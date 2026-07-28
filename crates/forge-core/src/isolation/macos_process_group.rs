use std::{
    ffi::c_int,
    mem::{MaybeUninit, size_of},
};

const INITIAL_PID_CAPACITY: usize = 64;
const MAX_PID_CAPACITY: usize = 65_536;

pub(super) fn has_live_members(process_group_id: c_int) -> Result<bool, String> {
    for process_id in list_process_group_members(process_group_id)? {
        let mut info = MaybeUninit::<libc::proc_bsdshortinfo>::uninit();
        let info_size = c_int::try_from(size_of::<libc::proc_bsdshortinfo>())
            .map_err(|_| "Darwin process information structure is too large.".to_owned())?;
        // SAFETY: `info` is valid for `info_size` bytes and is initialized only when
        // Darwin reports the complete structure.
        let returned = unsafe {
            libc::proc_pidinfo(
                process_id,
                libc::PROC_PIDT_SHORTBSDINFO,
                0,
                info.as_mut_ptr().cast(),
                info_size,
            )
        };
        if returned == info_size {
            // SAFETY: the preceding call initialized the complete structure.
            let info = unsafe { info.assume_init() };
            if info.pbsi_pgid == process_group_id as u32 && info.pbsi_status != libc::SZOMB {
                return Ok(true);
            }
            continue;
        }
        if returned > 0 {
            return Err(format!(
                "Darwin returned incomplete process information for verifier descendant {process_id}."
            ));
        }

        // The process can disappear between the group listing and detail lookup,
        // while Darwin can also retain a zombie that pidinfo no longer describes.
        // Treat a still-existing unknown PID as live and poll again; only ESRCH
        // proves disappearance.
        // SAFETY: `__error` returns this thread's writable errno location.
        unsafe {
            *libc::__error() = 0;
        }
        // SAFETY: signal zero performs an existence/permission check only.
        let probe = unsafe { libc::kill(process_id, 0) };
        let error = std::io::Error::last_os_error();
        if probe == 0 {
            return Ok(true);
        }
        match error.raw_os_error() {
            Some(libc::ESRCH) => continue,
            _ => {
                return Err(format!(
                    "Could not inspect verifier descendant {process_id}: {error}"
                ));
            }
        }
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
        // Darwin's convenience wrapper returns a PID count, not a byte count.
        // Clear errno first because a zero count can also wrap a kernel error.
        // SAFETY: `__error` returns this thread's writable errno location.
        unsafe {
            *libc::__error() = 0;
        }
        // SAFETY: the vector owns `buffer_bytes` writable bytes for PID results.
        let returned = unsafe {
            libc::proc_listpgrppids(
                process_group_id,
                process_ids.as_mut_ptr().cast(),
                buffer_bytes,
            )
        };
        let error = std::io::Error::last_os_error();
        if returned < 0 || (returned == 0 && error.raw_os_error().is_some_and(|code| code != 0)) {
            return Err(format!("Could not inspect verifier process group: {error}"));
        }
        let count = usize::try_from(returned)
            .map_err(|_| "Darwin returned an invalid process-group PID count.".to_owned())?;
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
