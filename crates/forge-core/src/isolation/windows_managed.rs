// Managed Windows provider evaluation module. It independently composes Forge's
// Rust-owned plan/Job/lifecycle contract with a provider's published API; it is not
// copied provider implementation source and remains unpromoted/setup-required.
#[cfg(test)]
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin},
    sync::mpsc,
};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
#[cfg(test)]
use serde::Serialize;

#[cfg(test)]
use super::{
    CapturedOutput, IsolationEnforcement, IsolationEvidence, ProcessEnvironmentEvidence,
    capture_stream, run_bounded_process, validate_effective_sandbox_plan, windows_job::WindowsJob,
};
use super::{
    EffectiveSandboxPlan, IsolatedProcessOutcome, IsolatedProcessSpec, IsolationControl,
    IsolationPolicy, IsolationProfile, IsolationProvider, IsolationProviderAvailability,
    IsolationProviderCapabilities, IsolationProviderClass, IsolationProviderStatus,
    IsolationRequest, baseline_environment_names,
};
use crate::Cancellation;

const PROVIDER_ID: &str = "forge.windows.managed.preview";
const ADAPTER_PROTOCOL_VERSION: u32 = 1;
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);
#[cfg(test)]
const SETUP_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(test)]
const CLEANUP_TIMEOUT: Duration = Duration::from_secs(15);
#[cfg(test)]
const ADAPTER_OUTPUT_LIMIT: usize = 65_536;

#[derive(Clone, Debug)]
pub struct WindowsManagedIsolationProvider {
    #[cfg(test)]
    node_executable: PathBuf,
    #[cfg(test)]
    adapter_script: PathBuf,
    #[cfg(test)]
    package_root: PathBuf,
    local_probe: ManagedProviderProbe,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedProviderProbe {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: u32,
    state: String,
    package_version: String,
    vendored_executable: PathBuf,
    diagnostics: serde_json::Value,
}

#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareRequest<'a> {
    protocol_version: u32,
    case_id: &'a str,
    plan: &'a EffectiveSandboxPlan,
    process: ProcessRequest<'a>,
}

#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessRequest<'a> {
    executable: &'a Path,
    arguments: &'a [String],
    environment: &'a [(String, String)],
    inherited_environment: &'a [String],
    working_directory: &'a Path,
    timeout_milliseconds: u64,
    max_output_bytes: usize,
}

#[cfg(test)]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PreparedLaunch {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: u32,
    plan_digest: String,
    executable: PathBuf,
    arguments: Vec<String>,
    environment: BTreeMap<String, String>,
}

#[cfg(test)]
struct ManagedBoundarySession {
    child: Child,
    stdin: Option<ChildStdin>,
    job: WindowsJob,
    stdout_capture: Option<thread::JoinHandle<Result<CapturedOutput, String>>>,
    stderr_capture: Option<thread::JoinHandle<Result<CapturedOutput, String>>>,
    cleaned: bool,
}

impl WindowsManagedIsolationProvider {
    pub fn preview_status() -> IsolationProviderStatus {
        unconfigured_status(
            "The managed provider remains a separately configured evaluation payload; doctor does not execute environment-selected adapter code.",
        )
    }

    pub fn try_new(
        node_executable: impl AsRef<Path>,
        adapter_script: impl AsRef<Path>,
        package_root: impl AsRef<Path>,
    ) -> Result<Self, String> {
        let node_executable = canonical_file(node_executable.as_ref(), "Node executable")?;
        let adapter_script = canonical_file(adapter_script.as_ref(), "managed adapter script")?;
        let package_root = canonical_directory(package_root.as_ref(), "provider package root")?;
        let local_probe = probe_adapter(&node_executable, &adapter_script, &package_root)?;
        if local_probe.message_type != "status"
            || local_probe.protocol_version != ADAPTER_PROTOCOL_VERSION
            || local_probe.package_version != "0.0.71"
            || !matches!(local_probe.state.as_str(), "ready" | "setup_required")
        {
            return Err(
                "Managed Windows adapter returned an unsupported status contract.".to_owned(),
            );
        }
        let vendored = local_probe
            .vendored_executable
            .canonicalize()
            .map_err(|error| format!("Cannot resolve managed provider executable: {error}"))?;
        if !vendored.starts_with(&package_root) || !vendored.is_file() {
            return Err(
                "Managed Windows adapter executable escaped its configured package root."
                    .to_owned(),
            );
        }
        Ok(Self {
            #[cfg(test)]
            node_executable,
            #[cfg(test)]
            adapter_script,
            #[cfg(test)]
            package_root,
            local_probe,
        })
    }

    pub fn setup_probe(&self) -> &serde_json::Value {
        &self.local_probe.diagnostics
    }

    #[cfg(test)]
    pub(super) fn execute_conformance_plan(
        &self,
        case_id: &str,
        plan: &EffectiveSandboxPlan,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        let status = self.conformance_status();
        validate_effective_sandbox_plan(plan, &status, process)?;
        if plan.required_controls
            != vec![
                IsolationControl::Filesystem,
                IsolationControl::Process,
                IsolationControl::Network,
                IsolationControl::Credentials,
                IsolationControl::Resources,
            ]
            || !plan.enforce_resource_limits
        {
            return Err(
                "Managed Windows conformance requires the complete five-control plan.".to_owned(),
            );
        }
        let active_process_limit = plan
            .max_active_processes
            .ok_or_else(|| "Managed plan lacks its process-count ceiling.".to_owned())?;
        let process_memory_limit = plan
            .max_process_memory_bytes
            .ok_or_else(|| "Managed plan lacks its process-memory ceiling.".to_owned())?;
        let (mut session, prepared) =
            ManagedBoundarySession::prepare(self, case_id, plan, process)?;
        let mut environment = prepared.environment.into_iter().collect::<Vec<_>>();
        environment.push((
            "FORGE_AMBIENT_SECRET".to_owned(),
            "conformance-sentinel-not-a-real-secret".to_owned(),
        ));
        let prepared_process = IsolatedProcessSpec {
            executable: prepared.executable,
            arguments: prepared.arguments,
            environment,
            inherited_environment: Vec::new(),
            working_directory: process.working_directory.clone(),
            readable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            timeout: process.timeout,
            max_output_bytes: process.max_output_bytes,
        };
        let execution = run_bounded_process(
            &prepared_process,
            cancellation,
            Some((active_process_limit, process_memory_limit)),
        );
        let cleanup = session.cleanup(plan);
        let (execution, _environment) = match (execution, cleanup) {
            (Ok(execution), Ok(())) => execution,
            (Err(error), Ok(())) => return Err(error),
            (Ok(_), Err(error)) => {
                return Err(format!(
                    "Managed Windows execution completed but cleanup failed: {error}"
                ));
            }
            (Err(error), Err(cleanup)) => {
                return Err(format!("{error} Managed cleanup also failed: {cleanup}"));
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
                provider_id: PROVIDER_ID.to_owned(),
                boundary_id: Some(format!("managed-windows:{}", &plan.plan_digest[..16])),
                plan_digest: Some(plan.plan_digest.clone()),
                forge_enforced: true,
                controls: plan.required_controls.clone(),
                host_authority: None,
                limitations: self.status().limitations,
            },
            environment: ProcessEnvironmentEvidence {
                cleared: true,
                inherited_names: Vec::new(),
                fixed_names: process
                    .environment
                    .iter()
                    .map(|(name, _)| name.clone())
                    .collect(),
            },
        })
    }

    #[cfg(test)]
    fn conformance_status(&self) -> IsolationProviderStatus {
        let mut status = self.status();
        status.availability = IsolationProviderAvailability::Available;
        status
    }
}

impl IsolationProvider for WindowsManagedIsolationProvider {
    fn status(&self) -> IsolationProviderStatus {
        let local_state = if self.local_probe.state == "ready" {
            "The pinned managed-provider machinery passed its local account, dependency, and behavioral WFP setup probe."
        } else {
            "The pinned managed-provider machinery requires local account/WFP setup before conformance execution."
        };
        IsolationProviderStatus {
            capabilities: IsolationProviderCapabilities {
                provider_id: PROVIDER_ID.to_owned(),
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
                local_state.to_owned(),
                "Production selection remains closed until the local same-corpus result is reproduced through packaged-payload, uninstall, disposable-lab, and hosted Windows gates."
                    .to_owned(),
                "The JavaScript package is replaceable execution machinery; Rust retains plan validation, process launch, resource Job ownership, timeout, cancellation, evidence, and fail-closed selection."
                    .to_owned(),
            ],
        }
    }

    fn execute_restricted(
        &self,
        _plan: &EffectiveSandboxPlan,
        _process: &IsolatedProcessSpec,
        _cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        Err(
            "The managed Windows provider is not promoted; production restricted execution remains setup_required."
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
        Err("The managed Windows provider accepts only compiled restricted plans.".to_owned())
    }
}

#[cfg(test)]
impl ManagedBoundarySession {
    fn prepare(
        provider: &WindowsManagedIsolationProvider,
        case_id: &str,
        plan: &EffectiveSandboxPlan,
        process: &IsolatedProcessSpec,
    ) -> Result<(Self, PreparedLaunch), String> {
        let mut command = Command::new(&provider.node_executable);
        command
            .arg(&provider.adapter_script)
            .arg("session")
            .arg(&provider.package_root)
            .env_clear()
            .envs(baseline_environment())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let job = WindowsJob::create()?;
        WindowsJob::configure_command(&mut command);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start managed provider adapter: {error}"))?;
        if let Err(error) = job.assign_and_resume(&child) {
            let _ = job.request_termination();
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Managed provider stdin is unavailable.".to_owned())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Managed provider stdout is unavailable.".to_owned())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Managed provider stderr is unavailable.".to_owned())?;
        let (line_sender, line_receiver) = mpsc::sync_channel(1);
        let stdout_capture = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut first = String::new();
            reader.read_line(&mut first).map_err(|error| {
                format!("Could not read managed provider prepare frame: {error}")
            })?;
            line_sender
                .send(first.clone())
                .map_err(|_| "Managed provider prepare receiver closed.".to_owned())?;
            let mut remaining = String::new();
            std::io::Read::read_to_string(&mut reader, &mut remaining)
                .map_err(|error| format!("Could not drain managed provider output: {error}"))?;
            let bytes = format!("{first}{remaining}").into_bytes();
            Ok(CapturedOutput {
                total_bytes: bytes.len() as u64,
                bytes,
            })
        });
        let budget = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stderr_capture = capture_stream(stderr, budget, ADAPTER_OUTPUT_LIMIT);
        let request = PrepareRequest {
            protocol_version: ADAPTER_PROTOCOL_VERSION,
            case_id,
            plan,
            process: ProcessRequest {
                executable: &plan.executable,
                arguments: &process.arguments,
                environment: &process.environment,
                inherited_environment: &process.inherited_environment,
                working_directory: &plan.working_directory,
                timeout_milliseconds: plan.timeout_milliseconds,
                max_output_bytes: process.max_output_bytes,
            },
        };
        let mut encoded = serde_json::to_vec(&request)
            .map_err(|_| "Could not encode managed provider request.".to_owned())?;
        encoded.push(b'\n');
        stdin
            .write_all(&encoded)
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not send managed provider request: {error}"))?;
        let line = match line_receiver.recv_timeout(SETUP_TIMEOUT) {
            Ok(line) => line,
            Err(_) => {
                let _ = job.request_termination();
                let _ = child.kill();
                let _ = child.wait();
                return Err("Managed provider setup exceeded 15 seconds.".to_owned());
            }
        };
        if line.trim().is_empty() {
            let _ = child.wait();
            let _ = job.confirm_empty();
            let stderr = stderr_capture
                .join()
                .map_err(|_| "Managed provider stderr capture panicked.".to_owned())??;
            let _ = stdout_capture.join();
            return Err(format!(
                "Managed provider exited before preparing a launch: {}",
                String::from_utf8_lossy(&stderr.bytes).trim()
            ));
        }
        let prepared: PreparedLaunch = serde_json::from_str(line.trim()).map_err(|_| {
            "Managed provider prepare frame is malformed; its contents were suppressed.".to_owned()
        })?;
        validate_prepared_environment(&prepared.environment)?;
        let executable = prepared
            .executable
            .canonicalize()
            .map_err(|error| format!("Cannot resolve prepared provider executable: {error}"))?;
        if prepared.message_type != "prepared"
            || prepared.protocol_version != ADAPTER_PROTOCOL_VERSION
            || prepared.plan_digest != plan.plan_digest
            || executable
                != provider
                    .local_probe
                    .vendored_executable
                    .canonicalize()
                    .map_err(|error| {
                        format!("Cannot resolve probed provider executable: {error}")
                    })?
            || !executable.starts_with(&provider.package_root)
        {
            let _ = job.request_termination();
            let _ = child.kill();
            let _ = child.wait();
            return Err("Managed provider prepared an invalid or broadened launch.".to_owned());
        }
        let session = Self {
            child,
            stdin: Some(stdin),
            job,
            stdout_capture: Some(stdout_capture),
            stderr_capture: Some(stderr_capture),
            cleaned: false,
        };
        Ok((
            session,
            PreparedLaunch {
                executable,
                ..prepared
            },
        ))
    }

    fn cleanup(&mut self, plan: &EffectiveSandboxPlan) -> Result<(), String> {
        if self.cleaned {
            return Ok(());
        }
        let mut stdin = self
            .stdin
            .take()
            .ok_or_else(|| "Managed provider cleanup channel is unavailable.".to_owned())?;
        let cleanup = serde_json::json!({
            "type": "cleanup",
            "planDigest": plan.plan_digest,
        });
        let mut encoded = serde_json::to_vec(&cleanup)
            .map_err(|_| "Could not encode managed provider cleanup.".to_owned())?;
        encoded.push(b'\n');
        stdin
            .write_all(&encoded)
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not request managed provider cleanup: {error}"))?;
        drop(stdin);
        let started = Instant::now();
        let status = loop {
            match self.child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() < CLEANUP_TIMEOUT => {
                    thread::sleep(Duration::from_millis(10));
                }
                Ok(None) => {
                    let _ = self.job.request_termination();
                    let _ = self.child.kill();
                    let _ = self.child.wait();
                    return Err("Managed provider cleanup exceeded 15 seconds.".to_owned());
                }
                Err(error) => {
                    return Err(format!(
                        "Could not observe managed provider cleanup: {error}"
                    ));
                }
            }
        };
        self.job.confirm_empty()?;
        let stdout = self
            .stdout_capture
            .take()
            .ok_or_else(|| "Managed provider stdout capture is missing.".to_owned())?
            .join()
            .map_err(|_| "Managed provider stdout capture panicked.".to_owned())??;
        let stderr = self
            .stderr_capture
            .take()
            .ok_or_else(|| "Managed provider stderr capture is missing.".to_owned())?
            .join()
            .map_err(|_| "Managed provider stderr capture panicked.".to_owned())??;
        if !status.success() {
            return Err(format!(
                "Managed provider cleanup exited unsuccessfully: stdout={} stderr={}",
                String::from_utf8_lossy(&stdout.bytes).trim(),
                String::from_utf8_lossy(&stderr.bytes).trim()
            ));
        }
        self.cleaned = true;
        Ok(())
    }
}

#[cfg(test)]
impl Drop for ManagedBoundarySession {
    fn drop(&mut self) {
        if self.cleaned {
            return;
        }
        let _ = self.job.request_termination();
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = self.job.confirm_empty();
    }
}

fn probe_adapter(
    node_executable: &Path,
    adapter_script: &Path,
    package_root: &Path,
) -> Result<ManagedProviderProbe, String> {
    let mut command = Command::new(node_executable);
    command
        .arg(adapter_script)
        .arg("status")
        .arg(package_root)
        .env_clear()
        .envs(baseline_environment())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start managed provider status probe: {error}"))?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < STATUS_TIMEOUT => {
                thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Managed provider status probe exceeded 10 seconds.".to_owned());
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "Could not observe managed provider status: {error}"
                ));
            }
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Could not collect managed provider status: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Managed provider status failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|_| "Managed provider status is not UTF-8.".to_owned())?;
    if text.lines().count() != 1 {
        return Err("Managed provider status must contain exactly one JSON line.".to_owned());
    }
    serde_json::from_str(text.trim())
        .map_err(|_| "Managed provider status JSON is malformed.".to_owned())
}

fn baseline_environment() -> Vec<(String, OsString)> {
    baseline_environment_names()
        .iter()
        .filter_map(|name| std::env::var_os(name).map(|value| ((*name).to_owned(), value)))
        .collect()
}

#[cfg(test)]
fn validate_prepared_environment(environment: &BTreeMap<String, String>) -> Result<(), String> {
    if environment.len() > 64 {
        return Err("Managed provider environment exceeds 64 entries.".to_owned());
    }
    for (name, value) in environment {
        if name.is_empty()
            || name.len() > 128
            || value.len() > 32_767
            || name.contains('\0')
            || name.contains('=')
            || value.contains('\0')
        {
            return Err("Managed provider environment contains an invalid entry.".to_owned());
        }
        let normalized = name.to_ascii_uppercase();
        if normalized == "FORGE_AMBIENT_SECRET"
            || normalized == "OPENAI_API_KEY"
            || normalized == "ANTHROPIC_API_KEY"
            || normalized.ends_with("_API_KEY")
            || normalized.ends_with("_ACCESS_TOKEN")
            || normalized.ends_with("_AUTH_TOKEN")
        {
            return Err(format!(
                "Managed provider environment attempted to return credential-like name {name}."
            ));
        }
    }
    Ok(())
}

fn canonical_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve {label}: {error}"))?;
    if !path.is_file() {
        return Err(format!("{label} is not a file."));
    }
    Ok(path)
}

fn canonical_directory(path: &Path, label: &str) -> Result<PathBuf, String> {
    let path = path
        .canonicalize()
        .map_err(|error| format!("Cannot resolve {label}: {error}"))?;
    if !path.is_dir() {
        return Err(format!("{label} is not a directory."));
    }
    Ok(path)
}

fn unconfigured_status(reason: &str) -> IsolationProviderStatus {
    IsolationProviderStatus {
        capabilities: IsolationProviderCapabilities {
            provider_id: PROVIDER_ID.to_owned(),
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
            reason.to_owned(),
            "Production selection remains closed until the local same-corpus result is reproduced through packaged-payload, uninstall, disposable-lab, and hosted Windows gates."
                .to_owned(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::BTreeSet,
        fs::{self, OpenOptions},
        io::Write as _,
    };

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
    struct CorpusReport {
        harness: &'static str,
        corpus_schema_version: u32,
        source_provider_id: String,
        target_provider_id: &'static str,
        required_controls: Vec<IsolationControl>,
        case_count: usize,
        passed_count: usize,
        all_cases_passed: bool,
        setup_state_before: String,
        setup_state_after: String,
        provider_state_clean: bool,
        tokens: Option<u64>,
        retries: u32,
        results: Vec<CaseReport>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CaseReport {
        id: String,
        plan_equivalent: bool,
        passed: bool,
        status_code: Option<i32>,
        timed_out: bool,
        cancelled: bool,
        elapsed_milliseconds: f64,
        stdout_bytes: u64,
        stderr_bytes: u64,
        acl_clean: bool,
        process_clean: bool,
        descendant_clean: bool,
        residue_clean: bool,
        stdout_excerpt: String,
        stderr_excerpt: String,
        error: Option<String>,
    }

    struct CancelAfter {
        started: Instant,
        delay: Duration,
    }

    impl Cancellation for CancelAfter {
        fn reason(&self) -> Option<String> {
            (self.started.elapsed() >= self.delay).then(|| "conformance cancellation".to_owned())
        }
    }

    #[test]
    fn managed_provider_remains_setup_required_even_when_local_probe_is_ready() {
        let Some(provider) = configured_provider() else {
            return;
        };
        let status = provider.status();
        assert_eq!(
            status.availability,
            IsolationProviderAvailability::SetupRequired
        );
        assert!(!super::super::isolation_provider_restricted_ready(&status));
        assert!(
            provider
                .execute_restricted(&dummy_plan(), &dummy_process(), &NoCancellation,)
                .is_err()
        );
    }

    #[test]
    #[ignore = "requires the pinned external payload and an explicit exported corpus"]
    fn managed_provider_executes_the_exact_five_control_corpus() {
        let corpus_path = required_path("FORGE_MANAGED_WINDOWS_CONFORMANCE_CORPUS");
        let corpus: CorpusInput =
            serde_json::from_slice(&fs::read(&corpus_path).expect("read managed corpus"))
                .expect("parse managed corpus");
        assert_eq!(corpus.schema_version, 2);
        assert_eq!(corpus.source_provider_id, PROVIDER_ID);
        assert_eq!(corpus.cases.len(), 17);
        if std::env::var_os("FORGE_MANAGED_WINDOWS_OWNER_CHILD").is_some() {
            execute_owner_child(&corpus);
        }
        let report_path = required_path("FORGE_MANAGED_WINDOWS_CONFORMANCE_REPORT");
        assert!(!report_path.exists(), "refusing to overwrite report");
        let provider = configured_provider().expect("configured managed provider");
        let setup_before = provider.local_probe.clone();
        let process_before = snapshot_processes();
        let mut results = Vec::with_capacity(corpus.cases.len());
        for record in &corpus.cases {
            let process = corpus_process(record);
            let target_plan = compile_effective_sandbox_plan(
                &provider.conformance_status(),
                &IsolationPolicy::restricted(corpus.required_controls.clone()),
                &IsolationRequest {
                    profile: IsolationProfile::Restricted,
                    host_provider_id: None,
                },
                &process,
            )
            .expect("recompile managed plan");
            let plan_equivalent = target_plan == record.effective_sandbox_plan;
            if record.id == "owner_death_contained" {
                results.push(execute_owner_parent(
                    &provider,
                    &corpus_path,
                    record,
                    &process,
                    plan_equivalent,
                ));
                continue;
            }
            results.push(execute_case(
                &provider,
                &corpus.fixture_root,
                record,
                &process,
                plan_equivalent,
            ));
        }
        let setup_after = probe_adapter(
            &provider.node_executable,
            &provider.adapter_script,
            &provider.package_root,
        )
        .expect("post-run managed status");
        let process_after = snapshot_processes();
        let provider_state_clean = setup_before.state == setup_after.state
            && stable_probe(&setup_before) == stable_probe(&setup_after)
            && process_before == process_after;
        let passed_count = results.iter().filter(|result| result.passed).count();
        let report = CorpusReport {
            harness: "forge-managed-windows-corpus-v1",
            corpus_schema_version: corpus.schema_version,
            source_provider_id: corpus.source_provider_id,
            target_provider_id: PROVIDER_ID,
            required_controls: corpus.required_controls,
            case_count: results.len(),
            passed_count,
            all_cases_passed: passed_count == results.len() && provider_state_clean,
            setup_state_before: setup_before.state,
            setup_state_after: setup_after.state,
            provider_state_clean,
            tokens: None,
            retries: 0,
            results,
        };
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&report_path)
            .expect("create managed report");
        file.write_all(&serde_json::to_vec_pretty(&report).expect("encode managed report"))
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .expect("persist managed report");
        assert!(
            report.all_cases_passed,
            "managed corpus gate failed; see {}",
            report_path.display()
        );
    }

    fn execute_case(
        provider: &WindowsManagedIsolationProvider,
        fixture_root: &Path,
        record: &CorpusCaseInput,
        process: &IsolatedProcessSpec,
        plan_equivalent: bool,
    ) -> CaseReport {
        let residue_paths = residue_paths(&record.effective_sandbox_plan);
        let acl_before = snapshot_acls(&residue_paths);
        let process_before = snapshot_processes();
        let cancellation = record.cancel_after_milliseconds.map(|delay| CancelAfter {
            started: Instant::now(),
            delay: Duration::from_millis(delay),
        });
        let no_cancellation = NoCancellation;
        let cancellation: &dyn Cancellation = cancellation
            .as_ref()
            .map_or(&no_cancellation, |value| value as &dyn Cancellation);
        let started = Instant::now();
        let outcome = provider.execute_conformance_plan(
            &record.id,
            &record.effective_sandbox_plan,
            process,
            cancellation,
        );
        let elapsed_milliseconds = started.elapsed().as_secs_f64() * 1_000.0;
        thread::sleep(Duration::from_millis(250));
        if matches!(
            record.id.as_str(),
            "child_grandchild_contained" | "timeout_contained" | "cancellation_contained"
        ) {
            thread::sleep(Duration::from_millis(2_500));
        }
        let acl_clean = acl_before == snapshot_acls(&residue_paths);
        let process_clean = process_before == snapshot_processes();
        let survivor = process.working_directory.join(match record.id.as_str() {
            "child_grandchild_contained" => "descendant-survivor.txt",
            "timeout_contained" => "timeout-survivor.txt",
            "cancellation_contained" => "cancellation-survivor.txt",
            _ => "descendant-survivor.txt",
        });
        let descendant_clean = !survivor.exists();
        match outcome {
            Ok(outcome) => {
                let process_matches = match record.expected.as_str() {
                    "success" => {
                        outcome.status.is_some_and(|status| status.success())
                            && !outcome.timed_out
                            && !outcome.cancelled
                    }
                    "denied" => {
                        outcome.status.is_some_and(|status| !status.success()) && !outcome.timed_out
                    }
                    "terminated" => {
                        outcome.timed_out
                            || outcome.cancelled
                            || outcome.status.is_some_and(|status| !status.success())
                    }
                    other => panic!("unsupported expected outcome {other}"),
                };
                let artifact_matches = match record.id.as_str() {
                    "allowed_candidate_write" => {
                        process.working_directory.join("allowed.txt").exists()
                    }
                    "workspace_outside_write_denied" => {
                        !fixture_root.join("outside").join("breach.txt").exists()
                    }
                    "protected_path_write_denied" => {
                        fs::read_to_string(process.working_directory.join(".git").join("config"))
                            .is_ok_and(|value| value == "protected\n")
                    }
                    "sensitive_read_denied" => !String::from_utf8_lossy(&outcome.stdout.bytes)
                        .contains("FORGE_SENSITIVE_SENTINEL"),
                    "child_grandchild_contained"
                    | "timeout_contained"
                    | "cancellation_contained" => descendant_clean,
                    _ => true,
                };
                let residue_clean = acl_clean && process_clean && descendant_clean;
                CaseReport {
                    id: record.id.clone(),
                    plan_equivalent,
                    passed: plan_equivalent && process_matches && artifact_matches && residue_clean,
                    status_code: outcome.status.and_then(|status| status.code()),
                    timed_out: outcome.timed_out,
                    cancelled: outcome.cancelled,
                    elapsed_milliseconds,
                    stdout_bytes: outcome.stdout.total_bytes,
                    stderr_bytes: outcome.stderr.total_bytes,
                    acl_clean,
                    process_clean,
                    descendant_clean,
                    residue_clean,
                    stdout_excerpt: excerpt(&outcome.stdout.bytes),
                    stderr_excerpt: excerpt(&outcome.stderr.bytes),
                    error: None,
                }
            }
            Err(error) => CaseReport {
                id: record.id.clone(),
                plan_equivalent,
                passed: false,
                status_code: None,
                timed_out: false,
                cancelled: false,
                elapsed_milliseconds,
                stdout_bytes: 0,
                stderr_bytes: 0,
                acl_clean,
                process_clean,
                descendant_clean,
                residue_clean: acl_clean && process_clean && descendant_clean,
                stdout_excerpt: String::new(),
                stderr_excerpt: String::new(),
                error: Some(error),
            },
        }
    }

    fn execute_owner_child(corpus: &CorpusInput) -> ! {
        let provider = configured_provider().expect("owner child managed provider");
        let record = corpus
            .cases
            .iter()
            .find(|record| record.id == "owner_death_contained")
            .expect("owner-death case");
        let process = corpus_process(record);
        let outcome = provider.execute_conformance_plan(
            &record.id,
            &record.effective_sandbox_plan,
            &process,
            &NoCancellation,
        );
        panic!("managed owner-death child was not terminated: {outcome:?}");
    }

    fn execute_owner_parent(
        provider: &WindowsManagedIsolationProvider,
        corpus_path: &Path,
        record: &CorpusCaseInput,
        process: &IsolatedProcessSpec,
        plan_equivalent: bool,
    ) -> CaseReport {
        let residue_paths = residue_paths(&record.effective_sandbox_plan);
        let acl_before = snapshot_acls(&residue_paths);
        let process_before = snapshot_processes();
        let ready_marker = process.working_directory.join("owner-ready.txt");
        let survivor_marker = process.working_directory.join("owner-death-survivor.txt");
        let _ = fs::remove_file(&ready_marker);
        let _ = fs::remove_file(&survivor_marker);
        let started = Instant::now();
        let mut child = Command::new(std::env::current_exe().expect("managed test binary"));
        child
            .arg("isolation::windows_managed::tests::managed_provider_executes_the_exact_five_control_corpus")
            .arg("--exact")
            .arg("--ignored")
            .env("FORGE_MANAGED_WINDOWS_CONFORMANCE_CORPUS", corpus_path)
            .env("FORGE_MANAGED_WINDOWS_OWNER_CHILD", "1")
            .env(
                "FORGE_MANAGED_WINDOWS_NODE",
                &provider.node_executable,
            )
            .env(
                "FORGE_MANAGED_WINDOWS_ADAPTER",
                &provider.adapter_script,
            )
            .env(
                "FORGE_MANAGED_WINDOWS_PACKAGE_ROOT",
                &provider.package_root,
            )
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = child.spawn().expect("spawn managed owner harness");
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready_marker.exists() && Instant::now() < deadline {
            assert!(
                child
                    .try_wait()
                    .expect("observe managed owner child")
                    .is_none(),
                "managed owner child exited before ready"
            );
            thread::sleep(Duration::from_millis(10));
        }
        let owner_ready = ready_marker.exists();
        let kill_result = child.kill();
        let status = child.wait().expect("reap managed owner harness");
        thread::sleep(Duration::from_millis(2_500));
        let recovery = ManagedBoundarySession::prepare(
            provider,
            "owner_death_recovery",
            &record.effective_sandbox_plan,
            process,
        )
        .and_then(|(mut session, _)| session.cleanup(&record.effective_sandbox_plan));
        let acl_clean = acl_before == snapshot_acls(&residue_paths);
        let process_clean = process_before == snapshot_processes();
        let descendant_clean = !survivor_marker.exists();
        let residue_clean = recovery.is_ok() && acl_clean && process_clean && descendant_clean;
        let passed = plan_equivalent
            && owner_ready
            && kill_result.is_ok()
            && !status.success()
            && residue_clean;
        CaseReport {
            id: record.id.clone(),
            plan_equivalent,
            passed,
            status_code: status.code(),
            timed_out: false,
            cancelled: false,
            elapsed_milliseconds: started.elapsed().as_secs_f64() * 1_000.0,
            stdout_bytes: 0,
            stderr_bytes: 0,
            acl_clean,
            process_clean,
            descendant_clean,
            residue_clean,
            stdout_excerpt: String::new(),
            stderr_excerpt: String::new(),
            error: (!passed).then(|| {
                format!("ownerReady={owner_ready}; kill={kill_result:?}; recovery={recovery:?}")
            }),
        }
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

    fn configured_provider() -> Option<WindowsManagedIsolationProvider> {
        let node = std::env::var_os("FORGE_MANAGED_WINDOWS_NODE")?;
        let adapter = std::env::var_os("FORGE_MANAGED_WINDOWS_ADAPTER")?;
        let package = std::env::var_os("FORGE_MANAGED_WINDOWS_PACKAGE_ROOT")?;
        Some(
            WindowsManagedIsolationProvider::try_new(node, adapter, package)
                .expect("configured managed provider"),
        )
    }

    fn required_path(name: &str) -> PathBuf {
        PathBuf::from(std::env::var_os(name).unwrap_or_else(|| panic!("{name}")))
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

    fn snapshot_processes() -> BTreeMap<String, Vec<String>> {
        ["forge-sandbox-conformance.exe", "srt-win.exe"]
            .into_iter()
            .map(|name| {
                let output = Command::new("tasklist.exe")
                    .args(["/fo", "csv", "/nh", "/fi", &format!("IMAGENAME eq {name}")])
                    .output()
                    .expect("tasklist snapshot");
                let mut rows = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .filter(|line| line.starts_with(&format!("\"{name}\"")))
                    .map(str::to_owned)
                    .collect::<Vec<_>>();
                rows.sort();
                (name.to_owned(), rows)
            })
            .collect()
    }

    fn excerpt(bytes: &[u8]) -> String {
        String::from_utf8_lossy(bytes).chars().take(512).collect()
    }

    fn stable_probe(probe: &ManagedProviderProbe) -> serde_json::Value {
        serde_json::json!({
            "dependencies": probe.diagnostics.get("dependencies"),
            "user": probe.diagnostics.get("user"),
            "wfpState": probe.diagnostics.pointer("/wfp/state"),
            "wfpBehaviorBlocked": probe
                .diagnostics
                .pointer("/wfpVerification/stderr")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|value| value.contains("BLOCKED")),
        })
    }

    fn dummy_process() -> IsolatedProcessSpec {
        let current = std::env::current_exe().expect("current test executable");
        IsolatedProcessSpec {
            executable: current.clone(),
            arguments: Vec::new(),
            environment: Vec::new(),
            inherited_environment: Vec::new(),
            working_directory: current.parent().expect("test directory").to_owned(),
            readable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            timeout: Duration::from_secs(1),
            max_output_bytes: 4_096,
        }
    }

    fn dummy_plan() -> EffectiveSandboxPlan {
        EffectiveSandboxPlan {
            schema_version: 4,
            provider_id: PROVIDER_ID.to_owned(),
            provider_class: IsolationProviderClass::NativeStrong,
            executable: PathBuf::from("C:\\invalid.exe"),
            working_directory: PathBuf::from("C:\\invalid"),
            readable_roots: Vec::new(),
            denied_read_roots: Vec::new(),
            denied_write_roots: Vec::new(),
            writable_roots: Vec::new(),
            protected_relative_paths: Vec::new(),
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
            plan_digest: "0".repeat(64),
        }
    }
}
