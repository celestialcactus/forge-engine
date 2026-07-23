use std::{
    collections::HashSet,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    ApprovalDecision, ApprovalFacts, ApprovalOutcome, BoundedTextEvidence, Cancellation,
    CandidateLeaseChange, CandidateLeaseRecord, CandidateLeaseState, CapabilityCall,
    FileCandidateLeaseStore, resolve_approval,
};

pub const CANDIDATE_PROMOTE_CAPABILITY_ID: &str = "workspace.candidate.promote";
pub const CANDIDATE_DISCARD_CAPABILITY_ID: &str = "workspace.candidate.discard";
const JOURNAL_SCHEMA_VERSION: u8 = 1;
const ARTIFACT_SCHEMA_VERSION: u8 = 1;
const MAX_GIT_OUTPUT_BYTES: usize = 32 * 1_048_576;
const MIN_DIFF_BYTES: usize = 1_000;
const MAX_DIFF_BYTES: usize = 1_000_000;

#[derive(Clone, Debug)]
pub struct CandidateLifecycleConfig {
    pub repository_root: PathBuf,
    pub candidate_parent: PathBuf,
    pub candidate_lease_root: PathBuf,
    pub git_executable: PathBuf,
    pub max_diff_bytes: usize,
}

impl CandidateLifecycleConfig {
    pub fn new(repository_root: impl Into<PathBuf>, candidate_parent: impl Into<PathBuf>) -> Self {
        let candidate_parent = candidate_parent.into();
        let candidate_lease_root = candidate_parent.join(".forge-leases");
        Self {
            repository_root: repository_root.into(),
            candidate_parent,
            candidate_lease_root,
            git_executable: PathBuf::from("git"),
            max_diff_bytes: 100_000,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatePromotionSubject {
    pub candidate_id: String,
    pub repository_id: String,
    pub expected_base_revision: String,
    pub proposal_id: String,
    pub snapshot_id: String,
    pub change_set_sha256: String,
    pub final_diff_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateInspectionArtifact {
    pub schema_version: u8,
    pub subject: CandidatePromotionSubject,
    pub state: CandidateLeaseState,
    pub changes: Vec<CandidateLeaseChange>,
    pub candidate_valid: bool,
    pub active_base_revision: String,
    pub active_workspace_clean: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub final_diff: Option<BoundedTextEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<CandidateRecoveryEvidence>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatePromotionRequest {
    pub promotion_id: String,
    pub subject: CandidatePromotionSubject,
    pub call: CapabilityCall,
    pub approval_facts: ApprovalFacts,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateDiscardRequest {
    pub discard_id: String,
    pub subject: CandidatePromotionSubject,
    pub call: CapabilityCall,
    pub approval_facts: ApprovalFacts,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateDiscardStatus {
    NotAuthorized,
    Cancelled,
    Failed,
    Discarded,
    AlreadyDiscarded,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateDiscardArtifact {
    pub schema_version: u8,
    pub discard_id: String,
    pub subject: CandidatePromotionSubject,
    pub status: CandidateDiscardStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancellation_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidateDiscardCallInput {
    discard_id: String,
    subject: CandidatePromotionSubject,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidatePromotionStatus {
    NotAuthorized,
    Cancelled,
    Failed,
    Recovered,
    RecoveryFailed,
    Promoted,
    AlreadyPromoted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateRecoveryEvidence {
    pub attempted: bool,
    pub success: bool,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidatePromotionArtifact {
    pub schema_version: u8,
    pub promotion_id: String,
    pub subject: CandidatePromotionSubject,
    pub status: CandidatePromotionStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval: Option<ApprovalDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recovery: Option<CandidateRecoveryEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancellation_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CandidatePromoteCallInput {
    promotion_id: String,
    subject: CandidatePromotionSubject,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PromotionJournal {
    schema_version: u8,
    promotion_id: String,
    subject: CandidatePromotionSubject,
    changes: Vec<CandidateLeaseChange>,
    created_at_unix_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ActiveState {
    Before,
    After,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PromotionHookPoint {
    JournalPersisted,
    PathReplaced(usize),
    CandidateApplied,
}

trait PromotionHook {
    fn reach(&mut self, _point: PromotionHookPoint) -> Result<(), String> {
        Ok(())
    }
}

struct NoopPromotionHook;
impl PromotionHook for NoopPromotionHook {}

struct RepositoryLock(File);
impl Drop for RepositoryLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

pub struct CandidateLifecycleService {
    config: CandidateLifecycleConfig,
    lease_store: FileCandidateLeaseStore,
    promotion_state_root: PathBuf,
}

impl CandidateLifecycleService {
    pub fn try_new(mut config: CandidateLifecycleConfig) -> Result<Self, String> {
        if !(MIN_DIFF_BYTES..=MAX_DIFF_BYTES).contains(&config.max_diff_bytes) {
            return Err(format!(
                "max_diff_bytes must be from {MIN_DIFF_BYTES} to {MAX_DIFF_BYTES}."
            ));
        }
        config.repository_root = fs::canonicalize(&config.repository_root)
            .map_err(|error| format!("Cannot resolve lifecycle repository root: {error}"))?;
        fs::create_dir_all(&config.candidate_parent)
            .map_err(|error| format!("Cannot create candidate parent: {error}"))?;
        config.candidate_parent = fs::canonicalize(&config.candidate_parent)
            .map_err(|error| format!("Cannot resolve candidate parent: {error}"))?;
        fs::create_dir_all(&config.candidate_lease_root)
            .map_err(|error| format!("Cannot create candidate lease root: {error}"))?;
        config.candidate_lease_root = fs::canonicalize(&config.candidate_lease_root)
            .map_err(|error| format!("Cannot resolve candidate lease root: {error}"))?;
        let lease_store = FileCandidateLeaseStore::try_new(
            &config.repository_root,
            &config.candidate_parent,
            &config.candidate_lease_root,
        )?;
        let promotion_state_root = config.candidate_lease_root.join("promotions");
        fs::create_dir_all(&promotion_state_root)
            .map_err(|error| format!("Cannot create promotion journal root: {error}"))?;
        Ok(Self {
            config,
            lease_store,
            promotion_state_root,
        })
    }

    pub fn inspect(&self, candidate_id: &str) -> Result<CandidateInspectionArtifact, String> {
        let _repository_lock = self.repository_lock()?;
        let recovery = self.reconcile(candidate_id)?;
        let _candidate_lock = self.lease_store.acquire_lock(candidate_id)?;
        let record = self.lease_store.load(candidate_id)?;
        let (candidate_valid, final_diff) = match record.state {
            CandidateLeaseState::Retained | CandidateLeaseState::Promoted => {
                let diff = self.validate_candidate(&record)?;
                (true, Some(diff))
            }
            CandidateLeaseState::CleanupFailed | CandidateLeaseState::Discarded => (false, None),
        };
        let active_base_revision = self.head_revision(&self.config.repository_root)?;
        let active_workspace_clean = self.workspace_clean(&self.config.repository_root)?;
        Ok(CandidateInspectionArtifact {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            subject: subject_for(&record),
            state: record.state,
            changes: record.changes,
            candidate_valid,
            active_base_revision,
            active_workspace_clean,
            final_diff,
            recovery,
        })
    }

    pub fn discard(
        &self,
        request: &CandidateDiscardRequest,
        cancellation: &dyn Cancellation,
    ) -> CandidateDiscardArtifact {
        let mut artifact = CandidateDiscardArtifact {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            discard_id: request.discard_id.clone(),
            subject: request.subject.clone(),
            status: CandidateDiscardStatus::Failed,
            approval: None,
            failure: None,
            cancellation_reason: None,
        };
        if let Err(error) = validate_discard_request(request) {
            artifact.failure = Some(error);
            return artifact;
        }
        if let Some(reason) = cancellation.reason() {
            artifact.status = CandidateDiscardStatus::Cancelled;
            artifact.cancellation_reason = Some(reason);
            return artifact;
        }
        let approval = match resolve_approval(&request.approval_facts) {
            Ok(value) => value,
            Err(error) => {
                artifact.failure = Some(error);
                return artifact;
            }
        };
        let authorized = approval.outcome == ApprovalOutcome::Allow;
        artifact.approval = Some(approval);
        if !authorized {
            artifact.status = CandidateDiscardStatus::NotAuthorized;
            return artifact;
        }
        if let Some(reason) = cancellation.reason() {
            artifact.status = CandidateDiscardStatus::Cancelled;
            artifact.cancellation_reason = Some(reason);
            return artifact;
        }
        let result = (|| -> Result<CandidateDiscardStatus, String> {
            let _repository_lock = self.repository_lock()?;
            self.reconcile(&request.subject.candidate_id)?;
            let _candidate_lock = self
                .lease_store
                .acquire_lock(&request.subject.candidate_id)?;
            let record = self.lease_store.load(&request.subject.candidate_id)?;
            if subject_for(&record) != request.subject {
                return Err(
                    "Discard subject does not match the durable candidate lease.".to_owned(),
                );
            }
            if record.state == CandidateLeaseState::Discarded {
                return Ok(CandidateDiscardStatus::AlreadyDiscarded);
            }
            if matches!(
                record.state,
                CandidateLeaseState::Retained | CandidateLeaseState::Promoted
            ) {
                self.validate_candidate(&record)?;
            }
            self.lease_store
                .discard_locked(record, &self.config.git_executable)?;
            Ok(CandidateDiscardStatus::Discarded)
        })();
        match result {
            Ok(status) => artifact.status = status,
            Err(error) => artifact.failure = Some(error),
        }
        artifact
    }

    pub fn promote(
        &self,
        request: &CandidatePromotionRequest,
        cancellation: &dyn Cancellation,
    ) -> CandidatePromotionArtifact {
        self.promote_with_hook(request, cancellation, &mut NoopPromotionHook)
    }

    fn promote_with_hook(
        &self,
        request: &CandidatePromotionRequest,
        cancellation: &dyn Cancellation,
        hook: &mut dyn PromotionHook,
    ) -> CandidatePromotionArtifact {
        let mut artifact = CandidatePromotionArtifact {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            promotion_id: request.promotion_id.clone(),
            subject: request.subject.clone(),
            status: CandidatePromotionStatus::Failed,
            approval: None,
            recovery: None,
            failure: None,
            cancellation_reason: None,
        };
        if let Err(error) = validate_request(request) {
            artifact.failure = Some(error);
            return artifact;
        }
        if let Some(reason) = cancellation.reason() {
            artifact.status = CandidatePromotionStatus::Cancelled;
            artifact.cancellation_reason = Some(reason);
            return artifact;
        }
        let approval = match resolve_approval(&request.approval_facts) {
            Ok(value) => value,
            Err(error) => {
                artifact.failure = Some(error);
                return artifact;
            }
        };
        let authorized = approval.outcome == ApprovalOutcome::Allow;
        artifact.approval = Some(approval);
        if !authorized {
            artifact.status = CandidatePromotionStatus::NotAuthorized;
            return artifact;
        }
        if let Some(reason) = cancellation.reason() {
            artifact.status = CandidatePromotionStatus::Cancelled;
            artifact.cancellation_reason = Some(reason);
            return artifact;
        }

        let result = (|| -> Result<CandidatePromotionStatus, String> {
            let _repository_lock = self.repository_lock()?;
            self.reconcile(&request.subject.candidate_id)?;
            let _candidate_lock = self
                .lease_store
                .acquire_lock(&request.subject.candidate_id)?;
            let record = self.lease_store.load(&request.subject.candidate_id)?;
            if subject_for(&record) != request.subject {
                return Err(
                    "Promotion subject does not match the durable candidate lease.".to_owned(),
                );
            }
            if record.state == CandidateLeaseState::Promoted {
                self.require_active_state(&record, ActiveState::After)?;
                return Ok(CandidatePromotionStatus::AlreadyPromoted);
            }
            if record.state != CandidateLeaseState::Retained {
                return Err("Only a retained candidate can be promoted.".to_owned());
            }
            let patch = self.validate_candidate_bytes(&record)?;
            self.require_active_state(&record, ActiveState::Before)?;
            self.git_with_input(
                &self.config.repository_root,
                &["apply", "--check", "--binary", "-"],
                &patch,
                "Git promotion preflight",
            )?;
            let journal = PromotionJournal {
                schema_version: JOURNAL_SCHEMA_VERSION,
                promotion_id: request.promotion_id.clone(),
                subject: request.subject.clone(),
                changes: record.changes.clone(),
                created_at_unix_ms: unix_ms()?,
            };
            self.prepare_backups(&record)?;
            if let Err(error) = self.write_journal(&journal) {
                let _ = self.remove_backup_tree(&record.candidate_id);
                return Err(error);
            }
            hook.reach(PromotionHookPoint::JournalPersisted)?;
            let mut cancellation_after_apply = None;
            let apply_result = (|| -> Result<(), String> {
                self.apply_exact_candidate_bytes(&record, hook)?;
                hook.reach(PromotionHookPoint::CandidateApplied)?;
                if let Some(reason) = cancellation.reason() {
                    cancellation_after_apply = Some(reason.clone());
                    return Err(format!("Promotion cancelled after apply: {reason}"));
                }
                self.require_active_state(&record, ActiveState::After)?;
                self.lease_store.record_promoted_locked(record.clone())?;
                self.cleanup_recovery_state(&record.candidate_id)?;
                Ok(())
            })();
            match apply_result {
                Ok(()) => Ok(CandidatePromotionStatus::Promoted),
                Err(error) => match self.rollback(&record) {
                    Ok(message) => {
                        artifact.recovery = Some(CandidateRecoveryEvidence {
                            attempted: true,
                            success: true,
                            message,
                        });
                        self.cleanup_recovery_state(&record.candidate_id)?;
                        if let Some(reason) = cancellation_after_apply {
                            artifact.cancellation_reason = Some(reason);
                            Ok(CandidatePromotionStatus::Cancelled)
                        } else {
                            artifact.failure = Some(error);
                            Ok(CandidatePromotionStatus::Recovered)
                        }
                    }
                    Err(recovery_error) => {
                        artifact.recovery = Some(CandidateRecoveryEvidence {
                            attempted: true,
                            success: false,
                            message: recovery_error.clone(),
                        });
                        Err(format!("{error} Recovery also failed: {recovery_error}"))
                    }
                },
            }
        })();
        match result {
            Ok(status) => artifact.status = status,
            Err(error) => {
                if artifact
                    .recovery
                    .as_ref()
                    .is_some_and(|recovery| !recovery.success)
                {
                    artifact.status = CandidatePromotionStatus::RecoveryFailed;
                }
                artifact.failure = Some(error);
            }
        }
        artifact
    }

    fn reconcile(&self, candidate_id: &str) -> Result<Option<CandidateRecoveryEvidence>, String> {
        let Some(journal) = self.read_journal(candidate_id)? else {
            return Ok(None);
        };
        let _candidate_lock = self.lease_store.acquire_lock(candidate_id)?;
        let record = self.lease_store.load(candidate_id)?;
        if journal.schema_version != JOURNAL_SCHEMA_VERSION
            || journal.subject != subject_for(&record)
            || journal.changes != record.changes
        {
            return Err("Promotion journal does not match the durable candidate lease.".to_owned());
        }
        match record.state {
            CandidateLeaseState::Promoted => {
                self.require_active_state(&record, ActiveState::After)?;
                self.cleanup_recovery_state(candidate_id)?;
                Ok(Some(CandidateRecoveryEvidence {
                    attempted: true,
                    success: true,
                    message: "Completed promotion transition was confirmed after restart."
                        .to_owned(),
                }))
            }
            CandidateLeaseState::Retained => {
                let message = self.rollback(&record)?;
                self.cleanup_recovery_state(candidate_id)?;
                Ok(Some(CandidateRecoveryEvidence {
                    attempted: true,
                    success: true,
                    message,
                }))
            }
            CandidateLeaseState::CleanupFailed | CandidateLeaseState::Discarded => Err(
                "Promotion journal exists for a candidate that is no longer promotable.".to_owned(),
            ),
        }
    }

    fn validate_candidate(
        &self,
        record: &CandidateLeaseRecord,
    ) -> Result<BoundedTextEvidence, String> {
        let bytes = self.validate_candidate_bytes(record)?;
        Ok(bounded_text(&bytes, self.config.max_diff_bytes))
    }

    fn validate_candidate_bytes(&self, record: &CandidateLeaseRecord) -> Result<Vec<u8>, String> {
        let candidate_path = PathBuf::from(&record.candidate_path);
        let canonical = fs::canonicalize(&candidate_path)
            .map_err(|error| format!("Cannot resolve retained candidate: {error}"))?;
        self.lease_store
            .validate_candidate_path_for_lifecycle(&canonical)?;
        if !paths_equal(&canonical, &candidate_path) {
            return Err("Candidate path identity changed after retention.".to_owned());
        }
        if self.head_revision(&canonical)? != record.base_revision {
            return Err("Candidate base revision no longer matches its lease.".to_owned());
        }
        self.require_exact_changed_paths(&canonical, &record.changes)?;
        for change in &record.changes {
            let digest = file_digest(&canonical.join(&change.path))?;
            if digest != change.after_sha256 {
                return Err(format!(
                    "Candidate content digest mismatch: {}.",
                    change.path
                ));
            }
        }
        let patch = self.git_bytes(
            &canonical,
            &["diff", "--no-ext-diff", "--no-color", "--binary", "--", "."],
            "Git candidate diff",
        )?;
        if digest(&patch) != record.final_diff_sha256 {
            return Err("Candidate diff digest no longer matches its lease.".to_owned());
        }
        Ok(patch)
    }

    fn require_active_state(
        &self,
        record: &CandidateLeaseRecord,
        expected: ActiveState,
    ) -> Result<(), String> {
        if self.head_revision(&self.config.repository_root)? != record.base_revision {
            return Err("Active workspace base revision is stale for this candidate.".to_owned());
        }
        match expected {
            ActiveState::Before => {
                if !self.workspace_clean(&self.config.repository_root)? {
                    return Err("Active workspace must be Git-clean before promotion.".to_owned());
                }
                for change in &record.changes {
                    if file_digest(&self.config.repository_root.join(&change.path))?
                        != change.before_sha256
                    {
                        return Err(format!(
                            "Active workspace content no longer matches the approved base: {}.",
                            change.path
                        ));
                    }
                }
            }
            ActiveState::After => {
                self.require_exact_changed_paths(&self.config.repository_root, &record.changes)?;
                for change in &record.changes {
                    if file_digest(&self.config.repository_root.join(&change.path))?
                        != change.after_sha256
                    {
                        return Err(format!(
                            "Promoted workspace content digest mismatch: {}.",
                            change.path
                        ));
                    }
                }
                let patch = self.git_bytes(
                    &self.config.repository_root,
                    &["diff", "--no-ext-diff", "--no-color", "--binary", "--", "."],
                    "Git active promotion diff",
                )?;
                if digest(&patch) != record.final_diff_sha256 {
                    return Err(
                        "Promoted workspace diff does not exactly match the candidate.".to_owned(),
                    );
                }
            }
        }
        Ok(())
    }

    fn require_exact_changed_paths(
        &self,
        root: &Path,
        expected: &[CandidateLeaseChange],
    ) -> Result<(), String> {
        let unstaged = self.git_bytes(
            root,
            &["diff", "--name-only", "-z", "--", "."],
            "Git unstaged path inventory",
        )?;
        let staged = self.git_bytes(
            root,
            &["diff", "--cached", "--name-only", "-z", "--", "."],
            "Git staged path inventory",
        )?;
        let untracked = self.git_bytes(
            root,
            &["ls-files", "--others", "--exclude-standard", "-z"],
            "Git untracked path inventory",
        )?;
        if !staged.is_empty() || !untracked.is_empty() {
            return Err(
                "Candidate contains staged or untracked paths outside the bounded change set."
                    .to_owned(),
            );
        }
        let actual = nul_paths(&unstaged)?;
        let expected = expected
            .iter()
            .map(|change| change.path.clone())
            .collect::<HashSet<_>>();
        if actual != expected {
            return Err(
                "Candidate changed-path inventory does not match its durable lease.".to_owned(),
            );
        }
        Ok(())
    }

    fn rollback(&self, record: &CandidateLeaseRecord) -> Result<String, String> {
        for change in &record.changes {
            let current = file_digest(&self.config.repository_root.join(&change.path))?;
            if current != change.before_sha256 && current != change.after_sha256 {
                return Err(format!(
                    "Recovery refused to overwrite divergent developer content: {}.",
                    change.path
                ));
            }
        }
        for change in &record.changes {
            let target = self.config.repository_root.join(&change.path);
            if file_digest(&target)? == change.before_sha256 {
                continue;
            }
            let backup = self.backup_path(&record.candidate_id, &change.path)?;
            let bytes = read_bounded_regular_file(&backup)?;
            if digest(&bytes) != change.before_sha256 {
                return Err(format!("Recovery backup digest mismatch: {}.", change.path));
            }
            atomic_replace_bytes(&target, &bytes)?;
        }
        self.require_active_state(record, ActiveState::Before)?;
        Ok("Recovered the active workspace to the exact pre-promotion state.".to_owned())
    }

    fn prepare_backups(&self, record: &CandidateLeaseRecord) -> Result<(), String> {
        let root = self.backup_root(&record.candidate_id)?;
        if root.exists() {
            return Err("A promotion recovery backup already exists.".to_owned());
        }
        fs::create_dir(&root)
            .map_err(|error| format!("Cannot create promotion recovery backup: {error}"))?;
        let result = (|| -> Result<(), String> {
            for change in &record.changes {
                let source = self.config.repository_root.join(&change.path);
                let bytes = read_bounded_regular_file(&source)?;
                if digest(&bytes) != change.before_sha256 {
                    return Err(format!(
                        "Active workspace changed while preparing promotion: {}.",
                        change.path
                    ));
                }
                let target = self.backup_path(&record.candidate_id, &change.path)?;
                let parent = target
                    .parent()
                    .ok_or_else(|| "Recovery backup path has no parent.".to_owned())?;
                fs::create_dir_all(parent)
                    .map_err(|error| format!("Cannot create recovery backup directory: {error}"))?;
                write_new_synced(&target, &bytes)?;
            }
            sync_directory(&root)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&root);
        }
        result
    }

    fn apply_exact_candidate_bytes(
        &self,
        record: &CandidateLeaseRecord,
        hook: &mut dyn PromotionHook,
    ) -> Result<(), String> {
        let candidate_root = PathBuf::from(&record.candidate_path);
        for (index, change) in record.changes.iter().enumerate() {
            let target = self.config.repository_root.join(&change.path);
            if file_digest(&target)? != change.before_sha256 {
                return Err(format!(
                    "Active workspace changed during promotion: {}.",
                    change.path
                ));
            }
            let bytes = read_bounded_regular_file(&candidate_root.join(&change.path))?;
            if digest(&bytes) != change.after_sha256 {
                return Err(format!(
                    "Candidate changed during promotion: {}.",
                    change.path
                ));
            }
            atomic_replace_bytes(&target, &bytes)?;
            hook.reach(PromotionHookPoint::PathReplaced(index))?;
        }
        Ok(())
    }

    fn backup_root(&self, candidate_id: &str) -> Result<PathBuf, String> {
        let value = candidate_id
            .strip_prefix("candidate:")
            .filter(|value| is_digest(value))
            .ok_or_else(|| "Candidate ID must contain a lowercase SHA-256 digest.".to_owned())?;
        Ok(self.promotion_state_root.join(format!("{value}.recovery")))
    }

    fn backup_path(&self, candidate_id: &str, relative: &str) -> Result<PathBuf, String> {
        let root = self.backup_root(candidate_id)?;
        let path = root.join(relative);
        if !path.starts_with(&root) {
            return Err("Recovery backup path escaped its state root.".to_owned());
        }
        Ok(path)
    }

    fn remove_backup_tree(&self, candidate_id: &str) -> Result<(), String> {
        let path = self.backup_root(candidate_id)?;
        if path.exists() {
            fs::remove_dir_all(path)
                .map_err(|error| format!("Cannot remove promotion recovery backup: {error}"))?;
            sync_directory(&self.promotion_state_root)?;
        }
        Ok(())
    }

    fn cleanup_recovery_state(&self, candidate_id: &str) -> Result<(), String> {
        self.remove_backup_tree(candidate_id)?;
        self.remove_journal(candidate_id)
    }
    fn workspace_clean(&self, root: &Path) -> Result<bool, String> {
        Ok(self
            .git_bytes(
                root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
                "Git clean-state check",
            )?
            .is_empty())
    }

    fn head_revision(&self, root: &Path) -> Result<String, String> {
        let bytes = self.git_bytes(
            root,
            &["rev-parse", "--verify", "HEAD"],
            "Git HEAD resolution",
        )?;
        let revision = String::from_utf8(bytes)
            .map_err(|_| "Git returned a non-UTF-8 HEAD revision.".to_owned())?
            .trim()
            .to_owned();
        if revision.is_empty() {
            return Err("Git returned an empty HEAD revision.".to_owned());
        }
        Ok(revision)
    }

    fn git_bytes(
        &self,
        root: &Path,
        arguments: &[&str],
        operation: &str,
    ) -> Result<Vec<u8>, String> {
        let arguments = arguments.iter().map(OsString::from).collect::<Vec<_>>();
        self.git_os(root, &arguments, operation)
    }

    fn git_os(
        &self,
        root: &Path,
        arguments: &[OsString],
        operation: &str,
    ) -> Result<Vec<u8>, String> {
        let output = Command::new(&self.config.git_executable)
            .current_dir(root)
            .args(arguments)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Could not start Git: {error}"))?;
        if output.stdout.len().saturating_add(output.stderr.len()) > MAX_GIT_OUTPUT_BYTES {
            return Err("Git output exceeded the 32 MiB lifecycle ceiling.".to_owned());
        }
        if !output.status.success() {
            return Err(format!(
                "{operation} failed: {}",
                bounded_message(&String::from_utf8_lossy(&output.stderr))
            ));
        }
        Ok(output.stdout)
    }

    fn git_with_input(
        &self,
        root: &Path,
        arguments: &[&str],
        input: &[u8],
        operation: &str,
    ) -> Result<(), String> {
        let mut child = Command::new(&self.config.git_executable)
            .current_dir(root)
            .args(arguments)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| format!("Could not start Git: {error}"))?;
        child
            .stdin
            .take()
            .ok_or_else(|| "Git stdin was unavailable.".to_owned())?
            .write_all(input)
            .map_err(|error| format!("Could not write Git patch input: {error}"))?;
        let output = child
            .wait_with_output()
            .map_err(|error| format!("Could not await Git: {error}"))?;
        if output.stdout.len().saturating_add(output.stderr.len()) > MAX_GIT_OUTPUT_BYTES {
            return Err("Git output exceeded the 32 MiB lifecycle ceiling.".to_owned());
        }
        if !output.status.success() {
            return Err(format!(
                "{operation} failed: {}",
                bounded_message(&String::from_utf8_lossy(&output.stderr))
            ));
        }
        Ok(())
    }

    fn repository_lock(&self) -> Result<RepositoryLock, String> {
        let path = self
            .config
            .candidate_lease_root
            .join("repository-promotion.lock");
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|error| format!("Cannot open repository promotion lock: {error}"))?;
        file.try_lock()
            .map_err(|error| format!("Repository promotion is already in progress: {error}"))?;
        Ok(RepositoryLock(file))
    }

    fn journal_path(&self, candidate_id: &str) -> Result<PathBuf, String> {
        let value = candidate_id
            .strip_prefix("candidate:")
            .filter(|value| is_digest(value))
            .ok_or_else(|| "Candidate ID must contain a lowercase SHA-256 digest.".to_owned())?;
        Ok(self
            .promotion_state_root
            .join(format!("{value}.pending.json")))
    }

    fn write_journal(&self, journal: &PromotionJournal) -> Result<(), String> {
        let target = self.journal_path(&journal.subject.candidate_id)?;
        if target.exists() {
            return Err("A pending promotion journal already exists.".to_owned());
        }
        let bytes = serde_json::to_vec_pretty(journal)
            .map_err(|error| format!("Cannot serialize promotion journal: {error}"))?;
        let temporary = self.promotion_state_root.join(format!(
            ".promotion-{}-{}.tmp",
            std::process::id(),
            unix_ms()?
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("Cannot create promotion journal: {error}"))?;
        let result = (|| -> Result<(), String> {
            file.write_all(&bytes)
                .map_err(|error| format!("Cannot write promotion journal: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Cannot sync promotion journal: {error}"))?;
            fs::rename(&temporary, &target)
                .map_err(|error| format!("Cannot publish promotion journal: {error}"))?;
            sync_directory(&self.promotion_state_root)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }

    fn read_journal(&self, candidate_id: &str) -> Result<Option<PromotionJournal>, String> {
        let path = self.journal_path(candidate_id)?;
        if !path.exists() {
            return Ok(None);
        }
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect promotion journal: {error}"))?;
        if !metadata.is_file() || metadata.len() > 128 * 1_024 {
            return Err("Promotion journal is not a bounded regular file.".to_owned());
        }
        let bytes =
            fs::read(path).map_err(|error| format!("Cannot read promotion journal: {error}"))?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|error| format!("Cannot parse promotion journal: {error}"))
    }

    fn remove_journal(&self, candidate_id: &str) -> Result<(), String> {
        let path = self.journal_path(candidate_id)?;
        if path.exists() {
            fs::remove_file(path)
                .map_err(|error| format!("Cannot remove promotion journal: {error}"))?;
            sync_directory(&self.promotion_state_root)?;
        }
        Ok(())
    }
}

fn validate_discard_request(request: &CandidateDiscardRequest) -> Result<(), String> {
    if request.discard_id.trim().is_empty() || request.discard_id.len() > 128 {
        return Err("discardId must be bounded and non-empty.".to_owned());
    }
    if request.call.id.trim().is_empty()
        || request.call.capability_id != CANDIDATE_DISCARD_CAPABILITY_ID
    {
        return Err(format!(
            "Discard requires capabilityId {CANDIDATE_DISCARD_CAPABILITY_ID}."
        ));
    }
    let input: CandidateDiscardCallInput = serde_json::from_value(request.call.input.clone())
        .map_err(|error| format!("Invalid workspace.candidate.discard input: {error}"))?;
    if input.discard_id != request.discard_id || input.subject != request.subject {
        return Err("The capability call is not bound to the exact discard subject.".to_owned());
    }
    if request.approval_facts.call_id != request.call.id
        || request.approval_facts.capability_id != request.call.capability_id
    {
        return Err("Approval facts do not match the exact discard call.".to_owned());
    }
    validate_subject(&request.subject)
}
fn validate_request(request: &CandidatePromotionRequest) -> Result<(), String> {
    if request.promotion_id.trim().is_empty() || request.promotion_id.len() > 128 {
        return Err("promotionId must be bounded and non-empty.".to_owned());
    }
    if request.call.id.trim().is_empty()
        || request.call.capability_id != CANDIDATE_PROMOTE_CAPABILITY_ID
    {
        return Err(format!(
            "Promotion requires capabilityId {CANDIDATE_PROMOTE_CAPABILITY_ID}."
        ));
    }
    let input: CandidatePromoteCallInput = serde_json::from_value(request.call.input.clone())
        .map_err(|error| format!("Invalid workspace.candidate.promote input: {error}"))?;
    if input.promotion_id != request.promotion_id || input.subject != request.subject {
        return Err("The capability call is not bound to the exact promotion subject.".to_owned());
    }
    if request.approval_facts.call_id != request.call.id
        || request.approval_facts.capability_id != request.call.capability_id
    {
        return Err("Approval facts do not match the exact promotion call.".to_owned());
    }
    validate_subject(&request.subject)
}

fn validate_subject(subject: &CandidatePromotionSubject) -> Result<(), String> {
    if !is_digest(&subject.repository_id)
        || !is_digest(&subject.change_set_sha256)
        || !is_digest(&subject.final_diff_sha256)
        || subject.expected_base_revision.trim().is_empty()
        || subject.proposal_id.trim().is_empty()
        || subject.snapshot_id.trim().is_empty()
    {
        return Err("Candidate lifecycle subject is incomplete or malformed.".to_owned());
    }
    Ok(())
}

fn subject_for(record: &CandidateLeaseRecord) -> CandidatePromotionSubject {
    CandidatePromotionSubject {
        candidate_id: record.candidate_id.clone(),
        repository_id: record.repository_id.clone(),
        expected_base_revision: record.base_revision.clone(),
        proposal_id: record.proposal_id.clone(),
        snapshot_id: record.snapshot_id.clone(),
        change_set_sha256: change_set_digest(&record.changes),
        final_diff_sha256: record.final_diff_sha256.clone(),
    }
}

fn change_set_digest(changes: &[CandidateLeaseChange]) -> String {
    digest(&serde_json::to_vec(changes).expect("candidate change-set serialization"))
}

fn nul_paths(bytes: &[u8]) -> Result<HashSet<String>, String> {
    let mut values = HashSet::new();
    for value in bytes
        .split(|byte| *byte == 0)
        .filter(|value| !value.is_empty())
    {
        let value = std::str::from_utf8(value)
            .map_err(|_| "Git returned a non-UTF-8 workspace path.".to_owned())?;
        values.insert(value.replace('\\', "/"));
    }
    Ok(values)
}

fn read_bounded_regular_file(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect promotion path {}: {error}", path.display()))?;
    if !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > 1_048_576
    {
        return Err(format!(
            "Promotion path is not a bounded regular file: {}.",
            path.display()
        ));
    }
    fs::read(path)
        .map_err(|error| format!("Cannot read promotion path {}: {error}", path.display()))
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Cannot create promotion state file: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("Cannot write promotion state file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Cannot sync promotion state file: {error}"))
}

fn atomic_replace_bytes(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "Promotion target has no parent directory.".to_owned())?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Promotion target filename is not UTF-8.".to_owned())?;
    let temporary = parent.join(format!(
        ".{name}.forge-promotion-{}-{}.tmp",
        std::process::id(),
        unix_ms()?
    ));
    write_new_synced(&temporary, bytes)?;
    let result = (|| -> Result<(), String> {
        let permissions = fs::metadata(target)
            .map_err(|error| format!("Cannot inspect promotion target permissions: {error}"))?
            .permissions();
        fs::set_permissions(&temporary, permissions)
            .map_err(|error| format!("Cannot preserve promotion target permissions: {error}"))?;
        replace_file(target, &temporary)?;
        sync_directory(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

#[cfg(unix)]
fn replace_file(target: &Path, replacement: &Path) -> Result<(), String> {
    fs::rename(replacement, target)
        .map_err(|error| format!("Cannot atomically replace promotion target: {error}"))
}

#[cfg(windows)]
fn replace_file(target: &Path, replacement: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut core::ffi::c_void,
            reserved: *mut core::ffi::c_void,
        ) -> i32;
    }

    let target = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    // SAFETY: both paths are owned, NUL-terminated UTF-16 buffers valid for the call;
    // the optional pointers are null and ReplaceFileW does not retain any pointer.
    let result = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if result == 0 {
        return Err(format!(
            "Cannot atomically replace promotion target: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}
fn file_digest(path: &Path) -> Result<String, String> {
    Ok(digest(&read_bounded_regular_file(path)?))
}

fn bounded_text(bytes: &[u8], maximum_bytes: usize) -> BoundedTextEvidence {
    let total_bytes = bytes.len() as u64;
    let truncated = bytes.len() > maximum_bytes;
    let bounded = &bytes[..bytes.len().min(maximum_bytes)];
    BoundedTextEvidence {
        text: String::from_utf8_lossy(bounded).into_owned(),
        total_bytes,
        sha256: digest(bytes),
        truncated,
    }
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn bounded_message(value: &str) -> String {
    value.chars().take(2_000).collect()
}

fn unix_ms() -> Result<u64, String> {
    let value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock cannot timestamp promotion: {error}"))?
        .as_millis();
    u64::try_from(value).map_err(|_| "Promotion timestamp overflowed u64.".to_owned())
}

fn sync_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("Cannot sync promotion journal directory: {error}"))?;
    }
    #[cfg(windows)]
    {
        let _ = path;
    }
    Ok(())
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy().to_lowercase() == right.to_string_lossy().to_lowercase()
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

#[cfg(test)]
mod tests;
