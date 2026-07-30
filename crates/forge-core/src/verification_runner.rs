use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    BaselineIsolationProvider, Cancellation, ChangeTransactionRequest,
    HostExecutionAuthorizationEvidence, HostExecutionBinding, HostExecutionGrant,
    IsolatedProcessSpec, IsolationProfile, IsolationProvider, VerificationCheck,
    VerificationEvidence, VerificationSelection, validate_change_transaction_request,
    validate_isolation_evidence, validate_isolation_policy, validate_isolation_provider_request,
    validate_process_environment_policy,
};

const MAX_CHECKS: usize = 32;
const MAX_ARGUMENTS: usize = 64;
const MIN_OUTPUT: usize = 1_024;
const MAX_OUTPUT: usize = 1_048_576;
const MAX_TIMEOUT: Duration = Duration::from_secs(600);
const CAPABILITY_BINDING_DOMAIN: &[u8] = b"forge.host-execution.capability.v1\0";
const POLICY_BINDING_DOMAIN: &[u8] = b"forge.host-execution.verification-policy.v1\0";

struct PendingHostExecution {
    transaction_id: String,
    check_id: String,
    binding: HostExecutionBinding,
    grant: HostExecutionGrant,
}

pub struct VerificationRunner {
    checks: HashMap<String, VerificationCheck>,
    isolation_provider: Arc<dyn IsolationProvider>,
    pending_host_execution: Mutex<Option<PendingHostExecution>>,
}

impl VerificationRunner {
    pub fn try_new(checks: Vec<VerificationCheck>) -> Result<Self, String> {
        Self::try_new_with_isolation_provider(
            checks,
            Arc::new(BaselineIsolationProvider::default()),
        )
    }

    pub fn try_new_with_isolation_provider(
        checks: Vec<VerificationCheck>,
        isolation_provider: Arc<dyn IsolationProvider>,
    ) -> Result<Self, String> {
        if checks.is_empty() || checks.len() > MAX_CHECKS {
            return Err(format!(
                "verification_checks must contain 1 to {MAX_CHECKS} entries."
            ));
        }
        let mut indexed = HashMap::new();
        for check in checks {
            validate_verification_check(&check)?;
            let check_id = check.check_id.clone();
            if indexed.insert(check_id.clone(), check).is_some() {
                return Err(format!("Duplicate verification check ID: {check_id}."));
            }
        }
        Ok(Self {
            checks: indexed,
            isolation_provider,
            pending_host_execution: Mutex::new(None),
        })
    }

    pub fn authorize_transaction(
        &self,
        request: &ChangeTransactionRequest,
        cancellation: &dyn Cancellation,
    ) -> Result<Option<HostExecutionAuthorizationEvidence>, String> {
        validate_change_transaction_request(request)?;
        if request.verification.isolation.profile != IsolationProfile::HostManaged {
            return Ok(None);
        }
        let check = self
            .checks
            .get(&request.verification.check_id)
            .ok_or_else(|| {
                format!(
                    "Verification check {} is not present in policy.",
                    request.verification.check_id
                )
            })?;
        let capabilities = self.isolation_provider.capabilities();
        validate_isolation_provider_request(
            &capabilities,
            &check.isolation_policy,
            &request.verification.isolation,
        )?;
        let binding = derive_host_execution_binding(request, check, &capabilities.provider_id)?;
        let mut pending = self
            .pending_host_execution
            .lock()
            .map_err(|_| "Host execution grant state is unavailable.".to_owned())?;
        if pending.is_some() {
            return Err("A host execution grant is already pending consumption.".to_owned());
        }
        let grant = self.isolation_provider.authorize_host_managed(
            &check.isolation_policy,
            &request.verification.isolation,
            &binding,
            cancellation,
        )?;
        let evidence = grant.evidence().clone();
        if evidence.capability_digest != binding.capability_digest()
            || evidence.policy_digest != binding.policy_digest()
        {
            return Err(
                "Host provider returned authorization for a different Rust execution binding."
                    .to_owned(),
            );
        }
        *pending = Some(PendingHostExecution {
            transaction_id: request.transaction_id.clone(),
            check_id: check.check_id.clone(),
            binding,
            grant,
        });
        Ok(Some(evidence))
    }

    pub fn discard_host_authorization(&self) {
        if let Ok(mut pending) = self.pending_host_execution.lock() {
            pending.take();
        }
    }

    pub fn execute(
        &self,
        working_directory: &Path,
        selection: &VerificationSelection,
        cancellation: &dyn Cancellation,
    ) -> Result<VerificationEvidence, String> {
        let check = self.checks.get(&selection.check_id).ok_or_else(|| {
            format!(
                "Verification check {} is not present in policy.",
                selection.check_id
            )
        })?;
        let process = IsolatedProcessSpec {
            executable: check.executable.clone(),
            arguments: check.arguments.clone(),
            environment: check.environment.clone(),
            inherited_environment: check.inherited_environment.clone(),
            working_directory: working_directory.to_path_buf(),
            timeout: check.timeout,
            max_output_bytes: check.max_output_bytes,
        };
        let provider_capabilities = self.isolation_provider.capabilities();
        validate_isolation_provider_request(
            &provider_capabilities,
            &check.isolation_policy,
            &selection.isolation,
        )
        .map_err(|error| {
            format!(
                "Could not execute policy verification check {}: {error}",
                check.check_id
            )
        })?;
        let result = if selection.isolation.profile == IsolationProfile::HostManaged {
            let pending = self
                .pending_host_execution
                .lock()
                .map_err(|_| "Host execution grant state is unavailable.".to_owned())?
                .take()
                .ok_or_else(|| {
                    "Host-managed verification requires a prepared single-use grant.".to_owned()
                })?;
            if pending.check_id != selection.check_id {
                return Err(format!(
                    "Prepared host grant for transaction {} targets a different verification check.",
                    pending.transaction_id
                ));
            }
            self.isolation_provider.execute_host_managed(
                pending.grant,
                &check.isolation_policy,
                &selection.isolation,
                &pending.binding,
                &process,
                cancellation,
            )
        } else {
            self.isolation_provider.execute(
                &check.isolation_policy,
                &selection.isolation,
                &process,
                cancellation,
            )
        }
        .map_err(|error| {
            format!(
                "Could not execute policy verification check {}: {error}",
                check.check_id
            )
        })?;
        validate_isolation_evidence(
            &provider_capabilities,
            &check.isolation_policy,
            &selection.isolation,
            &result.isolation,
        )
        .map_err(|error| {
            format!(
                "Policy verification check {} returned invalid isolation evidence: {error}",
                check.check_id
            )
        })?;
        let success = result.status.is_some_and(|status| status.success())
            && !result.timed_out
            && !result.cancelled;
        Ok(VerificationEvidence {
            check_id: selection.check_id.clone(),
            success,
            exit_code: result.status.and_then(|status| status.code()),
            timed_out: result.timed_out,
            cancelled: result.cancelled,
            stdout_bytes: result.stdout.total_bytes,
            stderr_bytes: result.stderr.total_bytes,
            output_truncated: result
                .stdout
                .total_bytes
                .saturating_add(result.stderr.total_bytes)
                > check.max_output_bytes as u64,
            stdout: String::from_utf8_lossy(&result.stdout.bytes).into_owned(),
            stderr: String::from_utf8_lossy(&result.stderr.bytes).into_owned(),
            isolation: result.isolation,
            environment: result.environment,
        })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapabilityBindingIdentity<'a> {
    schema_version: u8,
    transaction: &'a ChangeTransactionRequest,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VerificationPolicyBindingIdentity<'a> {
    schema_version: u8,
    selected_provider_id: &'a str,
    check: &'a VerificationCheck,
}

pub fn derive_host_execution_binding(
    request: &ChangeTransactionRequest,
    check: &VerificationCheck,
    selected_provider_id: &str,
) -> Result<HostExecutionBinding, String> {
    validate_change_transaction_request(request)?;
    validate_verification_check(check)?;
    if check.check_id != request.verification.check_id {
        return Err(
            "Selected verification check does not match the transaction request.".to_owned(),
        );
    }
    if request.verification.isolation.host_provider_id.as_deref() != Some(selected_provider_id) {
        return Err("Selected host provider does not match the transaction request.".to_owned());
    }
    let capability_digest = digest_identity(
        CAPABILITY_BINDING_DOMAIN,
        &CapabilityBindingIdentity {
            schema_version: 1,
            transaction: request,
        },
    )?;
    let mut normalized_check = check.clone();
    normalized_check
        .environment
        .sort_by(|left, right| left.0.cmp(&right.0).then(left.1.cmp(&right.1)));
    normalized_check.inherited_environment.sort();
    normalized_check
        .isolation_policy
        .required_controls
        .sort_by_key(isolation_control_code);
    normalized_check
        .isolation_policy
        .allowed_host_provider_ids
        .sort();
    let policy_digest = digest_identity(
        POLICY_BINDING_DOMAIN,
        &VerificationPolicyBindingIdentity {
            schema_version: 1,
            selected_provider_id,
            check: &normalized_check,
        },
    )?;
    HostExecutionBinding::new(capability_digest, policy_digest)
}

fn isolation_control_code(control: &crate::IsolationControl) -> u8 {
    match control {
        crate::IsolationControl::Process => 1,
        crate::IsolationControl::Filesystem => 2,
        crate::IsolationControl::Network => 3,
        crate::IsolationControl::Credentials => 4,
        crate::IsolationControl::Resources => 5,
    }
}

fn digest_identity<T: Serialize>(domain: &[u8], value: &T) -> Result<String, String> {
    let encoded = serde_json::to_vec(value)
        .map_err(|error| format!("Could not encode host execution identity: {error}"))?;
    let length = u64::try_from(encoded.len())
        .map_err(|_| "Host execution identity exceeds the digest length domain.".to_owned())?;
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(length.to_be_bytes());
    hasher.update(encoded);
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub fn validate_verification_check(check: &VerificationCheck) -> Result<(), String> {
    if check.check_id.trim().is_empty() {
        return Err("Verification check IDs must not be empty.".to_owned());
    }
    if check.executable.as_os_str().is_empty() {
        return Err(format!(
            "Verification check {} has an empty executable.",
            check.check_id
        ));
    }
    if check.arguments.len() > MAX_ARGUMENTS
        || check
            .arguments
            .iter()
            .any(|argument| argument.len() > 8_192 || argument.contains('\0'))
    {
        return Err(format!(
            "Verification check {} has invalid arguments.",
            check.check_id
        ));
    }
    if check.timeout.is_zero() || check.timeout > MAX_TIMEOUT {
        return Err(format!(
            "Verification check {} timeout must be greater than zero and at most 600 seconds.",
            check.check_id
        ));
    }
    if !(MIN_OUTPUT..=MAX_OUTPUT).contains(&check.max_output_bytes) {
        return Err(format!(
            "Verification check {} max_output_bytes must be from {MIN_OUTPUT} to {MAX_OUTPUT}.",
            check.check_id
        ));
    }
    validate_process_environment_policy(&check.environment, &check.inherited_environment).map_err(
        |error| {
            format!(
                "Verification check {} has invalid environment policy: {error}",
                check.check_id
            )
        },
    )?;
    validate_isolation_policy(&check.isolation_policy).map_err(|error| {
        format!(
            "Verification check {} has invalid isolation policy: {error}",
            check.check_id
        )
    })?;
    Ok(())
}
