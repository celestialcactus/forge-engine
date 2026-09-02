use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    MemoryFreshness, MemoryInspection, MemoryObservation, MemoryObservationId,
    MemoryObservationRelation, MemoryProvenance, MemoryScope, MemoryScopeKind, MemoryStatementKind,
    ProjectedMemory,
};

pub const DEFAULT_MEMORY_CONTEXT_PREVIEW_BYTES: u64 = 64 * 1024;
pub const MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES: u64 = 256 * 1024;
pub const MAXIMUM_MEMORY_OMISSION_PREVIEW_BYTES: usize = 120;
const MEMORY_CONTEXT_PREVIEW_SCHEMA_VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryContextSelectionReason {
    ActiveFreshExactScope,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryContextOmissionReason {
    ObservationNotYetEffective,
    DeclaredContradiction,
    InferredHypothesis,
    SourceNotEligible,
    ExplicitValidityExpired,
    EvidenceCurrentnessUnavailable,
    RunContextUnavailable,
    BudgetExceeded,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextSelected {
    pub entry: ProjectedMemory,
    pub context_bytes: u64,
    pub reason: MemoryContextSelectionReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextOmission {
    pub observation_id: MemoryObservationId,
    pub scope_kind: MemoryScopeKind,
    pub statement_preview: String,
    pub context_bytes: u64,
    pub reason: MemoryContextOmissionReason,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextScopeHead {
    pub scope: MemoryScope,
    pub ledger_head_sha256: Option<String>,
    pub active_count: u32,
    pub recovery_count: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryContextPreview {
    pub schema_version: u8,
    pub preview_id: String,
    pub as_of_millis: i64,
    pub budget_bytes: u64,
    pub selected_bytes: u64,
    pub candidate_count: u32,
    pub selected: Vec<MemoryContextSelected>,
    pub omitted: Vec<MemoryContextOmission>,
    pub scope_heads: Vec<MemoryContextScopeHead>,
    pub forgotten_excluded_count: u32,
    pub superseded_recovery_excluded_count: u32,
    pub retrieval_active: bool,
    pub planner_injection: bool,
    pub provider_work_performed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryContextError {
    code: &'static str,
    message: String,
}

impl MemoryContextError {
    fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub const fn code(&self) -> &'static str {
        self.code
    }
}

impl std::fmt::Display for MemoryContextError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MemoryContextError {}

pub fn compile_memory_context_preview(
    inspections: &[MemoryInspection],
    as_of_millis: i64,
    budget_bytes: u64,
) -> Result<MemoryContextPreview, MemoryContextError> {
    if as_of_millis < 0 {
        return Err(MemoryContextError::new(
            "memory_context_time_invalid",
            "Memory context preview time must be non-negative.",
        ));
    }
    if !(1..=MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES).contains(&budget_bytes) {
        return Err(MemoryContextError::new(
            "memory_context_budget_invalid",
            format!(
                "Memory context preview budget must be from 1 to {MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES} bytes."
            ),
        ));
    }
    validate_inspections(inspections)?;

    let mut ordered_inspections = inspections.to_vec();
    ordered_inspections.sort_by(|left, right| left.scope.cmp(&right.scope));
    let scope_heads = ordered_inspections
        .iter()
        .map(|inspection| MemoryContextScopeHead {
            scope: inspection.scope.clone(),
            ledger_head_sha256: inspection.ledger_head_sha256.clone(),
            active_count: inspection.active_count,
            recovery_count: inspection.recovery_count,
        })
        .collect::<Vec<_>>();

    let forgotten_excluded_count = ordered_inspections
        .iter()
        .flat_map(|inspection| &inspection.recovery)
        .filter(|entry| entry.replacement_observation_id.is_none())
        .count()
        .try_into()
        .unwrap_or(u32::MAX);
    let superseded_recovery_excluded_count = ordered_inspections
        .iter()
        .flat_map(|inspection| &inspection.recovery)
        .filter(|entry| entry.replacement_observation_id.is_some())
        .count()
        .try_into()
        .unwrap_or(u32::MAX);

    let mut candidates = ordered_inspections
        .iter()
        .flat_map(|inspection| inspection.active.iter().cloned())
        .collect::<Vec<_>>();
    candidates.sort_by(compare_projected_memory);

    let candidate_count = candidates.len().try_into().unwrap_or(u32::MAX);
    let mut selected = Vec::new();
    let mut omitted = Vec::new();
    let mut selected_bytes = 0_u64;
    for entry in candidates {
        let context_bytes = canonical_context_bytes(&entry)?;
        if let Some(reason) = policy_omission_reason(&entry.observation, as_of_millis) {
            omitted.push(omission(&entry, context_bytes, reason));
            continue;
        }
        if selected_bytes.saturating_add(context_bytes) > budget_bytes {
            omitted.push(omission(
                &entry,
                context_bytes,
                MemoryContextOmissionReason::BudgetExceeded,
            ));
            continue;
        }
        selected_bytes = selected_bytes.saturating_add(context_bytes);
        selected.push(MemoryContextSelected {
            entry,
            context_bytes,
            reason: MemoryContextSelectionReason::ActiveFreshExactScope,
        });
    }

    let preview_id = preview_id(
        as_of_millis,
        budget_bytes,
        selected_bytes,
        candidate_count,
        &selected,
        &omitted,
        &scope_heads,
        forgotten_excluded_count,
        superseded_recovery_excluded_count,
    )?;
    Ok(MemoryContextPreview {
        schema_version: MEMORY_CONTEXT_PREVIEW_SCHEMA_VERSION,
        preview_id,
        as_of_millis,
        budget_bytes,
        selected_bytes,
        candidate_count,
        selected,
        omitted,
        scope_heads,
        forgotten_excluded_count,
        superseded_recovery_excluded_count,
        retrieval_active: false,
        planner_injection: false,
        provider_work_performed: false,
    })
}

fn validate_inspections(inspections: &[MemoryInspection]) -> Result<(), MemoryContextError> {
    if inspections.len() != 2 {
        return Err(MemoryContextError::new(
            "memory_context_scope_invalid",
            "Memory context preview requires the exact repository and developer scopes.",
        ));
    }
    let distinct_scopes = inspections
        .iter()
        .map(|inspection| inspection.scope.clone())
        .collect::<BTreeSet<_>>();
    if distinct_scopes.len() != inspections.len() {
        return Err(MemoryContextError::new(
            "memory_context_scope_duplicate",
            "Memory context preview received a duplicate exact scope.",
        ));
    }
    if inspections
        .iter()
        .filter(|inspection| matches!(inspection.scope, MemoryScope::Repository { .. }))
        .count()
        != 1
        || inspections
            .iter()
            .filter(|inspection| matches!(inspection.scope, MemoryScope::Developer { .. }))
            .count()
            != 1
    {
        return Err(MemoryContextError::new(
            "memory_context_scope_invalid",
            "Memory context preview accepts one repository scope and one developer scope.",
        ));
    }

    let mut observations = BTreeSet::new();
    for inspection in inspections {
        if inspection.active_count as usize != inspection.active.len()
            || inspection.recovery_count as usize != inspection.recovery.len()
        {
            return Err(MemoryContextError::new(
                "memory_context_entry_mismatch",
                "Memory context preview counts do not match the validated projection.",
            ));
        }
        for entry in &inspection.active {
            validate_entry(&entry.observation, &inspection.scope, &mut observations)?;
        }
        for entry in &inspection.recovery {
            validate_entry(&entry.observation, &inspection.scope, &mut observations)?;
        }
    }
    Ok(())
}

fn validate_entry(
    observation: &MemoryObservation,
    expected_scope: &MemoryScope,
    observations: &mut BTreeSet<MemoryObservationId>,
) -> Result<(), MemoryContextError> {
    observation.validate_identity().map_err(|error| {
        MemoryContextError::new(
            "memory_context_entry_mismatch",
            format!("Memory context preview rejected an invalid observation: {error}"),
        )
    })?;
    if &observation.scope != expected_scope
        || !observations.insert(observation.observation_id.clone())
    {
        return Err(MemoryContextError::new(
            "memory_context_entry_mismatch",
            "Memory context preview entry does not match its exact scope or is duplicated.",
        ));
    }
    Ok(())
}

fn policy_omission_reason(
    observation: &MemoryObservation,
    as_of_millis: i64,
) -> Option<MemoryContextOmissionReason> {
    if observation.observed_at_millis > as_of_millis {
        return Some(MemoryContextOmissionReason::ObservationNotYetEffective);
    }
    if matches!(observation.relation, MemoryObservationRelation::Contradicts) {
        return Some(MemoryContextOmissionReason::DeclaredContradiction);
    }
    if matches!(
        observation.statement_kind,
        MemoryStatementKind::InferredHypothesis
    ) {
        return Some(MemoryContextOmissionReason::InferredHypothesis);
    }
    if matches!(
        observation.provenance,
        MemoryProvenance::ModelOutput { .. } | MemoryProvenance::RepositoryText { .. }
    ) {
        return Some(MemoryContextOmissionReason::SourceNotEligible);
    }
    match observation.freshness {
        MemoryFreshness::PersistentUntilReviewed => None,
        MemoryFreshness::ExplicitValidity { valid_until_millis }
            if as_of_millis <= valid_until_millis =>
        {
            None
        }
        MemoryFreshness::ExplicitValidity { .. } => {
            Some(MemoryContextOmissionReason::ExplicitValidityExpired)
        }
        MemoryFreshness::EvidenceBound { .. } => {
            Some(MemoryContextOmissionReason::EvidenceCurrentnessUnavailable)
        }
        MemoryFreshness::RunBound { .. } => {
            Some(MemoryContextOmissionReason::RunContextUnavailable)
        }
    }
}

fn compare_projected_memory(left: &ProjectedMemory, right: &ProjectedMemory) -> std::cmp::Ordering {
    left.observation
        .scope
        .cmp(&right.observation.scope)
        .then_with(|| {
            left.observation
                .subject_kind
                .cmp(&right.observation.subject_kind)
        })
        .then_with(|| left.observation.subject.cmp(&right.observation.subject))
        .then_with(|| left.observation.claim_id.cmp(&right.observation.claim_id))
        .then_with(|| {
            left.observation
                .observed_at_millis
                .cmp(&right.observation.observed_at_millis)
        })
        .then_with(|| {
            left.observation
                .observation_id
                .cmp(&right.observation.observation_id)
        })
}

fn canonical_context_bytes(entry: &ProjectedMemory) -> Result<u64, MemoryContextError> {
    serde_json::to_vec(entry)
        .map(|bytes| bytes.len().try_into().unwrap_or(u64::MAX))
        .map_err(|_| {
            MemoryContextError::new(
                "memory_context_encoding_failed",
                "Memory context entry could not be encoded.",
            )
        })
}

fn omission(
    entry: &ProjectedMemory,
    context_bytes: u64,
    reason: MemoryContextOmissionReason,
) -> MemoryContextOmission {
    MemoryContextOmission {
        observation_id: entry.observation.observation_id.clone(),
        scope_kind: entry.observation.scope.kind(),
        statement_preview: bounded_preview(&entry.observation.statement),
        context_bytes,
        reason,
    }
}

fn bounded_preview(value: &str) -> String {
    let single_line = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.len() <= MAXIMUM_MEMORY_OMISSION_PREVIEW_BYTES {
        return single_line;
    }
    let mut end = MAXIMUM_MEMORY_OMISSION_PREVIEW_BYTES.saturating_sub('…'.len_utf8());
    while !single_line.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    format!("{}…", &single_line[..end])
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewIdentity<'a> {
    schema_version: u8,
    as_of_millis: i64,
    budget_bytes: u64,
    selected_bytes: u64,
    candidate_count: u32,
    selected: &'a [MemoryContextSelected],
    omitted: &'a [MemoryContextOmission],
    scope_heads: &'a [MemoryContextScopeHead],
    forgotten_excluded_count: u32,
    superseded_recovery_excluded_count: u32,
    retrieval_active: bool,
    planner_injection: bool,
    provider_work_performed: bool,
}

#[allow(clippy::too_many_arguments)]
fn preview_id(
    as_of_millis: i64,
    budget_bytes: u64,
    selected_bytes: u64,
    candidate_count: u32,
    selected: &[MemoryContextSelected],
    omitted: &[MemoryContextOmission],
    scope_heads: &[MemoryContextScopeHead],
    forgotten_excluded_count: u32,
    superseded_recovery_excluded_count: u32,
) -> Result<String, MemoryContextError> {
    let material = PreviewIdentity {
        schema_version: MEMORY_CONTEXT_PREVIEW_SCHEMA_VERSION,
        as_of_millis,
        budget_bytes,
        selected_bytes,
        candidate_count,
        selected,
        omitted,
        scope_heads,
        forgotten_excluded_count,
        superseded_recovery_excluded_count,
        retrieval_active: false,
        planner_injection: false,
        provider_work_performed: false,
    };
    let canonical = serde_json::to_value(&material).map_err(|_| {
        MemoryContextError::new(
            "memory_context_encoding_failed",
            "Memory context preview identity could not be encoded.",
        )
    })?;
    let bytes = serde_json::to_vec(&canonical).map_err(|_| {
        MemoryContextError::new(
            "memory_context_encoding_failed",
            "Memory context preview identity could not be encoded.",
        )
    })?;
    let digest = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    Ok(format!("memory_context_preview:v1:sha256:{digest}"))
}
