use std::{
    io,
    mem::size_of,
    os::windows::{io::AsRawHandle, process::CommandExt},
    process::{Child, Command},
    ptr, thread,
    time::{Duration, Instant},
};

use windows_sys::Win32::{
    Foundation::{CloseHandle, ERROR_NO_MORE_FILES, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, TH32CS_SNAPTHREAD, THREADENTRY32, Thread32First, Thread32Next,
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
            JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOBOBJECT_BASIC_ACCOUNTING_INFORMATION,
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicAccountingInformation,
            JobObjectExtendedLimitInformation, QueryInformationJobObject, SetInformationJobObject,
            TerminateJobObject,
        },
        Threading::{
            CREATE_NEW_PROCESS_GROUP, CREATE_SUSPENDED, OpenThread, ResumeThread,
            THREAD_SUSPEND_RESUME,
        },
    },
};

const TERMINATION_CONFIRMATION_TIMEOUT: Duration = Duration::from_secs(2);
const TERMINATION_POLL_INTERVAL: Duration = Duration::from_millis(5);
const FORGE_TERMINATED_EXIT_CODE: u32 = 0xFFFF_FF01;

#[derive(Debug)]
pub(super) struct OwnedHandle(HANDLE);

impl OwnedHandle {
    pub(super) fn new(handle: HANDLE, operation: &str) -> Result<Self, String> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(last_error(operation));
        }
        Ok(Self(handle))
    }

    pub(super) fn raw(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        // SAFETY: this type owns one non-null Win32 handle and closes it exactly once.
        unsafe {
            CloseHandle(self.0);
        }
    }
}

#[derive(Debug)]
pub(super) struct WindowsJob {
    handle: OwnedHandle,
}

impl WindowsJob {
    #[cfg(test)]
    pub(super) fn create() -> Result<Self, String> {
        Self::create_with_resource_limits(None)
    }

    pub(super) fn create_with_resource_limits(
        resource_limits: Option<(u32, usize)>,
    ) -> Result<Self, String> {
        // SAFETY: null security attributes and name request one private job object.
        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        let handle = OwnedHandle::new(handle, "Could not create verifier Job Object")?;
        // SAFETY: the Win32 POD structure permits an all-zero initial state.
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
        limits.BasicLimitInformation.LimitFlags =
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
        if let Some((active_process_limit, process_memory_limit)) = resource_limits {
            if active_process_limit == 0 || process_memory_limit == 0 {
                return Err("Restricted Job Object resource limits must be positive.".to_owned());
            }
            limits.BasicLimitInformation.LimitFlags |=
                JOB_OBJECT_LIMIT_ACTIVE_PROCESS | JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            limits.BasicLimitInformation.ActiveProcessLimit = active_process_limit;
            limits.ProcessMemoryLimit = process_memory_limit;
        }
        // SAFETY: the information pointer and byte count describe a live structure of the
        // exact class requested, and the owned job handle remains valid for the call.
        let configured = unsafe {
            SetInformationJobObject(
                handle.raw(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
                    .map_err(|_| "Verifier Job Object limit structure is too large.".to_owned())?,
            )
        };
        if configured == 0 {
            return Err(last_error(
                "Could not configure verifier Job Object kill-on-close ownership",
            ));
        }
        Ok(Self { handle })
    }

    pub(super) fn configure_command(command: &mut Command) {
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_SUSPENDED);
    }

    pub(super) fn assign_and_resume(&self, child: &Child) -> Result<(), String> {
        let process_handle = child.as_raw_handle() as HANDLE;
        // SAFETY: both handles are live. The child was created suspended, so no verifier
        // code can create a descendant before successful assignment.
        let thread_id = suspended_primary_thread(child.id())?;
        // SAFETY: the enumerated thread belongs to the suspended child process.
        let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, thread_id) };
        let thread = OwnedHandle::new(thread, "Could not open suspended verifier thread")?;
        self.assign_process_and_resume_thread(process_handle, thread.raw())
    }

    pub(super) fn assign_process_and_resume_thread(
        &self,
        process_handle: HANDLE,
        thread_handle: HANDLE,
    ) -> Result<(), String> {
        // SAFETY: both handles are live and the primary thread remains suspended, so no
        // untrusted code can create a descendant before successful assignment.
        if unsafe { AssignProcessToJobObject(self.handle.raw(), process_handle) } == 0 {
            return Err(last_error(
                "Could not assign suspended verifier to its Job Object",
            ));
        }
        // SAFETY: the handle grants THREAD_SUSPEND_RESUME and is valid for this call.
        let previous_suspend_count = unsafe { ResumeThread(thread_handle) };
        if previous_suspend_count == u32::MAX {
            return Err(last_error("Could not resume the owned verifier process"));
        }
        if previous_suspend_count != 1 {
            return Err(format!(
                "Owned verifier had an unexpected suspend count: {previous_suspend_count}."
            ));
        }
        Ok(())
    }

    pub(super) fn request_termination(&self) -> Result<(), String> {
        // SAFETY: the owned handle identifies this verifier's private job hierarchy.
        if unsafe { TerminateJobObject(self.handle.raw(), FORGE_TERMINATED_EXIT_CODE) } == 0 {
            return Err(last_error("Could not terminate verifier Job Object"));
        }
        Ok(())
    }

    pub(super) fn confirm_empty(&self) -> Result<(), String> {
        let started = Instant::now();
        loop {
            // SAFETY: the Win32 POD output structure permits zero initialization.
            let mut accounting: JOBOBJECT_BASIC_ACCOUNTING_INFORMATION =
                unsafe { std::mem::zeroed() };
            // SAFETY: the output pointer and byte count describe a live structure of the
            // exact information class requested.
            let queried = unsafe {
                QueryInformationJobObject(
                    self.handle.raw(),
                    JobObjectBasicAccountingInformation,
                    (&raw mut accounting).cast(),
                    u32::try_from(size_of::<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>()).map_err(
                        |_| "Verifier Job Object accounting structure is too large.".to_owned(),
                    )?,
                    ptr::null_mut(),
                )
            };
            if queried == 0 {
                return Err(last_error("Could not query verifier Job Object state"));
            }
            if accounting.ActiveProcesses == 0 {
                return Ok(());
            }
            if started.elapsed() >= TERMINATION_CONFIRMATION_TIMEOUT {
                return Err(format!(
                    "Verifier Job Object still owns {} process(es) after termination.",
                    accounting.ActiveProcesses
                ));
            }
            thread::sleep(TERMINATION_POLL_INTERVAL);
        }
    }
}

fn suspended_primary_thread(process_id: u32) -> Result<u32, String> {
    // SAFETY: this requests a read-only system thread snapshot with no process filter.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    let snapshot = OwnedHandle::new(snapshot, "Could not enumerate suspended verifier threads")?;
    // SAFETY: the Win32 POD enumeration structure permits zero initialization.
    let mut entry: THREADENTRY32 = unsafe { std::mem::zeroed() };
    entry.dwSize = u32::try_from(size_of::<THREADENTRY32>())
        .map_err(|_| "Windows thread entry structure is too large.".to_owned())?;
    let mut matching = Vec::new();
    // SAFETY: entry has the required size and remains valid for the snapshot iteration.
    let mut available = unsafe { Thread32First(snapshot.raw(), &raw mut entry) } != 0;
    loop {
        if available && entry.th32OwnerProcessID == process_id {
            matching.push(entry.th32ThreadID);
        }
        if !available {
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_NO_MORE_FILES as i32) {
                return Err(format!(
                    "Could not enumerate suspended verifier threads: {error}"
                ));
            }
            break;
        }
        // SAFETY: the snapshot and output structure remain live and correctly sized.
        available = unsafe { Thread32Next(snapshot.raw(), &raw mut entry) } != 0;
    }
    if matching.len() != 1 {
        return Err(format!(
            "Expected one suspended primary verifier thread, found {}.",
            matching.len()
        ));
    }
    Ok(matching[0])
}

fn last_error(operation: &str) -> String {
    format!("{operation}: {}", io::Error::last_os_error())
}
