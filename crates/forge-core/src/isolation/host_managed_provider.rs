use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use crate::{
    AuthenticatedHostAuthorityEvidence, Cancellation, HostChallengeLedger, HostChallengeRequest,
    HostIsolationChallenge, SignedHostBoundaryStatement,
};

#[cfg(unix)]
use super::BaselineIsolationProvider;

use super::{
    IsolatedProcessOutcome, IsolatedProcessSpec, IsolationEnforcement, IsolationEvidence,
    IsolationPolicy, IsolationProfile, IsolationProvider, IsolationProviderCapabilities,
    IsolationRequest, process_ownership_limitation, run_bounded_process,
    validate_isolation_provider_request, validate_process,
};

const MAX_HOST_CHALLENGE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostExecutionBinding {
    capability_digest: String,
    policy_digest: String,
}

impl HostExecutionBinding {
    pub(crate) fn new(capability_digest: String, policy_digest: String) -> Result<Self, String> {
        validate_digest("Host execution capability digest", &capability_digest)?;
        validate_digest("Host execution policy digest", &policy_digest)?;
        Ok(Self {
            capability_digest,
            policy_digest,
        })
    }

    pub fn capability_digest(&self) -> &str {
        &self.capability_digest
    }

    pub fn policy_digest(&self) -> &str {
        &self.policy_digest
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostExecutionAuthorizationEvidence {
    pub capability_digest: String,
    pub policy_digest: String,
    pub authority: AuthenticatedHostAuthorityEvidence,
}

pub struct HostExecutionGrant {
    provider_id: String,
    binding: HostExecutionBinding,
    evidence: HostExecutionAuthorizationEvidence,
}

impl HostExecutionGrant {
    pub fn evidence(&self) -> &HostExecutionAuthorizationEvidence {
        &self.evidence
    }
}

pub trait HostBoundaryNegotiator: Send + Sync {
    fn negotiate(
        &self,
        challenge: &HostIsolationChallenge,
        timeout: Duration,
        cancellation: &dyn Cancellation,
    ) -> Result<SignedHostBoundaryStatement, String>;
}

pub struct AuthenticatedHostIsolationProvider {
    provider_id: String,
    ledger: HostChallengeLedger,
    negotiator: Arc<dyn HostBoundaryNegotiator>,
    challenge_ttl: Duration,
    #[cfg(unix)]
    process_supervisor: BaselineIsolationProvider,
}

impl AuthenticatedHostIsolationProvider {
    pub fn try_new(
        provider_id: impl Into<String>,
        ledger: HostChallengeLedger,
        negotiator: Arc<dyn HostBoundaryNegotiator>,
        challenge_ttl: Duration,
    ) -> Result<Self, String> {
        let provider_id = provider_id.into();
        let capabilities = host_capabilities(&provider_id);
        super::validate_isolation_provider_capabilities(&capabilities)?;
        if challenge_ttl.is_zero() || challenge_ttl > MAX_HOST_CHALLENGE_TTL {
            return Err("Host provider challenge TTL must be from 1 ms to 300 seconds.".to_owned());
        }
        Ok(Self {
            provider_id,
            ledger,
            negotiator,
            challenge_ttl,
            #[cfg(unix)]
            process_supervisor: BaselineIsolationProvider::default(),
        })
    }

    #[cfg(unix)]
    pub fn with_unix_watchdog_executable(mut self, executable: std::path::PathBuf) -> Self {
        self.process_supervisor =
            BaselineIsolationProvider::with_unix_watchdog_executable(executable);
        self
    }

    fn validate_authority(
        &self,
        binding: &HostExecutionBinding,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        authority: &AuthenticatedHostAuthorityEvidence,
    ) -> Result<(), String> {
        if authority.challenge.provider_id != self.provider_id
            || request.host_provider_id.as_deref() != Some(self.provider_id.as_str())
        {
            return Err(
                "Authenticated host evidence provider does not match the executing provider."
                    .to_owned(),
            );
        }
        if authority.challenge.capability_digest != binding.capability_digest
            || authority.challenge.policy_digest != binding.policy_digest
        {
            return Err(
                "Authenticated host evidence does not match the Rust-derived execution binding."
                    .to_owned(),
            );
        }
        if !policy.required_controls.iter().all(|control| {
            authority.challenge.required_controls.contains(control)
                && authority.statement.attested_controls.contains(control)
        }) {
            return Err("Authenticated host evidence omits a policy-required control.".to_owned());
        }
        if !authority.statement.process_boundary_inherited {
            return Err(
                "Authenticated host evidence does not bind child processes to the boundary."
                    .to_owned(),
            );
        }
        Ok(())
    }
}

impl IsolationProvider for AuthenticatedHostIsolationProvider {
    fn capabilities(&self) -> IsolationProviderCapabilities {
        host_capabilities(&self.provider_id)
    }

    fn authorize_host_managed(
        &self,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        binding: &HostExecutionBinding,
        cancellation: &dyn Cancellation,
    ) -> Result<HostExecutionGrant, String> {
        validate_isolation_provider_request(&self.capabilities(), policy, request)?;
        validate_digest(
            "Host execution capability digest",
            binding.capability_digest(),
        )?;
        validate_digest("Host execution policy digest", binding.policy_digest())?;
        if cancellation.reason().is_some() {
            return Err(
                "Host execution authorization was cancelled before challenge issuance.".to_owned(),
            );
        }
        let ttl_ms = u64::try_from(self.challenge_ttl.as_millis())
            .map_err(|_| "Host provider challenge TTL overflowed.".to_owned())?;
        let challenge = self.ledger.issue(HostChallengeRequest {
            provider_id: self.provider_id.clone(),
            capability_digest: binding.capability_digest.clone(),
            policy_digest: binding.policy_digest.clone(),
            required_controls: policy.required_controls.clone(),
            ttl_ms,
        })?;
        let started = Instant::now();
        let signed = self
            .negotiator
            .negotiate(&challenge, self.challenge_ttl, cancellation)?;
        if cancellation.reason().is_some() {
            return Err(
                "Host execution authorization was cancelled before statement consumption."
                    .to_owned(),
            );
        }
        if started.elapsed() >= self.challenge_ttl {
            return Err("Host execution authorization exceeded the challenge lifetime.".to_owned());
        }
        if signed.statement.challenge_id != challenge.challenge_id {
            return Err("Host response does not match the issued challenge.".to_owned());
        }
        let authority = self.ledger.verify_and_consume(&signed)?;
        self.validate_authority(binding, policy, request, &authority)?;
        let evidence = HostExecutionAuthorizationEvidence {
            capability_digest: binding.capability_digest.clone(),
            policy_digest: binding.policy_digest.clone(),
            authority,
        };
        Ok(HostExecutionGrant {
            provider_id: self.provider_id.clone(),
            binding: binding.clone(),
            evidence,
        })
    }

    fn execute_host_managed(
        &self,
        grant: HostExecutionGrant,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        binding: &HostExecutionBinding,
        process: &IsolatedProcessSpec,
        cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        validate_isolation_provider_request(&self.capabilities(), policy, request)?;
        validate_process(process)?;
        if grant.provider_id != self.provider_id || grant.binding != *binding {
            return Err(
                "Host execution grant does not match the executing provider and binding."
                    .to_owned(),
            );
        }
        self.validate_authority(binding, policy, request, &grant.evidence.authority)?;
        let persisted = self
            .ledger
            .inspect_consumed(&grant.evidence.authority.challenge.challenge_id)?
            .ok_or_else(|| {
                "Consumed host authority evidence is missing before launch.".to_owned()
            })?;
        if persisted != grant.evidence.authority {
            return Err("Consumed host authority evidence changed before launch.".to_owned());
        }
        if cancellation.reason().is_some() {
            return Err("Host-managed verifier launch was cancelled.".to_owned());
        }
        let authority = grant.evidence.authority;
        let isolation = IsolationEvidence {
            requested_profile: IsolationProfile::HostManaged,
            effective_profile: IsolationProfile::HostManaged,
            enforcement: IsolationEnforcement::HostAttested,
            provider_id: self.provider_id.clone(),
            boundary_id: Some(authority.statement.boundary_id.clone()),
            forge_enforced: false,
            controls: authority.statement.attested_controls.clone(),
            host_authority: Some(authority),
            limitations: vec![
                "The enclosing authenticated host attests the boundary; Forge does not independently enforce or verify those controls."
                    .to_owned(),
                "Forge clears the verifier environment and restores only baseline and policy-listed values; this reduces exposure but is not containment."
                    .to_owned(),
                process_ownership_limitation().to_owned(),
            ],
        };
        let (execution, environment) = run_bounded_process(
            process,
            cancellation,
            #[cfg(unix)]
            &self.process_supervisor.resolve_unix_watchdog()?,
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

    fn execute(
        &self,
        policy: &IsolationPolicy,
        request: &IsolationRequest,
        _process: &IsolatedProcessSpec,
        _cancellation: &dyn Cancellation,
    ) -> Result<IsolatedProcessOutcome, String> {
        validate_isolation_provider_request(&self.capabilities(), policy, request)?;
        Err("Host-managed execution requires a Rust-issued single-use execution grant.".to_owned())
    }
}

fn host_capabilities(provider_id: &str) -> IsolationProviderCapabilities {
    IsolationProviderCapabilities {
        provider_id: provider_id.to_owned(),
        supported_profiles: vec![IsolationProfile::HostManaged],
        authenticates_host_attestations: true,
        restricted_controls: Vec::new(),
    }
}

fn validate_digest(label: &str, value: &str) -> Result<(), String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(format!("{label} is not a lowercase SHA-256 digest."));
    }
    Ok(())
}
