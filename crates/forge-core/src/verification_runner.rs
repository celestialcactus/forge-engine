use std::{collections::HashMap, path::Path, sync::Arc, time::Duration};

use crate::{
    BaselineIsolationProvider, Cancellation, IsolatedProcessSpec, IsolationProvider,
    VerificationCheck, VerificationEvidence, VerificationSelection, validate_isolation_evidence,
    validate_isolation_policy, validate_isolation_provider_request,
    validate_process_environment_policy,
};

const MAX_CHECKS: usize = 32;
const MAX_ARGUMENTS: usize = 64;
const MIN_OUTPUT: usize = 1_024;
const MAX_OUTPUT: usize = 1_048_576;
const MAX_TIMEOUT: Duration = Duration::from_secs(600);

pub struct VerificationRunner {
    checks: HashMap<String, VerificationCheck>,
    isolation_provider: Arc<dyn IsolationProvider>,
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
        })
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
        let result = self
            .isolation_provider
            .execute(
                &check.isolation_policy,
                &selection.isolation,
                &process,
                cancellation,
            )
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
