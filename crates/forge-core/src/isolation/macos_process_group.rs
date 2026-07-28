use std::{
    ffi::{c_int, c_void},
    mem::{MaybeUninit, size_of},
};

const PROC_PIDT_SHORTBSDINFO: c_int = 13;
const SZOMB: u32 = 5;
const INITIAL_PID_CAPACITY: usize = 64;
const MAX_PID_CAPACITY: usize = 65_536;
const MAXCOMLEN: usize = 16;

#[repr(C)]
struct ProcBsdShortInfo {
    pid: u32,
    parent_pid: u32,
    process_group_id: u32,
    status: u32,
    command: [i8; MAXCOMLEN],
    flags: u32,
    uid: u32,
    gid: u32,
    real_uid: u32,
    real_gid: u32,
    saved_uid: u32,
    saved_gid: u32,
    reserved: u32,
}

#[link(name = "proc")]
unsafe extern "C" {
    fn proc_listpgrppids(
        process_group_id: libc::pid_t,
        buffer: *mut c_void,
        buffer_size: c_int,
    ) -> c_int;
    fn proc_pidinfo(
        process_id: c_int,
        flavor: c_int,
        argument: u64,
        buffer: *mut c_void,
        buffer_size: c_int,
    ) -> c_int;
}

pub(super) fn has_live_members(process_group_id: c_int) -> Result<bool, String> {
    for process_id in list_process_group_members(process_group_id)? {
        let mut info = MaybeUninit::<ProcBsdShortInfo>::uninit();
        let info_size = c_int::try_from(size_of::<ProcBsdShortInfo>())
            .map_err(|_| "Darwin process information structure is too large.".to_owned())?;
        // SAFETY: `info` is valid for `info_size` bytes and is initialized only when
        // Darwin reports the complete structure.
        let returned = unsafe {
            proc_pidinfo(
                process_id,
                PROC_PIDT_SHORTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                info_size,
            )
        };
        if returned == info_size {
            // SAFETY: the preceding call initialized the complete structure.
            let info = unsafe { info.assume_init() };
            if info.process_group_id == process_group_id as u32 && info.status != SZOMB {
                return Ok(true);
            }
            continue;
        }
        if returned > 0 {
            return Err(format!(
                "Darwin returned incomplete process information for verifier descendant {process_id}."
            ));
        }

        // The process can disappear between the group listing and detail lookup.
        // Accept only a proven ESRCH race; any other state remains an explicit error.
        // SAFETY: signal zero performs an existence/permission check only.
        let probe = unsafe { libc::kill(process_id, 0) };
        let error = std::io::Error::last_os_error();
        if probe != 0 && error.raw_os_error() == Some(libc::ESRCH) {
            continue;
        }
        return Err(format!(
            "Could not inspect verifier descendant {process_id}: {error}"
        ));
    }
    Ok(false)
}

fn list_process_group_members(process_group_id: c_int) -> Result<Vec<c_int>, String> {
    let mut capacity = INITIAL_PID_CAPACITY;
    loop {
        let mut process_ids = vec![0; capacity];
        let buffer_bytes = capacity
            .checked_mul(size_of::<c_int>())
            .and_then(|bytes| c_int::try_from(bytes).ok())
            .ok_or_else(|| "Darwin process-group query exceeded its byte bound.".to_owned())?;
        // SAFETY: the vector owns `buffer_bytes` writable bytes for PID results.
        let returned = unsafe {
            proc_listpgrppids(
                process_group_id,
                process_ids.as_mut_ptr().cast(),
                buffer_bytes,
            )
        };
        if returned < 0 {
            return Err(format!(
                "Could not inspect verifier process group: {}",
                std::io::Error::last_os_error()
            ));
        }
        let returned_bytes = usize::try_from(returned)
            .map_err(|_| "Darwin returned an invalid process-group byte count.".to_owned())?;
        if returned_bytes % size_of::<c_int>() != 0 {
            return Err("Darwin returned a misaligned process-group result.".to_owned());
        }
        let count = returned_bytes / size_of::<c_int>();
        if count < capacity {
            process_ids.truncate(count);
            process_ids.retain(|process_id| *process_id > 0);
            return Ok(process_ids);
        }
        if capacity >= MAX_PID_CAPACITY {
            return Err(
                "Verifier process group exceeded Forge's bounded Darwin inspection capacity."
                    .to_owned(),
            );
        }
        capacity = (capacity * 2).min(MAX_PID_CAPACITY);
    }
}
