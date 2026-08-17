//! Bounded, append-oriented learning observations.
//!
//! This module is deliberately not connected to the run coordinator, CLI, MCP,
//! or planner. It provides a Rust-owned typed ledger and a deterministic
//! projection that a later checkpoint may explicitly integrate with those
//! contracts.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MEMORY_SCHEMA_VERSION: u8 = 1;
pub const MAX_MEMORY_RECORDS: usize = 10_000;
pub const MAX_MEMORY_TEXT_BYTES: usize = 8 * 1024;
pub const MAX_MEMORY_QUERY_RESULTS: usize = 100;

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MemoryId(pub String);

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    WorkspaceArchitecture,
    RepositoryConvention,
    DomainFact,
    DeveloperPreference,
    WorkflowStep,
    CorrectionNegativeEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryScope {
    pub workspace_id: String,
    pub repository_id: Option<String>,
    pub branch: Option<String>,
    pub actor_id: Option<String>,
}

impl MemoryScope {
    pub fn workspace(workspace_id: impl Into<String>) -> Result<Self, MemoryValidationError> {
        let workspace_id = required_text("workspaceId", &workspace_id.into())?;
        Ok(Self {
            workspace_id,
            repository_id: None,
            branch: None,
            actor_id: None,
        })
    }

    pub fn with_repository(
        mut self,
        repository_id: impl Into<String>,
    ) -> Result<Self, MemoryValidationError> {
        self.repository_id = Some(required_text("repositoryId", &repository_id.into())?);
        Ok(self)
    }

    pub fn with_branch(mut self, branch: impl Into<String>) -> Result<Self, MemoryValidationError> {
        self.branch = Some(required_text("branch", &branch.into())?);
        Ok(self)
    }

    pub fn with_actor(
        mut self,
        actor_id: impl Into<String>,
    ) -> Result<Self, MemoryValidationError> {
        self.actor_id = Some(required_text("actorId", &actor_id.into())?);
        Ok(self)
    }

    fn can_access(&self, query: &Self) -> bool {
        self.workspace_id == query.workspace_id
            && optional_scope_matches(&self.repository_id, &query.repository_id)
            && optional_scope_matches(&self.branch, &query.branch)
            && optional_scope_matches(&self.actor_id, &query.actor_id)
    }
}

fn optional_scope_matches(observation: &Option<String>, query: &Option<String>) -> bool {
    match observation {
        Some(value) => query.as_ref() == Some(value),
        None => true,
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum MemoryProvenance {
    RunEvent {
        run_id: String,
        event_sequence: u64,
    },
    DeveloperAuthored {
        actor_id: String,
    },
    RepositoryText {
        path: String,
        content_sha256: String,
    },
}

impl MemoryProvenance {
    pub fn run_event(
        run_id: impl Into<String>,
        event_sequence: u64,
    ) -> Result<Self, MemoryValidationError> {
        Ok(Self::RunEvent {
            run_id: required_text("runId", &run_id.into())?,
            event_sequence,
        })
    }

    pub fn developer(actor_id: impl Into<String>) -> Result<Self, MemoryValidationError> {
        Ok(Self::DeveloperAuthored {
            actor_id: required_text("actorId", &actor_id.into())?,
        })
    }

    pub fn repository_text(
        path: impl Into<String>,
        content_sha256: impl Into<String>,
    ) -> Result<Self, MemoryValidationError> {
        Ok(Self::RepositoryText {
            path: required_text("path", &path.into())?,
            content_sha256: required_text("contentSha256", &content_sha256.into())?,
        })
    }

    fn is_untrusted_repository_text(&self) -> bool {
        matches!(self, Self::RepositoryText { .. })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessPolicy {
    pub max_age_millis: Option<u64>,
}

impl FreshnessPolicy {
    pub const fn permanent() -> Self {
        Self {
            max_age_millis: None,
        }
    }

    pub const fn expires_after(max_age_millis: u64) -> Self {
        Self {
            max_age_millis: Some(max_age_millis),
        }
    }

    fn is_fresh(&self, observed_at_millis: i64, as_of_millis: i64) -> bool {
        if as_of_millis < observed_at_millis {
            return false;
        }
        match self.max_age_millis {
            Some(max_age) => (as_of_millis - observed_at_millis) as u64 <= max_age,
            None => true,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryObservation {
    pub schema_version: u8,
    pub id: MemoryId,
    pub kind: MemoryKind,
    pub subject: String,
    pub claim: String,
    pub scope: MemoryScope,
    pub provenance: MemoryProvenance,
    pub confidence: u8,
    pub observed_at_millis: i64,
    pub freshness: FreshnessPolicy,
    pub supersedes: Option<MemoryId>,
    pub correction_of: Option<MemoryId>,
}

impl MemoryObservation {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        kind: MemoryKind,
        subject: impl Into<String>,
        claim: impl Into<String>,
        scope: MemoryScope,
        provenance: MemoryProvenance,
        confidence: u8,
        observed_at_millis: i64,
        freshness: FreshnessPolicy,
        supersedes: Option<MemoryId>,
        correction_of: Option<MemoryId>,
    ) -> Result<Self, MemoryValidationError> {
        let subject = bounded_text("subject", &subject.into())?;
        let claim = bounded_text("claim", &claim.into())?;
        if confidence > 100 {
            return Err(MemoryValidationError::InvalidField(
                "confidence must be 0..=100",
            ));
        }
        if observed_at_millis < 0 {
            return Err(MemoryValidationError::InvalidField(
                "observedAtMillis must be non-negative",
            ));
        }
        if correction_of.is_some() && kind != MemoryKind::CorrectionNegativeEvidence {
            return Err(MemoryValidationError::InvalidField(
                "correctionOf requires correction_negative_evidence kind",
            ));
        }
        let id = observation_id(
            &kind,
            &subject,
            &claim,
            &scope,
            &provenance,
            confidence,
            observed_at_millis,
            &freshness,
            supersedes.as_ref(),
            correction_of.as_ref(),
        );
        Ok(Self {
            schema_version: MEMORY_SCHEMA_VERSION,
            id,
            kind,
            subject,
            claim,
            scope,
            provenance,
            confidence,
            observed_at_millis,
            freshness,
            supersedes,
            correction_of,
        })
    }

    pub fn is_fresh(&self, as_of_millis: i64) -> bool {
        self.freshness
            .is_fresh(self.observed_at_millis, as_of_millis)
    }

    pub fn is_untrusted_repository_text(&self) -> bool {
        self.provenance.is_untrusted_repository_text()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTombstone {
    pub schema_version: u8,
    pub id: MemoryId,
    pub target_id: MemoryId,
    pub scope: MemoryScope,
    pub provenance: MemoryProvenance,
    pub observed_at_millis: i64,
    pub reason: String,
}

impl MemoryTombstone {
    pub fn new(
        target_id: MemoryId,
        scope: MemoryScope,
        provenance: MemoryProvenance,
        observed_at_millis: i64,
        reason: impl Into<String>,
    ) -> Result<Self, MemoryValidationError> {
        if observed_at_millis < 0 {
            return Err(MemoryValidationError::InvalidField(
                "observedAtMillis must be non-negative",
            ));
        }
        let reason = bounded_text("reason", &reason.into())?;
        let id = tombstone_id(&target_id, &scope, &provenance, observed_at_millis, &reason);
        Ok(Self {
            schema_version: MEMORY_SCHEMA_VERSION,
            id,
            target_id,
            scope,
            provenance,
            observed_at_millis,
            reason,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "recordType", content = "record", rename_all = "snake_case")]
pub enum MemoryRecord {
    Observation(MemoryObservation),
    Tombstone(MemoryTombstone),
}

impl MemoryRecord {
    fn id(&self) -> &MemoryId {
        match self {
            Self::Observation(value) => &value.id,
            Self::Tombstone(value) => &value.id,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MemoryValidationError {
    EmptyField(&'static str),
    FieldTooLarge(&'static str),
    InvalidField(&'static str),
    InvalidIdentity,
    DuplicateRecord,
    LedgerFull,
    InvalidJson,
}

impl std::fmt::Display for MemoryValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyField(field) => write!(formatter, "{field} must not be empty"),
            Self::FieldTooLarge(field) => {
                write!(formatter, "{field} exceeds the bounded memory limit")
            }
            Self::InvalidField(message) => formatter.write_str(message),
            Self::InvalidIdentity => {
                formatter.write_str("memory record identity does not match its content")
            }
            Self::DuplicateRecord => formatter.write_str("memory record already exists"),
            Self::LedgerFull => {
                formatter.write_str("memory ledger reached its bounded record limit")
            }
            Self::InvalidJson => formatter.write_str("invalid memory ledger JSON"),
        }
    }
}

impl std::error::Error for MemoryValidationError {}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryStore {
    records: Vec<MemoryRecord>,
}

impl MemoryStore {
    pub fn append(&mut self, record: MemoryRecord) -> Result<(), MemoryValidationError> {
        if self.records.len() >= MAX_MEMORY_RECORDS {
            return Err(MemoryValidationError::LedgerFull);
        }
        if self
            .records
            .iter()
            .any(|existing| existing.id() == record.id())
        {
            return Err(MemoryValidationError::DuplicateRecord);
        }
        validate_record_identity(&record)?;
        self.records.push(record);
        Ok(())
    }

    pub fn records(&self) -> &[MemoryRecord] {
        &self.records
    }

    pub fn rebuild_projection(&self) -> MemoryProjection {
        MemoryProjection::rebuild(&self.records)
    }

    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    pub fn from_json(value: &str) -> Result<Self, MemoryValidationError> {
        let store: Self =
            serde_json::from_str(value).map_err(|_| MemoryValidationError::InvalidJson)?;
        let mut validated = Self::default();
        for record in store.records {
            validated.append(record)?;
        }
        Ok(validated)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemoryQuery {
    pub scope: MemoryScope,
    pub subject: Option<String>,
    pub kind: Option<MemoryKind>,
    pub as_of_millis: i64,
    pub include_stale: bool,
    pub include_untrusted_repository_text: bool,
    pub limit: usize,
}

impl MemoryQuery {
    pub fn in_scope(scope: MemoryScope, as_of_millis: i64) -> Result<Self, MemoryValidationError> {
        if as_of_millis < 0 {
            return Err(MemoryValidationError::InvalidField(
                "asOfMillis must be non-negative",
            ));
        }
        Ok(Self {
            scope,
            subject: None,
            kind: None,
            as_of_millis,
            include_stale: false,
            include_untrusted_repository_text: false,
            limit: MAX_MEMORY_QUERY_RESULTS,
        })
    }

    pub fn for_subject(
        mut self,
        subject: impl Into<String>,
    ) -> Result<Self, MemoryValidationError> {
        self.subject = Some(bounded_text("subject", &subject.into())?);
        Ok(self)
    }

    pub fn of_kind(mut self, kind: MemoryKind) -> Self {
        self.kind = Some(kind);
        self
    }

    pub fn with_stale(mut self) -> Self {
        self.include_stale = true;
        self
    }

    pub fn with_untrusted_repository_text(mut self) -> Self {
        self.include_untrusted_repository_text = true;
        self
    }

    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = limit.min(MAX_MEMORY_QUERY_RESULTS);
        self
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MemoryProjection {
    observations: BTreeMap<MemoryId, MemoryObservation>,
    tombstones: BTreeMap<MemoryId, MemoryTombstone>,
    superseded: BTreeSet<MemoryId>,
}

impl MemoryProjection {
    pub fn rebuild(records: &[MemoryRecord]) -> Self {
        let mut projection = Self::default();
        for record in records {
            match record {
                MemoryRecord::Observation(observation) => {
                    projection
                        .observations
                        .insert(observation.id.clone(), observation.clone());
                }
                MemoryRecord::Tombstone(tombstone) => {
                    projection
                        .tombstones
                        .insert(tombstone.id.clone(), tombstone.clone());
                }
            }
        }

        let deleted: BTreeSet<MemoryId> = projection
            .tombstones
            .values()
            .filter_map(|tombstone| {
                projection
                    .observations
                    .get(&tombstone.target_id)
                    .and_then(|target| {
                        (target.scope == tombstone.scope).then(|| tombstone.target_id.clone())
                    })
            })
            .collect();
        for id in deleted {
            projection.observations.remove(&id);
        }

        for observation in projection.observations.values() {
            for target_id in [
                observation.supersedes.as_ref(),
                observation.correction_of.as_ref(),
            ]
            .into_iter()
            .flatten()
            {
                if let Some(target) = projection.observations.get(target_id) {
                    if target.scope == observation.scope {
                        projection.superseded.insert(target_id.clone());
                    }
                }
            }
        }
        projection
    }

    pub fn retrieve(&self, query: &MemoryQuery) -> Vec<MemoryObservation> {
        let mut values: Vec<_> = self
            .observations
            .values()
            .filter(|observation| !self.superseded.contains(&observation.id))
            .filter(|observation| observation.scope.can_access(&query.scope))
            .filter(|observation| {
                query
                    .subject
                    .as_ref()
                    .is_none_or(|subject| subject == &observation.subject)
            })
            .filter(|observation| {
                query
                    .kind
                    .as_ref()
                    .is_none_or(|kind| kind == &observation.kind)
            })
            .filter(|observation| query.include_stale || observation.is_fresh(query.as_of_millis))
            .filter(|observation| {
                query.include_untrusted_repository_text
                    || !observation.is_untrusted_repository_text()
            })
            .cloned()
            .collect();
        values.sort_by(|left, right| {
            right
                .confidence
                .cmp(&left.confidence)
                .then_with(|| right.observed_at_millis.cmp(&left.observed_at_millis))
                .then_with(|| left.id.cmp(&right.id))
        });
        values.truncate(query.limit);
        values
    }

    pub fn contradictions(&self, query: &MemoryQuery) -> Vec<Vec<MemoryObservation>> {
        let mut groups: BTreeMap<
            (MemoryKind, MemoryScope, String),
            BTreeMap<String, Vec<MemoryObservation>>,
        > = BTreeMap::new();
        for observation in self.retrieve(&MemoryQuery {
            limit: MAX_MEMORY_QUERY_RESULTS,
            ..query.clone()
        }) {
            groups
                .entry((
                    observation.kind.clone(),
                    observation.scope.clone(),
                    observation.subject.clone(),
                ))
                .or_default()
                .entry(observation.claim.clone())
                .or_default()
                .push(observation);
        }
        groups
            .into_values()
            .filter(|claims| claims.len() > 1)
            .map(|claims| claims.into_values().flatten().collect())
            .collect()
    }

    pub fn tombstones(&self) -> impl Iterator<Item = &MemoryTombstone> {
        self.tombstones.values()
    }
}

fn required_text(field: &'static str, value: &str) -> Result<String, MemoryValidationError> {
    bounded_text(field, value)
}

fn bounded_text(field: &'static str, value: &str) -> Result<String, MemoryValidationError> {
    let value = value.trim();
    if value.is_empty() {
        return Err(MemoryValidationError::EmptyField(field));
    }
    if value.len() > MAX_MEMORY_TEXT_BYTES {
        return Err(MemoryValidationError::FieldTooLarge(field));
    }
    Ok(value.to_owned())
}

fn observation_id(
    kind: &MemoryKind,
    subject: &str,
    claim: &str,
    scope: &MemoryScope,
    provenance: &MemoryProvenance,
    confidence: u8,
    observed_at_millis: i64,
    freshness: &FreshnessPolicy,
    supersedes: Option<&MemoryId>,
    correction_of: Option<&MemoryId>,
) -> MemoryId {
    let identity = serde_json::json!({
        "kind": kind,
        "subject": subject,
        "claim": claim,
        "scope": scope,
        "provenance": provenance,
        "confidence": confidence,
        "observedAtMillis": observed_at_millis,
        "freshness": freshness,
        "supersedes": supersedes,
        "correctionOf": correction_of,
    });
    MemoryId(format!("mem_{}", digest(identity.to_string().as_bytes())))
}

fn tombstone_id(
    target_id: &MemoryId,
    scope: &MemoryScope,
    provenance: &MemoryProvenance,
    observed_at_millis: i64,
    reason: &str,
) -> MemoryId {
    let identity = serde_json::json!({
        "targetId": target_id,
        "scope": scope,
        "provenance": provenance,
        "observedAtMillis": observed_at_millis,
        "reason": reason,
    });
    MemoryId(format!("tomb_{}", digest(identity.to_string().as_bytes())))
}

fn digest(value: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn validate_record_identity(record: &MemoryRecord) -> Result<(), MemoryValidationError> {
    match record {
        MemoryRecord::Observation(observation) => {
            if observation.schema_version != MEMORY_SCHEMA_VERSION {
                return Err(MemoryValidationError::InvalidField(
                    "unsupported memory observation schema version",
                ));
            }
            let expected = observation_id(
                &observation.kind,
                &observation.subject,
                &observation.claim,
                &observation.scope,
                &observation.provenance,
                observation.confidence,
                observation.observed_at_millis,
                &observation.freshness,
                observation.supersedes.as_ref(),
                observation.correction_of.as_ref(),
            );
            (expected == observation.id)
                .then_some(())
                .ok_or(MemoryValidationError::InvalidIdentity)
        }
        MemoryRecord::Tombstone(tombstone) => {
            if tombstone.schema_version != MEMORY_SCHEMA_VERSION {
                return Err(MemoryValidationError::InvalidField(
                    "unsupported memory tombstone schema version",
                ));
            }
            let expected = tombstone_id(
                &tombstone.target_id,
                &tombstone.scope,
                &tombstone.provenance,
                tombstone.observed_at_millis,
                &tombstone.reason,
            );
            (expected == tombstone.id)
                .then_some(())
                .ok_or(MemoryValidationError::InvalidIdentity)
        }
    }
}
