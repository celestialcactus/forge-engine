use std::{
    collections::HashSet,
    io::Read,
    path::PathBuf,
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};

use crate::Cancellation;

const MAX_ARGUMENTS: usize = 64;
const MAX_ENVIRONMENT_ENTRIES: usize = 128;
const MAX_ATTESTED_CONTROLS: usize = 16;
const MIN_OUTPUT_BYTES: usize = 1_024;
const MAX_OUTPUT_BYTES: usize = 1_048_576;
const MAX_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IsolationProfile {
    Trusted,
    HostManaged,
    Restricted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IsolationControl {
    Filesystem,
    Process,
    Network,
    Credentials,
    Resources,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostIsolationAttestation {
    pub provider_id: String,
    pub boundary_id: String,
    pub process_boundary_inherited: bool,
    pub attested_controls: Vec<IsolationControl>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolationRequest {
    pub profile: IsolationProfile,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_attestation: Option<HostIsolationAttestation>,
}

impl IsolationRequest {
    pub fn trusted() -> Self {
        Self {
            profile: IsolationProfile::Trusted,
            host_attestation: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct IsolationPolicy {
    pub required_profile: IsolationProfile,
    pub required_controls: Vec<IsolationControl>,
    pub allowed_host_provider_ids: Vec<String>,
}

impl IsolationPolicy {
    pub fn trusted() -> Self {
        Self {
            required_profile: IsolationProfile::Trusted,
            required_controls: Vec::new(),
            allowed_host_provider_ids: Vec::new(),
        }
    }

    pub fn host_managed(
        allowed_host_provider_ids: Vec<String>,
        required_controls: Vec<IsolationControl>,
    ) -> Self {
        Self {
            required_profile: IsolationProfile::HostManaged,
            required_controls,
            allowed_host_provider_ids,
        }
    }

    pub fn restricted(required_controls: Vec<IsolationControl>) -> Self {
        Self {
            required_profile: IsolationProfile::Restricted,
            required_controls,
            allowed_host_provider_ids: Vec::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IsolationEnforcement {
    None,
    HostAttested,
    ForgeEnforced,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolationEvidence {
    pub requested_profile: IsolationProfile,
    pub effective_profile: IsolationProfile,
    pub enforcement: IsolationEnforcement,
    pub provider_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary_id: Option<String>,
    pub forge_enforced: bool,
    pub controls: Vec<IsolationControl>,
    pub limitations: Vec<String>,
}

impl IsolationEvidence {
    pub fn is_consistent_with(&self, request: &IsolationRequest) -> bool {
        if self.requested_profile != request.profile || self.effective_profile != request.profile {
            return false;
        }
        match request.profile {
            IsolationProfile::Trusted => {
                self.enforcement == IsolationEnforcement::None
                    && !self.forge_enforced
                    && self.boundary_id.is_none()
                    && self.controls.is_empty()
            }
            IsolationProfile::HostManaged => {
                let Some(attestation) = request.host_attestation.as_ref() else {
                    return false;
                };
                self.enforcement == IsolationEnforcement::HostAttested
                    && !self.forge_enforced
                    && self.provider_id == attestation.provider_id
                    && self.boundary_id.as_deref() == Some(attestation.boundary_id.as_str())
                    && self.controls == attestation.attested_controls
            }
            IsolationProfile::Restricted => {
                self.enforcement == IsolationEnforcement::ForgeEnforced
                    && self.forge_enforced
                    && self
                        .boundary_id
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                    && !self.provider_id.is_empty()
                    && !self.controls.is_empty()
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct IsolatedProcessSpec {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    pub working_directory: PathBuf,
    pub timeout: Duration,
    pub max_output_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct CapturedOutput {
    pub bytes: Vec<u8>,
    pub total_bytes: u64,
}

#[derive(Debug)]
pub struct IsolatedProcessOutcome {
    pub status: Option<ExitStatus>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub stdout: CapturedOutput,
    pub stderr: CapturedOutput,
    pub isolation: IsolationEvidence,
}

pub trait IsolationProvider: Send + Sync {
    fn execute(
        &self,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String>;
}

#[derive(Default)]
pub struct BaselineIsolationProvider;

impl IsolationProvider for BaselineIsolationProvider {
    fn execute(
        &self,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        validate_isolation_policy(policy)?;
        validate_policy_request(policy, request)?;
        validate_process(process)?;
        let isolation = match request.profile {
            IsolationProfile::Trusted => IsolationEvidence {
                requested_profile: request.profile,
                effective_profile: IsolationProfile::Trusted,
                enforcement: IsolationEnforcement::None,
                provider_id: "forge.baseline".to_owned(),
                boundary_id: None,
                forge_enforced: false,
                controls: Vec::new(),
                limitations: vec![
                    "The process runs with the Forge process's operating-system permissions."
                        .to_owned(),
                    "Forge does not restrict filesystem, network, credentials, or subprocesses in trusted mode."
                        .to_owned(),
                ],
            },
            IsolationProfile::HostManaged => {
                let attestation = request
                    .host_attestation
                    .as_ref()
                    .expect("validated host attestation");
                IsolationEvidence {
                    requested_profile: request.profile,
                    effective_profile: IsolationProfile::HostManaged,
                    enforcement: IsolationEnforcement::HostAttested,
                    provider_id: attestation.provider_id.clone(),
                    boundary_id: Some(attestation.boundary_id.clone()),
                    forge_enforced: false,
                    controls: attestation.attested_controls.clone(),
                    limitations: vec![
                        "Containment is attested by the host and is not independently enforced or verified by Forge."
                            .to_owned(),
                    ],
                }
            }
            IsolationProfile::Restricted => {
                return Err(
                    "The baseline isolation provider cannot enforce the restricted profile."
                        .to_owned(),
                );
            }
        };

        let execution = run_bounded_process(process, cancellation)?;
        Ok(IsolatedProcessOutcome {
            status: execution.status,
            timed_out: execution.timed_out,
            cancelled: execution.cancelled,
            stdout: execution.stdout,
            stderr: execution.stderr,
            isolation,
        })
    }
}

fn validate_identifier(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 200
        || value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    {
        return Err(format!("{label} is invalid."));
    }
    Ok(())
}

pub fn validate_isolation_policy(policy: &IsolationPolicy) -> Result<(), String> {
    let controls = &policy.required_controls;
    let controls_valid =
        controls.len() <= 5 && controls.iter().collect::<HashSet<_>>().len() == controls.len();
    match policy.required_profile {
        IsolationProfile::Trusted => {
            if !controls.is_empty() || !policy.allowed_host_provider_ids.is_empty() {
                return Err(
                    "Trusted execution cannot declare containment controls or host providers."
                        .to_owned(),
                );
            }
        }
        IsolationProfile::HostManaged => {
            if controls.is_empty() || !controls_valid {
                return Err("Host-managed execution requires valid minimum controls.".to_owned());
            }
            if policy.allowed_host_provider_ids.is_empty()
                || policy.allowed_host_provider_ids.len() > 16
                || policy
                    .allowed_host_provider_ids
                    .iter()
                    .collect::<HashSet<_>>()
                    .len()
                    != policy.allowed_host_provider_ids.len()
            {
                return Err(
                    "Host-managed execution requires unique allowed host providers.".to_owned(),
                );
            }
            for provider in &policy.allowed_host_provider_ids {
                validate_identifier("Allowed host isolation provider ID", provider)?;
            }
        }
        IsolationProfile::Restricted => {
            if controls.is_empty()
                || !controls_valid
                || !policy.allowed_host_provider_ids.is_empty()
            {
                return Err(
                    "Restricted execution requires valid Forge controls and no host providers."
                        .to_owned(),
                );
            }
        }
    }
    Ok(())
}
fn validate_policy_request(
    policy: &IsolationPolicy,
    request: &IsolationRequest,
) -> Result<(), String> {
    if request.profile != policy.required_profile {
        return Err(format!(
            "Requested isolation profile {:?} does not satisfy policy profile {:?}.",
            request.profile, policy.required_profile
        ));
    }
    match request.profile {
        IsolationProfile::Trusted | IsolationProfile::Restricted => {
            if request.host_attestation.is_some() {
                return Err(
                    "Host isolation attestation is valid only for host-managed execution."
                        .to_owned(),
                );
            }
        }
        IsolationProfile::HostManaged => {
            let attestation = request.host_attestation.as_ref().ok_or_else(|| {
                "Host-managed execution requires an explicit host isolation attestation.".to_owned()
            })?;
            validate_identifier("Host isolation provider ID", &attestation.provider_id)?;
            validate_identifier("Host isolation boundary ID", &attestation.boundary_id)?;
            if !attestation.process_boundary_inherited {
                return Err(
                    "The host did not attest that child processes inherit its isolation boundary."
                        .to_owned(),
                );
            }
            if attestation.attested_controls.is_empty()
                || attestation.attested_controls.len() > MAX_ATTESTED_CONTROLS
                || attestation
                    .attested_controls
                    .iter()
                    .collect::<HashSet<_>>()
                    .len()
                    != attestation.attested_controls.len()
            {
                return Err("Host-attested isolation controls are empty or invalid.".to_owned());
            }
            if !policy
                .required_controls
                .iter()
                .all(|control| attestation.attested_controls.contains(control))
            {
                return Err(
                    "Host isolation attestation does not satisfy every policy-required control."
                        .to_owned(),
                );
            }
            if policy.allowed_host_provider_ids.is_empty()
                || !policy
                    .allowed_host_provider_ids
                    .contains(&attestation.provider_id)
            {
                return Err(format!(
                    "Host isolation provider {} is not allowed by policy.",
                    attestation.provider_id
                ));
            }
        }
    }
    Ok(())
}

fn validate_process(process: &IsolatedProcessSpec) -> Result<(), String> {
    if process.executable.as_os_str().is_empty() {
        return Err("Isolated process executable must not be empty.".to_owned());
    }
    if process.arguments.len() > MAX_ARGUMENTS
        || process
            .arguments
            .iter()
            .any(|argument| argument.len() > 8_192 || argument.contains('\0'))
    {
        return Err("Isolated process arguments are invalid.".to_owned());
    }
    if process.environment.len() > MAX_ENVIRONMENT_ENTRIES
        || process.environment.iter().any(|(name, value)| {
            name.is_empty() || name.contains('=') || name.contains('\0') || value.contains('\0')
        })
    {
        return Err("Isolated process environment is invalid.".to_owned());
    }
    if process.timeout.is_zero() || process.timeout > MAX_TIMEOUT {
        return Err("Isolated process timeout must be from 1 ms to 600 seconds.".to_owned());
    }
    if !(MIN_OUTPUT_BYTES..=MAX_OUTPUT_BYTES).contains(&process.max_output_bytes) {
        return Err(format!(
            "Isolated process output limit must be from {MIN_OUTPUT_BYTES} to {MAX_OUTPUT_BYTES} bytes."
        ));
    }
    Ok(())
}

struct BoundedProcessResult {
    status: Option<ExitStatus>,
    timed_out: bool,
    cancelled: bool,
    stdout: CapturedOutput,
    stderr: CapturedOutput,
}

fn run_bounded_process(
    process: &IsolatedProcessSpec,
    cancellation: &dyn Cancellation,
) -> Result<BoundedProcessResult, String> {
    let mut command = Command::new(&process.executable);
    command
        .current_dir(&process.working_directory)
        .args(&process.arguments)
        .envs(process.environment.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x0000_0200);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start isolated process: {error}"))?;
    let process_id = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Isolated process stdout pipe is unavailable.".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Isolated process stderr pipe is unavailable.".to_owned())?;
    let budget = Arc::new(AtomicUsize::new(0));
    let stdout_capture = capture_stream(stdout, Arc::clone(&budget), process.max_output_bytes);
    let stderr_capture = capture_stream(stderr, Arc::clone(&budget), process.max_output_bytes);

    let started = Instant::now();
    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if cancellation.reason().is_some() {
            cancelled = true;
            terminate_process_tree(&mut child, process_id);
            break child.wait().ok();
        }
        if started.elapsed() >= process.timeout {
            timed_out = true;
            terminate_process_tree(&mut child, process_id);
            break child.wait().ok();
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                terminate_remaining_descendants(&mut child, process_id);
                break Some(status);
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                terminate_process_tree(&mut child, process_id);
                let _ = child.wait();
                return Err(format!("Could not observe isolated process: {error}"));
            }
        }
    };

    let stdout = stdout_capture
        .join()
        .map_err(|_| "Isolated process stdout capture panicked.".to_owned())??;
    let stderr = stderr_capture
        .join()
        .map_err(|_| "Isolated process stderr capture panicked.".to_owned())??;
    Ok(BoundedProcessResult {
        status,
        timed_out,
        cancelled,
        stdout,
        stderr,
    })
}

fn capture_stream<R: Read + Send + 'static>(
    mut stream: R,
    budget: Arc<AtomicUsize>,
    maximum_bytes: usize,
) -> thread::JoinHandle<Result<CapturedOutput, String>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut total_bytes = 0_u64;
        let mut buffer = [0_u8; 8_192];
        loop {
            let count = stream
                .read(&mut buffer)
                .map_err(|error| format!("Could not capture isolated process output: {error}"))?;
            if count == 0 {
                break;
            }
            total_bytes = total_bytes.saturating_add(count as u64);
            let reserved = reserve_output(&budget, maximum_bytes, count);
            bytes.extend_from_slice(&buffer[..reserved]);
        }
        Ok(CapturedOutput { bytes, total_bytes })
    })
}

fn reserve_output(budget: &AtomicUsize, maximum_bytes: usize, requested: usize) -> usize {
    let mut current = budget.load(Ordering::Relaxed);
    loop {
        if current >= maximum_bytes {
            return 0;
        }
        let reserved = requested.min(maximum_bytes - current);
        match budget.compare_exchange_weak(
            current,
            current + reserved,
            Ordering::AcqRel,
            Ordering::Relaxed,
        ) {
            Ok(_) => return reserved,
            Err(actual) => current = actual,
        }
    }
}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child, process_id: u32) {
    // SAFETY: the child was placed in a new process group whose ID is its PID.
    unsafe {
        libc::kill(-(process_id as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child, process_id: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(child: &mut Child, _process_id: u32) {
    let _ = child.kill();
}

#[cfg(unix)]
fn terminate_remaining_descendants(child: &mut Child, process_id: u32) {
    // SAFETY: signaling a process group is safe; ESRCH is expected when it is empty.
    unsafe {
        libc::kill(-(process_id as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_remaining_descendants(child: &mut Child, process_id: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn terminate_remaining_descendants(child: &mut Child, _process_id: u32) {
    let _ = child.kill();
}
