#[cfg(unix)]
mod unix {
    use std::{
        env,
        ffi::OsString,
        io,
        os::{
            fd::{FromRawFd, OwnedFd, RawFd},
            unix::process::ExitStatusExt,
        },
        process::{Command, ExitStatus, Stdio},
        thread,
        time::Duration,
    };

    const WATCHDOG_FAILURE_EXIT: i32 = 125;
    const POLL_INTERVAL: Duration = Duration::from_millis(5);

    struct Arguments {
        owner_fd: RawFd,
        startup_fd: RawFd,
        executable: OsString,
        verifier_arguments: Vec<OsString>,
    }

    pub fn run() -> Result<(), String> {
        let arguments = parse_arguments()?;
        // SAFETY: the Forge parent passes two owned descriptors that exist only in
        // this helper after exec. OwnedFd closes them on every ordinary return.
        let owner = unsafe { OwnedFd::from_raw_fd(arguments.owner_fd) };
        // SAFETY: the startup descriptor is distinct and owned by this helper.
        let startup = unsafe { OwnedFd::from_raw_fd(arguments.startup_fd) };
        mark_close_on_exec(arguments.owner_fd, "owner")?;
        mark_close_on_exec(arguments.startup_fd, "startup")?;
        if !owner_is_alive(arguments.owner_fd)? {
            return Err("Forge owner closed before verifier launch.".to_owned());
        }

        let mut verifier = match Command::new(&arguments.executable)
            .args(&arguments.verifier_arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
        {
            Ok(verifier) => verifier,
            Err(error) => {
                let _ = notify_startup(arguments.startup_fd, b'F');
                return Err(format!("Could not start watched verifier: {error}"));
            }
        };
        if let Err(error) = notify_startup(arguments.startup_fd, b'S') {
            eprintln!("Could not confirm watched verifier startup: {error}");
            terminate_group_or_child(&mut verifier);
        }
        drop(startup);

        loop {
            match owner_is_alive(arguments.owner_fd) {
                Ok(true) => {}
                Ok(false) => terminate_group_or_child(&mut verifier),
                Err(error) => {
                    eprintln!("Forge owner watchdog failed closed: {error}");
                    terminate_group_or_child(&mut verifier);
                }
            }
            match verifier.try_wait() {
                Ok(Some(status)) => {
                    drop(owner);
                    mirror_exit(status);
                }
                Ok(None) => thread::sleep(POLL_INTERVAL),
                Err(error) => {
                    eprintln!("Could not observe watched verifier: {error}");
                    terminate_group_or_child(&mut verifier);
                }
            }
        }
    }

    fn parse_arguments() -> Result<Arguments, String> {
        let mut arguments = env::args_os().skip(1);
        if arguments.next().as_deref() != Some(std::ffi::OsStr::new("--owner-fd")) {
            return Err("Expected --owner-fd.".to_owned());
        }
        let owner_fd = parse_descriptor(arguments.next(), "owner")?;
        if arguments.next().as_deref() != Some(std::ffi::OsStr::new("--startup-fd")) {
            return Err("Expected --startup-fd.".to_owned());
        }
        let startup_fd = parse_descriptor(arguments.next(), "startup")?;
        if startup_fd == owner_fd {
            return Err("Owner and startup descriptors must be distinct.".to_owned());
        }
        if arguments.next().as_deref() != Some(std::ffi::OsStr::new("--")) {
            return Err("Expected -- before the verifier command.".to_owned());
        }
        let executable = arguments
            .next()
            .ok_or_else(|| "Missing verifier executable.".to_owned())?;
        Ok(Arguments {
            owner_fd,
            startup_fd,
            executable,
            verifier_arguments: arguments.collect(),
        })
    }

    fn parse_descriptor(value: Option<OsString>, label: &str) -> Result<RawFd, String> {
        let descriptor = value
            .ok_or_else(|| format!("Missing {label} descriptor."))?
            .into_string()
            .map_err(|_| format!("{label} descriptor must be ASCII."))?
            .parse::<RawFd>()
            .map_err(|_| format!("{label} descriptor is invalid."))?;
        if descriptor < 0 {
            return Err(format!("{label} descriptor is invalid."));
        }
        Ok(descriptor)
    }

    fn mark_close_on_exec(descriptor: RawFd, label: &str) -> Result<(), String> {
        // SAFETY: descriptor is owned by this helper and F_GETFD is a valid query.
        let current = unsafe { libc::fcntl(descriptor, libc::F_GETFD) };
        if current < 0 {
            return Err(format!(
                "Could not inspect {label} descriptor: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: descriptor is owned by this helper and F_SETFD accepts descriptor flags.
        if unsafe { libc::fcntl(descriptor, libc::F_SETFD, current | libc::FD_CLOEXEC) } != 0 {
            return Err(format!(
                "Could not protect {label} descriptor from verifier inheritance: {}",
                io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    fn notify_startup(startup_fd: RawFd, status: u8) -> Result<(), String> {
        // SAFETY: the watchdog is single-threaded. Temporarily ignoring SIGPIPE
        // converts a closed Forge reader into EPIPE rather than orphaning a verifier.
        let previous = unsafe { libc::signal(libc::SIGPIPE, libc::SIG_IGN) };
        if previous == libc::SIG_ERR {
            return Err(format!(
                "Could not suppress startup-pipe SIGPIPE: {}",
                io::Error::last_os_error()
            ));
        }
        // SAFETY: startup_fd is held by OwnedFd and status points to one readable byte.
        let result =
            unsafe { libc::write(startup_fd, (&status as *const u8).cast::<libc::c_void>(), 1) };
        let write_error = (result != 1).then(io::Error::last_os_error);
        // SAFETY: restore the disposition before continuing or launching other work.
        let restore_result = unsafe { libc::signal(libc::SIGPIPE, previous) };
        if restore_result == libc::SIG_ERR {
            return Err(format!(
                "Could not restore startup-pipe SIGPIPE handling: {}",
                io::Error::last_os_error()
            ));
        }
        if let Some(error) = write_error {
            return Err(format!(
                "Could not notify Forge of verifier startup: {error}"
            ));
        }
        Ok(())
    }

    fn owner_is_alive(owner_fd: RawFd) -> Result<bool, String> {
        let mut byte = 0_u8;
        loop {
            // SAFETY: owner_fd is held by OwnedFd for this call and byte is writable.
            let result =
                unsafe { libc::read(owner_fd, (&mut byte as *mut u8).cast::<libc::c_void>(), 1) };
            if result == 0 {
                return Ok(false);
            }
            if result > 0 {
                return Err("Owner liveness pipe contained unexpected data.".to_owned());
            }
            let error = io::Error::last_os_error();
            match error.raw_os_error() {
                Some(libc::EAGAIN) => return Ok(true),
                Some(libc::EINTR) => continue,
                _ => return Err(format!("Could not read owner liveness pipe: {error}")),
            }
        }
    }

    fn terminate_group_or_child(child: &mut std::process::Child) -> ! {
        // SAFETY: this helper is the leader of the private verifier process group.
        let group_id = unsafe { libc::getpgrp() };
        // SAFETY: a negative group ID addresses every member of that private group.
        let result = unsafe { libc::kill(-group_id, libc::SIGKILL) };
        if result != 0 {
            let error = io::Error::last_os_error();
            eprintln!("Could not terminate watched verifier group: {error}");
            let _ = child.kill();
        }
        // SIGKILL should terminate this helper as a member of the group.
        unsafe { libc::_exit(WATCHDOG_FAILURE_EXIT) }
    }

    fn mirror_exit(status: ExitStatus) -> ! {
        if let Some(code) = status.code() {
            std::process::exit(code);
        }
        if let Some(signal) = status.signal() {
            // SAFETY: resetting and raising the verifier's terminal signal preserves
            // the ExitStatus observed by the Forge parent.
            unsafe {
                libc::signal(signal, libc::SIG_DFL);
                libc::raise(signal);
                libc::_exit(128_i32.saturating_add(signal));
            }
        }
        std::process::exit(WATCHDOG_FAILURE_EXIT);
    }
}

#[cfg(unix)]
fn main() {
    if let Err(message) = unix::run() {
        eprintln!("forge-process-watchdog: {message}");
        std::process::exit(125);
    }
}

#[cfg(not(unix))]
fn main() {
    eprintln!("forge-process-watchdog is used only on Unix platforms.");
    std::process::exit(125);
}
