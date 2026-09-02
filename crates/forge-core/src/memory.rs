//! CLI8A attributable memory contracts.
//!
//! This module defines validated observation material, deterministic identities,
//! and the bounded explicit-control lifecycle used by CLI8A Slices 1–4. It is not
//! connected to the run coordinator, planner, context compiler, MCP, or provider
//! retrieval loop. Standing-grant capture is explicit and local; Slice 4 forget,
//! purge, and recovery-history clearing remain exact-scope memory operations.
//! Retrieval and prompt injection remain inactive.

mod grants;
mod lifecycle;
mod projection;
mod retention;
mod store;

pub use grants::*;
pub use lifecycle::*;
pub use projection::*;
pub use retention::*;
pub use store::*;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MEMORY_SCHEMA_VERSION: u8 = 1;
pub const MEMORY_NORMALIZATION_ID: &str = "memory_text_v1";
pub const MAX_MEMORY_TEXT_BYTES: usize = 8 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemoryClaimId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemoryObservationId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemoryGrantId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemorySubjectKind {
    WorkspaceArchitecture,
    RepositoryConvention,
    DomainFact,
    DeveloperPreference,
    WorkflowStep,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryStatementKind {
    QuotedFact,
    InferredHypothesis,
    DeveloperPreference,
    ReviewedDecision,
    WorkflowPattern,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryScope {
    Branch {
        workspace_id: String,
        repository_id: String,
        branch: String,
    },
    Repository {
        workspace_id: String,
        repository_id: String,
    },
    Workspace {
        workspace_id: String,
    },
    Developer {
        actor_id: String,
    },
}

impl MemoryScope {
    pub fn kind(&self) -> MemoryScopeKind {
        match self {
            Self::Branch { .. } => MemoryScopeKind::Branch,
            Self::Repository { .. } => MemoryScopeKind::Repository,
            Self::Workspace { .. } => MemoryScopeKind::Workspace,
            Self::Developer { .. } => MemoryScopeKind::Developer,
        }
    }

    fn normalized(self) -> Result<Self, MemoryContractError> {
        Ok(match self {
            Self::Branch {
                workspace_id,
                repository_id,
                branch,
            } => Self::Branch {
                workspace_id: bounded_identifier("workspaceId", workspace_id)?,
                repository_id: bounded_identifier("repositoryId", repository_id)?,
                branch: bounded_identifier("branch", branch)?,
            },
            Self::Repository {
                workspace_id,
                repository_id,
            } => Self::Repository {
                workspace_id: bounded_identifier("workspaceId", workspace_id)?,
                repository_id: bounded_identifier("repositoryId", repository_id)?,
            },
            Self::Workspace { workspace_id } => Self::Workspace {
                workspace_id: bounded_identifier("workspaceId", workspace_id)?,
            },
            Self::Developer { actor_id } => Self::Developer {
                actor_id: bounded_identifier("actorId", actor_id)?,
            },
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryScopeKind {
    Branch,
    Repository,
    Workspace,
    Developer,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PreferenceAdmission {
    ExplicitRemember,
    ReviewedAcceptance,
    StandingGrant { grant_id: MemoryGrantId },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryProvenance {
    RunEvent {
        run_id: String,
        event_sequence: u64,
        event_sha256: String,
    },
    CapabilityEvidence {
        run_id: String,
        call_id: String,
        evidence_sha256: String,
    },
    DeveloperStatement {
        run_id: String,
        actor_id: String,
        source_id: String,
        input_sha256: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        admission: Option<PreferenceAdmission>,
    },
    RepositoryText {
        run_id: String,
        call_id: String,
        path: String,
        content_sha256: String,
    },
    ModelOutput {
        run_id: String,
        request_id: String,
        output_sha256: String,
    },
}

impl MemoryProvenance {
    fn normalized(self) -> Result<Self, MemoryContractError> {
        Ok(match self {
            Self::RunEvent {
                run_id,
                event_sequence,
                event_sha256,
            } => Self::RunEvent {
                run_id: bounded_identifier("runId", run_id)?,
                event_sequence,
                event_sha256: sha256_value("eventSha256", event_sha256)?,
            },
            Self::CapabilityEvidence {
                run_id,
                call_id,
                evidence_sha256,
            } => Self::CapabilityEvidence {
                run_id: bounded_identifier("runId", run_id)?,
                call_id: bounded_identifier("callId", call_id)?,
                evidence_sha256: sha256_value("evidenceSha256", evidence_sha256)?,
            },
            Self::DeveloperStatement {
                run_id,
                actor_id,
                source_id,
                input_sha256,
                admission,
            } => Self::DeveloperStatement {
                run_id: bounded_identifier("runId", run_id)?,
                actor_id: bounded_identifier("actorId", actor_id)?,
                source_id: bounded_identifier("sourceId", source_id)?,
                input_sha256: sha256_value("inputSha256", input_sha256)?,
                admission,
            },
            Self::RepositoryText {
                run_id,
                call_id,
                path,
                content_sha256,
            } => Self::RepositoryText {
                run_id: bounded_identifier("runId", run_id)?,
                call_id: bounded_identifier("callId", call_id)?,
                path: normalize_memory_text(&path)?,
                content_sha256: sha256_value("contentSha256", content_sha256)?,
            },
            Self::ModelOutput {
                run_id,
                request_id,
                output_sha256,
            } => Self::ModelOutput {
                run_id: bounded_identifier("runId", run_id)?,
                request_id: bounded_identifier("requestId", request_id)?,
                output_sha256: sha256_value("outputSha256", output_sha256)?,
            },
        })
    }

    fn run_id(&self) -> &str {
        match self {
            Self::RunEvent { run_id, .. }
            | Self::CapabilityEvidence { run_id, .. }
            | Self::DeveloperStatement { run_id, .. }
            | Self::RepositoryText { run_id, .. }
            | Self::ModelOutput { run_id, .. } => run_id,
        }
    }

    fn evidence_digest(&self) -> Option<&str> {
        match self {
            Self::RunEvent { event_sha256, .. } => Some(event_sha256),
            Self::CapabilityEvidence {
                evidence_sha256, ..
            } => Some(evidence_sha256),
            Self::RepositoryText { content_sha256, .. } => Some(content_sha256),
            Self::DeveloperStatement { .. } | Self::ModelOutput { .. } => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryFreshness {
    EvidenceBound { evidence_sha256: String },
    RunBound { run_id: String },
    PersistentUntilReviewed,
    ExplicitValidity { valid_until_millis: i64 },
}

impl MemoryFreshness {
    fn normalized(self, observed_at_millis: i64) -> Result<Self, MemoryContractError> {
        Ok(match self {
            Self::EvidenceBound { evidence_sha256 } => Self::EvidenceBound {
                evidence_sha256: sha256_value("evidenceSha256", evidence_sha256)?,
            },
            Self::RunBound { run_id } => Self::RunBound {
                run_id: bounded_identifier("runId", run_id)?,
            },
            Self::PersistentUntilReviewed => Self::PersistentUntilReviewed,
            Self::ExplicitValidity { valid_until_millis } => {
                if valid_until_millis < observed_at_millis {
                    return Err(MemoryContractError::new(
                        "memory_validity_precedes_observation",
                        "validUntilMillis must not precede observedAtMillis",
                    ));
                }
                Self::ExplicitValidity { valid_until_millis }
            }
        })
    }

    pub fn is_fresh(
        &self,
        as_of_millis: i64,
        evidence_is_current: Option<bool>,
        active_run_id: Option<&str>,
    ) -> bool {
        match self {
            Self::EvidenceBound { .. } => evidence_is_current == Some(true),
            Self::RunBound { run_id } => active_run_id == Some(run_id.as_str()),
            Self::PersistentUntilReviewed => true,
            Self::ExplicitValidity { valid_until_millis } => {
                as_of_millis >= 0 && as_of_millis <= *valid_until_millis
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MemoryObservationRelation {
    Supports,
    Contradicts,
    Corrects { observation_id: MemoryObservationId },
    Supersedes { observation_id: MemoryObservationId },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryObservationInput {
    pub subject_kind: MemorySubjectKind,
    pub statement_kind: MemoryStatementKind,
    pub subject: String,
    pub statement: String,
    pub scope: MemoryScope,
    pub provenance: MemoryProvenance,
    pub relation: MemoryObservationRelation,
    pub confidence: u8,
    pub observed_at_millis: i64,
    pub freshness: MemoryFreshness,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryObservation {
    pub schema_version: u8,
    pub normalization_id: String,
    pub claim_id: MemoryClaimId,
    pub observation_id: MemoryObservationId,
    pub subject_kind: MemorySubjectKind,
    pub statement_kind: MemoryStatementKind,
    pub subject: String,
    pub statement: String,
    pub scope: MemoryScope,
    pub provenance: MemoryProvenance,
    pub relation: MemoryObservationRelation,
    pub confidence: u8,
    pub observed_at_millis: i64,
    pub freshness: MemoryFreshness,
}

impl MemoryObservation {
    pub fn new(input: MemoryObservationInput) -> Result<Self, MemoryContractError> {
        if input.confidence > 100 {
            return Err(MemoryContractError::new(
                "memory_confidence_out_of_range",
                "confidence must be 0..=100",
            ));
        }
        if input.observed_at_millis < 0 {
            return Err(MemoryContractError::new(
                "memory_observed_time_invalid",
                "observedAtMillis must be non-negative",
            ));
        }

        let subject = normalize_memory_text(&input.subject)?;
        let statement = normalize_memory_text(&input.statement)?;
        let scope = input.scope.normalized()?;
        let provenance = input.provenance.normalized()?;
        let freshness = input.freshness.normalized(input.observed_at_millis)?;

        validate_policy(
            &input.subject_kind,
            &input.statement_kind,
            &scope,
            &provenance,
            &freshness,
        )?;

        let claim_id = claim_id(
            &input.subject_kind,
            &input.statement_kind,
            &subject,
            &statement,
            &scope,
        );
        let observation_id = observation_id(
            &claim_id,
            &provenance,
            &input.relation,
            input.confidence,
            input.observed_at_millis,
            &freshness,
        );

        Ok(Self {
            schema_version: MEMORY_SCHEMA_VERSION,
            normalization_id: MEMORY_NORMALIZATION_ID.to_owned(),
            claim_id,
            observation_id,
            subject_kind: input.subject_kind,
            statement_kind: input.statement_kind,
            subject,
            statement,
            scope,
            provenance,
            relation: input.relation,
            confidence: input.confidence,
            observed_at_millis: input.observed_at_millis,
            freshness,
        })
    }

    pub fn validate_identity(&self) -> Result<(), MemoryContractError> {
        if self.schema_version != MEMORY_SCHEMA_VERSION
            || self.normalization_id != MEMORY_NORMALIZATION_ID
        {
            return Err(MemoryContractError::new(
                "memory_schema_unsupported",
                "unsupported memory schema or normalization",
            ));
        }
        let reconstructed = Self::new(MemoryObservationInput {
            subject_kind: self.subject_kind.clone(),
            statement_kind: self.statement_kind.clone(),
            subject: self.subject.clone(),
            statement: self.statement.clone(),
            scope: self.scope.clone(),
            provenance: self.provenance.clone(),
            relation: self.relation.clone(),
            confidence: self.confidence,
            observed_at_millis: self.observed_at_millis,
            freshness: self.freshness.clone(),
        })?;
        if reconstructed == *self {
            Ok(())
        } else {
            Err(MemoryContractError::new(
                "memory_identity_mismatch",
                "memory identity does not match normalized content",
            ))
        }
    }

    pub fn normally_retrievable(&self) -> bool {
        !matches!(self.statement_kind, MemoryStatementKind::InferredHypothesis)
            && !matches!(
                self.provenance,
                MemoryProvenance::ModelOutput { .. } | MemoryProvenance::RepositoryText { .. }
            )
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryContractError {
    code: &'static str,
    message: &'static str,
}

impl MemoryContractError {
    pub(crate) const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for MemoryContractError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message)
    }
}

impl std::error::Error for MemoryContractError {}

pub fn normalize_memory_text(value: &str) -> Result<String, MemoryContractError> {
    let normalized = value.replace("\r\n", "\n").replace('\r', "\n");
    let normalized = normalized.trim_matches(|character: char| character.is_ascii_whitespace());
    if normalized.is_empty() {
        return Err(MemoryContractError::new(
            "memory_text_empty",
            "memory text must not be empty",
        ));
    }
    if normalized.len() > MAX_MEMORY_TEXT_BYTES {
        return Err(MemoryContractError::new(
            "memory_text_too_large",
            "memory text exceeds the bounded byte limit",
        ));
    }
    if normalized
        .chars()
        .any(|character| character.is_control() && character != '\n')
    {
        return Err(MemoryContractError::new(
            "memory_text_control_character",
            "memory text contains a forbidden control character",
        ));
    }
    Ok(normalized.to_owned())
}

fn validate_policy(
    subject_kind: &MemorySubjectKind,
    statement_kind: &MemoryStatementKind,
    scope: &MemoryScope,
    provenance: &MemoryProvenance,
    freshness: &MemoryFreshness,
) -> Result<(), MemoryContractError> {
    let is_preference = *statement_kind == MemoryStatementKind::DeveloperPreference;
    if is_preference != (*subject_kind == MemorySubjectKind::DeveloperPreference) {
        return Err(MemoryContractError::new(
            "memory_preference_kind_mismatch",
            "developer preference subject and statement kinds must match",
        ));
    }
    if is_preference {
        if !matches!(scope, MemoryScope::Developer { .. }) {
            return Err(MemoryContractError::new(
                "memory_scope_escalation",
                "developer preferences require exact developer scope",
            ));
        }
        match (scope, provenance) {
            (
                MemoryScope::Developer { actor_id },
                MemoryProvenance::DeveloperStatement {
                    actor_id: source_actor_id,
                    admission: Some(_),
                    ..
                },
            ) if actor_id == source_actor_id => {}
            (
                MemoryScope::Developer { .. },
                MemoryProvenance::DeveloperStatement {
                    admission: None, ..
                },
            ) => {
                return Err(MemoryContractError::new(
                    "memory_preference_admission_required",
                    "developer preference requires explicit admission",
                ));
            }
            _ => {
                return Err(MemoryContractError::new(
                    "memory_scope_escalation",
                    "only the same explicitly admitted developer may create a developer preference",
                ));
            }
        }
        if !matches!(
            freshness,
            MemoryFreshness::PersistentUntilReviewed | MemoryFreshness::ExplicitValidity { .. }
        ) {
            return Err(MemoryContractError::new(
                "memory_preference_freshness_invalid",
                "developer preference must persist until review or carry explicit validity",
            ));
        }
    } else if matches!(scope, MemoryScope::Developer { .. }) {
        return Err(MemoryContractError::new(
            "memory_scope_escalation",
            "non-preference knowledge cannot use developer scope",
        ));
    }

    if matches!(provenance, MemoryProvenance::RepositoryText { .. })
        && matches!(scope, MemoryScope::Developer { .. })
    {
        return Err(MemoryContractError::new(
            "memory_scope_escalation",
            "repository text cannot create developer-scoped knowledge",
        ));
    }

    match statement_kind {
        MemoryStatementKind::InferredHypothesis => match freshness {
            MemoryFreshness::RunBound { run_id } if run_id == provenance.run_id() => {}
            _ => {
                return Err(MemoryContractError::new(
                    "memory_hypothesis_must_be_run_bound",
                    "inferred hypothesis must be bound to its source run",
                ));
            }
        },
        MemoryStatementKind::QuotedFact => {
            if matches!(
                provenance,
                MemoryProvenance::ModelOutput { .. } | MemoryProvenance::DeveloperStatement { .. }
            ) {
                return Err(MemoryContractError::new(
                    "memory_verified_evidence_required",
                    "model output or developer assertion alone cannot create a quoted fact",
                ));
            }
            if !matches!(
                freshness,
                MemoryFreshness::EvidenceBound { .. } | MemoryFreshness::ExplicitValidity { .. }
            ) {
                return Err(MemoryContractError::new(
                    "memory_verified_evidence_required",
                    "quoted fact must be evidence-bound or explicitly time-bound",
                ));
            }
            validate_evidence_binding(provenance, freshness)?;
        }
        MemoryStatementKind::WorkflowPattern => {
            if !matches!(
                provenance,
                MemoryProvenance::RunEvent { .. } | MemoryProvenance::CapabilityEvidence { .. }
            ) || !matches!(freshness, MemoryFreshness::EvidenceBound { .. })
            {
                return Err(MemoryContractError::new(
                    "memory_workflow_evidence_required",
                    "workflow pattern must be bound to run or capability evidence",
                ));
            }
            validate_evidence_binding(provenance, freshness)?;
        }
        MemoryStatementKind::DeveloperPreference => {}
        MemoryStatementKind::ReviewedDecision => {
            if matches!(scope, MemoryScope::Developer { .. })
                || matches!(subject_kind, MemorySubjectKind::DeveloperPreference)
            {
                return Err(MemoryContractError::new(
                    "memory_reviewed_decision_scope_invalid",
                    "reviewed decisions require branch, repository, or workspace scope",
                ));
            }
            match provenance {
                MemoryProvenance::DeveloperStatement {
                    admission:
                        Some(
                            PreferenceAdmission::ExplicitRemember
                            | PreferenceAdmission::ReviewedAcceptance,
                        ),
                    ..
                } => {}
                _ => {
                    return Err(MemoryContractError::new(
                        "memory_reviewed_decision_admission_required",
                        "reviewed decision requires explicitly admitted developer input",
                    ));
                }
            }
            if !matches!(
                freshness,
                MemoryFreshness::PersistentUntilReviewed | MemoryFreshness::ExplicitValidity { .. }
            ) {
                return Err(MemoryContractError::new(
                    "memory_reviewed_decision_freshness_invalid",
                    "reviewed decision must persist until review or carry explicit validity",
                ));
            }
        }
    }
    Ok(())
}

fn validate_evidence_binding(
    provenance: &MemoryProvenance,
    freshness: &MemoryFreshness,
) -> Result<(), MemoryContractError> {
    if let MemoryFreshness::EvidenceBound { evidence_sha256 } = freshness
        && provenance.evidence_digest() != Some(evidence_sha256.as_str())
    {
        return Err(MemoryContractError::new(
            "memory_evidence_binding_mismatch",
            "freshness evidence digest must match provenance",
        ));
    }
    Ok(())
}

pub(crate) fn bounded_identifier(
    field: &'static str,
    value: String,
) -> Result<String, MemoryContractError> {
    let value = value.trim_matches(|character: char| character.is_ascii_whitespace());
    if value.is_empty() {
        return Err(MemoryContractError::new(
            "memory_identifier_empty",
            "memory identifier must not be empty",
        ));
    }
    if value.len() > MAX_MEMORY_TEXT_BYTES {
        return Err(MemoryContractError::new(
            "memory_identifier_too_large",
            "memory identifier exceeds the bounded byte limit",
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(MemoryContractError::new(
            "memory_identifier_control_character",
            "memory identifier contains a forbidden control character",
        ));
    }
    let _ = field;
    Ok(value.to_owned())
}

fn sha256_value(_field: &'static str, value: String) -> Result<String, MemoryContractError> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(MemoryContractError::new(
            "memory_sha256_invalid",
            "memory provenance digest must be lowercase SHA-256",
        ));
    }
    Ok(value)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClaimIdentityMaterial<'a> {
    schema_version: u8,
    normalization_id: &'static str,
    subject_kind: &'a MemorySubjectKind,
    statement_kind: &'a MemoryStatementKind,
    subject: &'a str,
    statement: &'a str,
    scope: &'a MemoryScope,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ObservationIdentityMaterial<'a> {
    schema_version: u8,
    claim_id: &'a MemoryClaimId,
    provenance: &'a MemoryProvenance,
    relation: &'a MemoryObservationRelation,
    confidence: u8,
    observed_at_millis: i64,
    freshness: &'a MemoryFreshness,
}

fn claim_id(
    subject_kind: &MemorySubjectKind,
    statement_kind: &MemoryStatementKind,
    subject: &str,
    statement: &str,
    scope: &MemoryScope,
) -> MemoryClaimId {
    MemoryClaimId(format!(
        "memory_claim:v1:sha256:{}",
        digest_json(&ClaimIdentityMaterial {
            schema_version: MEMORY_SCHEMA_VERSION,
            normalization_id: MEMORY_NORMALIZATION_ID,
            subject_kind,
            statement_kind,
            subject,
            statement,
            scope,
        })
    ))
}

fn observation_id(
    claim_id: &MemoryClaimId,
    provenance: &MemoryProvenance,
    relation: &MemoryObservationRelation,
    confidence: u8,
    observed_at_millis: i64,
    freshness: &MemoryFreshness,
) -> MemoryObservationId {
    MemoryObservationId(format!(
        "memory_observation:v1:sha256:{}",
        digest_json(&ObservationIdentityMaterial {
            schema_version: MEMORY_SCHEMA_VERSION,
            claim_id,
            provenance,
            relation,
            confidence,
            observed_at_millis,
            freshness,
        })
    ))
}

fn digest_json(value: &impl Serialize) -> String {
    let encoded = serde_json::to_vec(value).expect("memory identity material serializes");
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
