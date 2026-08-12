use std::{
    collections::HashSet,
    env,
    ffi::OsString,
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
use std::os::{
    fd::{AsRawFd, FromRawFd, OwnedFd, RawFd},
    unix::{fs::PermissionsExt, process::CommandExt},
};
#[cfg(unix)]
use std::path::Path;
mod host_managed_provider;
#[cfg(target_os = "macos")]
mod macos_process_group;
#[cfg(windows)]
mod windows_appcontainer;
#[cfg(windows)]
mod windows_job;
#[cfg(windows)]
mod windows_managed;

pub use host_managed_provider::*;
#[cfg(windows)]
pub use windows_appcontainer::WindowsAppContainerIsolationProvider;
#[cfg(windows)]
pub use windows_managed::WindowsManagedIsolationProvider;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{AuthenticatedHostAuthorityEvidence, Cancellation};

const MAX_ARGUMENTS: usize = 64;
const MAX_ENVIRONMENT_ENTRIES: usize = 128;
const MAX_READABLE_ROOTS: usize = 32;
const MAX_DENIED_READ_ROOTS: usize = 32;
const MAX_DENIED_WRITE_ROOTS: usize = 32;
const MIN_OUTPUT_BYTES: usize = 1_024;
const MAX_OUTPUT_BYTES: usize = 1_048_576;
const MAX_TIMEOUT: Duration = Duration::from_secs(600);
const RESTRICTED_MAX_ACTIVE_PROCESSES: u32 = 64;
const RESTRICTED_MAX_PROCESS_MEMORY_BYTES: usize = 1_073_741_824;
const RESTRICTED_PROTECTED_PATHS: [&str; 5] =
    [".git", ".forge", ".agents", ".codex", ".forge-toolchain"];
#[cfg(unix)]
const PROCESS_TERMINATION_TIMEOUT: Duration = Duration::from_secs(2);
#[cfg(unix)]
const PROCESS_STARTUP_TIMEOUT: Duration = Duration::from_secs(5);
#[cfg(unix)]
const PROCESS_TERMINATION_POLL_INTERVAL: Duration = Duration::from_millis(5);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IsolationProviderClass {
    TrustedBaseline,
    ExternalAttested,
    NativeFallback,
    NativeStrong,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IsolationProviderAvailability {
    Available,
    SetupRequired,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolationProviderCapabilities {
    pub provider_id: String,
    pub supported_profiles: Vec<IsolationProfile>,
    pub authenticates_host_attestations: bool,
    pub restricted_controls: Vec<IsolationControl>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolationProviderStatus {
    pub capabilities: IsolationProviderCapabilities,
    pub provider_class: IsolationProviderClass,
    pub availability: IsolationProviderAvailability,
    pub limitations: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IsolationRequest {
    pub profile: IsolationProfile,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_provider_id: Option<String>,
}

impl IsolationRequest {
    pub fn trusted() -> Self {
        Self {
            profile: IsolationProfile::Trusted,
            host_provider_id: None,
        }
    }

    pub fn host_managed(provider_id: impl Into<String>) -> Self {
        Self {
            profile: IsolationProfile::HostManaged,
            host_provider_id: Some(provider_id.into()),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan_digest: Option<String>,
    pub forge_enforced: bool,
    pub controls: Vec<IsolationControl>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_authority: Option<AuthenticatedHostAuthorityEvidence>,
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
                    && self.plan_digest.is_none()
                    && self.controls.is_empty()
                    && self.host_authority.is_none()
            }
            IsolationProfile::HostManaged => {
                let Some(provider_id) = request.host_provider_id.as_deref() else {
                    return false;
                };
                let Some(authority) = self.host_authority.as_ref() else {
                    return false;
                };
                self.enforcement == IsolationEnforcement::HostAttested
                    && !self.forge_enforced
                    && self.provider_id == provider_id
                    && authority.challenge.provider_id == provider_id
                    && self.boundary_id.as_deref() == Some(authority.statement.boundary_id.as_str())
                    && self.plan_digest.is_none()
                    && self.controls == authority.statement.attested_controls
            }
            IsolationProfile::Restricted => {
                self.enforcement == IsolationEnforcement::ForgeEnforced
                    && self.forge_enforced
                    && self
                        .boundary_id
                        .as_ref()
                        .is_some_and(|value| !value.is_empty())
                    && self.plan_digest.as_deref().is_some_and(is_lower_sha256)
                    && !self.provider_id.is_empty()
                    && !self.controls.is_empty()
                    && self.host_authority.is_none()
            }
        }
    }
}

#[derive(Clone, Debug)]
pub struct IsolatedProcessSpec {
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    pub inherited_environment: Vec<String>,
    pub working_directory: PathBuf,
    pub readable_roots: Vec<PathBuf>,
    pub denied_read_roots: Vec<PathBuf>,
    pub denied_write_roots: Vec<PathBuf>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxNetworkPlan {
    Inherit,
    DenyDirect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxCredentialPlan {
    ExplicitEnvironmentOnly,
    DenyAmbient,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EffectiveSandboxPlan {
    pub schema_version: u32,
    pub provider_id: String,
    pub provider_class: IsolationProviderClass,
    pub executable: PathBuf,
    pub working_directory: PathBuf,
    pub readable_roots: Vec<PathBuf>,
    pub denied_read_roots: Vec<PathBuf>,
    pub denied_write_roots: Vec<PathBuf>,
    pub writable_roots: Vec<PathBuf>,
    pub protected_relative_paths: Vec<PathBuf>,
    pub deny_filesystem_outside_roots: bool,
    pub network: SandboxNetworkPlan,
    pub credentials: SandboxCredentialPlan,
    pub own_descendant_processes: bool,
    pub enforce_resource_limits: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_active_processes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_process_memory_bytes: Option<usize>,
    pub timeout_milliseconds: u64,
    pub max_output_bytes: usize,
    pub required_controls: Vec<IsolationControl>,
    pub launch_digest: String,
    pub plan_digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProcessEnvironmentEvidence {
    pub cleared: bool,
    pub inherited_names: Vec<String>,
    pub fixed_names: Vec<String>,
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
    pub environment: ProcessEnvironmentEvidence,
}

pub trait IsolationProvider: Send + Sync {
    fn status(&self) -> IsolationProviderStatus;

    fn capabilities(&self) -> IsolationProviderCapabilities {
        self.status().capabilities
    }

    fn authorize_host_managed(
        &self,
        _policy: &IsolationPolicy,
        _request: &IsolationRequest,
        _binding: &HostExecutionBinding,
        _cancellation: &dyn Cancellation,
    ) -> Result<HostExecutionGrant, String> {
        Err("Isolation provider does not issue authenticated host execution grants.".to_owned())
    }

    fn execute_host_managed(
        &self,
        _grant: HostExecutionGrant,
        _policy: &IsolationPolicy,
        _request: &IsolationRequest,
        _binding: &HostExecutionBinding,
        _process: &IsolatedProcessSpec,
        _cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        Err("Isolation provider does not consume authenticated host execution grants.".to_owned())
    }

    fn execute_restricted(
        &self,
        _plan: &EffectiveSandboxPlan,
        _process: &IsolatedProcessSpec,
        _cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        Err("Isolation provider does not implement compiled restricted execution.".to_owned())
    }

    fn execute(
        &self,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String>;
}

#[derive(Clone, Debug, Default)]
pub struct BaselineIsolationProvider {
    #[cfg(unix)]
    unix_watchdog_executable: Option<PathBuf>,
}

impl BaselineIsolationProvider {
    #[cfg(unix)]
    pub fn with_unix_watchdog_executable(executable: PathBuf) -> Self {
        Self {
            unix_watchdog_executable: Some(executable),
        }
    }

    #[cfg(unix)]
    fn resolve_unix_watchdog(&self) -> Result<PathBuf, String> {
        match self.unix_watchdog_executable.as_deref() {
            Some(executable) => validate_unix_watchdog(executable),
            None => locate_packaged_unix_watchdog(),
        }
    }
}

impl IsolationProvider for BaselineIsolationProvider {
    fn status(&self) -> IsolationProviderStatus {
        IsolationProviderStatus {
            capabilities: IsolationProviderCapabilities {
                provider_id: "forge.baseline".to_owned(),
                supported_profiles: vec![IsolationProfile::Trusted],
                authenticates_host_attestations: false,
                restricted_controls: Vec::new(),
            },
            provider_class: IsolationProviderClass::TrustedBaseline,
            availability: IsolationProviderAvailability::Available,
            limitations: vec![
                "Trusted execution has no Forge-enforced operating-system permission boundary."
                    .to_owned(),
            ],
        }
    }

    fn execute(
        &self,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        let capabilities = self.capabilities();
        validate_isolation_provider_request(&capabilities, policy, request)?;
        validate_process(process)?;
        let mut isolation = match request.profile {
            IsolationProfile::Trusted => IsolationEvidence {
                requested_profile: request.profile,
                effective_profile: IsolationProfile::Trusted,
                enforcement: IsolationEnforcement::None,
                provider_id: "forge.baseline".to_owned(),
                boundary_id: None,
                plan_digest: None,
                forge_enforced: false,
                controls: Vec::new(),
                host_authority: None,
                limitations: vec![
                    "The process runs with the Forge process's operating-system permissions."
                        .to_owned(),
                    "Forge does not restrict filesystem, network, credentials, or subprocesses in trusted mode."
                        .to_owned(),
                ],
            },
            IsolationProfile::HostManaged | IsolationProfile::Restricted => unreachable!(
                "baseline provider capabilities reject non-trusted execution before launch"
            ),
        };
        isolation.limitations.push(
            "Forge clears the verifier environment and restores only baseline and policy-listed values; this reduces exposure but is not containment."
                .to_owned(),
        );
        isolation
            .limitations
            .push(process_ownership_limitation().to_owned());

        let (execution, environment) = run_bounded_process(
            process,
            cancellation,
            #[cfg(unix)]
            &self.resolve_unix_watchdog()?,
            #[cfg(windows)]
            None,
        )?;
        Ok(IsolatedProcessOutcome {
            status: execution.status,
            timed_out: execution.timed_out,
            cancelled: execution.cancelled,
            stdout: execution.stdout,
            stderr: execution.stderr,
            isolation,
            environment,
        })
    }
}

#[cfg(windows)]
fn process_ownership_limitation() -> &'static str {
    "Forge assigns the suspended verifier to a kill-on-close Windows Job Object before execution and confirms process-tree teardown; this controls lifecycle, not filesystem, network, credential, or privilege access."
}

#[cfg(unix)]
fn process_ownership_limitation() -> &'static str {
    "Forge launches a packaged watchdog and verifier in one dedicated process group, confirms supervised teardown, and uses parent-pipe EOF for ordinary owner-death cleanup; this controls lifecycle, not permissions, and a trusted verifier may deliberately escape the group."
}

#[cfg(not(any(unix, windows)))]
fn process_ownership_limitation() -> &'static str {
    "Forge supervises only the direct verifier process on this platform; descendant ownership is unsupported and no containment is claimed."
}

#[cfg(unix)]
fn validate_unix_watchdog(executable: &Path) -> Result<PathBuf, String> {
    let canonical = executable.canonicalize().map_err(|error| {
        format!(
            "Unix verifier watchdog {} is unavailable: {error}",
            executable.display()
        )
    })?;
    let metadata = canonical.metadata().map_err(|error| {
        format!(
            "Could not inspect Unix verifier watchdog {}: {error}",
            canonical.display()
        )
    })?;
    if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
        return Err(format!(
            "Unix verifier watchdog {} is not an executable file.",
            canonical.display()
        ));
    }
    if canonical.file_name().and_then(|name| name.to_str()) != Some("forge-process-watchdog") {
        return Err(
            "Unix verifier watchdog must be the packaged forge-process-watchdog executable."
                .to_owned(),
        );
    }
    Ok(canonical)
}

#[cfg(unix)]
fn locate_packaged_unix_watchdog() -> Result<PathBuf, String> {
    let current = env::current_exe()
        .map_err(|error| format!("Could not locate the running Forge executable: {error}"))?;
    let directory = current
        .parent()
        .ok_or_else(|| "Running Forge executable has no parent directory.".to_owned())?;
    let mut candidates = vec![directory.join("forge-process-watchdog")];
    if directory.file_name().and_then(|name| name.to_str()) == Some("deps")
        && let Some(build_directory) = directory.parent()
    {
        candidates.push(build_directory.join("forge-process-watchdog"));
    }
    for candidate in candidates {
        if candidate.exists() {
            return validate_unix_watchdog(&candidate);
        }
    }
    Err("Packaged Unix verifier watchdog is unavailable beside Forge; verifier execution was not started."
        .to_owned())
}

#[cfg(unix)]
fn create_unix_owner_pipe() -> Result<(OwnedFd, OwnedFd), String> {
    let mut descriptors = [-1_i32; 2];
    // SAFETY: descriptors points to storage for the two descriptors returned by pipe.
    if unsafe { libc::pipe(descriptors.as_mut_ptr()) } != 0 {
        return Err(format!(
            "Could not create Unix owner liveness pipe: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: pipe returned two new owned descriptors.
    let reader = unsafe { OwnedFd::from_raw_fd(descriptors[0]) };
    // SAFETY: pipe returned two new owned descriptors.
    let writer = unsafe { OwnedFd::from_raw_fd(descriptors[1]) };
    set_descriptor_flag(
        reader.as_raw_fd(),
        libc::F_GETFL,
        libc::F_SETFL,
        libc::O_NONBLOCK,
        0,
    )?;
    set_descriptor_flag(
        reader.as_raw_fd(),
        libc::F_GETFD,
        libc::F_SETFD,
        0,
        libc::FD_CLOEXEC,
    )?;
    set_descriptor_flag(
        writer.as_raw_fd(),
        libc::F_GETFD,
        libc::F_SETFD,
        libc::FD_CLOEXEC,
        0,
    )?;
    Ok((reader, writer))
}

#[cfg(unix)]
fn create_unix_startup_pipe() -> Result<(OwnedFd, OwnedFd), String> {
    let mut descriptors = [-1_i32; 2];
    // SAFETY: descriptors points to storage for the two descriptors returned by pipe.
    if unsafe { libc::pipe(descriptors.as_mut_ptr()) } != 0 {
        return Err(format!(
            "Could not create Unix verifier startup pipe: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: pipe returned two new owned descriptors.
    let reader = unsafe { OwnedFd::from_raw_fd(descriptors[0]) };
    // SAFETY: pipe returned two new owned descriptors.
    let writer = unsafe { OwnedFd::from_raw_fd(descriptors[1]) };
    set_descriptor_flag(
        reader.as_raw_fd(),
        libc::F_GETFL,
        libc::F_SETFL,
        libc::O_NONBLOCK,
        0,
    )?;
    set_descriptor_flag(
        reader.as_raw_fd(),
        libc::F_GETFD,
        libc::F_SETFD,
        libc::FD_CLOEXEC,
        0,
    )?;
    set_descriptor_flag(
        writer.as_raw_fd(),
        libc::F_GETFD,
        libc::F_SETFD,
        0,
        libc::FD_CLOEXEC,
    )?;
    Ok((reader, writer))
}

#[cfg(unix)]
fn set_descriptor_flag(
    descriptor: RawFd,
    get_command: libc::c_int,
    set_command: libc::c_int,
    add: libc::c_int,
    remove: libc::c_int,
) -> Result<(), String> {
    // SAFETY: descriptor is owned by the caller and get_command is a valid fcntl query.
    let current = unsafe { libc::fcntl(descriptor, get_command) };
    if current < 0 {
        return Err(format!(
            "Could not inspect Unix owner liveness descriptor: {}",
            std::io::Error::last_os_error()
        ));
    }
    // SAFETY: descriptor is owned by the caller and set_command accepts flag bits.
    if unsafe { libc::fcntl(descriptor, set_command, (current | add) & !remove) } != 0 {
        return Err(format!(
            "Could not configure Unix owner liveness descriptor: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
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
pub fn validate_isolation_provider_capabilities(
    capabilities: &IsolationProviderCapabilities,
) -> Result<(), String> {
    validate_identifier("Isolation provider ID", &capabilities.provider_id)?;
    if capabilities.supported_profiles.is_empty()
        || capabilities.supported_profiles.len() > 3
        || capabilities
            .supported_profiles
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != capabilities.supported_profiles.len()
    {
        return Err("Isolation provider profiles are empty, duplicated, or invalid.".to_owned());
    }
    let supports_host = capabilities
        .supported_profiles
        .contains(&IsolationProfile::HostManaged);
    if supports_host != capabilities.authenticates_host_attestations {
        return Err(
            "Host-managed provider support must authenticate host attestations.".to_owned(),
        );
    }
    let supports_restricted = capabilities
        .supported_profiles
        .contains(&IsolationProfile::Restricted);
    if capabilities.restricted_controls.len() > 5
        || capabilities
            .restricted_controls
            .iter()
            .collect::<HashSet<_>>()
            .len()
            != capabilities.restricted_controls.len()
        || supports_restricted != !capabilities.restricted_controls.is_empty()
    {
        return Err(
            "Restricted provider support must declare unique enforceable controls.".to_owned(),
        );
    }
    Ok(())
}

pub fn validate_isolation_provider_status(status: &IsolationProviderStatus) -> Result<(), String> {
    validate_isolation_provider_capabilities(&status.capabilities)?;
    if status.limitations.is_empty()
        || status.limitations.len() > 16
        || status
            .limitations
            .iter()
            .any(|item| item.trim().is_empty() || item.len() > 1_024)
    {
        return Err("Isolation provider status requires bounded explicit limitations.".to_owned());
    }
    let supports_trusted = status
        .capabilities
        .supported_profiles
        .contains(&IsolationProfile::Trusted);
    let supports_host = status
        .capabilities
        .supported_profiles
        .contains(&IsolationProfile::HostManaged);
    let supports_restricted = status
        .capabilities
        .supported_profiles
        .contains(&IsolationProfile::Restricted);
    let class_matches = match status.provider_class {
        IsolationProviderClass::TrustedBaseline => {
            supports_trusted && !supports_host && !supports_restricted
        }
        IsolationProviderClass::ExternalAttested => supports_host && !supports_restricted,
        IsolationProviderClass::NativeFallback | IsolationProviderClass::NativeStrong => {
            supports_restricted && !supports_host
        }
    };
    if !class_matches {
        return Err(
            "Isolation provider class is inconsistent with its supported profiles.".to_owned(),
        );
    }
    Ok(())
}

pub fn isolation_provider_restricted_ready(status: &IsolationProviderStatus) -> bool {
    validate_isolation_provider_status(status).is_ok()
        && status.availability == IsolationProviderAvailability::Available
        && status.provider_class == IsolationProviderClass::NativeStrong
        && status
            .capabilities
            .supported_profiles
            .contains(&IsolationProfile::Restricted)
        && [
            IsolationControl::Filesystem,
            IsolationControl::Process,
            IsolationControl::Network,
            IsolationControl::Credentials,
            IsolationControl::Resources,
        ]
        .iter()
        .all(|control| status.capabilities.restricted_controls.contains(control))
}

pub fn compile_effective_sandbox_plan(
    status: &IsolationProviderStatus,
    policy: &IsolationPolicy,
    request: &IsolationRequest,
    process: &IsolatedProcessSpec,
) -> Result<EffectiveSandboxPlan, String> {
    validate_isolation_provider_status(status)?;
    validate_isolation_provider_request(&status.capabilities, policy, request)?;
    validate_process(process)?;
    if request.profile != IsolationProfile::Restricted {
        return Err("An effective sandbox plan is valid only for restricted execution.".to_owned());
    }
    if status.availability != IsolationProviderAvailability::Available {
        return Err(format!(
            "Isolation provider {} is {:?}; restricted execution was not started.",
            status.capabilities.provider_id, status.availability
        ));
    }
    if !matches!(
        status.provider_class,
        IsolationProviderClass::NativeFallback | IsolationProviderClass::NativeStrong
    ) {
        return Err("Restricted execution requires a Forge native isolation provider.".to_owned());
    }
    if !process.executable.is_absolute() {
        return Err(
            "Restricted execution requires an absolute policy-owned executable path.".to_owned(),
        );
    }
    let executable = process.executable.canonicalize().map_err(|error| {
        format!(
            "Restricted executable {} is unavailable: {error}",
            process.executable.display()
        )
    })?;
    if !executable
        .metadata()
        .map_err(|error| format!("Could not inspect restricted executable: {error}"))?
        .is_file()
    {
        return Err("Restricted executable is not a regular file.".to_owned());
    }
    let working_directory = process.working_directory.canonicalize().map_err(|error| {
        format!(
            "Restricted working directory {} is unavailable: {error}",
            process.working_directory.display()
        )
    })?;
    if !working_directory
        .metadata()
        .map_err(|error| format!("Could not inspect restricted working directory: {error}"))?
        .is_dir()
    {
        return Err("Restricted working directory is not a directory.".to_owned());
    }
    let mut required_controls = policy.required_controls.clone();
    required_controls.sort_by_key(|control| isolation_control_order(*control));
    let filesystem = required_controls.contains(&IsolationControl::Filesystem);
    let timeout_milliseconds = u64::try_from(process.timeout.as_millis())
        .map_err(|_| "Restricted process timeout overflowed.".to_owned())?;
    let mut readable_roots = process
        .readable_roots
        .iter()
        .map(|path| {
            let canonical = path.canonicalize().map_err(|error| {
                format!(
                    "Restricted readable root {} is unavailable: {error}",
                    path.display()
                )
            })?;
            if !canonical
                .metadata()
                .map_err(|error| format!("Could not inspect restricted readable root: {error}"))?
                .is_dir()
            {
                return Err(format!(
                    "Restricted readable root {} is not a directory.",
                    canonical.display()
                ));
            }
            Ok(canonical)
        })
        .collect::<Result<Vec<_>, String>>()?;
    readable_roots.push(working_directory.clone());
    readable_roots.sort();
    readable_roots.dedup();
    let mut denied_read_roots = process
        .denied_read_roots
        .iter()
        .map(|path| {
            let canonical = path.canonicalize().map_err(|error| {
                format!(
                    "Restricted denied-read root {} is unavailable: {error}",
                    path.display()
                )
            })?;
            if !canonical
                .metadata()
                .map_err(|error| format!("Could not inspect restricted denied-read root: {error}"))?
                .is_dir()
            {
                return Err(format!(
                    "Restricted denied-read root {} is not a directory.",
                    canonical.display()
                ));
            }
            Ok(canonical)
        })
        .collect::<Result<Vec<_>, String>>()?;
    denied_read_roots.sort();
    denied_read_roots.dedup();
    let mut denied_write_roots = process
        .denied_write_roots
        .iter()
        .map(|path| {
            let canonical = path.canonicalize().map_err(|error| {
                format!(
                    "Restricted denied-write root {} is unavailable: {error}",
                    path.display()
                )
            })?;
            if !canonical
                .metadata()
                .map_err(|error| {
                    format!("Could not inspect restricted denied-write root: {error}")
                })?
                .is_dir()
            {
                return Err(format!(
                    "Restricted denied-write root {} is not a directory.",
                    canonical.display()
                ));
            }
            Ok(canonical)
        })
        .collect::<Result<Vec<_>, String>>()?;
    denied_write_roots.sort();
    denied_write_roots.dedup();
    let launch_digest = hash_serializable(&(
        &executable,
        &process.arguments,
        &process.environment,
        &process.inherited_environment,
        &working_directory,
        &readable_roots,
        &denied_read_roots,
        &denied_write_roots,
        timeout_milliseconds,
        process.max_output_bytes,
    ))?;
    let mut plan = EffectiveSandboxPlan {
        schema_version: 4,
        provider_id: status.capabilities.provider_id.clone(),
        provider_class: status.provider_class,
        executable,
        working_directory: working_directory.clone(),
        readable_roots: if filesystem {
            readable_roots
        } else {
            Vec::new()
        },
        denied_read_roots: if filesystem {
            denied_read_roots
        } else {
            Vec::new()
        },
        denied_write_roots: if filesystem {
            denied_write_roots
        } else {
            Vec::new()
        },
        writable_roots: if filesystem {
            vec![working_directory]
        } else {
            Vec::new()
        },
        protected_relative_paths: if filesystem {
            RESTRICTED_PROTECTED_PATHS
                .into_iter()
                .map(PathBuf::from)
                .collect()
        } else {
            Vec::new()
        },
        deny_filesystem_outside_roots: filesystem,
        network: if required_controls.contains(&IsolationControl::Network) {
            SandboxNetworkPlan::DenyDirect
        } else {
            SandboxNetworkPlan::Inherit
        },
        credentials: if required_controls.contains(&IsolationControl::Credentials) {
            SandboxCredentialPlan::DenyAmbient
        } else {
            SandboxCredentialPlan::ExplicitEnvironmentOnly
        },
        own_descendant_processes: required_controls.contains(&IsolationControl::Process),
        enforce_resource_limits: required_controls.contains(&IsolationControl::Resources),
        max_active_processes: required_controls
            .contains(&IsolationControl::Resources)
            .then_some(RESTRICTED_MAX_ACTIVE_PROCESSES),
        max_process_memory_bytes: required_controls
            .contains(&IsolationControl::Resources)
            .then_some(RESTRICTED_MAX_PROCESS_MEMORY_BYTES),
        timeout_milliseconds,
        max_output_bytes: process.max_output_bytes,
        required_controls,
        launch_digest,
        plan_digest: String::new(),
    };
    plan.plan_digest = hash_serializable(&plan)?;
    validate_effective_sandbox_plan(&plan, status, process)?;
    Ok(plan)
}

pub fn validate_effective_sandbox_plan(
    plan: &EffectiveSandboxPlan,
    status: &IsolationProviderStatus,
    process: &IsolatedProcessSpec,
) -> Result<(), String> {
    validate_isolation_provider_status(status)?;
    validate_process(process)?;
    if status.availability != IsolationProviderAvailability::Available {
        return Err(format!(
            "Isolation provider {} is {:?}; restricted execution was not started.",
            status.capabilities.provider_id, status.availability
        ));
    }
    if !process.executable.is_absolute() {
        return Err(
            "Restricted execution requires an absolute policy-owned executable path.".to_owned(),
        );
    }
    let executable = process.executable.canonicalize().map_err(|error| {
        format!(
            "Restricted executable {} is unavailable: {error}",
            process.executable.display()
        )
    })?;
    if !executable
        .metadata()
        .map_err(|error| format!("Could not inspect restricted executable: {error}"))?
        .is_file()
    {
        return Err("Restricted executable is not a regular file.".to_owned());
    }
    let working_directory = process.working_directory.canonicalize().map_err(|error| {
        format!(
            "Restricted working directory {} is unavailable: {error}",
            process.working_directory.display()
        )
    })?;
    if !working_directory
        .metadata()
        .map_err(|error| format!("Could not inspect restricted working directory: {error}"))?
        .is_dir()
    {
        return Err("Restricted working directory is not a directory.".to_owned());
    }
    let timeout_milliseconds = u64::try_from(process.timeout.as_millis())
        .map_err(|_| "Restricted process timeout overflowed.".to_owned())?;
    if plan.schema_version != 4
        || plan.provider_id != status.capabilities.provider_id
        || plan.provider_class != status.provider_class
        || plan.executable != executable
        || plan.working_directory != working_directory
        || plan.timeout_milliseconds != timeout_milliseconds
        || plan.max_output_bytes != process.max_output_bytes
        || !is_lower_sha256(&plan.launch_digest)
        || !is_lower_sha256(&plan.plan_digest)
    {
        return Err("Effective sandbox plan identity is invalid.".to_owned());
    }
    let mut unsigned = plan.clone();
    let expected_plan_digest = unsigned.plan_digest.clone();
    unsigned.plan_digest.clear();
    if hash_serializable(&unsigned)? != expected_plan_digest {
        return Err("Effective sandbox plan digest does not match its contents.".to_owned());
    }
    let mut expected_readable_roots = process
        .readable_roots
        .iter()
        .map(|path| path.canonicalize())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Restricted readable root is unavailable: {error}"))?;
    expected_readable_roots.push(working_directory.clone());
    expected_readable_roots.sort();
    expected_readable_roots.dedup();
    let mut expected_denied_read_roots = process
        .denied_read_roots
        .iter()
        .map(|path| path.canonicalize())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Restricted denied-read root is unavailable: {error}"))?;
    expected_denied_read_roots.sort();
    expected_denied_read_roots.dedup();
    let mut expected_denied_write_roots = process
        .denied_write_roots
        .iter()
        .map(|path| path.canonicalize())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Restricted denied-write root is unavailable: {error}"))?;
    expected_denied_write_roots.sort();
    expected_denied_write_roots.dedup();
    let expected_launch_digest = hash_serializable(&(
        &executable,
        &process.arguments,
        &process.environment,
        &process.inherited_environment,
        &working_directory,
        &expected_readable_roots,
        &expected_denied_read_roots,
        &expected_denied_write_roots,
        timeout_milliseconds,
        process.max_output_bytes,
    ))?;
    if expected_launch_digest != plan.launch_digest {
        return Err(
            "Effective sandbox plan does not match the requested process launch.".to_owned(),
        );
    }
    if !plan
        .required_controls
        .iter()
        .all(|control| status.capabilities.restricted_controls.contains(control))
    {
        return Err("Effective sandbox plan exceeds provider capabilities.".to_owned());
    }
    let filesystem = plan
        .required_controls
        .contains(&IsolationControl::Filesystem);
    let process_control = plan.required_controls.contains(&IsolationControl::Process);
    let network = plan.required_controls.contains(&IsolationControl::Network);
    let credentials = plan
        .required_controls
        .contains(&IsolationControl::Credentials);
    let resources = plan
        .required_controls
        .contains(&IsolationControl::Resources);
    let expected_writable_roots = if filesystem {
        vec![working_directory.clone()]
    } else {
        Vec::new()
    };
    let expected_protected_paths = if filesystem {
        RESTRICTED_PROTECTED_PATHS
            .into_iter()
            .map(PathBuf::from)
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    let mut ordered_controls = plan.required_controls.clone();
    ordered_controls.sort_by_key(|control| isolation_control_order(*control));
    let unique_controls = plan
        .required_controls
        .iter()
        .copied()
        .collect::<HashSet<_>>();
    if ordered_controls != plan.required_controls
        || unique_controls.len() != plan.required_controls.len()
        || plan.deny_filesystem_outside_roots != filesystem
        || plan.readable_roots
            != if filesystem {
                expected_readable_roots
            } else {
                Vec::new()
            }
        || plan.denied_read_roots
            != if filesystem {
                expected_denied_read_roots
            } else {
                Vec::new()
            }
        || plan.denied_write_roots
            != if filesystem {
                expected_denied_write_roots
            } else {
                Vec::new()
            }
        || plan.writable_roots != expected_writable_roots
        || plan.protected_relative_paths != expected_protected_paths
        || plan.own_descendant_processes != process_control
        || (plan.network == SandboxNetworkPlan::DenyDirect) != network
        || (plan.credentials == SandboxCredentialPlan::DenyAmbient) != credentials
        || plan.enforce_resource_limits != resources
        || plan.max_active_processes != resources.then_some(RESTRICTED_MAX_ACTIVE_PROCESSES)
        || plan.max_process_memory_bytes != resources.then_some(RESTRICTED_MAX_PROCESS_MEMORY_BYTES)
    {
        return Err(
            "Effective sandbox plan does not exactly represent its required controls.".to_owned(),
        );
    }
    Ok(())
}

pub fn validate_restricted_plan_evidence(
    plan: &EffectiveSandboxPlan,
    evidence: &IsolationEvidence,
) -> Result<(), String> {
    if evidence.plan_digest.as_deref() != Some(plan.plan_digest.as_str()) {
        return Err(
            "Restricted isolation evidence is not bound to the effective sandbox plan.".to_owned(),
        );
    }
    Ok(())
}

fn isolation_control_order(control: IsolationControl) -> u8 {
    match control {
        IsolationControl::Filesystem => 0,
        IsolationControl::Process => 1,
        IsolationControl::Network => 2,
        IsolationControl::Credentials => 3,
        IsolationControl::Resources => 4,
    }
}

fn hash_serializable(value: &impl Serialize) -> Result<String, String> {
    let bytes = serde_json::to_vec(value)
        .map_err(|_| "Could not encode sandbox plan identity.".to_owned())?;
    let digest = Sha256::digest(bytes);
    Ok(digest.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn is_lower_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn validate_isolation_provider_request(
    capabilities: &IsolationProviderCapabilities,
    policy: &IsolationPolicy,
    request: &IsolationRequest,
) -> Result<(), String> {
    validate_isolation_provider_capabilities(capabilities)?;
    validate_isolation_policy(policy)?;
    validate_policy_request(policy, request)?;
    if !capabilities.supported_profiles.contains(&request.profile) {
        return Err(format!(
            "Isolation provider {} does not support profile {:?}.",
            capabilities.provider_id, request.profile
        ));
    }
    if request.profile == IsolationProfile::HostManaged
        && request.host_provider_id.as_deref() != Some(capabilities.provider_id.as_str())
    {
        return Err(format!(
            "Requested host provider does not match executing provider {}.",
            capabilities.provider_id
        ));
    }
    if request.profile == IsolationProfile::Restricted
        && !policy
            .required_controls
            .iter()
            .all(|control| capabilities.restricted_controls.contains(control))
    {
        return Err(format!(
            "Isolation provider {} does not advertise every policy-required restricted control.",
            capabilities.provider_id
        ));
    }
    Ok(())
}

pub fn validate_isolation_evidence(
    capabilities: &IsolationProviderCapabilities,
    policy: &IsolationPolicy,
    request: &IsolationRequest,
    evidence: &IsolationEvidence,
) -> Result<(), String> {
    validate_isolation_provider_request(capabilities, policy, request)?;
    if !evidence.is_consistent_with(request) {
        return Err("Isolation evidence is inconsistent with the request.".to_owned());
    }
    if evidence.provider_id != capabilities.provider_id {
        return Err(format!(
            "Isolation evidence provider {} does not match executing provider {}.",
            evidence.provider_id, capabilities.provider_id
        ));
    }
    if evidence.limitations.is_empty()
        || evidence
            .limitations
            .iter()
            .any(|item| item.trim().is_empty() || item.len() > 1_024)
    {
        return Err("Isolation evidence requires bounded explicit limitations.".to_owned());
    }
    if request.profile == IsolationProfile::HostManaged {
        if !policy
            .required_controls
            .iter()
            .all(|control| evidence.controls.contains(control))
        {
            return Err(
                "Host-attested isolation evidence omits a policy-required control.".to_owned(),
            );
        }
        let authority = evidence.host_authority.as_ref().ok_or_else(|| {
            "Host-attested isolation evidence omits authenticated authority.".to_owned()
        })?;
        if authority.challenge.required_controls.len() != policy.required_controls.len()
            || !policy
                .required_controls
                .iter()
                .all(|control| authority.challenge.required_controls.contains(control))
            || authority.challenge.capability_digest.len() != 64
            || authority.challenge.policy_digest.len() != 64
        {
            return Err(
                "Authenticated host evidence does not preserve exact policy bindings.".to_owned(),
            );
        }
    }
    if request.profile == IsolationProfile::Restricted {
        if !policy
            .required_controls
            .iter()
            .all(|control| evidence.controls.contains(control))
        {
            return Err(
                "Restricted isolation evidence omits a policy-required control.".to_owned(),
            );
        }
        if !evidence
            .controls
            .iter()
            .all(|control| capabilities.restricted_controls.contains(control))
        {
            return Err(
                "Restricted isolation evidence claims a control the provider did not advertise."
                    .to_owned(),
            );
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
            if request.host_provider_id.is_some() {
                return Err(
                    "Host isolation provider selection is valid only for host-managed execution."
                        .to_owned(),
                );
            }
        }
        IsolationProfile::HostManaged => {
            let provider_id = request.host_provider_id.as_ref().ok_or_else(|| {
                "Host-managed execution requires an explicit host isolation provider.".to_owned()
            })?;
            validate_identifier("Host isolation provider ID", provider_id)?;
            if policy.allowed_host_provider_ids.is_empty()
                || !policy.allowed_host_provider_ids.contains(provider_id)
            {
                return Err(format!(
                    "Host isolation provider {provider_id} is not allowed by policy."
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
    validate_process_environment_policy(&process.environment, &process.inherited_environment)?;
    if process.readable_roots.len() > MAX_READABLE_ROOTS
        || process
            .readable_roots
            .iter()
            .any(|path| !path.is_absolute())
    {
        return Err(format!(
            "Isolated process readable roots must contain at most {MAX_READABLE_ROOTS} absolute paths."
        ));
    }
    if process.denied_read_roots.len() > MAX_DENIED_READ_ROOTS
        || process
            .denied_read_roots
            .iter()
            .any(|path| !path.is_absolute())
    {
        return Err(format!(
            "Isolated process denied-read roots must contain at most {MAX_DENIED_READ_ROOTS} absolute paths."
        ));
    }
    if process.denied_write_roots.len() > MAX_DENIED_WRITE_ROOTS
        || process
            .denied_write_roots
            .iter()
            .any(|path| !path.is_absolute())
    {
        return Err(format!(
            "Isolated process denied-write roots must contain at most {MAX_DENIED_WRITE_ROOTS} absolute paths."
        ));
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

struct OwnedProcessTree {
    child: Child,
    #[cfg(not(windows))]
    process_id: u32,
    terminated: bool,
    #[cfg(windows)]
    job: windows_job::WindowsJob,
    #[cfg(unix)]
    _owner_liveness: OwnedFd,
}

impl OwnedProcessTree {
    fn spawn(
        command: &mut Command,
        #[cfg(unix)] owner_liveness: OwnedFd,
        #[cfg(windows)] resource_limits: Option<(u32, usize)>,
    ) -> Result<Self, String> {
        #[cfg(windows)]
        {
            let job = windows_job::WindowsJob::create_with_resource_limits(resource_limits)?;
            windows_job::WindowsJob::configure_command(command);
            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start isolated process: {error}"))?;
            if let Err(error) = job.assign_and_resume(&child) {
                let cleanup = job.request_termination();
                let _ = child.kill();
                let _ = child.wait();
                return match cleanup {
                    Ok(()) => Err(error),
                    Err(cleanup_error) => Err(format!(
                        "{error} Suspended verifier cleanup also failed: {cleanup_error}"
                    )),
                };
            }
            Ok(Self {
                child,
                terminated: false,
                job,
            })
        }

        #[cfg(not(windows))]
        {
            let child = command
                .spawn()
                .map_err(|error| format!("Could not start isolated process: {error}"))?;
            let process_id = child.id();
            Ok(Self {
                child,
                process_id,
                terminated: false,
                #[cfg(unix)]
                _owner_liveness: owner_liveness,
            })
        }
    }

    fn terminate_and_reap(
        &mut self,
        observed_status: Option<ExitStatus>,
    ) -> Result<ExitStatus, String> {
        self.request_termination()?;
        let status = match observed_status {
            Some(status) => status,
            None => self
                .child
                .wait()
                .map_err(|error| format!("Could not reap verifier process: {error}"))?,
        };
        self.confirm_termination()?;
        self.terminated = true;
        Ok(status)
    }

    fn request_termination(&mut self) -> Result<(), String> {
        if self.terminated {
            return Ok(());
        }
        #[cfg(windows)]
        return self.job.request_termination();
        #[cfg(unix)]
        return signal_process_group(self.process_id);
        #[cfg(not(any(unix, windows)))]
        return match self.child.kill() {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => Ok(()),
            Err(error) => Err(format!("Could not terminate verifier process: {error}")),
        };
    }

    fn confirm_termination(&self) -> Result<(), String> {
        #[cfg(windows)]
        return self.job.confirm_empty();
        #[cfg(unix)]
        return confirm_process_group_empty(self.process_id);
        #[cfg(not(any(unix, windows)))]
        return Ok(());
    }
}

impl Drop for OwnedProcessTree {
    fn drop(&mut self) {
        if self.terminated {
            return;
        }
        let _ = self.request_termination();
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = self.confirm_termination();
    }
}

fn run_bounded_process(
    process: &IsolatedProcessSpec,
    cancellation: &dyn Cancellation,
    #[cfg(unix)] watchdog_executable: &Path,
    #[cfg(windows)] resource_limits: Option<(u32, usize)>,
) -> Result<(BoundedProcessResult, ProcessEnvironmentEvidence), String> {
    let (inherited_environment, environment_evidence) = minimal_process_environment(process)?;
    #[cfg(unix)]
    let mut process_tree = {
        let (owner_reader, owner_writer) = create_unix_owner_pipe()?;
        let (startup_reader, startup_writer) = create_unix_startup_pipe()?;
        let mut command = Command::new(watchdog_executable);
        command
            .arg("--owner-fd")
            .arg(owner_reader.as_raw_fd().to_string())
            .arg("--startup-fd")
            .arg(startup_writer.as_raw_fd().to_string())
            .arg("--")
            .arg(&process.executable)
            .args(&process.arguments)
            .current_dir(&process.working_directory)
            .env_clear()
            .envs(inherited_environment)
            .envs(process.environment.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0);
        let launched = OwnedProcessTree::spawn(&mut command, owner_writer);
        drop(owner_reader);
        drop(startup_writer);
        let mut launched = launched?;
        await_unix_watchdog_startup(&mut launched, startup_reader)?;
        launched
    };
    #[cfg(not(unix))]
    let mut process_tree = {
        let mut command = Command::new(&process.executable);
        command
            .current_dir(&process.working_directory)
            .args(&process.arguments)
            .env_clear()
            .envs(inherited_environment)
            .envs(process.environment.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        OwnedProcessTree::spawn(
            &mut command,
            #[cfg(windows)]
            resource_limits,
        )?
    };
    let stdout = process_tree
        .child
        .stdout
        .take()
        .ok_or_else(|| "Isolated process stdout pipe is unavailable.".to_owned())?;
    let stderr = process_tree
        .child
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
            break Some(process_tree.terminate_and_reap(None)?);
        }
        if started.elapsed() >= process.timeout {
            timed_out = true;
            break Some(process_tree.terminate_and_reap(None)?);
        }
        match process_tree.child.try_wait() {
            Ok(Some(status)) => {
                break Some(process_tree.terminate_and_reap(Some(status))?);
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                let cleanup = process_tree.terminate_and_reap(None);
                return match cleanup {
                    Ok(_) => Err(format!("Could not observe isolated process: {error}")),
                    Err(cleanup_error) => Err(format!(
                        "Could not observe isolated process: {error}. Cleanup also failed: {cleanup_error}"
                    )),
                };
            }
        }
    };

    let stdout = stdout_capture
        .join()
        .map_err(|_| "Isolated process stdout capture panicked.".to_owned())??;
    let stderr = stderr_capture
        .join()
        .map_err(|_| "Isolated process stderr capture panicked.".to_owned())??;
    Ok((
        BoundedProcessResult {
            status,
            timed_out,
            cancelled,
            stdout,
            stderr,
        },
        environment_evidence,
    ))
}

pub fn validate_process_environment_policy(
    fixed: &[(String, String)],
    inherited: &[String],
) -> Result<(), String> {
    if fixed.len() > MAX_ENVIRONMENT_ENTRIES
        || inherited.len() > MAX_ENVIRONMENT_ENTRIES
        || fixed.len().saturating_add(inherited.len()) > MAX_ENVIRONMENT_ENTRIES
        || fixed.iter().any(|(name, value)| {
            !valid_environment_name(name) || value.contains('\0') || value.len() > 32_768
        })
        || inherited.iter().any(|name| !valid_environment_name(name))
    {
        return Err("Isolated process environment is invalid.".to_owned());
    }
    let fixed_names = fixed
        .iter()
        .map(|(name, _)| environment_key(name))
        .collect::<HashSet<_>>();
    let inherited_names = inherited
        .iter()
        .map(|name| environment_key(name))
        .collect::<HashSet<_>>();
    if fixed_names.len() != fixed.len()
        || inherited_names.len() != inherited.len()
        || !fixed_names.is_disjoint(&inherited_names)
    {
        return Err("Isolated process environment names must be unique.".to_owned());
    }
    Ok(())
}
fn valid_environment_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 256
        && !name.contains(['=', '\0'])
        && !name.chars().any(char::is_control)
}

fn environment_key(name: &str) -> String {
    #[cfg(windows)]
    {
        name.to_uppercase()
    }
    #[cfg(not(windows))]
    {
        name.to_owned()
    }
}

fn baseline_environment_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &[
            "PATH",
            "PATHEXT",
            "SystemRoot",
            "WINDIR",
            "ComSpec",
            "TEMP",
            "TMP",
            "USERPROFILE",
            "APPDATA",
            "LOCALAPPDATA",
        ]
    }
    #[cfg(not(windows))]
    {
        &["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL"]
    }
}

fn minimal_process_environment(
    process: &IsolatedProcessSpec,
) -> Result<(Vec<(String, OsString)>, ProcessEnvironmentEvidence), String> {
    let fixed_names = process
        .environment
        .iter()
        .map(|(name, _)| environment_key(name))
        .collect::<HashSet<_>>();
    let mut inherited = Vec::new();
    let mut inherited_keys = HashSet::new();
    for name in baseline_environment_names() {
        let key = environment_key(name);
        if fixed_names.contains(&key) || !inherited_keys.insert(key) {
            continue;
        }
        if let Some(value) = env::var_os(name) {
            inherited.push(((*name).to_owned(), value));
        }
    }
    for name in &process.inherited_environment {
        let key = environment_key(name);
        if fixed_names.contains(&key) || !inherited_keys.insert(key) {
            continue;
        }
        let value = env::var_os(name).ok_or_else(|| {
            format!("Policy-allowlisted environment variable {name} is unavailable.")
        })?;
        inherited.push((name.clone(), value));
    }
    let mut inherited_names = inherited
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    let mut fixed_names = process
        .environment
        .iter()
        .map(|(name, _)| name.clone())
        .collect::<Vec<_>>();
    inherited_names.sort();
    fixed_names.sort();
    Ok((
        inherited,
        ProcessEnvironmentEvidence {
            cleared: true,
            inherited_names,
            fixed_names,
        },
    ))
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
fn await_unix_watchdog_startup(
    process_tree: &mut OwnedProcessTree,
    startup_reader: OwnedFd,
) -> Result<(), String> {
    let started = Instant::now();
    loop {
        let mut status = 0_u8;
        // SAFETY: startup_reader owns the descriptor and status is one writable byte.
        let result = unsafe {
            libc::read(
                startup_reader.as_raw_fd(),
                (&mut status as *mut u8).cast::<libc::c_void>(),
                1,
            )
        };
        if result == 1 {
            return match status {
                b'S' => Ok(()),
                b'F' => Err(
                    "Could not start isolated process through the Unix verifier watchdog."
                        .to_owned(),
                ),
                _ => Err("Unix verifier watchdog returned an invalid startup status.".to_owned()),
            };
        }
        if result == 0 {
            return Err(
                "Unix verifier watchdog exited before confirming verifier startup.".to_owned(),
            );
        }
        let error = std::io::Error::last_os_error();
        match error.raw_os_error() {
            Some(libc::EAGAIN) => {}
            Some(libc::EINTR) => continue,
            _ => {
                return Err(format!(
                    "Could not read Unix verifier watchdog startup status: {error}"
                ));
            }
        }
        if let Some(status) = process_tree
            .child
            .try_wait()
            .map_err(|error| format!("Could not observe Unix verifier watchdog startup: {error}"))?
        {
            return Err(format!(
                "Unix verifier watchdog exited with {status} before confirming verifier startup."
            ));
        }
        if started.elapsed() >= PROCESS_STARTUP_TIMEOUT {
            return Err(
                "Unix verifier watchdog did not confirm startup within five seconds.".to_owned(),
            );
        }
        thread::sleep(PROCESS_TERMINATION_POLL_INTERVAL);
    }
}

#[cfg(unix)]
fn signal_process_group(process_id: u32) -> Result<(), String> {
    let group_id = i32::try_from(process_id)
        .map_err(|_| "Verifier process ID cannot be represented as a process group.".to_owned())?;
    // SAFETY: the verifier was placed in a new process group whose ID is its PID.
    let result = unsafe { libc::kill(-group_id, libc::SIGKILL) };
    if result == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        Ok(())
    } else {
        Err(format!(
            "Could not terminate verifier process group: {error}"
        ))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn confirm_process_group_empty(process_id: u32) -> Result<(), String> {
    let group_id = i32::try_from(process_id)
        .map_err(|_| "Verifier process ID cannot be represented as a process group.".to_owned())?;
    let started = Instant::now();
    loop {
        // SAFETY: signal zero performs an existence/permission check without delivering a signal.
        let result = unsafe { libc::kill(-group_id, 0) };
        if result != 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(libc::ESRCH) {
                return Ok(());
            }
            return Err(format!(
                "Could not confirm verifier process-group termination: {error}"
            ));
        }
        if started.elapsed() >= PROCESS_TERMINATION_TIMEOUT {
            return Err("Verifier process group remained active after termination.".to_owned());
        }
        thread::sleep(PROCESS_TERMINATION_POLL_INTERVAL);
    }
}

#[cfg(target_os = "macos")]
fn confirm_process_group_empty(process_id: u32) -> Result<(), String> {
    let group_id = i32::try_from(process_id)
        .map_err(|_| "Verifier process ID cannot be represented as a process group.".to_owned())?;
    let started = Instant::now();
    loop {
        if !macos_process_group::has_live_members(group_id)? {
            return Ok(());
        }
        if started.elapsed() >= PROCESS_TERMINATION_TIMEOUT {
            return Err(
                "Verifier process group retained live members after termination.".to_owned(),
            );
        }
        thread::sleep(PROCESS_TERMINATION_POLL_INTERVAL);
    }
}

#[cfg(test)]
mod process_ownership_tests;
