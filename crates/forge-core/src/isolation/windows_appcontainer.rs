// AppContainer evaluation module: an original Forge implementation against public
// Windows APIs. The boundary lifecycle is deliberately compiled before production
// selection so startup recovery remains reviewable. Remove this narrow preview
// allowance when the launcher is promoted out of conformance-only tests and every
// item becomes a production call path.
#![cfg_attr(not(test), allow(dead_code))]

use std::{
    collections::BTreeSet,
    ffi::{OsStr, c_void},
    fs::{self, OpenOptions},
    io::{self, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    ptr,
    sync::atomic::{AtomicU64, Ordering},
};

#[cfg(test)]
use std::{
    collections::{BTreeMap, HashSet},
    env,
    ffi::OsString,
    fs::File,
    mem::size_of,
    net::TcpListener,
    os::windows::{
        io::{AsRawHandle, FromRawHandle, IntoRawHandle, OwnedHandle as StdOwnedHandle},
        process::ExitStatusExt,
    },
    process::Command,
    sync::{Arc, atomic::AtomicUsize},
    thread,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
#[cfg(test)]
use windows_sys::Win32::{
    Foundation::{
        HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, SetHandleInformation, WAIT_FAILED,
        WAIT_OBJECT_0, WAIT_TIMEOUT,
    },
    Security::{SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES},
    System::{
        Pipes::CreatePipe,
        Threading::{
            CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_SUSPENDED,
            CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
            EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, InitializeProcThreadAttributeList,
            LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, STARTF_USESTDHANDLES,
            STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute, WaitForSingleObject,
        },
    },
};
use windows_sys::{
    Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NOT_FOUND, ERROR_SUCCESS, LocalFree},
        Security::{
            ACL,
            Authorization::{
                EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW, NO_MULTIPLE_TRUSTEE,
                REVOKE_ACCESS, SE_FILE_OBJECT, SetEntriesInAclW, SetNamedSecurityInfoW,
                TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
            },
            DACL_SECURITY_INFORMATION, FreeSid,
            Isolation::{
                CreateAppContainerProfile, DeleteAppContainerProfile,
                DeriveAppContainerSidFromAppContainerName, GetAppContainerFolderPath,
            },
            PSECURITY_DESCRIPTOR, PSID, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        },
        Storage::FileSystem::{FILE_GENERIC_EXECUTE, FILE_GENERIC_READ, FILE_GENERIC_WRITE},
        System::Com::CoTaskMemFree,
    },
    core::PWSTR,
};

#[cfg(test)]
use super::{
    CapturedOutput, IsolationEnforcement, IsolationEvidence, ProcessEnvironmentEvidence,
    capture_stream, windows_job::WindowsJob,
};
use super::{
    EffectiveSandboxPlan, IsolatedProcessOutcome, IsolatedProcessSpec, IsolationControl,
    IsolationPolicy, IsolationProfile, IsolationProvider, IsolationProviderAvailability,
    IsolationProviderCapabilities, IsolationProviderClass, IsolationProviderStatus,
    IsolationRequest, validate_effective_sandbox_plan,
};
use crate::Cancellation;

const MAX_RECOVERY_RECORDS: usize = 64;
const MAX_RECOVERY_RECORD_BYTES: usize = 16_384;
const MAX_GRANT_PATHS: usize = 257;
const PROFILE_PREFIX: &str = "ForgeEngine.Sandbox";
const RESIDUE_SCHEMA_VERSION: u32 = 3;
const CANDIDATE_ACCESS: u32 = FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE;
const READABLE_ACCESS: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
#[cfg(test)]
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(10);
#[cfg(test)]
const FORGE_TERMINATED_EXIT_CODE: u32 = 0xFFFF_FF01;
static PROFILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct WindowsAppContainerIsolationProvider {
    candidate_parent: PathBuf,
    recovery_root: PathBuf,
}

impl WindowsAppContainerIsolationProvider {
    pub fn preview_status() -> IsolationProviderStatus {
        IsolationProviderStatus {
            capabilities: IsolationProviderCapabilities {
                provider_id: "forge.windows.appcontainer.preview".to_owned(),
                supported_profiles: vec![IsolationProfile::Restricted],
                authenticates_host_attestations: false,
                restricted_controls: vec![
                    IsolationControl::Filesystem,
                    IsolationControl::Process,
                    IsolationControl::Network,
                    IsolationControl::Credentials,
                    IsolationControl::Resources,
                ],
            },
            provider_class: IsolationProviderClass::NativeStrong,
            availability: IsolationProviderAvailability::SetupRequired,
            limitations: vec![
                "The AppContainer preview remains unavailable to production transactions until its local same-corpus result is reproduced through packaging and hosted gates."
                    .to_owned(),
                "The preview projects policy-owned toolchains beneath .forge-toolchain with read/execute-only SID grants; the candidate remains writable while protected metadata and the projection remain unwritable."
                    .to_owned(),
                "A future managed Windows provider may add a dedicated lower-privilege identity, firewall/WFP policy, and private desktop without replacing this provider contract."
                    .to_owned(),
            ],
        }
    }

    pub fn try_new(candidate_parent: impl AsRef<Path>) -> Result<Self, String> {
        let candidate_parent = candidate_parent
            .as_ref()
            .canonicalize()
            .map_err(|error| format!("Cannot resolve sandbox candidate parent: {error}"))?;
        if !candidate_parent
            .metadata()
            .map_err(|error| format!("Cannot inspect sandbox candidate parent: {error}"))?
            .is_dir()
        {
            return Err("Sandbox candidate parent is not a directory.".to_owned());
        }
        let recovery_root = candidate_parent.join(".forge-sandbox-recovery");
        fs::create_dir_all(&recovery_root)
            .map_err(|error| format!("Cannot create sandbox recovery root: {error}"))?;
        if recovery_root
            .symlink_metadata()
            .map_err(|error| format!("Cannot inspect sandbox recovery root: {error}"))?
            .file_type()
            .is_symlink()
        {
            return Err("Sandbox recovery root must not be a symbolic link.".to_owned());
        }
        let recovery_root = recovery_root
            .canonicalize()
            .map_err(|error| format!("Cannot resolve sandbox recovery root: {error}"))?;
        if recovery_root.parent() != Some(candidate_parent.as_path()) {
            return Err("Sandbox recovery root escaped the candidate parent.".to_owned());
        }
        let provider = Self {
            candidate_parent,
            recovery_root,
        };
        provider.recover_abandoned_boundaries()?;
        Ok(provider)
    }

    fn recover_abandoned_boundaries(&self) -> Result<usize, String> {
        let mut entries = fs::read_dir(&self.recovery_root)
            .map_err(|error| format!("Cannot scan sandbox recovery root: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot inspect sandbox recovery entry: {error}"))?;
        entries.sort_by_key(|entry| entry.file_name());
        if entries.len() > MAX_RECOVERY_RECORDS {
            return Err(format!(
                "Sandbox recovery root contains more than {MAX_RECOVERY_RECORDS} entries."
            ));
        }
        let mut recovered = 0;
        for entry in entries {
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Cannot inspect sandbox recovery record: {error}"))?;
            if !metadata.is_file() {
                return Err("Sandbox recovery root contains a non-file entry.".to_owned());
            }
            let record = SandboxResidueRecord::read(&entry.path())?;
            record.validate(&self.candidate_parent)?;
            cleanup_record(&record)?;
            fs::remove_file(entry.path())
                .map_err(|error| format!("Cannot remove recovered sandbox record: {error}"))?;
            recovered += 1;
        }
        Ok(recovered)
    }

    fn prepare_boundary(&self, plan: &EffectiveSandboxPlan) -> Result<PreparedBoundary, String> {
        if plan.working_directory.parent() != Some(self.candidate_parent.as_path()) {
            return Err(
                "Restricted working directory must be a direct disposable candidate child."
                    .to_owned(),
            );
        }
        let sequence = PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let profile_name = format!(
            "{PROFILE_PREFIX}.{}.{}.{}",
            &plan.plan_digest[..16],
            std::process::id(),
            sequence
        );
        let protected_paths = plan
            .protected_relative_paths
            .iter()
            .map(|relative| plan.working_directory.join(relative))
            .filter(|path| path.exists())
            .collect::<Vec<_>>();
        // Do not place one recursive write ACE on the candidate root: Windows treats
        // the AppContainer package SID as a restricted grant, so a deny ACE for that
        // same SID does not reliably protect inherited metadata paths. Instead, grant
        // the root without inheritance and grant only existing safe top-level entries.
        // Future improvement: replace this bounded preview with brokered read/write
        // projections so new root paths and read-only metadata have explicit semantics.
        let mut granted_paths = vec![plan.working_directory.clone()];
        let mut children = fs::read_dir(&plan.working_directory)
            .map_err(|error| format!("Cannot enumerate sandbox candidate: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot inspect sandbox candidate entry: {error}"))?;
        children.sort_by_key(|entry| entry.file_name());
        for entry in children {
            let path = entry.path();
            if protected_paths.contains(&path) {
                continue;
            }
            if entry
                .file_type()
                .map_err(|error| format!("Cannot inspect sandbox candidate entry: {error}"))?
                .is_symlink()
            {
                return Err(format!(
                    "Restricted candidate top-level entry {} must not be a symbolic link.",
                    path.display()
                ));
            }
            granted_paths.push(path);
        }
        if granted_paths.len() > MAX_GRANT_PATHS {
            return Err(format!(
                "Restricted candidate has more than {} grantable top-level entries.",
                MAX_GRANT_PATHS - 1
            ));
        }
        let mut readable_paths = plan
            .readable_roots
            .iter()
            .filter(|path| *path != &plan.working_directory)
            .cloned()
            .collect::<Vec<_>>();
        readable_paths.sort();
        readable_paths.dedup();
        let record = SandboxResidueRecord {
            schema_version: RESIDUE_SCHEMA_VERSION,
            profile_name,
            candidate_path: plan.working_directory.clone(),
            protected_paths,
            granted_paths,
            readable_paths,
        };
        record.validate(&self.candidate_parent)?;
        let record_path = self.recovery_root.join(format!(
            "boundary-{}-{}-{}.json",
            &plan.plan_digest[..16],
            std::process::id(),
            sequence
        ));
        record.write_new(&record_path)?;
        let profile = match AppContainerProfile::create(&record.profile_name) {
            Ok(profile) => profile,
            Err(error) => {
                let _ = fs::remove_file(&record_path);
                return Err(error);
            }
        };
        if let Err(error) = grant_record(&record, profile.sid) {
            let cleanup = cleanup_record_with_sid(&record, profile.sid);
            let mut profile = profile;
            let profile_cleanup = if cleanup.is_ok() {
                profile.cleanup()
            } else {
                // The profile name is the durable way to derive the unique SID during
                // recovery. Keep it registered if any ACE could remain.
                profile.retain_for_recovery();
                Err("Profile cleanup was deferred so ACL recovery remains possible.".to_owned())
            };
            if cleanup.is_ok() && profile_cleanup.is_ok() {
                let _ = fs::remove_file(&record_path);
            }
            return Err(combine_cleanup_error(error, cleanup, profile_cleanup));
        }
        Ok(PreparedBoundary {
            record,
            record_path,
            profile,
            cleaned: false,
        })
    }
}

impl IsolationProvider for WindowsAppContainerIsolationProvider {
    fn status(&self) -> IsolationProviderStatus {
        Self::preview_status()
    }

    fn execute_restricted(
        &self,
        plan: &EffectiveSandboxPlan,
        process: &IsolatedProcessSpec,
        _cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        validate_effective_sandbox_plan(plan, &self.status(), process)?;
        Err(
            "The AppContainer preview has not passed its native process-launch conformance gate."
                .to_owned(),
        )
    }

    fn execute(
        &self,
        _policy: &IsolationPolicy,
        _request: &IsolationRequest,
        _process: &IsolatedProcessSpec,
        _cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        Err("The AppContainer provider accepts only compiled restricted plans.".to_owned())
    }
}

#[cfg(test)]
impl WindowsAppContainerIsolationProvider {
    fn execute_conformance_plan(
        &self,
        plan: &EffectiveSandboxPlan,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        let mut conformance_status = self.status();
        conformance_status.availability = IsolationProviderAvailability::Available;
        validate_effective_sandbox_plan(plan, &conformance_status, process)?;
        if cancellation.reason().is_some() {
            return Err(
                "Restricted verifier launch was cancelled before boundary setup.".to_owned(),
            );
        }
        let mut boundary = self.prepare_boundary(plan)?;
        let boundary_id = format!("appcontainer:{}", boundary.record.profile_name);
        let execution = run_appcontainer_process(plan, process, &boundary.profile, cancellation);
        let cleanup = boundary.cleanup();
        let (execution, environment) = match (execution, cleanup) {
            (Ok(execution), Ok(())) => execution,
            (Err(error), Ok(())) => return Err(error),
            (Ok(_), Err(cleanup_error)) => {
                return Err(format!(
                    "Restricted verifier completed but boundary cleanup failed: {cleanup_error}"
                ));
            }
            (Err(error), Err(cleanup_error)) => {
                return Err(format!(
                    "{error} Boundary cleanup also failed: {cleanup_error}"
                ));
            }
        };
        Ok(IsolatedProcessOutcome {
            status: execution.status,
            timed_out: execution.timed_out,
            cancelled: execution.cancelled,
            stdout: execution.stdout,
            stderr: execution.stderr,
            isolation: IsolationEvidence {
                requested_profile: IsolationProfile::Restricted,
                effective_profile: IsolationProfile::Restricted,
                enforcement: IsolationEnforcement::ForgeEnforced,
                provider_id: self.status().capabilities.provider_id,
                boundary_id: Some(boundary_id),
                plan_digest: Some(plan.plan_digest.clone()),
                forge_enforced: true,
                controls: plan.required_controls.clone(),
                host_authority: None,
                limitations: self.status().limitations,
            },
            environment,
        })
    }
}

#[cfg(test)]
struct AppContainerProcessResult {
    status: Option<std::process::ExitStatus>,
    timed_out: bool,
    cancelled: bool,
    stdout: CapturedOutput,
    stderr: CapturedOutput,
}

#[cfg(test)]
fn run_appcontainer_process(
    plan: &EffectiveSandboxPlan,
    process: &IsolatedProcessSpec,
    profile: &AppContainerProfile,
    cancellation: &dyn Cancellation,
) -> Result<(AppContainerProcessResult, ProcessEnvironmentEvidence), String> {
    let (environment_block, environment_evidence) =
        appcontainer_environment(process, &profile.folder)?;
    // Create and configure the Job before CreateProcessW. If Job setup fails there
    // is no suspended child to orphan; the child is assigned before its first
    // instruction and every later exit path can terminate through the owned Job.
    let resource_limits = if plan.enforce_resource_limits {
        Some((
            plan.max_active_processes
                .ok_or_else(|| "Sandbox plan omits active-process limit.".to_owned())?,
            plan.max_process_memory_bytes
                .ok_or_else(|| "Sandbox plan omits process-memory limit.".to_owned())?,
        ))
    } else {
        None
    };
    let job = WindowsJob::create_with_resource_limits(resource_limits)?;
    let stdout_pipe = InheritedOutputPipe::create("stdout")?;
    let stderr_pipe = InheritedOutputPipe::create("stderr")?;
    let stdin_pipe = InheritedInputPipe::create()?;
    let inherited_handles = [
        stdin_pipe.child_read.raw(),
        stdout_pipe.child_write.raw(),
        stderr_pipe.child_write.raw(),
    ];
    let security_capabilities = SECURITY_CAPABILITIES {
        AppContainerSid: profile.sid,
        Capabilities: ptr::null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    let mut attributes = ProcessAttributeList::new(&security_capabilities, &inherited_handles)?;
    // SAFETY: the Win32 startup structure permits zero initialization.
    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = u32::try_from(size_of::<STARTUPINFOEXW>())
        .map_err(|_| "Windows startup structure is too large.".to_owned())?;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin_pipe.child_read.raw();
    startup.StartupInfo.hStdOutput = stdout_pipe.child_write.raw();
    startup.StartupInfo.hStdError = stderr_pipe.child_write.raw();
    startup.lpAttributeList = attributes.raw();
    let executable = wide_os(plan.executable.as_os_str())?;
    let mut command_line = windows_command_line(&plan.executable, &process.arguments)?;
    let launch_working_directory = win32_launch_path(&plan.working_directory);
    let working_directory = wide_os(launch_working_directory.as_os_str())?;
    // SAFETY: the Win32 process-information structure permits zero initialization.
    let mut information: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let creation_flags = CREATE_SUSPENDED
        | CREATE_NEW_PROCESS_GROUP
        | CREATE_NO_WINDOW
        | CREATE_UNICODE_ENVIRONMENT
        | EXTENDED_STARTUPINFO_PRESENT;
    // SAFETY: all pointers reference live buffers for the duration of the call. Only
    // the three explicit standard handles are inheritable and included in the handle
    // list. The AppContainer attribute is applied before the suspended child runs.
    let created = unsafe {
        CreateProcessW(
            executable.as_ptr(),
            command_line.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            creation_flags,
            environment_block.as_ptr().cast(),
            working_directory.as_ptr(),
            &raw const startup.StartupInfo,
            &raw mut information,
        )
    };
    if created == 0 {
        return Err(format!(
            "Cannot launch AppContainer verifier: {}",
            io::Error::last_os_error()
        ));
    }
    // SAFETY: CreateProcessW returned newly owned process and thread handles.
    let process_handle = unsafe { WinHandle::from_raw(information.hProcess) }?;
    // SAFETY: CreateProcessW returned newly owned process and thread handles.
    let thread_handle = unsafe { WinHandle::from_raw(information.hThread) }?;
    drop(attributes);
    drop(stdin_pipe.child_read);
    drop(stdout_pipe.child_write);
    drop(stderr_pipe.child_write);
    let budget = Arc::new(AtomicUsize::new(0));
    let stdout_capture = capture_stream(
        stdout_pipe.parent_read.into_file(),
        Arc::clone(&budget),
        process.max_output_bytes,
    );
    let stderr_capture = capture_stream(
        stderr_pipe.parent_read.into_file(),
        budget,
        process.max_output_bytes,
    );
    if let Err(error) =
        job.assign_process_and_resume_thread(process_handle.raw(), thread_handle.raw())
    {
        let termination = terminate_unstarted_process(process_handle.raw());
        drop(thread_handle);
        drop(process_handle);
        let stdout_cleanup = stdout_capture
            .join()
            .map_err(|_| "AppContainer stdout capture panicked during failed launch.".to_owned())
            .and_then(|result| result.map(|_| ()));
        let stderr_cleanup = stderr_capture
            .join()
            .map_err(|_| "AppContainer stderr capture panicked during failed launch.".to_owned())
            .and_then(|result| result.map(|_| ()));
        let mut errors = vec![error];
        for cleanup in [termination, stdout_cleanup, stderr_cleanup] {
            if let Err(cleanup_error) = cleanup {
                errors.push(format!("Launch cleanup also failed: {cleanup_error}"));
            }
        }
        return Err(errors.join(" "));
    }
    drop(thread_handle);

    let started = Instant::now();
    let mut timed_out = false;
    let mut cancelled = false;
    let observed_exit = loop {
        if cancellation.reason().is_some() {
            cancelled = true;
            break None;
        }
        if started.elapsed() >= process.timeout {
            timed_out = true;
            break None;
        }
        // SAFETY: process_handle remains live throughout the wait loop.
        match unsafe { WaitForSingleObject(process_handle.raw(), 10) } {
            WAIT_OBJECT_0 => break Some(process_exit_code(process_handle.raw())?),
            WAIT_TIMEOUT => thread::sleep(PROCESS_POLL_INTERVAL),
            WAIT_FAILED => {
                let error = io::Error::last_os_error();
                let cleanup = terminate_job(&job, process_handle.raw());
                return match cleanup {
                    Ok(_) => Err(format!("Cannot observe AppContainer verifier: {error}")),
                    Err(cleanup_error) => Err(format!(
                        "Cannot observe AppContainer verifier: {error}. Cleanup also failed: {cleanup_error}"
                    )),
                };
            }
            other => {
                let cleanup = terminate_job(&job, process_handle.raw());
                return match cleanup {
                    Ok(_) => Err(format!("Unexpected Windows process wait result: {other}.")),
                    Err(cleanup_error) => Err(format!(
                        "Unexpected Windows process wait result: {other}. Cleanup also failed: {cleanup_error}"
                    )),
                };
            }
        }
    };
    let terminated_exit = terminate_job(&job, process_handle.raw())?;
    let exit_code = observed_exit.unwrap_or(terminated_exit);
    drop(process_handle);
    let stdout = stdout_capture
        .join()
        .map_err(|_| "AppContainer stdout capture panicked.".to_owned())??;
    let stderr = stderr_capture
        .join()
        .map_err(|_| "AppContainer stderr capture panicked.".to_owned())??;
    Ok((
        AppContainerProcessResult {
            status: Some(std::process::ExitStatus::from_raw(exit_code)),
            timed_out,
            cancelled,
            stdout,
            stderr,
        },
        environment_evidence,
    ))
}

#[cfg(test)]
struct WinHandle(StdOwnedHandle);

#[cfg(test)]
impl WinHandle {
    unsafe fn from_raw(handle: HANDLE) -> Result<Self, String> {
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            return Err(format!(
                "Invalid Windows handle: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: the caller transfers one newly owned Win32 handle into this object.
        Ok(Self(unsafe { StdOwnedHandle::from_raw_handle(handle) }))
    }

    fn raw(&self) -> HANDLE {
        self.0.as_raw_handle()
    }

    fn into_file(self) -> File {
        let handle = self.0.into_raw_handle();
        // SAFETY: ownership of the same live handle transfers from OwnedHandle to File.
        unsafe { File::from_raw_handle(handle) }
    }
}

#[cfg(test)]
struct InheritedOutputPipe {
    parent_read: WinHandle,
    child_write: WinHandle,
}

#[cfg(test)]
impl InheritedOutputPipe {
    fn create(label: &str) -> Result<Self, String> {
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>())
                .map_err(|_| "Windows security-attributes structure is too large.".to_owned())?,
            lpSecurityDescriptor: ptr::null_mut(),
            bInheritHandle: 1,
        };
        let mut read = ptr::null_mut();
        let mut write = ptr::null_mut();
        // SAFETY: both output pointers and the initialized attributes remain live.
        if unsafe { CreatePipe(&raw mut read, &raw mut write, &raw mut attributes, 0) } == 0 {
            return Err(format!(
                "Cannot create AppContainer {label} pipe: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: CreatePipe returned two newly owned handles.
        let parent_read = unsafe { WinHandle::from_raw(read) }?;
        // SAFETY: CreatePipe returned two newly owned handles.
        let child_write = unsafe { WinHandle::from_raw(write) }?;
        // SAFETY: parent_read is live and this clears only its inheritance bit.
        if unsafe { SetHandleInformation(parent_read.raw(), HANDLE_FLAG_INHERIT, 0) } == 0 {
            return Err(format!(
                "Cannot make AppContainer {label} capture private: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(Self {
            parent_read,
            child_write,
        })
    }
}

#[cfg(test)]
struct InheritedInputPipe {
    child_read: WinHandle,
}

#[cfg(test)]
impl InheritedInputPipe {
    fn create() -> Result<Self, String> {
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>())
                .map_err(|_| "Windows security-attributes structure is too large.".to_owned())?,
            lpSecurityDescriptor: ptr::null_mut(),
            bInheritHandle: 1,
        };
        let mut read = ptr::null_mut();
        let mut write = ptr::null_mut();
        // SAFETY: both output pointers and the initialized attributes remain live.
        if unsafe { CreatePipe(&raw mut read, &raw mut write, &raw mut attributes, 0) } == 0 {
            return Err(format!(
                "Cannot create AppContainer stdin pipe: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: CreatePipe returned two newly owned handles.
        let child_read = unsafe { WinHandle::from_raw(read) }?;
        // SAFETY: CreatePipe returned this handle; dropping it before launch makes
        // child stdin observe EOF without inheriting an ambient parent handle.
        drop(unsafe { WinHandle::from_raw(write) }?);
        Ok(Self { child_read })
    }
}

#[cfg(test)]
struct ProcessAttributeList {
    storage: Vec<usize>,
}

#[cfg(test)]
impl ProcessAttributeList {
    fn new(
        security_capabilities: &SECURITY_CAPABILITIES,
        handles: &[HANDLE],
    ) -> Result<Self, String> {
        let mut bytes = 0_usize;
        // SAFETY: the documented sizing call uses a null list and returns required bytes.
        unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), 2, 0, &raw mut bytes) };
        if bytes == 0 {
            return Err(format!(
                "Cannot size Windows process attributes: {}",
                io::Error::last_os_error()
            ));
        }
        let words = bytes.div_ceil(size_of::<usize>());
        let mut storage = vec![0_usize; words];
        let raw = storage.as_mut_ptr().cast();
        // SAFETY: storage is aligned and large enough for the reported attribute list.
        if unsafe { InitializeProcThreadAttributeList(raw, 2, 0, &raw mut bytes) } == 0 {
            return Err(format!(
                "Cannot initialize Windows process attributes: {}",
                io::Error::last_os_error()
            ));
        }
        let mut list = Self { storage };
        // SAFETY: raw points into list storage and security_capabilities lives through
        // CreateProcessW; the attribute API copies the pointer-sized descriptor value.
        if unsafe {
            UpdateProcThreadAttribute(
                list.raw(),
                0,
                PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                (security_capabilities as *const SECURITY_CAPABILITIES).cast(),
                size_of::<SECURITY_CAPABILITIES>(),
                ptr::null_mut(),
                ptr::null(),
            )
        } == 0
        {
            return Err(format!(
                "Cannot attach AppContainer security capabilities: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: handles is a live fixed list through CreateProcessW.
        if unsafe {
            UpdateProcThreadAttribute(
                list.raw(),
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_ptr().cast(),
                std::mem::size_of_val(handles),
                ptr::null_mut(),
                ptr::null(),
            )
        } == 0
        {
            return Err(format!(
                "Cannot restrict AppContainer inherited handles: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(list)
    }

    fn raw(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
        self.storage.as_mut_ptr().cast()
    }
}

#[cfg(test)]
impl Drop for ProcessAttributeList {
    fn drop(&mut self) {
        // SAFETY: this list was initialized successfully and storage remains live.
        unsafe { DeleteProcThreadAttributeList(self.raw()) };
    }
}

#[cfg(test)]
fn appcontainer_environment(
    process: &IsolatedProcessSpec,
    profile_folder: &Path,
) -> Result<(Vec<u16>, ProcessEnvironmentEvidence), String> {
    let temporary = profile_folder.join("Temp");
    let local = profile_folder.join("Local");
    let roaming = profile_folder.join("Roaming");
    for directory in [&temporary, &local, &roaming] {
        fs::create_dir_all(directory).map_err(|error| {
            format!(
                "Cannot create AppContainer environment directory {}: {error}",
                directory.display()
            )
        })?;
    }
    let fixed_keys = process
        .environment
        .iter()
        .map(|(name, _)| name.to_uppercase())
        .collect::<HashSet<_>>();
    let mut values = BTreeMap::<String, (String, OsString)>::new();
    let mut inherited_names = Vec::new();
    for name in ["PATH", "PATHEXT", "SystemRoot", "WINDIR", "ComSpec"]
        .into_iter()
        .chain(process.inherited_environment.iter().map(String::as_str))
    {
        let key = name.to_uppercase();
        if fixed_keys.contains(&key) || values.contains_key(&key) {
            continue;
        }
        if let Some(value) = env::var_os(name) {
            values.insert(key, (name.to_owned(), value));
            inherited_names.push(name.to_owned());
        } else if process
            .inherited_environment
            .iter()
            .any(|configured| configured.eq_ignore_ascii_case(name))
        {
            return Err(format!(
                "Policy-allowlisted environment variable {name} is unavailable."
            ));
        }
    }
    for (name, value) in &process.environment {
        values.insert(name.to_uppercase(), (name.clone(), OsString::from(value)));
    }
    let synthetic = [
        ("USERPROFILE", profile_folder),
        ("HOME", profile_folder),
        ("LOCALAPPDATA", local.as_path()),
        ("APPDATA", roaming.as_path()),
        ("TEMP", temporary.as_path()),
        ("TMP", temporary.as_path()),
    ];
    for (name, value) in synthetic {
        values.insert(
            name.to_owned(),
            (name.to_owned(), value.as_os_str().to_owned()),
        );
    }
    let launch_working_directory = win32_launch_path(&process.working_directory);
    if let Some(name) = drive_current_directory_name(&launch_working_directory) {
        values.insert(
            name.to_uppercase(),
            (name.clone(), launch_working_directory.into_os_string()),
        );
    }
    let mut block = Vec::new();
    for (_, (name, value)) in values {
        let mut entry = OsString::from(name);
        entry.push("=");
        entry.push(value);
        let encoded = entry.encode_wide().collect::<Vec<_>>();
        if encoded.contains(&0) {
            return Err("AppContainer environment contains an embedded NUL.".to_owned());
        }
        block.extend(encoded);
        block.push(0);
    }
    block.push(0);
    inherited_names.sort();
    inherited_names.dedup();
    let mut fixed_names = process
        .environment
        .iter()
        .map(|(name, _)| name.clone())
        .chain(
            [
                "USERPROFILE",
                "HOME",
                "LOCALAPPDATA",
                "APPDATA",
                "TEMP",
                "TMP",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .collect::<Vec<_>>();
    fixed_names.sort();
    fixed_names.dedup();
    Ok((
        block,
        ProcessEnvironmentEvidence {
            cleared: true,
            inherited_names,
            fixed_names,
        },
    ))
}

#[cfg(test)]
fn drive_current_directory_name(path: &Path) -> Option<String> {
    let value = path.to_string_lossy();
    let bytes = value.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/'))
        .then(|| format!("={}", &value[..2]))
}

#[cfg(test)]
fn win32_launch_path(path: &Path) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    value
        .strip_prefix(r"\\?\")
        .map(PathBuf::from)
        .unwrap_or_else(|| path.to_owned())
}

#[cfg(test)]
fn windows_command_line(executable: &Path, arguments: &[String]) -> Result<Vec<u16>, String> {
    let executable = executable
        .to_str()
        .ok_or_else(|| "AppContainer executable path is not Unicode.".to_owned())?;
    let mut rendered = quote_windows_argument(executable);
    for argument in arguments {
        rendered.push(' ');
        rendered.push_str(&quote_windows_argument(argument));
    }
    wide(&rendered)
}

#[cfg(test)]
fn quote_windows_argument(value: &str) -> String {
    if !value.is_empty()
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character == '"')
    {
        return value.to_owned();
    }
    let mut rendered = String::from("\"");
    let mut backslashes = 0;
    for character in value.chars() {
        if character == '\\' {
            backslashes += 1;
        } else if character == '"' {
            rendered.push_str(&"\\".repeat(backslashes * 2 + 1));
            rendered.push('"');
            backslashes = 0;
        } else {
            rendered.push_str(&"\\".repeat(backslashes));
            backslashes = 0;
            rendered.push(character);
        }
    }
    rendered.push_str(&"\\".repeat(backslashes * 2));
    rendered.push('"');
    rendered
}

#[cfg(test)]
fn process_exit_code(process: HANDLE) -> Result<u32, String> {
    let mut exit_code = 0_u32;
    // SAFETY: process is a live process handle and exit_code is writable.
    if unsafe { GetExitCodeProcess(process, &raw mut exit_code) } == 0 {
        return Err(format!(
            "Cannot read AppContainer verifier exit code: {}",
            io::Error::last_os_error()
        ));
    }
    Ok(exit_code)
}

#[cfg(test)]
fn terminate_job(job: &WindowsJob, process: HANDLE) -> Result<u32, String> {
    job.request_termination()?;
    // SAFETY: process remains live while waiting for job termination to signal it.
    let wait = unsafe { WaitForSingleObject(process, 2_000) };
    if wait != WAIT_OBJECT_0 {
        return Err(format!(
            "AppContainer verifier did not terminate within the cleanup deadline: {wait}."
        ));
    }
    let exit_code = process_exit_code(process)?;
    job.confirm_empty()?;
    Ok(exit_code)
}

#[cfg(test)]
fn terminate_unstarted_process(process: HANDLE) -> Result<(), String> {
    // SAFETY: CreateProcessW returned this live process handle. The process is either
    // still suspended or already owned by the Job, and direct termination is valid in
    // both cases before the Job handle is dropped.
    if unsafe { TerminateProcess(process, FORGE_TERMINATED_EXIT_CODE) } == 0 {
        return Err(format!(
            "Cannot terminate failed AppContainer launch: {}",
            io::Error::last_os_error()
        ));
    }
    // SAFETY: process remains live until this bounded wait completes.
    let wait = unsafe { WaitForSingleObject(process, 2_000) };
    if wait != WAIT_OBJECT_0 {
        return Err(format!(
            "Failed AppContainer launch did not terminate within the cleanup deadline: {wait}."
        ));
    }
    Ok(())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SandboxResidueRecord {
    schema_version: u32,
    profile_name: String,
    candidate_path: PathBuf,
    protected_paths: Vec<PathBuf>,
    granted_paths: Vec<PathBuf>,
    readable_paths: Vec<PathBuf>,
}

impl SandboxResidueRecord {
    fn validate(&self, candidate_parent: &Path) -> Result<(), String> {
        let allowed_protected = [".git", ".forge", ".agents", ".codex", ".forge-toolchain"]
            .into_iter()
            .map(|name| self.candidate_path.join(name))
            .collect::<BTreeSet<_>>();
        let unique_protected = self
            .protected_paths
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>();
        let unique_grants = self.granted_paths.iter().cloned().collect::<BTreeSet<_>>();
        let unique_readable = self.readable_paths.iter().cloned().collect::<BTreeSet<_>>();
        if self.schema_version != RESIDUE_SCHEMA_VERSION
            || !valid_profile_name(&self.profile_name)
            || self.candidate_path.parent() != Some(candidate_parent)
            || self.protected_paths.len() > 5
            || self.granted_paths.is_empty()
            || self.granted_paths.len() > MAX_GRANT_PATHS
            || self.readable_paths.len() > super::MAX_READABLE_ROOTS
            || self.granted_paths.first() != Some(&self.candidate_path)
            || unique_protected.len() != self.protected_paths.len()
            || unique_grants.len() != self.granted_paths.len()
            || unique_readable.len() != self.readable_paths.len()
            || self
                .protected_paths
                .iter()
                .any(|path| !allowed_protected.contains(path))
            || self.granted_paths.iter().skip(1).any(|path| {
                path.parent() != Some(self.candidate_path.as_path())
                    || self.protected_paths.contains(path)
            })
            || self.readable_paths.iter().any(|path| {
                !path.starts_with(candidate_parent)
                    || path == &candidate_parent.join(".forge-sandbox-recovery")
                    || (path.starts_with(&self.candidate_path)
                        && !self
                            .protected_paths
                            .iter()
                            .any(|protected| path == protected || path.starts_with(protected)))
                    || !path.is_dir()
                    || path
                        .symlink_metadata()
                        .is_ok_and(|metadata| metadata.file_type().is_symlink())
            })
        {
            return Err(
                "Sandbox recovery record is invalid or escaped its provider-owned root.".to_owned(),
            );
        }
        Ok(())
    }

    fn write_new(&self, path: &Path) -> Result<(), String> {
        let bytes = serde_json::to_vec(self)
            .map_err(|_| "Cannot encode sandbox recovery record.".to_owned())?;
        if bytes.len().saturating_add(1) > MAX_RECOVERY_RECORD_BYTES {
            return Err(format!(
                "Sandbox recovery record exceeds {MAX_RECOVERY_RECORD_BYTES} bytes."
            ));
        }
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .map_err(|error| format!("Cannot create sandbox recovery record: {error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Cannot persist sandbox recovery record: {error}"))
    }

    fn read(path: &Path) -> Result<Self, String> {
        let metadata = path
            .metadata()
            .map_err(|error| format!("Cannot inspect sandbox recovery record: {error}"))?;
        if metadata.len() > MAX_RECOVERY_RECORD_BYTES as u64 {
            return Err(format!(
                "Sandbox recovery record exceeds {MAX_RECOVERY_RECORD_BYTES} bytes."
            ));
        }
        let bytes = fs::read(path)
            .map_err(|error| format!("Cannot read sandbox recovery record: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|_| "Sandbox recovery record is malformed.".to_owned())
    }
}

struct AppContainerProfile {
    name: Vec<u16>,
    sid: PSID,
    folder: PathBuf,
    deleted: bool,
    delete_on_drop: bool,
}

impl AppContainerProfile {
    fn create(profile_name: &str) -> Result<Self, String> {
        let name = wide(profile_name)?;
        let display = wide("ForgeEngine disposable sandbox")?;
        let description = wide("Disposable ForgeEngine verifier boundary")?;
        let mut sid = ptr::null_mut();
        // SAFETY: strings are NUL-terminated and live for the call. No capabilities
        // are supplied, so direct network access remains denied by AppContainer.
        let result = unsafe {
            CreateAppContainerProfile(
                name.as_ptr(),
                display.as_ptr(),
                description.as_ptr(),
                ptr::null(),
                0,
                &raw mut sid,
            )
        };
        if result < 0 || sid.is_null() {
            return Err(hresult_error(
                "Cannot create disposable AppContainer profile",
                result,
            ));
        }
        let folder = match appcontainer_folder(sid) {
            Ok(folder) => folder,
            Err(error) => {
                // SAFETY: the profile creation returned this SID allocation.
                unsafe { FreeSid(sid) };
                // SAFETY: name identifies only the unique profile created above.
                unsafe { DeleteAppContainerProfile(name.as_ptr()) };
                return Err(error);
            }
        };
        Ok(Self {
            name,
            sid,
            folder,
            deleted: false,
            delete_on_drop: true,
        })
    }

    fn retain_for_recovery(&mut self) {
        self.delete_on_drop = false;
    }

    fn cleanup(&mut self) -> Result<(), String> {
        if self.deleted {
            return Ok(());
        }
        // SAFETY: name identifies the unique disposable profile owned by this object.
        let result = unsafe { DeleteAppContainerProfile(self.name.as_ptr()) };
        if result < 0 && !hresult_is_not_found(result) {
            return Err(hresult_error(
                "Cannot delete disposable AppContainer profile",
                result,
            ));
        }
        self.deleted = true;
        Ok(())
    }
}

impl Drop for AppContainerProfile {
    fn drop(&mut self) {
        if self.delete_on_drop {
            let _ = self.cleanup();
        }
        if !self.sid.is_null() {
            // SAFETY: this object owns the SID returned by profile creation.
            unsafe { FreeSid(self.sid) };
            self.sid = ptr::null_mut();
        }
    }
}

struct PreparedBoundary {
    record: SandboxResidueRecord,
    record_path: PathBuf,
    profile: AppContainerProfile,
    cleaned: bool,
}

impl PreparedBoundary {
    fn cleanup(&mut self) -> Result<(), String> {
        if self.cleaned {
            return Ok(());
        }
        if let Err(error) = cleanup_record_with_sid(&self.record, self.profile.sid) {
            // Do not delete the profile after incomplete ACE revocation: its name lets
            // the next provider startup derive the same SID and retry safely.
            self.profile.retain_for_recovery();
            return Err(error);
        }
        self.profile.cleanup()?;
        fs::remove_file(&self.record_path)
            .map_err(|error| format!("Cannot remove sandbox recovery record: {error}"))?;
        self.cleaned = true;
        Ok(())
    }

    #[cfg(test)]
    fn abandon_for_recovery_test(mut self) {
        // Model abrupt owner death without leaking the process-local SID allocation.
        // The journal, OS profile, and unique ACEs intentionally remain for try_new().
        self.cleaned = true;
        self.profile.retain_for_recovery();
    }
}

impl Drop for PreparedBoundary {
    fn drop(&mut self) {
        let _ = self.cleanup();
    }
}

fn grant_record(record: &SandboxResidueRecord, sid: PSID) -> Result<(), String> {
    // Every mutation is an ACE for this unique disposable SID. Cleanup revokes only
    // that SID and therefore does not restore or overwrite unrelated administrator
    // changes made to the Forge-owned candidate while the boundary exists.
    for path in record.granted_paths.iter().rev() {
        if path.exists() {
            let inherit = path != &record.candidate_path
                && path
                    .metadata()
                    .map_err(|error| {
                        format!(
                            "Cannot inspect sandbox grant path {}: {error}",
                            path.display()
                        )
                    })?
                    .is_dir();
            update_acl(path, sid, GRANT_ACCESS, CANDIDATE_ACCESS, inherit)?;
        }
    }
    for path in &record.readable_paths {
        update_acl(path, sid, GRANT_ACCESS, READABLE_ACCESS, true)?;
    }
    Ok(())
}

fn cleanup_record(record: &SandboxResidueRecord) -> Result<(), String> {
    let profile_name = wide(&record.profile_name)?;
    let mut sid = ptr::null_mut();
    // SAFETY: profile name is NUL-terminated and sid receives an allocation on success.
    let result =
        unsafe { DeriveAppContainerSidFromAppContainerName(profile_name.as_ptr(), &raw mut sid) };
    if result < 0 || sid.is_null() {
        return Err(hresult_error(
            "Cannot derive abandoned AppContainer SID",
            result,
        ));
    }
    let cleanup = cleanup_record_with_sid(record, sid);
    // SAFETY: the derive call returned this SID allocation.
    unsafe { FreeSid(sid) };
    cleanup?;
    // SAFETY: the profile name is valid and identifies the abandoned profile.
    let result = unsafe { DeleteAppContainerProfile(profile_name.as_ptr()) };
    if result < 0 && !hresult_is_not_found(result) {
        return Err(hresult_error(
            "Cannot delete abandoned AppContainer profile",
            result,
        ));
    }
    Ok(())
}

fn cleanup_record_with_sid(record: &SandboxResidueRecord, sid: PSID) -> Result<(), String> {
    let mut errors = Vec::new();
    for path in record.readable_paths.iter().rev() {
        if path.exists()
            && let Err(error) = update_acl(path, sid, REVOKE_ACCESS, 0, true)
        {
            errors.push(format!("{}: {error}", path.display()));
        }
    }
    for path in record.granted_paths.iter().rev() {
        if path.exists()
            && let Err(error) = update_acl(path, sid, REVOKE_ACCESS, 0, true)
        {
            errors.push(format!("{}: {error}", path.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Cannot fully revoke disposable AppContainer ACL entries: {}",
            errors.join("; ")
        ))
    }
}

fn update_acl(
    path: &Path,
    sid: PSID,
    mode: i32,
    permissions: u32,
    inherit: bool,
) -> Result<(), String> {
    let path = wide_os(path.as_os_str())?;
    let mut current_dacl: *mut ACL = ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = ptr::null_mut();
    // SAFETY: path is NUL-terminated and all output pointers remain live.
    let result = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &raw mut current_dacl,
            ptr::null_mut(),
            &raw mut descriptor,
        )
    };
    if result != ERROR_SUCCESS {
        return Err(win32_error("Cannot read sandbox path ACL", result));
    }
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: permissions,
        grfAccessMode: mode,
        grfInheritance: if inherit {
            SUB_CONTAINERS_AND_OBJECTS_INHERIT
        } else {
            0
        },
        Trustee: TRUSTEE_W {
            pMultipleTrustee: ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.cast(),
        },
    };
    let mut next_dacl: *mut ACL = ptr::null_mut();
    // SAFETY: entry/current DACL are live and next_dacl receives a LocalAlloc allocation.
    let result = unsafe { SetEntriesInAclW(1, &raw const entry, current_dacl, &raw mut next_dacl) };
    if result != ERROR_SUCCESS || next_dacl.is_null() {
        // SAFETY: GetNamedSecurityInfoW allocated descriptor.
        unsafe { LocalFree(descriptor.cast()) };
        return Err(win32_error("Cannot construct sandbox path ACL", result));
    }
    // SAFETY: path and next DACL remain live for this call.
    let result = unsafe {
        SetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            next_dacl,
            ptr::null(),
        )
    };
    // SAFETY: both functions above allocated these buffers with LocalAlloc.
    unsafe {
        LocalFree(next_dacl.cast());
        LocalFree(descriptor.cast());
    }
    if result != ERROR_SUCCESS {
        return Err(win32_error("Cannot apply sandbox path ACL", result));
    }
    Ok(())
}

fn appcontainer_folder(sid: PSID) -> Result<PathBuf, String> {
    use windows_sys::Win32::Security::Authorization::ConvertSidToStringSidW;

    let mut sid_text: PWSTR = ptr::null_mut();
    // SAFETY: sid is live and sid_text receives a LocalAlloc allocation.
    if unsafe { ConvertSidToStringSidW(sid, &raw mut sid_text) } == 0 || sid_text.is_null() {
        return Err(format!(
            "Cannot format AppContainer SID: {}",
            io::Error::last_os_error()
        ));
    }
    let mut folder: PWSTR = ptr::null_mut();
    // SAFETY: sid_text is NUL-terminated and folder receives a COM allocation.
    let result = unsafe { GetAppContainerFolderPath(sid_text, &raw mut folder) };
    // SAFETY: ConvertSidToStringSidW allocated sid_text with LocalAlloc.
    unsafe { LocalFree(sid_text.cast()) };
    if result < 0 || folder.is_null() {
        return Err(hresult_error("Cannot resolve AppContainer storage", result));
    }
    let path = PathBuf::from(read_wide(folder));
    // SAFETY: GetAppContainerFolderPath returns a CoTaskMem allocation.
    unsafe { CoTaskMemFree(folder.cast::<c_void>()) };
    Ok(path)
}

fn valid_profile_name(value: &str) -> bool {
    let Some(suffix) = value.strip_prefix(&format!("{PROFILE_PREFIX}.")) else {
        return false;
    };
    let parts = suffix.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts[0].len() == 16
        && parts[0]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && parts[1].parse::<u32>().is_ok()
        && parts[2].parse::<u64>().is_ok()
}

fn read_wide(value: *const u16) -> String {
    let mut length = 0;
    // SAFETY: callers provide a live NUL-terminated Windows string.
    while unsafe { *value.add(length) } != 0 {
        length += 1;
    }
    // SAFETY: length excludes the terminating NUL and the allocation remains live.
    String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(value, length) })
}

fn wide(value: &str) -> Result<Vec<u16>, String> {
    wide_os(OsStr::new(value))
}

fn wide_os(value: &OsStr) -> Result<Vec<u16>, String> {
    let mut encoded = value.encode_wide().collect::<Vec<_>>();
    if encoded.contains(&0) {
        return Err("Windows sandbox string contains an embedded NUL.".to_owned());
    }
    encoded.push(0);
    Ok(encoded)
}

fn hresult_is_not_found(result: i32) -> bool {
    let code = result as u32;
    code == (0x8007_0000 | ERROR_FILE_NOT_FOUND) || code == (0x8007_0000 | ERROR_NOT_FOUND)
}

fn hresult_error(operation: &str, result: i32) -> String {
    format!("{operation}: HRESULT 0x{:08x}.", result as u32)
}

fn win32_error(operation: &str, result: u32) -> String {
    format!(
        "{operation}: {}",
        io::Error::from_raw_os_error(result as i32)
    )
}

fn combine_cleanup_error(
    primary: String,
    acl_cleanup: Result<(), String>,
    profile_cleanup: Result<(), String>,
) -> String {
    let mut errors = vec![primary];
    if let Err(error) = acl_cleanup {
        errors.push(format!("ACL cleanup also failed: {error}"));
    }
    if let Err(error) = profile_cleanup {
        errors.push(format!("Profile cleanup also failed: {error}"));
    }
    errors.join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{NoCancellation, compile_effective_sandbox_plan};

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CorpusInput {
        schema_version: u32,
        source_provider_id: String,
        required_controls: Vec<IsolationControl>,
        fixture_root: PathBuf,
        cases: Vec<CorpusCaseInput>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct CorpusCaseInput {
        id: String,
        executable: PathBuf,
        arguments: Vec<String>,
        environment: Vec<(String, String)>,
        inherited_environment: Vec<String>,
        working_directory: PathBuf,
        expected: String,
        cancel_after_milliseconds: Option<u64>,
        effective_sandbox_plan: EffectiveSandboxPlan,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AppContainerCorpusReport {
        harness: &'static str,
        corpus_schema_version: u32,
        source_provider_id: String,
        target_provider_id: String,
        required_controls: Vec<IsolationControl>,
        case_count: usize,
        passed_count: usize,
        all_cases_passed: bool,
        tokens: Option<u64>,
        retries: u32,
        results: Vec<AppContainerCaseReport>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct AppContainerCaseReport {
        id: String,
        normalized_plan_equivalent: bool,
        passed: bool,
        status_code: Option<i32>,
        timed_out: bool,
        cancelled: bool,
        elapsed_milliseconds: f64,
        stdout_bytes: u64,
        stderr_bytes: u64,
        stdout_excerpt: String,
        stderr_excerpt: String,
        acl_clean: bool,
        descendant_clean: bool,
        residue_clean: bool,
        error: Option<String>,
    }

    struct CancelAfter {
        started: Instant,
        delay: Duration,
    }

    impl Cancellation for CancelAfter {
        fn reason(&self) -> Option<String> {
            (self.started.elapsed() >= self.delay).then(|| "test cancellation".to_owned())
        }
    }

    struct AppContainerFixture {
        parent: PathBuf,
        candidate: PathBuf,
        command: PathBuf,
        provider: WindowsAppContainerIsolationProvider,
    }

    impl AppContainerFixture {
        fn new(label: &str, protected_git: bool) -> Self {
            let parent = std::env::temp_dir().join(format!(
                "forge-appcontainer-{label}-{}-{}",
                std::process::id(),
                PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            let candidate = parent.join("candidate");
            fs::create_dir_all(&candidate).expect("candidate fixture");
            if protected_git {
                fs::create_dir(candidate.join(".git")).expect("protected fixture");
            }
            let command_source = std::env::var_os("ComSpec").expect("ComSpec");
            let command = candidate.join("forge-sandbox-cmd.exe");
            fs::copy(command_source, &command).expect("copy verifier fixture");
            let provider =
                WindowsAppContainerIsolationProvider::try_new(&parent).expect("provider");
            Self {
                parent,
                candidate,
                command,
                provider,
            }
        }

        fn process(
            &self,
            command_body: String,
            environment: Vec<(String, String)>,
            timeout: Duration,
        ) -> IsolatedProcessSpec {
            IsolatedProcessSpec {
                executable: self.command.canonicalize().expect("command path"),
                arguments: vec!["/d".to_owned(), "/c".to_owned(), command_body],
                environment,
                inherited_environment: Vec::new(),
                working_directory: self.candidate.canonicalize().expect("candidate path"),
                readable_roots: Vec::new(),
                denied_read_roots: Vec::new(),
                denied_write_roots: Vec::new(),
                timeout,
                max_output_bytes: 16_384,
            }
        }

        fn plan(&self, process: &IsolatedProcessSpec) -> EffectiveSandboxPlan {
            let controls = vec![
                IsolationControl::Filesystem,
                IsolationControl::Process,
                IsolationControl::Network,
                IsolationControl::Credentials,
                IsolationControl::Resources,
            ];
            let mut status = self.provider.status();
            status.availability = IsolationProviderAvailability::Available;
            compile_effective_sandbox_plan(
                &status,
                &IsolationPolicy::restricted(controls),
                &IsolationRequest {
                    profile: IsolationProfile::Restricted,
                    host_provider_id: None,
                },
                process,
            )
            .expect("sandbox plan")
        }

        fn execute(
            &self,
            process: &IsolatedProcessSpec,
            cancellation: &dyn Cancellation,
        ) -> IsolatedProcessOutcome {
            let plan = self.plan(process);
            self.provider
                .execute_conformance_plan(&plan, process, cancellation)
                .expect("AppContainer execution")
        }
    }

    impl Drop for AppContainerFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.parent);
        }
    }

    #[test]
    fn profile_name_grammar_is_strict() {
        assert!(valid_profile_name(
            "ForgeEngine.Sandbox.0123456789abcdef.123.456"
        ));
        assert!(!valid_profile_name(
            "ForgeEngine.Sandbox.0123456789ABCDEF.123.456"
        ));
        assert!(!valid_profile_name("Other.0123456789abcdef.123.456"));
    }

    #[test]
    fn disposable_profile_acl_and_recovery_record_clean_up() {
        let parent = std::env::temp_dir().join(format!(
            "forge-appcontainer-{}-{}",
            std::process::id(),
            PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let candidate = parent.join("candidate");
        fs::create_dir_all(&candidate).expect("candidate fixture");
        fs::write(candidate.join("allowed.txt"), b"fixture").expect("fixture file");
        fs::write(candidate.join(".git"), b"gitdir: fixture").expect("protected fixture");
        let provider = WindowsAppContainerIsolationProvider::try_new(&parent).expect("provider");
        let plan = EffectiveSandboxPlan {
            schema_version: 4,
            provider_id: provider.status().capabilities.provider_id,
            provider_class: IsolationProviderClass::NativeStrong,
            executable: std::env::current_exe().expect("test executable"),
            working_directory: candidate.canonicalize().expect("candidate path"),
            readable_roots: vec![candidate.canonicalize().expect("candidate path")],
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            writable_roots: vec![candidate.canonicalize().expect("candidate path")],
            protected_relative_paths: vec![PathBuf::from(".git")],
            deny_filesystem_outside_roots: true,
            network: super::super::SandboxNetworkPlan::DenyDirect,
            credentials: super::super::SandboxCredentialPlan::DenyAmbient,
            own_descendant_processes: true,
            enforce_resource_limits: true,
            max_active_processes: Some(64),
            max_process_memory_bytes: Some(1_073_741_824),
            timeout_milliseconds: 1_000,
            max_output_bytes: 4_096,
            required_controls: vec![
                IsolationControl::Filesystem,
                IsolationControl::Process,
                IsolationControl::Network,
                IsolationControl::Credentials,
                IsolationControl::Resources,
            ],
            launch_digest: "0".repeat(64),
            plan_digest: "a".repeat(64),
        };
        let mut boundary = provider.prepare_boundary(&plan).expect("prepared boundary");
        assert!(boundary.profile.folder.is_absolute());
        assert!(boundary.record_path.exists());
        boundary.cleanup().expect("explicit cleanup");
        assert!(!boundary.record_path.exists());
        drop(boundary);
        drop(provider);
        fs::remove_dir_all(&parent).expect("fixture cleanup");
    }

    #[test]
    fn appcontainer_conformance_launcher_runs_an_allowed_candidate_command() {
        let parent = std::env::temp_dir().join(format!(
            "forge-appcontainer-launch-{}-{}",
            std::process::id(),
            PROFILE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        let candidate = parent.join("candidate");
        fs::create_dir_all(&candidate).expect("candidate fixture");
        let command_source = std::env::var_os("ComSpec").expect("ComSpec");
        let command = candidate.join("forge-sandbox-cmd.exe");
        fs::copy(command_source, &command).expect("copy verifier fixture");
        let provider = WindowsAppContainerIsolationProvider::try_new(&parent).expect("provider");
        let process = IsolatedProcessSpec {
            executable: command.canonicalize().expect("command path"),
            arguments: vec![
                "/d".to_owned(),
                "/c".to_owned(),
                format!(
                    "echo APP_CONTAINER_OK>{}",
                    candidate.join("allowed.txt").display()
                ),
            ],
            environment: Vec::new(),
            inherited_environment: Vec::new(),
            working_directory: candidate.canonicalize().expect("candidate path"),
            readable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            timeout: Duration::from_secs(5),
            max_output_bytes: 16_384,
        };
        let controls = vec![
            IsolationControl::Filesystem,
            IsolationControl::Process,
            IsolationControl::Network,
            IsolationControl::Credentials,
            IsolationControl::Resources,
        ];
        let mut status = provider.status();
        status.availability = IsolationProviderAvailability::Available;
        let plan = compile_effective_sandbox_plan(
            &status,
            &IsolationPolicy::restricted(controls),
            &IsolationRequest {
                profile: IsolationProfile::Restricted,
                host_provider_id: None,
            },
            &process,
        )
        .expect("sandbox plan");

        let outcome = provider
            .execute_conformance_plan(&plan, &process, &NoCancellation)
            .expect("AppContainer execution");

        assert!(
            outcome.status.is_some_and(|status| status.success()),
            "status={:?} stdout={} stderr={}",
            outcome.status,
            String::from_utf8_lossy(&outcome.stdout.bytes),
            String::from_utf8_lossy(&outcome.stderr.bytes)
        );
        assert!(!outcome.timed_out);
        assert!(!outcome.cancelled);
        assert_eq!(
            fs::read_to_string(candidate.join("allowed.txt"))
                .expect("allowed write")
                .trim(),
            "APP_CONTAINER_OK"
        );
        assert_eq!(outcome.isolation.plan_digest, Some(plan.plan_digest));
        assert!(
            fs::read_dir(parent.join(".forge-sandbox-recovery"))
                .expect("recovery root")
                .next()
                .is_none()
        );
        drop(provider);
        fs::remove_dir_all(&parent).expect("fixture cleanup");
    }

    #[test]
    fn appcontainer_denies_writes_outside_candidate_and_to_protected_paths() {
        let fixture = AppContainerFixture::new("denials", true);
        let outside = fixture.parent.join("outside.txt");
        let outside_process = fixture.process(
            format!("echo BREACH>{}", outside.display()),
            Vec::new(),
            Duration::from_secs(5),
        );
        let outside_outcome = fixture.execute(&outside_process, &NoCancellation);
        assert!(
            outside_outcome
                .status
                .is_some_and(|status| !status.success()),
            "outside write unexpectedly succeeded"
        );
        assert!(!outside.exists());

        let protected = fixture.candidate.join(".git").join("breach.txt");
        let protected_process = fixture.process(
            format!("echo BREACH>{}", protected.display()),
            Vec::new(),
            Duration::from_secs(5),
        );
        let protected_outcome = fixture.execute(&protected_process, &NoCancellation);
        assert!(
            protected_outcome
                .status
                .is_some_and(|status| !status.success()),
            "protected-path write unexpectedly succeeded"
        );
        assert!(!protected.exists());
    }

    #[test]
    fn appcontainer_uses_an_explicit_minimized_environment() {
        let fixture = AppContainerFixture::new("environment", false);
        let process = fixture.process(
            "if defined USERNAME exit /b 44&if not %FORGE_VISIBLE%==yes exit /b 45&exit /b 0"
                .to_owned(),
            vec![("FORGE_VISIBLE".to_owned(), "yes".to_owned())],
            Duration::from_secs(5),
        );
        let outcome = fixture.execute(&process, &NoCancellation);

        assert!(
            outcome.status.is_some_and(|status| status.success()),
            "status={:?} stdout={} stderr={}",
            outcome.status,
            String::from_utf8_lossy(&outcome.stdout.bytes),
            String::from_utf8_lossy(&outcome.stderr.bytes)
        );
        assert!(outcome.environment.cleared);
        assert!(
            outcome
                .environment
                .fixed_names
                .contains(&"FORGE_VISIBLE".to_owned())
        );
        assert!(
            !outcome
                .environment
                .inherited_names
                .iter()
                .any(|name| name.eq_ignore_ascii_case("USERNAME"))
        );
    }

    #[test]
    fn appcontainer_honors_the_requested_candidate_working_directory() {
        let fixture = AppContainerFixture::new("working-directory", false);
        let process = fixture.process("cd".to_owned(), Vec::new(), Duration::from_secs(5));
        let outcome = fixture.execute(&process, &NoCancellation);

        assert!(outcome.status.is_some_and(|status| status.success()));
        assert_eq!(
            String::from_utf8_lossy(&outcome.stdout.bytes).trim(),
            win32_launch_path(&fixture.candidate.canonicalize().expect("candidate path"))
                .display()
                .to_string()
        );
    }

    #[test]
    fn appcontainer_recovers_an_abandoned_profile_and_acl_journal() {
        let fixture = AppContainerFixture::new("recovery", true);
        let process = fixture.process("exit /b 0".to_owned(), Vec::new(), Duration::from_secs(5));
        let plan = fixture.plan(&process);
        let boundary = fixture
            .provider
            .prepare_boundary(&plan)
            .expect("prepared boundary");
        let record_path = boundary.record_path.clone();
        assert!(record_path.exists());
        boundary.abandon_for_recovery_test();

        let recovered = WindowsAppContainerIsolationProvider::try_new(&fixture.parent)
            .expect("provider recovery");
        assert!(!record_path.exists());
        assert!(
            fs::read_dir(&recovered.recovery_root)
                .expect("recovery root")
                .next()
                .is_none()
        );
    }

    #[test]
    fn appcontainer_job_enforces_timeout_and_cancellation() {
        let fixture = AppContainerFixture::new("termination", false);
        let loop_body = "for /L %i in (1,1,2147483647) do @rem".to_owned();
        let timed_process =
            fixture.process(loop_body.clone(), Vec::new(), Duration::from_millis(75));
        let timed = fixture.execute(&timed_process, &NoCancellation);
        assert!(timed.timed_out);
        assert!(!timed.cancelled);
        assert!(timed.status.is_some_and(|status| !status.success()));

        let cancelled_process = fixture.process(loop_body, Vec::new(), Duration::from_secs(5));
        let cancelled = fixture.execute(
            &cancelled_process,
            &CancelAfter {
                started: Instant::now(),
                delay: Duration::from_millis(75),
            },
        );
        assert!(!cancelled.timed_out);
        assert!(cancelled.cancelled);
        assert!(cancelled.status.is_some_and(|status| !status.success()));
    }

    #[test]
    fn appcontainer_without_capabilities_denies_direct_loopback_network_access() {
        let fixture = AppContainerFixture::new("network", false);
        let curl_source = PathBuf::from(std::env::var_os("SystemRoot").expect("SystemRoot"))
            .join("System32")
            .join("curl.exe");
        assert!(curl_source.is_file(), "Windows curl.exe is required");
        let probe = fixture.candidate.join("forge-sandbox-network-probe.exe");
        fs::copy(curl_source, &probe).expect("copy network probe");

        let version_process = IsolatedProcessSpec {
            executable: probe.canonicalize().expect("probe path"),
            arguments: vec!["--version".to_owned()],
            environment: Vec::new(),
            inherited_environment: Vec::new(),
            working_directory: fixture.candidate.canonicalize().expect("candidate path"),
            readable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            timeout: Duration::from_secs(5),
            max_output_bytes: 16_384,
        };
        let version = fixture.execute(&version_process, &NoCancellation);
        assert!(
            version.status.is_some_and(|status| status.success()),
            "network probe could not initialize: status={:?} stderr={}",
            version.status,
            String::from_utf8_lossy(&version.stderr.bytes)
        );

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("loopback listener");
        listener
            .set_nonblocking(true)
            .expect("nonblocking listener");
        let address = listener.local_addr().expect("listener address");
        let accepted = thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let _ = stream.write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                        );
                        return true;
                    }
                    Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => panic!("loopback accept failed: {error}"),
                }
            }
            false
        });
        let network_process = IsolatedProcessSpec {
            executable: probe.canonicalize().expect("probe path"),
            arguments: vec![
                "--silent".to_owned(),
                "--show-error".to_owned(),
                "--max-time".to_owned(),
                "2".to_owned(),
                format!("http://{address}/"),
            ],
            environment: Vec::new(),
            inherited_environment: Vec::new(),
            working_directory: fixture.candidate.canonicalize().expect("candidate path"),
            readable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            timeout: Duration::from_secs(5),
            max_output_bytes: 16_384,
        };
        let network = fixture.execute(&network_process, &NoCancellation);
        let connected = accepted.join().expect("listener thread");

        assert!(!connected, "AppContainer unexpectedly reached loopback");
        assert!(
            network.status.is_some_and(|status| !status.success()),
            "network denial probe unexpectedly succeeded: stdout={} stderr={}",
            String::from_utf8_lossy(&network.stdout.bytes),
            String::from_utf8_lossy(&network.stderr.bytes)
        );
    }

    #[test]
    #[ignore = "requires an explicit exported corpus and writes a durable conformance report"]
    fn appcontainer_executes_the_exported_provider_neutral_corpus() {
        let corpus_path = PathBuf::from(
            std::env::var_os("FORGE_APPCONTAINER_CONFORMANCE_CORPUS")
                .expect("FORGE_APPCONTAINER_CONFORMANCE_CORPUS"),
        );
        let corpus: CorpusInput =
            serde_json::from_slice(&fs::read(&corpus_path).expect("read conformance corpus"))
                .expect("parse conformance corpus");
        assert_eq!(corpus.schema_version, 2, "unsupported corpus schema");
        assert_eq!(corpus.cases.len(), 17, "unexpected corpus size");
        if std::env::var_os("FORGE_APPCONTAINER_OWNER_CHILD").is_some() {
            execute_owner_death_child(&corpus);
        }
        let report_path = PathBuf::from(
            std::env::var_os("FORGE_APPCONTAINER_CONFORMANCE_REPORT")
                .expect("FORGE_APPCONTAINER_CONFORMANCE_REPORT"),
        );
        assert!(!report_path.exists(), "refusing to overwrite report");

        let provider = WindowsAppContainerIsolationProvider::try_new(&corpus.fixture_root)
            .expect("AppContainer corpus provider");
        let mut status = provider.status();
        status.availability = IsolationProviderAvailability::Available;
        let target_provider_id = status.capabilities.provider_id.clone();
        let mut results = Vec::with_capacity(corpus.cases.len());
        for record in corpus.cases {
            let process = corpus_process(&record);
            let target_plan = compile_effective_sandbox_plan(
                &status,
                &IsolationPolicy::restricted(corpus.required_controls.clone()),
                &IsolationRequest {
                    profile: IsolationProfile::Restricted,
                    host_provider_id: None,
                },
                &process,
            )
            .expect("compile AppContainer plan");
            let normalized_plan_equivalent =
                normalized_plan(&record.effective_sandbox_plan) == normalized_plan(&target_plan);
            if record.id == "owner_death_contained" {
                results.push(execute_owner_death_parent(
                    &corpus_path,
                    &corpus.fixture_root,
                    &target_plan,
                    normalized_plan_equivalent,
                ));
                continue;
            }
            let cancellation = record.cancel_after_milliseconds.map(|delay| CancelAfter {
                started: Instant::now(),
                delay: Duration::from_millis(delay),
            });
            let no_cancellation = NoCancellation;
            let residue_paths = residue_paths(&target_plan);
            let acl_before = snapshot_acls(&residue_paths);
            let cancellation: &dyn Cancellation = cancellation
                .as_ref()
                .map_or(&no_cancellation, |value| value as &dyn Cancellation);
            let started = Instant::now();
            let outcome = provider.execute_conformance_plan(&target_plan, &process, cancellation);
            if matches!(
                record.id.as_str(),
                "child_grandchild_contained"
                    | "timeout_contained"
                    | "cancellation_contained"
                    | "owner_death_contained"
            ) {
                thread::sleep(Duration::from_millis(2_500));
            }
            let recovery_clean = fs::read_dir(corpus.fixture_root.join(".forge-sandbox-recovery"))
                .expect("recovery root")
                .next()
                .is_none();
            let survivor = process.working_directory.join(match record.id.as_str() {
                "child_grandchild_contained" => "descendant-survivor.txt",
                "timeout_contained" => "timeout-survivor.txt",
                "cancellation_contained" => "cancellation-survivor.txt",
                "owner_death_contained" => "owner-death-survivor.txt",
                _ => "descendant-survivor.txt",
            });
            let descendant_clean = !survivor.exists();
            let acl_clean = acl_before == snapshot_acls(&residue_paths);
            let elapsed_milliseconds = started.elapsed().as_secs_f64() * 1_000.0;
            let (
                passed,
                status_code,
                timed_out,
                cancelled,
                stdout_bytes,
                stderr_bytes,
                stdout_excerpt,
                stderr_excerpt,
                error,
            ) = match outcome {
                Ok(outcome) => {
                    let process_matches = match record.expected.as_str() {
                        "success" => {
                            outcome.status.is_some_and(|value| value.success())
                                && !outcome.timed_out
                                && !outcome.cancelled
                        }
                        "denied" => {
                            outcome.status.is_some_and(|value| !value.success())
                                && !outcome.timed_out
                        }
                        "terminated" => {
                            outcome.timed_out
                                || outcome.cancelled
                                || outcome.status.is_some_and(|value| !value.success())
                        }
                        other => panic!("unsupported expected outcome {other}"),
                    };
                    let artifact_matches = match record.id.as_str() {
                        "allowed_candidate_write" => {
                            process.working_directory.join("allowed.txt").exists()
                        }
                        "workspace_outside_write_denied" => !corpus
                            .fixture_root
                            .join("outside")
                            .join("breach.txt")
                            .exists(),
                        "protected_path_write_denied" => fs::read_to_string(
                            process.working_directory.join(".git").join("config"),
                        )
                        .is_ok_and(|value| value == "protected\n"),
                        "sensitive_read_denied" => !String::from_utf8_lossy(&outcome.stdout.bytes)
                            .contains("FORGE_SENSITIVE_SENTINEL"),
                        "child_grandchild_contained"
                        | "timeout_contained"
                        | "cancellation_contained"
                        | "owner_death_contained" => descendant_clean,
                        _ => true,
                    };
                    (
                        normalized_plan_equivalent
                            && process_matches
                            && artifact_matches
                            && acl_clean
                            && recovery_clean
                            && descendant_clean,
                        outcome.status.and_then(|value| value.code()),
                        outcome.timed_out,
                        outcome.cancelled,
                        outcome.stdout.total_bytes,
                        outcome.stderr.total_bytes,
                        String::from_utf8_lossy(&outcome.stdout.bytes)
                            .chars()
                            .take(512)
                            .collect(),
                        String::from_utf8_lossy(&outcome.stderr.bytes)
                            .chars()
                            .take(512)
                            .collect(),
                        None,
                    )
                }
                Err(error) => (
                    false,
                    None,
                    false,
                    false,
                    0,
                    0,
                    String::new(),
                    String::new(),
                    Some(error),
                ),
            };
            results.push(AppContainerCaseReport {
                id: record.id,
                normalized_plan_equivalent,
                passed,
                status_code,
                timed_out,
                cancelled,
                elapsed_milliseconds,
                stdout_bytes,
                stderr_bytes,
                stdout_excerpt,
                stderr_excerpt,
                acl_clean,
                descendant_clean,
                residue_clean: acl_clean && recovery_clean && descendant_clean,
                error,
            });
        }
        let passed_count = results.iter().filter(|result| result.passed).count();
        let report = AppContainerCorpusReport {
            harness: "forge-appcontainer-corpus-v1",
            corpus_schema_version: corpus.schema_version,
            source_provider_id: corpus.source_provider_id,
            target_provider_id,
            required_controls: corpus.required_controls,
            case_count: results.len(),
            passed_count,
            all_cases_passed: passed_count == results.len(),
            tokens: None,
            retries: 0,
            results,
        };
        fs::write(
            &report_path,
            serde_json::to_vec_pretty(&report).expect("encode conformance report"),
        )
        .expect("write conformance report");
        assert!(
            report.all_cases_passed,
            "AppContainer corpus gate failed; see {}",
            report_path.display()
        );
    }

    fn normalized_plan(plan: &EffectiveSandboxPlan) -> EffectiveSandboxPlan {
        let mut normalized = plan.clone();
        normalized.provider_id.clear();
        normalized.plan_digest.clear();
        normalized
    }

    fn corpus_process(record: &CorpusCaseInput) -> IsolatedProcessSpec {
        IsolatedProcessSpec {
            executable: record.executable.clone(),
            arguments: record.arguments.clone(),
            environment: record.environment.clone(),
            inherited_environment: record.inherited_environment.clone(),
            working_directory: record.working_directory.clone(),
            readable_roots: record.effective_sandbox_plan.readable_roots.clone(),
            denied_read_roots: record.effective_sandbox_plan.denied_read_roots.clone(),
            denied_write_roots: record.effective_sandbox_plan.denied_write_roots.clone(),
            timeout: Duration::from_millis(record.effective_sandbox_plan.timeout_milliseconds),
            max_output_bytes: record.effective_sandbox_plan.max_output_bytes,
        }
    }

    fn residue_paths(plan: &EffectiveSandboxPlan) -> Vec<PathBuf> {
        let mut paths = BTreeSet::new();
        paths.insert(plan.working_directory.clone());
        paths.extend(plan.readable_roots.iter().cloned());
        paths.extend(plan.denied_read_roots.iter().cloned());
        paths.extend(plan.denied_write_roots.iter().cloned());
        paths.into_iter().collect()
    }

    fn snapshot_acls(paths: &[PathBuf]) -> BTreeMap<PathBuf, (Option<i32>, String, String)> {
        paths
            .iter()
            .map(|path| {
                let output = Command::new("icacls.exe")
                    .arg(path)
                    .output()
                    .expect("icacls snapshot");
                (
                    path.clone(),
                    (
                        output.status.code(),
                        String::from_utf8_lossy(&output.stdout).replace("\r\n", "\n"),
                        String::from_utf8_lossy(&output.stderr).replace("\r\n", "\n"),
                    ),
                )
            })
            .collect()
    }

    fn remove_marker(path: &Path) -> Result<(), String> {
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(format!(
                "Cannot remove conformance marker {}: {error}",
                path.display()
            )),
        }
    }

    fn execute_owner_death_child(corpus: &CorpusInput) -> ! {
        let record = corpus
            .cases
            .iter()
            .find(|record| record.id == "owner_death_contained")
            .expect("owner-death corpus case");
        let process = corpus_process(record);
        let provider = WindowsAppContainerIsolationProvider::try_new(&corpus.fixture_root)
            .expect("owner child provider");
        let mut status = provider.status();
        status.availability = IsolationProviderAvailability::Available;
        let plan = compile_effective_sandbox_plan(
            &status,
            &IsolationPolicy::restricted(corpus.required_controls.clone()),
            &IsolationRequest {
                profile: IsolationProfile::Restricted,
                host_provider_id: None,
            },
            &process,
        )
        .expect("owner child plan");
        let _ = provider.execute_conformance_plan(&plan, &process, &NoCancellation);
        panic!("owner-death child was not terminated by its parent");
    }

    fn execute_owner_death_parent(
        corpus_path: &Path,
        fixture_root: &Path,
        plan: &EffectiveSandboxPlan,
        normalized_plan_equivalent: bool,
    ) -> AppContainerCaseReport {
        let working_directory = &plan.working_directory;
        let ready_marker = working_directory.join("owner-ready.txt");
        let survivor_marker = working_directory.join("owner-death-survivor.txt");
        let marker_preclean =
            remove_marker(&ready_marker).and_then(|()| remove_marker(&survivor_marker));
        let residue_paths = residue_paths(plan);
        let acl_before = snapshot_acls(&residue_paths);
        let started = Instant::now();
        let mut child = std::process::Command::new(std::env::current_exe().expect("test binary"))
            .arg("isolation::windows_appcontainer::tests::appcontainer_executes_the_exported_provider_neutral_corpus")
            .arg("--exact")
            .arg("--ignored")
            .env("FORGE_APPCONTAINER_CONFORMANCE_CORPUS", corpus_path)
            .env("FORGE_APPCONTAINER_OWNER_CHILD", "1")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn owner-death harness");
        let deadline = Instant::now() + Duration::from_secs(5);
        while !ready_marker.exists() && Instant::now() < deadline {
            assert!(
                child.try_wait().expect("observe owner child").is_none(),
                "owner-death child exited before its ready marker"
            );
            thread::sleep(Duration::from_millis(10));
        }
        let owner_ready = ready_marker.exists();
        let kill_result = child.kill();
        let status = child.wait().expect("reap owner-death harness");
        thread::sleep(Duration::from_millis(2_500));
        let recovery = WindowsAppContainerIsolationProvider::try_new(fixture_root);
        let recovery_clean = recovery.as_ref().is_ok_and(|provider| {
            fs::read_dir(&provider.recovery_root).is_ok_and(|mut entries| entries.next().is_none())
        });
        let descendant_clean = !survivor_marker.exists();
        let marker_cleanup = remove_marker(&ready_marker);
        let acl_clean = acl_before == snapshot_acls(&residue_paths);
        let passed = normalized_plan_equivalent
            && marker_preclean.is_ok()
            && owner_ready
            && kill_result.is_ok()
            && !status.success()
            && recovery_clean
            && descendant_clean
            && marker_cleanup.is_ok()
            && acl_clean;
        AppContainerCaseReport {
            id: "owner_death_contained".to_owned(),
            normalized_plan_equivalent,
            passed,
            status_code: status.code(),
            timed_out: false,
            cancelled: false,
            elapsed_milliseconds: started.elapsed().as_secs_f64() * 1_000.0,
            stdout_bytes: 0,
            stderr_bytes: 0,
            stdout_excerpt: String::new(),
            stderr_excerpt: String::new(),
            acl_clean,
            descendant_clean,
            residue_clean: recovery_clean
                && descendant_clean
                && marker_cleanup.is_ok()
                && acl_clean,
            error: (!passed).then(|| {
                format!(
                    "markerPreclean={marker_preclean:?}; ownerReady={owner_ready}; kill={kill_result:?}; recoveryClean={recovery_clean}; descendantClean={descendant_clean}; markerCleanup={marker_cleanup:?}; aclClean={acl_clean}"
                )
            }),
        }
    }
}
