use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::{
    MemoryCorrectionDisposition, MemoryEvent, MemoryGrantId, MemoryLineageId,
    MemoryNonContentReceipt, MemoryObservation, MemoryObservationId, MemoryProvenance, MemoryScope,
    MemoryStandingGrant, MemoryStoreLimits, PreferenceAdmission,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectedMemory {
    pub lineage_id: MemoryLineageId,
    pub observation: MemoryObservation,
    pub admitted_sequence: u64,
    pub updated_sequence: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecoveryMemory {
    pub lineage_id: MemoryLineageId,
    pub observation: MemoryObservation,
    pub replaced_at_millis: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replacement_observation_id: Option<MemoryObservationId>,
    pub updated_sequence: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemoryProjection {
    pub schema_version: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger_head_sha256: Option<String>,
    pub active: Vec<ProjectedMemory>,
    pub recovery: Vec<RecoveryMemory>,
    pub receipts: Vec<MemoryNonContentReceipt>,
    pub grants: Vec<MemoryStandingGrant>,
}

impl MemoryProjection {
    pub(crate) fn empty() -> Self {
        Self {
            schema_version: 1,
            ledger_head_sha256: None,
            active: Vec::new(),
            recovery: Vec::new(),
            receipts: Vec::new(),
            grants: Vec::new(),
        }
    }

    pub(crate) fn apply(
        &mut self,
        sequence: u64,
        event: &MemoryEvent,
        limits: &MemoryStoreLimits,
    ) -> Result<ProjectionChange, ProjectionError> {
        let mut change = ProjectionChange::default();
        match event {
            MemoryEvent::ObservationAdmitted { observation } => {
                observation
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                if self
                    .active
                    .iter()
                    .any(|entry| entry.observation.observation_id == observation.observation_id)
                {
                    change.unchanged = true;
                    change.active_observation = Some(observation.clone());
                    return Ok(change);
                }
                if let Some(existing) = self
                    .active
                    .iter()
                    .find(|entry| entry.observation.claim_id == observation.claim_id)
                {
                    change.unchanged = true;
                    change.active_observation = Some(existing.observation.clone());
                    return Ok(change);
                }
                if self.contains_observation(&observation.observation_id) {
                    return Err(ProjectionError::new(
                        "memory_transition_duplicate_observation",
                        "memory observation already exists in recovery",
                    ));
                }
                let lineage_id = MemoryLineageId(observation.observation_id.0.clone());
                self.active.push(ProjectedMemory {
                    lineage_id,
                    observation: observation.clone(),
                    admitted_sequence: sequence,
                    updated_sequence: sequence,
                });
                change.active_observation = Some(observation.clone());
            }
            MemoryEvent::ObservationAutoCaptured {
                observation,
                grant_id,
                grant_scope,
            } => {
                observation
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                let grant = self
                    .grants
                    .iter()
                    .find(|grant| &grant.grant_id == grant_id)
                    .ok_or_else(|| {
                        ProjectionError::new(
                            "memory_admission_grant_missing",
                            "automatic memory capture requires an existing standing grant",
                        )
                    })?;
                if !grant.is_active_auto() {
                    return Err(ProjectionError::new(
                        "memory_admission_grant_inactive",
                        "automatic memory capture requires an active auto grant",
                    ));
                }
                if &grant.scope != grant_scope {
                    return Err(ProjectionError::new(
                        "memory_admission_scope_mismatch",
                        "automatic memory capture does not match the grant scope",
                    ));
                }
                validate_standing_grant_observation(observation, grant)?;
                if self
                    .active
                    .iter()
                    .any(|entry| entry.observation.observation_id == observation.observation_id)
                {
                    change.unchanged = true;
                    change.active_observation = Some(observation.clone());
                    return Ok(change);
                }
                if let Some(existing) = self
                    .active
                    .iter()
                    .find(|entry| entry.observation.claim_id == observation.claim_id)
                {
                    change.unchanged = true;
                    change.active_observation = Some(existing.observation.clone());
                    return Ok(change);
                }
                if self.contains_observation(&observation.observation_id) {
                    return Err(ProjectionError::new(
                        "memory_transition_duplicate_observation",
                        "memory observation already exists in recovery",
                    ));
                }
                self.active.push(ProjectedMemory {
                    lineage_id: MemoryLineageId(observation.observation_id.0.clone()),
                    observation: observation.clone(),
                    admitted_sequence: sequence,
                    updated_sequence: sequence,
                });
                change.active_observation = Some(observation.clone());
            }
            MemoryEvent::ObservationCorrected {
                target,
                replacement,
                disposition,
                occurred_at_millis,
            } => {
                validate_time(*occurred_at_millis)?;
                replacement
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                let index = self.active_index(target).ok_or_else(|| {
                    ProjectionError::new(
                        "memory_transition_target_not_active",
                        "correction target is not an active memory",
                    )
                })?;
                let previous = self.active.remove(index);
                validate_replacement(&previous.observation, replacement, target)?;
                if replacement.observed_at_millis != *occurred_at_millis
                    || replacement.observed_at_millis < previous.observation.observed_at_millis
                {
                    return Err(ProjectionError::new(
                        "memory_transition_correction_time",
                        "correction observation and transition times must match and not move backward",
                    ));
                }
                if self.contains_observation(&replacement.observation_id) {
                    return Err(ProjectionError::new(
                        "memory_transition_duplicate_observation",
                        "replacement observation already exists",
                    ));
                }
                if *disposition == MemoryCorrectionDisposition::KeepBounded {
                    self.recovery.push(RecoveryMemory {
                        lineage_id: previous.lineage_id.clone(),
                        observation: previous.observation,
                        replaced_at_millis: *occurred_at_millis,
                        replacement_observation_id: Some(replacement.observation_id.clone()),
                        updated_sequence: sequence,
                    });
                } else {
                    let before = self.recovery.len();
                    self.recovery
                        .retain(|entry| entry.lineage_id != previous.lineage_id);
                    change.erased_records = before
                        .saturating_sub(self.recovery.len())
                        .saturating_add(1)
                        .try_into()
                        .unwrap_or(u32::MAX);
                }
                self.active.push(ProjectedMemory {
                    lineage_id: previous.lineage_id,
                    observation: replacement.clone(),
                    admitted_sequence: previous.admitted_sequence,
                    updated_sequence: sequence,
                });
                change.active_observation = Some(replacement.clone());
            }
            MemoryEvent::ObservationRestored {
                target,
                occurred_at_millis,
            } => {
                validate_time(*occurred_at_millis)?;
                let recovery_index = self.recovery_index(target).ok_or_else(|| {
                    ProjectionError::new(
                        "memory_recovery_missing",
                        "restore target is not available in recovery history",
                    )
                })?;
                let restored = self.recovery.remove(recovery_index);
                let active_index = self
                    .active
                    .iter()
                    .position(|entry| entry.lineage_id == restored.lineage_id);
                let admitted_sequence = if let Some(active_index) = active_index {
                    let previous = self.active.remove(active_index);
                    self.recovery.push(RecoveryMemory {
                        lineage_id: previous.lineage_id.clone(),
                        observation: previous.observation,
                        replaced_at_millis: *occurred_at_millis,
                        replacement_observation_id: Some(
                            restored.observation.observation_id.clone(),
                        ),
                        updated_sequence: sequence,
                    });
                    previous.admitted_sequence
                } else {
                    if restored.replacement_observation_id.is_some() {
                        let terminal = self
                            .recovery
                            .iter_mut()
                            .find(|entry| {
                                entry.lineage_id == restored.lineage_id
                                    && entry.replacement_observation_id.is_none()
                            })
                            .ok_or_else(|| {
                                ProjectionError::new(
                                    "memory_integrity_lineage_missing",
                                    "recovery lineage has neither active nor forgotten terminal memory",
                                )
                            })?;
                        terminal.replaced_at_millis = *occurred_at_millis;
                        terminal.replacement_observation_id =
                            Some(restored.observation.observation_id.clone());
                        terminal.updated_sequence = sequence;
                    }
                    restored.updated_sequence
                };
                let active_observation = restored.observation;
                self.active.push(ProjectedMemory {
                    lineage_id: restored.lineage_id,
                    observation: active_observation.clone(),
                    admitted_sequence,
                    updated_sequence: sequence,
                });
                change.active_observation = Some(active_observation);
            }
            MemoryEvent::ObservationForgotten {
                target,
                occurred_at_millis,
            } => {
                validate_time(*occurred_at_millis)?;
                let index = self.active_index(target).ok_or_else(|| {
                    ProjectionError::new(
                        "memory_transition_target_not_active",
                        "forget target is not an active memory",
                    )
                })?;
                let previous = self.active.remove(index);
                self.recovery.push(RecoveryMemory {
                    lineage_id: previous.lineage_id,
                    observation: previous.observation,
                    replaced_at_millis: *occurred_at_millis,
                    replacement_observation_id: None,
                    updated_sequence: sequence,
                });
            }
            MemoryEvent::ObservationPurged {
                target,
                actor_id,
                purged_at_millis,
            } => {
                validate_time(*purged_at_millis)?;
                validate_actor(actor_id)?;
                let lineage = self
                    .active
                    .iter()
                    .find(|entry| entry.observation.observation_id == *target)
                    .map(|entry| entry.lineage_id.clone())
                    .or_else(|| {
                        self.recovery
                            .iter()
                            .find(|entry| entry.observation.observation_id == *target)
                            .map(|entry| entry.lineage_id.clone())
                    })
                    .ok_or_else(|| {
                        ProjectionError::new(
                            "memory_transition_target_missing",
                            "purge target does not exist in active or recovery memory",
                        )
                    })?;
                let before = self.active.len().saturating_add(self.recovery.len());
                self.active.retain(|entry| entry.lineage_id != lineage);
                self.recovery.retain(|entry| entry.lineage_id != lineage);
                change.erased_records = before
                    .saturating_sub(self.active.len().saturating_add(self.recovery.len()))
                    .try_into()
                    .unwrap_or(u32::MAX);
            }
            MemoryEvent::RecoveryHistoryCleared {
                actor_id,
                cleared_at_millis,
            } => {
                validate_time(*cleared_at_millis)?;
                validate_actor(actor_id)?;
                change.erased_records = self.recovery.len().try_into().unwrap_or(u32::MAX);
                self.recovery.clear();
            }
            MemoryEvent::GrantChanged { grant } => {
                grant
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                self.grants
                    .retain(|current| current.grant_id != grant.grant_id);
                self.grants.push(grant.clone());
                change.grant = Some(grant.clone());
            }
            MemoryEvent::GrantRevoked {
                grant_id,
                actor_id,
                revoked_at_millis,
            } => {
                validate_time(*revoked_at_millis)?;
                let grant = self
                    .grants
                    .iter_mut()
                    .find(|grant| &grant.grant_id == grant_id)
                    .ok_or_else(|| {
                        ProjectionError::new(
                            "memory_admission_grant_missing",
                            "memory grant does not exist",
                        )
                    })?;
                if grant.actor_id != *actor_id {
                    return Err(ProjectionError::new(
                        "memory_admission_actor_mismatch",
                        "only the grant actor may revoke the memory grant",
                    ));
                }
                if grant.revoked_at_millis.is_some() {
                    change.unchanged = true;
                    change.grant = Some(grant.clone());
                    return Ok(change);
                }
                if *revoked_at_millis < grant.created_at_millis {
                    return Err(ProjectionError::new(
                        "memory_grant_time_invalid",
                        "memory grant revocation cannot precede creation",
                    ));
                }
                grant.revoked_at_millis = Some(*revoked_at_millis);
                change.grant = Some(grant.clone());
            }
            MemoryEvent::AutoCaptureUndone {
                target,
                grant_id,
                actor_id,
                occurred_at_millis,
            } => {
                validate_time(*occurred_at_millis)?;
                let index = self.active_index(target).ok_or_else(|| {
                    ProjectionError::new(
                        "memory_transition_target_not_active",
                        "automatic memory capture is no longer active",
                    )
                })?;
                let entry = &self.active[index];
                validate_undo_authority(&entry.observation, grant_id, actor_id)?;
                self.active.remove(index);
                change.erased_records = 1;
            }
            MemoryEvent::CompactionStarted {
                compacted_at_millis,
            } => {
                validate_time(*compacted_at_millis)?;
                self.active.clear();
                self.recovery.clear();
                self.receipts.clear();
                self.grants.clear();
            }
            MemoryEvent::CompactedActive { entry } => {
                entry
                    .observation
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                if self.contains_observation(&entry.observation.observation_id)
                    || self
                        .active
                        .iter()
                        .any(|current| current.lineage_id == entry.lineage_id)
                {
                    return Err(ProjectionError::new(
                        "memory_integrity_duplicate_lineage",
                        "compacted memory state contains duplicate active lineage",
                    ));
                }
                self.active.push(entry.clone());
            }
            MemoryEvent::CompactedRecovery { entry } => {
                entry
                    .observation
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                if self.contains_observation(&entry.observation.observation_id) {
                    return Err(ProjectionError::new(
                        "memory_integrity_duplicate_observation",
                        "compacted recovery contains a duplicate observation",
                    ));
                }
                self.recovery.push(entry.clone());
            }
            MemoryEvent::CompactedReceipt { receipt } => {
                self.receipts.push(receipt.clone());
            }
            MemoryEvent::CompactedGrant { grant } => {
                grant
                    .validate_identity()
                    .map_err(|error| ProjectionError::new(error.code(), error.to_string()))?;
                if self
                    .grants
                    .iter()
                    .any(|current| current.grant_id == grant.grant_id)
                {
                    return Err(ProjectionError::new(
                        "memory_integrity_duplicate_grant",
                        "compacted memory state contains a duplicate grant",
                    ));
                }
                self.grants.push(grant.clone());
            }
        }
        if self.active.len() > limits.maximum_active_records as usize {
            return Err(ProjectionError::new(
                "memory_store_active_capacity",
                "active memory record ceiling would be exceeded",
            ));
        }
        self.canonicalize();
        Ok(change)
    }

    pub(crate) fn enforce_recovery_limits(
        &mut self,
        as_of_millis: i64,
        limits: &MemoryStoreLimits,
    ) -> Result<u32, ProjectionError> {
        validate_time(as_of_millis)?;
        let before = self.recovery.len();
        let retention = i64::try_from(limits.recovery_retention_millis).unwrap_or(i64::MAX);
        self.recovery
            .retain(|entry| as_of_millis.saturating_sub(entry.replaced_at_millis) <= retention);

        self.recovery.sort_by(|left, right| {
            left.lineage_id
                .cmp(&right.lineage_id)
                .then_with(|| right.replaced_at_millis.cmp(&left.replaced_at_millis))
                .then_with(|| right.updated_sequence.cmp(&left.updated_sequence))
                .then_with(|| {
                    right
                        .observation
                        .observation_id
                        .cmp(&left.observation.observation_id)
                })
        });
        let mut counts = BTreeMap::<MemoryLineageId, u8>::new();
        self.recovery.retain(|entry| {
            let count = counts.entry(entry.lineage_id.clone()).or_default();
            *count = count.saturating_add(1);
            *count <= limits.recovery_versions_per_lineage
        });

        self.recovery.sort_by(|left, right| {
            left.replaced_at_millis
                .cmp(&right.replaced_at_millis)
                .then_with(|| left.updated_sequence.cmp(&right.updated_sequence))
                .then_with(|| {
                    left.observation
                        .observation_id
                        .cmp(&right.observation.observation_id)
                })
        });
        while recovery_bytes(&self.recovery)? > limits.maximum_recovery_bytes {
            if self.recovery.is_empty() {
                break;
            }
            self.recovery.remove(0);
        }
        self.canonicalize();
        Ok(before
            .saturating_sub(self.recovery.len())
            .try_into()
            .unwrap_or(u32::MAX))
    }

    pub(crate) fn active_by_id(&self, id: &MemoryObservationId) -> Option<&ProjectedMemory> {
        self.active
            .iter()
            .find(|entry| &entry.observation.observation_id == id)
    }

    pub(crate) fn validate_lineage_integrity(&self) -> Result<(), ProjectionError> {
        let mut recovery_lineages = BTreeMap::<MemoryLineageId, u32>::new();
        for entry in &self.recovery {
            let terminals = recovery_lineages
                .entry(entry.lineage_id.clone())
                .or_default();
            if entry.replacement_observation_id.is_none() {
                *terminals = terminals.saturating_add(1);
            } else if let Some(replacement) = &entry.replacement_observation_id {
                let replacement_lineage = self
                    .active
                    .iter()
                    .find(|candidate| candidate.observation.observation_id == *replacement)
                    .map(|candidate| &candidate.lineage_id)
                    .or_else(|| {
                        self.recovery
                            .iter()
                            .find(|candidate| candidate.observation.observation_id == *replacement)
                            .map(|candidate| &candidate.lineage_id)
                    });
                if replacement_lineage != Some(&entry.lineage_id) {
                    return Err(ProjectionError::new(
                        "memory_integrity_lineage_replacement",
                        "recovery replacement does not exist in the same lineage",
                    ));
                }
            }
        }
        for (lineage, terminals) in recovery_lineages {
            let has_active = self
                .active
                .iter()
                .any(|candidate| candidate.lineage_id == lineage);
            if (has_active && terminals != 0) || (!has_active && terminals != 1) {
                return Err(ProjectionError::new(
                    "memory_integrity_lineage_terminal",
                    "recovery lineage does not have exactly one active or forgotten terminal",
                ));
            }
        }
        Ok(())
    }

    fn active_index(&self, id: &MemoryObservationId) -> Option<usize> {
        self.active
            .iter()
            .position(|entry| &entry.observation.observation_id == id)
    }

    fn recovery_index(&self, id: &MemoryObservationId) -> Option<usize> {
        self.recovery
            .iter()
            .position(|entry| &entry.observation.observation_id == id)
    }

    fn contains_observation(&self, id: &MemoryObservationId) -> bool {
        self.active_index(id).is_some() || self.recovery_index(id).is_some()
    }

    fn canonicalize(&mut self) {
        self.active.sort_by(|left, right| {
            scope_key(&left.observation.scope)
                .cmp(&scope_key(&right.observation.scope))
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
        });
        self.recovery.sort_by(|left, right| {
            left.lineage_id
                .cmp(&right.lineage_id)
                .then_with(|| left.replaced_at_millis.cmp(&right.replaced_at_millis))
                .then_with(|| left.updated_sequence.cmp(&right.updated_sequence))
                .then_with(|| {
                    left.observation
                        .observation_id
                        .cmp(&right.observation.observation_id)
                })
        });
        self.receipts.sort_by(|left, right| {
            left.performed_at_millis
                .cmp(&right.performed_at_millis)
                .then_with(|| left.operation_id.cmp(&right.operation_id))
        });
        self.grants.sort_by(|left, right| {
            left.scope
                .cmp(&right.scope)
                .then_with(|| left.grant_id.cmp(&right.grant_id))
        });
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct ProjectionChange {
    pub active_observation: Option<MemoryObservation>,
    pub unchanged: bool,
    pub erased_records: u32,
    pub grant: Option<MemoryStandingGrant>,
}

fn validate_actor(actor_id: &str) -> Result<(), ProjectionError> {
    if actor_id.trim().is_empty() || actor_id.len() > 512 || actor_id.chars().any(char::is_control)
    {
        return Err(ProjectionError::new(
            "memory_admission_actor_invalid",
            "memory actor identity is invalid",
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProjectionError {
    pub code: String,
    pub message: String,
}

impl ProjectionError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

fn validate_replacement(
    previous: &MemoryObservation,
    replacement: &MemoryObservation,
    target: &MemoryObservationId,
) -> Result<(), ProjectionError> {
    if replacement.scope != previous.scope
        || replacement.subject_kind != previous.subject_kind
        || replacement.subject != previous.subject
        || replacement.statement_kind != previous.statement_kind
    {
        return Err(ProjectionError::new(
            "memory_transition_correction_mismatch",
            "correction must preserve scope, subject, and statement kind",
        ));
    }
    let relation_matches = matches!(
        &replacement.relation,
        super::MemoryObservationRelation::Corrects { observation_id }
            | super::MemoryObservationRelation::Supersedes { observation_id }
            if observation_id == target
    );
    if !relation_matches {
        return Err(ProjectionError::new(
            "memory_transition_correction_relation",
            "replacement must explicitly correct or supersede its active target",
        ));
    }
    Ok(())
}

fn validate_standing_grant_observation(
    observation: &MemoryObservation,
    grant: &MemoryStandingGrant,
) -> Result<(), ProjectionError> {
    let actor_matches = matches!(
        &observation.scope,
        MemoryScope::Developer { actor_id } if actor_id == &grant.actor_id
    );
    let provenance_matches = matches!(
        &observation.provenance,
        MemoryProvenance::DeveloperStatement {
            actor_id,
            admission: Some(PreferenceAdmission::StandingGrant { grant_id }),
            ..
        } if actor_id == &grant.actor_id && grant_id == &grant.grant_id
    );
    if !actor_matches || !provenance_matches {
        return Err(ProjectionError::new(
            "memory_admission_grant_mismatch",
            "automatic memory capture must be exact input from the grant actor",
        ));
    }
    Ok(())
}

fn validate_undo_authority(
    observation: &MemoryObservation,
    grant_id: &MemoryGrantId,
    actor_id: &str,
) -> Result<(), ProjectionError> {
    let authorized = matches!(
        (&observation.scope, &observation.provenance),
        (
            MemoryScope::Developer { actor_id: scope_actor },
            MemoryProvenance::DeveloperStatement {
                actor_id: source_actor,
                admission: Some(PreferenceAdmission::StandingGrant { grant_id: source_grant }),
                ..
            }
        ) if scope_actor == actor_id && source_actor == actor_id && source_grant == grant_id
    );
    if !authorized {
        return Err(ProjectionError::new(
            "memory_admission_grant_mismatch",
            "automatic memory undo must match the admitted grant and actor",
        ));
    }
    Ok(())
}

fn validate_time(value: i64) -> Result<(), ProjectionError> {
    if value < 0 {
        return Err(ProjectionError::new(
            "memory_transition_time_invalid",
            "memory transition time must be non-negative",
        ));
    }
    Ok(())
}

fn recovery_bytes(entries: &[RecoveryMemory]) -> Result<u64, ProjectionError> {
    serde_json::to_vec(entries)
        .map(|bytes| bytes.len().try_into().unwrap_or(u64::MAX))
        .map_err(|_| {
            ProjectionError::new(
                "memory_recovery_encoding_failed",
                "memory recovery state could not be encoded",
            )
        })
}

fn scope_key(scope: &MemoryScope) -> Vec<u8> {
    serde_json::to_vec(scope).expect("validated memory scope serializes")
}
