use super::{
    CandidateOperationBoundaryEvidence, ChangeOperationV2, ChangeSetV2, FileBlobStore, FileMode,
    PathIdentityResolver, RepositoryPathIdentity, change_set_sha256, sha256,
    validate_change_set_v2, verify_change_set_blobs,
};
use crate::{Cancellation, workspace_snapshot_id};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: u8 = 1;
const MAX_MANIFEST: u64 = 256 * 1024;
const MAX_JOURNAL: u64 = 512 * 1024;
const MAX_GIT: usize = 32 * 1_048_576;
const MAX_BEFORE: u64 = 1_048_576;
const MAX_BEFORE_TOTAL: u64 = 4_194_304;

#[derive(Clone, Debug)]
pub struct ChangeSetV2CoordinatorConfig {
    pub repository_root: PathBuf,
    pub state_root: PathBuf,
    pub git_executable: PathBuf,
    pub blob_store: FileBlobStore,
}
impl ChangeSetV2CoordinatorConfig {
    pub fn new(
        repository_root: impl Into<PathBuf>,
        state_root: impl Into<PathBuf>,
        blob_store: FileBlobStore,
    ) -> Self {
        Self {
            repository_root: repository_root.into(),
            state_root: state_root.into(),
            git_executable: PathBuf::from("git"),
            blob_store,
        }
    }
}
#[derive(Clone, Debug)]
pub struct ChangeSetV2Registration {
    pub boundary: CandidateOperationBoundaryEvidence,
    pub candidate_path: PathBuf,
    pub change_set: ChangeSetV2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeSetV2CoordinatorState {
    Prepared,
    Promoting,
    OperationApplied,
    RollingBack,
    RolledBack,
    Promoted,
    RepairRequired,
}
impl ChangeSetV2CoordinatorState {
    fn terminal(self) -> bool {
        matches!(
            self,
            Self::RolledBack | Self::Promoted | Self::RepairRequired
        )
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeSetV2Transition {
    pub sequence: u32,
    pub state: ChangeSetV2CoordinatorState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_sequence: Option<u32>,
    pub at_unix_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeSetV2CoordinatorArtifact {
    pub schema_version: u8,
    pub transaction_id: String,
    pub change_set_id: String,
    pub base_revision: String,
    pub state: ChangeSetV2CoordinatorState,
    pub transitions: Vec<ChangeSetV2Transition>,
    pub recovery_performed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancellation_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u8,
    transaction_id: String,
    repository_id: String,
    repository_root: String,
    base_revision: String,
    workspace_generation: String,
    boundary: CandidateOperationBoundaryEvidence,
    candidate_path: String,
    change_set: ChangeSetV2,
    operation_order: Vec<usize>,
    created_at_unix_ms: u64,
}
struct Lock(File);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Seen {
    Absent,
    Present(FileMode),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum HookPoint {
    PromotionStarted,
    OperationMutated(usize),
    OperationRecorded(usize),
    BeforePromoted,
    RollbackStarted,
    RollbackRestored(usize),
    BeforeRolledBack,
}
#[derive(Debug)]
enum HookFailure {
    Ordinary(String),
    Abrupt(String),
}
trait Hook {
    fn reach(&mut self, _: HookPoint) -> Result<(), HookFailure> {
        Ok(())
    }
}
struct Noop;
impl Hook for Noop {}

pub struct ChangeSetV2Coordinator {
    config: ChangeSetV2CoordinatorConfig,
}
impl ChangeSetV2Coordinator {
    pub fn try_new(mut config: ChangeSetV2CoordinatorConfig) -> Result<Self, String> {
        config.repository_root = fs::canonicalize(&config.repository_root)
            .map_err(|e| format!("Cannot resolve coordinator repository root: {e}"))?;
        fs::create_dir_all(&config.state_root)
            .map_err(|e| format!("Cannot create coordinator state root: {e}"))?;
        config.state_root = fs::canonicalize(&config.state_root)
            .map_err(|e| format!("Cannot resolve coordinator state root: {e}"))?;
        fs::create_dir_all(config.blob_store.root())
            .map_err(|e| format!("Cannot create coordinator blob root: {e}"))?;
        let blob = fs::canonicalize(config.blob_store.root())
            .map_err(|e| format!("Cannot resolve coordinator blob root: {e}"))?;
        if within(&config.state_root, &config.repository_root)
            || within(&blob, &config.repository_root)
        {
            return Err(
                "Coordinator state_root and blob_store must be outside the governed workspace."
                    .into(),
            );
        }
        if within(&config.state_root, &blob) || within(&blob, &config.state_root) {
            return Err("Coordinator state_root and blob_store must not overlap.".into());
        }
        git(
            &config.git_executable,
            &config.repository_root,
            &["rev-parse", "--show-toplevel"],
            "Git coordinator repository discovery",
        )?;
        let value = Self { config };
        value.cleanup_temps()?;
        value.reconcile_all()?;
        Ok(value)
    }
    pub fn register(
        &self,
        r: &ChangeSetV2Registration,
    ) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        self.reconcile_all()?;
        let _repo = self.repo_lock()?;
        let m = self.prepare_manifest(r)?;
        let dir = self.tx_dir(&m.transaction_id)?;
        if dir.exists() {
            let existing = self.load_manifest(&m.transaction_id)?;
            if existing != m {
                return Err("Transaction ID collides with different coordinator facts.".into());
            }
            return self.artifact(&existing, false, None, None);
        }
        let d = tx_digest(&m.transaction_id)?;
        let tmp = self.config.state_root.join(format!(
            ".transaction-{d}-{}-{}.tmp",
            std::process::id(),
            now()?
        ));
        fs::create_dir(&tmp).map_err(|e| format!("Cannot create coordinator transaction: {e}"))?;
        let result = (|| -> Result<(), String> {
            fs::create_dir(tmp.join("before"))
                .map_err(|e| format!("Cannot create before-image directory: {e}"))?;
            self.write_backups(&tmp, &m)?;
            write_json(&tmp.join("manifest.json"), &m)?;
            let first = ChangeSetV2Transition {
                sequence: 1,
                state: ChangeSetV2CoordinatorState::Prepared,
                operation_sequence: None,
                at_unix_ms: now()?,
                message: Some("Durable ChangeSet v2 transaction prepared.".into()),
            };
            write_journal(&tmp.join("transitions.jsonl"), &first)?;
            sync_dir(&tmp.join("before"))?;
            sync_dir(&tmp)?;
            fs::rename(&tmp, &dir)
                .map_err(|e| format!("Cannot publish coordinator transaction: {e}"))?;
            sync_dir(&self.config.state_root)
        })();
        if result.is_err() {
            let _ = fs::remove_dir_all(&tmp);
        }
        result?;
        self.artifact(&m, false, None, None)
    }
    pub fn inspect(&self, id: &str) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        self.reconcile(id)?;
        let m = self.load_manifest(id)?;
        self.artifact(&m, false, None, None)
    }
    pub fn promote(&self, id: &str, c: &dyn Cancellation) -> ChangeSetV2CoordinatorArtifact {
        self.promote_hook(id, c, &mut Noop)
    }
    pub fn reconcile_all(&self) -> Result<Vec<ChangeSetV2CoordinatorArtifact>, String> {
        let _repo = self.repo_lock()?;
        let mut ids = Vec::new();
        for entry in fs::read_dir(&self.config.state_root)
            .map_err(|e| format!("Cannot scan coordinator state root: {e}"))?
        {
            let entry = entry.map_err(|e| format!("Cannot scan coordinator entry: {e}"))?;
            if !entry
                .file_type()
                .map_err(|e| format!("Cannot inspect coordinator entry: {e}"))?
                .is_dir()
            {
                continue;
            }
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                return Err("Coordinator state contains a non-UTF-8 directory.".into());
            };
            let Some(d) = name.strip_prefix("transaction-") else {
                continue;
            };
            if !digest_ok(d) {
                return Err("Coordinator state contains an invalid transaction directory.".into());
            }
            ids.push(format!("transaction:sha256:{d}"));
        }
        ids.sort();
        let mut out = Vec::new();
        for id in ids {
            out.push(self.reconcile_locked(&id)?)
        }
        Ok(out)
    }
    pub fn reconcile(&self, id: &str) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        let _repo = self.repo_lock()?;
        self.reconcile_locked(id)
    }
    fn reconcile_locked(&self, id: &str) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        let _tx = self.tx_lock(id)?;
        let m = self.load_manifest(id)?;
        let t = self.read_transitions(id)?;
        let state = t
            .last()
            .ok_or("Coordinator journal has no transition.")?
            .state;
        if state.terminal() || state == ChangeSetV2CoordinatorState::Prepared {
            return self.artifact_from(m, t, false, None, None);
        }
        self.rollback(
            &m,
            t,
            "Recovered an interrupted ChangeSet v2 promotion after restart.",
            &mut Noop,
        )
    }
    fn promote_hook(
        &self,
        id: &str,
        c: &dyn Cancellation,
        hook: &mut dyn Hook,
    ) -> ChangeSetV2CoordinatorArtifact {
        let run = (|| -> Result<ChangeSetV2CoordinatorArtifact, String> {
            self.reconcile_all()?;
            let _repo = self.repo_lock()?;
            let _tx = self.tx_lock(id)?;
            let m = self.load_manifest(id)?;
            let mut t = self.read_transitions(id)?;
            let state = t
                .last()
                .ok_or("Coordinator journal has no transition.")?
                .state;
            if state.terminal() {
                return self.artifact_from(m, t, false, None, None);
            }
            if state != ChangeSetV2CoordinatorState::Prepared {
                return Err("Coordinator transaction is not prepared.".into());
            }
            if let Some(reason) = c.reason() {
                return self.rollback(
                    &m,
                    t,
                    &format!("Promotion cancelled before mutation: {reason}"),
                    hook,
                );
            }
            self.require_base(&m)?;
            self.require_clean()?;
            self.require_all_before(&m)?;
            self.require_changed_bounded(&m)?;
            self.append(
                &m.transaction_id,
                &mut t,
                ChangeSetV2CoordinatorState::Promoting,
                None,
                Some("Active-workspace publication started.".into()),
            )?;
            match hook.reach(HookPoint::PromotionStarted) {
                Ok(()) => {}
                Err(HookFailure::Abrupt(e)) => {
                    return self.artifact_from(m, t, false, None, Some(e));
                }
                Err(HookFailure::Ordinary(e)) => return self.rollback(&m, t, &e, hook),
            }
            for (position, index) in m.operation_order.iter().enumerate() {
                if let Some(reason) = c.reason() {
                    return self.rollback(
                        &m,
                        t,
                        &format!("Promotion cancelled during publication: {reason}"),
                        hook,
                    );
                }
                self.require_operation_before(&m.change_set.operations[*index])?;
                self.require_changed_bounded(&m)?;
                self.apply_operation(&m.change_set.operations[*index])?;
                match hook.reach(HookPoint::OperationMutated(position)) {
                    Ok(()) => {}
                    Err(HookFailure::Abrupt(e)) => {
                        return self.artifact_from(m, t, false, None, Some(e));
                    }
                    Err(HookFailure::Ordinary(e)) => return self.rollback(&m, t, &e, hook),
                }
                self.require_operation_after(&m.change_set.operations[*index])?;
                self.append(
                    &m.transaction_id,
                    &mut t,
                    ChangeSetV2CoordinatorState::OperationApplied,
                    Some(
                        u32::try_from(position + 1)
                            .map_err(|_| "Operation sequence overflowed u32.")?,
                    ),
                    None,
                )?;
                match hook.reach(HookPoint::OperationRecorded(position)) {
                    Ok(()) => {}
                    Err(HookFailure::Abrupt(e)) => {
                        return self.artifact_from(m, t, false, None, Some(e));
                    }
                    Err(HookFailure::Ordinary(e)) => return self.rollback(&m, t, &e, hook),
                }
            }
            self.require_all_after(&m)?;
            self.require_changed_bounded(&m)?;
            if let Some(reason) = c.reason() {
                return self.rollback(
                    &m,
                    t,
                    &format!("Promotion cancelled before acknowledgement: {reason}"),
                    hook,
                );
            }
            match hook.reach(HookPoint::BeforePromoted) {
                Ok(()) => {}
                Err(HookFailure::Abrupt(e)) => {
                    return self.artifact_from(m, t, false, None, Some(e));
                }
                Err(HookFailure::Ordinary(e)) => return self.rollback(&m, t, &e, hook),
            }
            self.append(
                &m.transaction_id,
                &mut t,
                ChangeSetV2CoordinatorState::Promoted,
                None,
                Some("ChangeSet v2 promotion durably acknowledged.".into()),
            )?;
            self.artifact_from(m, t, false, None, None)
        })();
        match run {
            Ok(v) => v,
            Err(e) => self.failure_artifact(id, e),
        }
    }
    fn rollback(
        &self,
        m: &Manifest,
        mut t: Vec<ChangeSetV2Transition>,
        reason: &str,
        hook: &mut dyn Hook,
    ) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        let last = t
            .last()
            .ok_or("Coordinator journal has no transition.")?
            .state;
        if last == ChangeSetV2CoordinatorState::Prepared {
            self.append(
                &m.transaction_id,
                &mut t,
                ChangeSetV2CoordinatorState::RolledBack,
                None,
                Some(bound(reason)),
            )?;
            return self.artifact_from(m.clone(), t, true, cancel_reason(reason), None);
        }
        if last != ChangeSetV2CoordinatorState::RollingBack {
            self.append(
                &m.transaction_id,
                &mut t,
                ChangeSetV2CoordinatorState::RollingBack,
                None,
                Some(bound(reason)),
            )?
        }
        if let Err(HookFailure::Abrupt(e)) = hook.reach(HookPoint::RollbackStarted) {
            return self.artifact_from(m.clone(), t, true, cancel_reason(reason), Some(e));
        }
        if let Err(e) = self.require_recoverable(m) {
            self.append(
                &m.transaction_id,
                &mut t,
                ChangeSetV2CoordinatorState::RepairRequired,
                None,
                Some(bound(&e)),
            )?;
            return self.artifact_from(m.clone(), t, true, cancel_reason(reason), Some(e));
        }
        for (position, index) in m.operation_order.iter().enumerate().rev() {
            self.restore_operation(m, &m.change_set.operations[*index])?;
            if let Err(HookFailure::Abrupt(e)) = hook.reach(HookPoint::RollbackRestored(position)) {
                return self.artifact_from(m.clone(), t, true, cancel_reason(reason), Some(e));
            }
        }
        self.require_all_before(m)?;
        if let Err(HookFailure::Abrupt(e)) = hook.reach(HookPoint::BeforeRolledBack) {
            return self.artifact_from(m.clone(), t, true, cancel_reason(reason), Some(e));
        }
        self.append(
            &m.transaction_id,
            &mut t,
            ChangeSetV2CoordinatorState::RolledBack,
            None,
            Some(bound(reason)),
        )?;
        self.artifact_from(m.clone(), t, true, cancel_reason(reason), None)
    }
    fn prepare_manifest(&self, r: &ChangeSetV2Registration) -> Result<Manifest, String> {
        let candidate = fs::canonicalize(&r.candidate_path)
            .map_err(|e| format!("Cannot resolve coordinator candidate: {e}"))?;
        if within(&candidate, &self.config.repository_root) {
            return Err("Coordinator candidate must be outside the governed workspace.".into());
        }
        if r.boundary.change_set_id != r.change_set.change_set_id
            || r.boundary.base_revision.trim().is_empty()
            || r.boundary.snapshot_id != r.change_set.snapshot_id
            || !r.boundary.original_workspace_unchanged
        {
            return Err(
                "Coordinator registration does not match candidate boundary evidence.".into(),
            );
        }
        let identity = RepositoryPathIdentity::inspect(
            &self.config.repository_root,
            &self.config.git_executable,
        )?;
        let validated = validate_change_set_v2(&r.change_set, &identity)?;
        verify_change_set_blobs(&validated, &self.config.blob_store)?;
        self.platform_support(&r.change_set, &identity)?;
        self.require_clean()?;
        if self.head(&self.config.repository_root)? != r.boundary.base_revision {
            return Err(
                "Active repository revision changed before coordinator registration.".into(),
            );
        }
        if workspace_snapshot_id(&self.config.repository_root)? != r.change_set.snapshot_id {
            return Err(
                "Active workspace generation changed before coordinator registration.".into(),
            );
        }
        let mut order = (0..r.change_set.operations.len()).collect::<Vec<_>>();
        order.sort_by_key(|i| {
            serde_json::to_vec(&r.change_set.operations[*i]).expect("operation ordering")
        });
        let root = utf8(&self.config.repository_root, "repository root")?;
        let candidate_text = utf8(&candidate, "candidate path")?;
        let repo_id = sha256(format!("{root}\n{}", r.boundary.base_revision).as_bytes());
        let id = format!(
            "transaction:sha256:{}",
            sha256(
                format!(
                    "{repo_id}\n{}\n{}\n{candidate_text}",
                    r.boundary.boundary_id, r.change_set.change_set_id
                )
                .as_bytes()
            )
        );
        let m = Manifest {
            schema_version: SCHEMA,
            transaction_id: id,
            repository_id: repo_id,
            repository_root: root,
            base_revision: r.boundary.base_revision.clone(),
            workspace_generation: r.change_set.snapshot_id.clone(),
            boundary: r.boundary.clone(),
            candidate_path: candidate_text,
            change_set: r.change_set.clone(),
            operation_order: order,
            created_at_unix_ms: now()?,
        };
        self.validate_manifest(&m)?;
        self.require_all_before(&m)?;
        self.require_candidate_after(&m)?;
        Ok(m)
    }
    fn validate_manifest(&self, m: &Manifest) -> Result<(), String> {
        if m.schema_version != SCHEMA
            || m.repository_root != utf8(&self.config.repository_root, "repository root")?
            || m.repository_id
                != sha256(format!("{}\n{}", m.repository_root, m.base_revision).as_bytes())
            || m.workspace_generation != m.change_set.snapshot_id
            || m.boundary.change_set_id != m.change_set.change_set_id
            || m.boundary.base_revision != m.base_revision
            || m.boundary.snapshot_id != m.workspace_generation
            || change_set_sha256(&m.change_set)
                != m.change_set
                    .change_set_id
                    .strip_prefix("changeset:sha256:")
                    .unwrap_or("")
        {
            return Err("Coordinator manifest failed identity validation.".into());
        }
        let expected = format!(
            "transaction:sha256:{}",
            sha256(
                format!(
                    "{}\n{}\n{}\n{}",
                    m.repository_id,
                    m.boundary.boundary_id,
                    m.change_set.change_set_id,
                    m.candidate_path
                )
                .as_bytes()
            )
        );
        if m.transaction_id != expected {
            return Err("Coordinator transaction identity is invalid.".into());
        }
        let mut order = (0..m.change_set.operations.len()).collect::<Vec<_>>();
        order.sort_by_key(|i| {
            serde_json::to_vec(&m.change_set.operations[*i]).expect("operation ordering")
        });
        if m.operation_order != order {
            return Err("Coordinator operation order is not deterministic.".into());
        }
        let identity = RepositoryPathIdentity::inspect(
            &self.config.repository_root,
            &self.config.git_executable,
        )?;
        validate_change_set_v2(&m.change_set, &identity)?;
        self.platform_support(&m.change_set, &identity)
    }
    fn platform_support(
        &self,
        c: &ChangeSetV2,
        identity: &RepositoryPathIdentity,
    ) -> Result<(), String> {
        for op in &c.operations {
            if let ChangeOperationV2::Move {
                from_path, to_path, ..
            } = op
            {
                if from_path != to_path
                    && identity.identity_for(from_path)? == identity.identity_for(to_path)?
                {
                    return Err("Case-only move promotion is not yet proven on a case-insensitive active workspace.".into());
                }
            }
            #[cfg(windows)] match op{ChangeOperationV2::Create{mode:FileMode::Executable,..}=>return Err("Executable create promotion is not yet proven on Windows active workspaces.".into()),ChangeOperationV2::Replace{before_mode,after_mode,..}if before_mode!=after_mode=>return Err("Executable-mode replacement promotion is not yet proven on Windows active workspaces.".into()),ChangeOperationV2::Move{before_mode,after_mode,..}if *before_mode!=FileMode::Regular||*after_mode!=FileMode::Regular=>return Err("Executable move promotion is not yet proven on Windows active workspaces.".into()),ChangeOperationV2::SetMode{..}=>return Err("Set-mode promotion is not yet proven on Windows active workspaces.".into()),_=>{}}
        }
        Ok(())
    }
    fn write_backups(&self, root: &Path, m: &Manifest) -> Result<(), String> {
        let mut seen = HashSet::new();
        let mut total = 0u64;
        for op in &m.change_set.operations {
            let p = match op {
                ChangeOperationV2::Create { .. } => None,
                ChangeOperationV2::Replace { path, .. }
                | ChangeOperationV2::Delete { path, .. }
                | ChangeOperationV2::SetMode { path, .. } => Some(path.as_str()),
                ChangeOperationV2::Move { from_path, .. } => Some(from_path.as_str()),
            };
            let Some(p) = p else { continue };
            if !seen.insert(p.to_owned()) {
                continue;
            }
            let bytes = read_regular(&self.config.repository_root, p)?;
            let size =
                u64::try_from(bytes.len()).map_err(|_| "Before-image size overflowed u64.")?;
            if size > MAX_BEFORE {
                return Err(format!("Before-image exceeds 1 MiB: {p}."));
            }
            total = total
                .checked_add(size)
                .ok_or("Before-image aggregate overflowed u64.")?;
            if total > MAX_BEFORE_TOTAL {
                return Err("Before-images exceed the 4 MiB aggregate limit.".into());
            }
            write_new(&root.join("before").join(backup_name(p)), &bytes)?
        }
        Ok(())
    }
    fn require_base(&self, m: &Manifest) -> Result<(), String> {
        if self.head(&self.config.repository_root)? != m.base_revision {
            return Err("Active repository revision is stale for this transaction.".into());
        }
        Ok(())
    }
    fn require_clean(&self) -> Result<(), String> {
        if !git(
            &self.config.git_executable,
            &self.config.repository_root,
            &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            "Git coordinator clean-state check",
        )?
        .is_empty()
        {
            return Err(
                "Active workspace must be Git-clean before registration or promotion.".into(),
            );
        }
        Ok(())
    }
    fn require_all_before(&self, m: &Manifest) -> Result<(), String> {
        for op in &m.change_set.operations {
            self.require_operation_before(op)?
        }
        Ok(())
    }
    fn require_operation_before(&self, op: &ChangeOperationV2) -> Result<(), String> {
        match op {
            ChangeOperationV2::Create { path, .. } => self.absent(path),
            ChangeOperationV2::Replace {
                path,
                before_sha256,
                before_mode,
                ..
            }
            | ChangeOperationV2::Delete {
                path,
                before_sha256,
                before_mode,
            }
            | ChangeOperationV2::SetMode {
                path,
                before_sha256,
                before_mode,
                ..
            } => self.present(path, before_sha256, *before_mode),
            ChangeOperationV2::Move {
                from_path,
                to_path,
                before_sha256,
                before_mode,
                ..
            } => {
                self.present(from_path, before_sha256, *before_mode)?;
                self.absent(to_path)
            }
        }
    }
    fn require_operation_after(&self, op: &ChangeOperationV2) -> Result<(), String> {
        match op {
            ChangeOperationV2::Create { path, after, mode } => {
                self.present(path, &after.sha256, *mode)
            }
            ChangeOperationV2::Replace {
                path,
                after,
                after_mode,
                ..
            } => self.present(path, &after.sha256, *after_mode),
            ChangeOperationV2::Delete { path, .. } => self.absent(path),
            ChangeOperationV2::Move {
                from_path,
                to_path,
                before_sha256,
                after,
                after_mode,
                ..
            } => {
                self.absent(from_path)?;
                self.present(
                    to_path,
                    after.as_ref().map_or(before_sha256, |b| &b.sha256),
                    *after_mode,
                )
            }
            ChangeOperationV2::SetMode {
                path,
                before_sha256,
                after_mode,
                ..
            } => self.present(path, before_sha256, *after_mode),
        }
    }
    fn require_all_after(&self, m: &Manifest) -> Result<(), String> {
        for op in &m.change_set.operations {
            self.require_operation_after(op)?
        }
        Ok(())
    }
    fn require_candidate_after(&self, m: &Manifest) -> Result<(), String> {
        let root = Path::new(&m.candidate_path);
        if self.head(root)? != m.base_revision {
            return Err("Coordinator candidate revision changed before registration.".into());
        }
        for op in &m.change_set.operations {
            match op {
                ChangeOperationV2::Create { path, after, mode }
                | ChangeOperationV2::Replace {
                    path,
                    after,
                    after_mode: mode,
                    ..
                } => present_at(
                    root,
                    path,
                    &after.sha256,
                    *mode,
                    &self.config.git_executable,
                )?,
                ChangeOperationV2::Delete { path, .. } => absent_at(root, path)?,
                ChangeOperationV2::Move {
                    from_path,
                    to_path,
                    before_sha256,
                    after,
                    after_mode,
                    ..
                } => {
                    absent_at(root, from_path)?;
                    present_at(
                        root,
                        to_path,
                        after.as_ref().map_or(before_sha256, |b| &b.sha256),
                        *after_mode,
                        &self.config.git_executable,
                    )?
                }
                ChangeOperationV2::SetMode {
                    path,
                    before_sha256,
                    after_mode,
                    ..
                } => present_at(
                    root,
                    path,
                    before_sha256,
                    *after_mode,
                    &self.config.git_executable,
                )?,
            }
        }
        Ok(())
    }
    fn apply_operation(&self, op: &ChangeOperationV2) -> Result<(), String> {
        match op {
            ChangeOperationV2::Create { path, after, mode } => {
                let b = self.config.blob_store.read(after)?;
                publish_new(&self.config.repository_root, path, &b)?;
                set_mode(&self.config.repository_root.join(portable(path)), *mode)
            }
            ChangeOperationV2::Replace {
                path,
                after,
                after_mode,
                ..
            } => {
                let b = self.config.blob_store.read(after)?;
                publish_existing(&self.config.repository_root, path, &b)?;
                set_mode(
                    &self.config.repository_root.join(portable(path)),
                    *after_mode,
                )
            }
            ChangeOperationV2::Delete { path, .. } => {
                remove_path(&self.config.repository_root, path)
            }
            ChangeOperationV2::Move {
                from_path,
                to_path,
                after,
                after_mode,
                ..
            } => {
                let b = match after {
                    Some(v) => self.config.blob_store.read(v)?,
                    None => read_regular(&self.config.repository_root, from_path)?,
                };
                publish_new(&self.config.repository_root, to_path, &b)?;
                set_mode(
                    &self.config.repository_root.join(portable(to_path)),
                    *after_mode,
                )?;
                remove_path(&self.config.repository_root, from_path)
            }
            ChangeOperationV2::SetMode {
                path, after_mode, ..
            } => set_mode(
                &self.config.repository_root.join(portable(path)),
                *after_mode,
            ),
        }
    }
    fn require_recoverable(&self, m: &Manifest) -> Result<(), String> {
        for op in &m.change_set.operations {
            match op {
                ChangeOperationV2::Create { path, after, mode } => absent_or(
                    &self.config.repository_root,
                    path,
                    &after.sha256,
                    *mode,
                    &self.config.git_executable,
                )?,
                ChangeOperationV2::Replace {
                    path,
                    before_sha256,
                    before_mode,
                    after,
                    after_mode,
                } => one_of(
                    &self.config.repository_root,
                    path,
                    &[(before_sha256, *before_mode), (&after.sha256, *after_mode)],
                    &self.config.git_executable,
                )?,
                ChangeOperationV2::Delete {
                    path,
                    before_sha256,
                    before_mode,
                } => absent_or(
                    &self.config.repository_root,
                    path,
                    before_sha256,
                    *before_mode,
                    &self.config.git_executable,
                )?,
                ChangeOperationV2::Move {
                    from_path,
                    to_path,
                    before_sha256,
                    before_mode,
                    after,
                    after_mode,
                } => {
                    absent_or(
                        &self.config.repository_root,
                        from_path,
                        before_sha256,
                        *before_mode,
                        &self.config.git_executable,
                    )?;
                    absent_or(
                        &self.config.repository_root,
                        to_path,
                        after.as_ref().map_or(before_sha256, |b| &b.sha256),
                        *after_mode,
                        &self.config.git_executable,
                    )?
                }
                ChangeOperationV2::SetMode {
                    path,
                    before_sha256,
                    before_mode,
                    after_mode,
                } => one_of(
                    &self.config.repository_root,
                    path,
                    &[(before_sha256, *before_mode), (before_sha256, *after_mode)],
                    &self.config.git_executable,
                )?,
            }
        }
        Ok(())
    }
    fn restore_operation(&self, m: &Manifest, op: &ChangeOperationV2) -> Result<(), String> {
        match op {
            ChangeOperationV2::Create { path, .. } => {
                if observe(
                    &self.config.repository_root,
                    path,
                    &self.config.git_executable,
                )?
                .0 != Seen::Absent
                {
                    remove_path(&self.config.repository_root, path)?;
                    remove_empty(&self.config.repository_root, path)?
                }
                Ok(())
            }
            ChangeOperationV2::Replace {
                path, before_mode, ..
            }
            | ChangeOperationV2::Delete {
                path, before_mode, ..
            }
            | ChangeOperationV2::SetMode {
                path, before_mode, ..
            } => self.restore_backup(m, path, *before_mode),
            ChangeOperationV2::Move {
                from_path,
                to_path,
                before_mode,
                ..
            } => {
                if observe(
                    &self.config.repository_root,
                    to_path,
                    &self.config.git_executable,
                )?
                .0 != Seen::Absent
                {
                    remove_path(&self.config.repository_root, to_path)?;
                    remove_empty(&self.config.repository_root, to_path)?
                }
                self.restore_backup(m, from_path, *before_mode)
            }
        }
    }
    fn restore_backup(&self, m: &Manifest, path: &str, mode: FileMode) -> Result<(), String> {
        let b = read_bounded(
            &self
                .tx_dir(&m.transaction_id)?
                .join("before")
                .join(backup_name(path)),
            MAX_BEFORE,
        )?;
        publish_any(&self.config.repository_root, path, &b)?;
        set_mode(&self.config.repository_root.join(portable(path)), mode)
    }
    fn present(&self, p: &str, d: &str, m: FileMode) -> Result<(), String> {
        present_at(
            &self.config.repository_root,
            p,
            d,
            m,
            &self.config.git_executable,
        )
    }
    fn absent(&self, p: &str) -> Result<(), String> {
        absent_at(&self.config.repository_root, p)
    }
    fn require_changed_bounded(&self, m: &Manifest) -> Result<(), String> {
        let expected = m
            .change_set
            .operations
            .iter()
            .flat_map(paths)
            .collect::<HashSet<_>>();
        let out = git(
            &self.config.git_executable,
            &self.config.repository_root,
            &[
                "status",
                "--porcelain=v1",
                "-z",
                "--untracked-files=all",
                "--no-renames",
            ],
            "Git coordinator changed-path inventory",
        )?;
        for item in out.split(|b| *b == 0).filter(|v| !v.is_empty()) {
            if item.len() < 4 || item[2] != b' ' {
                return Err("Git returned malformed coordinator status evidence.".into());
            }
            let p = std::str::from_utf8(&item[3..])
                .map_err(|_| "Git returned a non-UTF-8 changed path.")?;
            if !expected.contains(p) {
                return Err(format!(
                    "Workspace changed outside the coordinated path set: {p}."
                ));
            }
        }
        Ok(())
    }
    fn append(
        &self,
        id: &str,
        t: &mut Vec<ChangeSetV2Transition>,
        state: ChangeSetV2CoordinatorState,
        op: Option<u32>,
        message: Option<String>,
    ) -> Result<(), String> {
        let sequence =
            u32::try_from(t.len() + 1).map_err(|_| "Transition sequence overflowed u32.")?;
        let value = ChangeSetV2Transition {
            sequence,
            state,
            operation_sequence: op,
            at_unix_ms: now()?,
            message,
        };
        let path = self.tx_dir(id)?.join("transitions.jsonl");
        if fs::metadata(&path)
            .map_err(|e| format!("Cannot inspect coordinator journal: {e}"))?
            .len()
            > MAX_JOURNAL
        {
            return Err("Coordinator journal exceeds 512 KiB.".into());
        }
        let mut bytes = serde_json::to_vec(&value)
            .map_err(|e| format!("Cannot serialize coordinator transition: {e}"))?;
        bytes.push(b'\n');
        let mut f = OpenOptions::new()
            .append(true)
            .open(&path)
            .map_err(|e| format!("Cannot append coordinator journal: {e}"))?;
        f.write_all(&bytes)
            .map_err(|e| format!("Cannot write coordinator transition: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("Cannot sync coordinator transition: {e}"))?;
        t.push(value);
        Ok(())
    }
    fn load_manifest(&self, id: &str) -> Result<Manifest, String> {
        let bytes = read_bounded(&self.tx_dir(id)?.join("manifest.json"), MAX_MANIFEST)?;
        let m: Manifest = serde_json::from_slice(&bytes)
            .map_err(|e| format!("Cannot parse coordinator manifest: {e}"))?;
        if m.transaction_id != id {
            return Err("Coordinator manifest transaction ID mismatch.".into());
        }
        self.validate_manifest(&m)?;
        Ok(m)
    }
    fn read_transitions(&self, id: &str) -> Result<Vec<ChangeSetV2Transition>, String> {
        let path = self.tx_dir(id)?.join("transitions.jsonl");
        let meta =
            fs::metadata(&path).map_err(|e| format!("Cannot inspect coordinator journal: {e}"))?;
        if !meta.is_file() || meta.len() > MAX_JOURNAL {
            return Err("Coordinator journal is not a bounded regular file.".into());
        }
        let f = File::open(path).map_err(|e| format!("Cannot open coordinator journal: {e}"))?;
        let mut out = Vec::new();
        for line in BufReader::new(f).lines() {
            let line = line.map_err(|e| format!("Cannot read coordinator journal: {e}"))?;
            if line.is_empty() {
                return Err("Coordinator journal contains an empty transition.".into());
            }
            let v: ChangeSetV2Transition = serde_json::from_str(&line)
                .map_err(|e| format!("Cannot parse coordinator transition: {e}"))?;
            let expected =
                u32::try_from(out.len() + 1).map_err(|_| "Transition sequence overflowed u32.")?;
            if v.sequence != expected {
                return Err("Coordinator transition sequence is not contiguous.".into());
            }
            out.push(v)
        }
        if out.first().map(|v| v.state) != Some(ChangeSetV2CoordinatorState::Prepared)
            || out
                .iter()
                .take(out.len().saturating_sub(1))
                .any(|v| v.state.terminal())
        {
            return Err("Coordinator transition graph is invalid.".into());
        }
        Ok(out)
    }
    fn artifact(
        &self,
        m: &Manifest,
        recovery: bool,
        cancel: Option<String>,
        failure: Option<String>,
    ) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        self.artifact_from(
            m.clone(),
            self.read_transitions(&m.transaction_id)?,
            recovery,
            cancel,
            failure,
        )
    }
    fn artifact_from(
        &self,
        m: Manifest,
        t: Vec<ChangeSetV2Transition>,
        recovery: bool,
        cancel: Option<String>,
        failure: Option<String>,
    ) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        let state = t
            .last()
            .ok_or("Coordinator journal has no transition.")?
            .state;
        Ok(ChangeSetV2CoordinatorArtifact {
            schema_version: SCHEMA,
            transaction_id: m.transaction_id,
            change_set_id: m.change_set.change_set_id,
            base_revision: m.base_revision,
            state,
            transitions: t,
            recovery_performed: recovery,
            cancellation_reason: cancel,
            failure,
        })
    }
    fn failure_artifact(&self, id: &str, e: String) -> ChangeSetV2CoordinatorArtifact {
        if let Ok(m) = self.load_manifest(id) {
            if let Ok(v) = self.artifact(&m, false, None, Some(e.clone())) {
                return v;
            }
        }
        ChangeSetV2CoordinatorArtifact {
            schema_version: SCHEMA,
            transaction_id: id.into(),
            change_set_id: String::new(),
            base_revision: String::new(),
            state: ChangeSetV2CoordinatorState::RepairRequired,
            transitions: Vec::new(),
            recovery_performed: false,
            cancellation_reason: None,
            failure: Some(e),
        }
    }
    fn head(&self, root: &Path) -> Result<String, String> {
        String::from_utf8(git(
            &self.config.git_executable,
            root,
            &["rev-parse", "HEAD"],
            "Git coordinator HEAD resolution",
        )?)
        .map(|v| v.trim().to_owned())
        .map_err(|_| "Git returned non-UTF-8 HEAD.".into())
    }
    fn repo_lock(&self) -> Result<Lock, String> {
        open_lock(
            &self.config.state_root.join("repository-v2.lock"),
            "repository",
        )
    }
    fn tx_lock(&self, id: &str) -> Result<Lock, String> {
        open_lock(&self.tx_dir(id)?.join("transaction.lock"), "transaction")
    }
    fn tx_dir(&self, id: &str) -> Result<PathBuf, String> {
        Ok(self
            .config
            .state_root
            .join(format!("transaction-{}", tx_digest(id)?)))
    }
    fn cleanup_temps(&self) -> Result<(), String> {
        for entry in fs::read_dir(&self.config.state_root)
            .map_err(|e| format!("Cannot scan coordinator state root: {e}"))?
        {
            let entry = entry.map_err(|e| format!("Cannot scan coordinator entry: {e}"))?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            if name.starts_with(".transaction-")
                && name.ends_with(".tmp")
                && entry
                    .file_type()
                    .map_err(|e| format!("Cannot inspect temporary transaction: {e}"))?
                    .is_dir()
            {
                fs::remove_dir_all(entry.path())
                    .map_err(|e| format!("Cannot remove incomplete transaction: {e}"))?
            }
        }
        Ok(())
    }
}

fn paths(op: &ChangeOperationV2) -> Vec<&str> {
    match op {
        ChangeOperationV2::Create { path, .. }
        | ChangeOperationV2::Replace { path, .. }
        | ChangeOperationV2::Delete { path, .. }
        | ChangeOperationV2::SetMode { path, .. } => vec![path],
        ChangeOperationV2::Move {
            from_path, to_path, ..
        } => vec![from_path, to_path],
    }
}
fn cancel_reason(r: &str) -> Option<String> {
    r.strip_prefix("Promotion cancelled").map(|_| bound(r))
}
fn absent_or(root: &Path, p: &str, d: &str, m: FileMode, g: &Path) -> Result<(), String> {
    match observe(root, p, g)? {
        (Seen::Absent, None) => Ok(()),
        (Seen::Present(mode), Some(actual)) if actual == d && mode == m => Ok(()),
        _ => Err(format!("Recovery found divergent content or mode: {p}.")),
    }
}
fn one_of(root: &Path, p: &str, expected: &[(&String, FileMode)], g: &Path) -> Result<(), String> {
    let (state, d) = observe(root, p, g)?;
    let Seen::Present(mode) = state else {
        return Err(format!("Recovery expected a present path: {p}."));
    };
    let d = d.expect("present digest");
    if expected.iter().any(|(v, m)| d == v.as_str() && mode == *m) {
        Ok(())
    } else {
        Err(format!("Recovery found divergent content or mode: {p}."))
    }
}
fn present_at(root: &Path, p: &str, d: &str, m: FileMode, g: &Path) -> Result<(), String> {
    match observe(root, p, g)? {
        (Seen::Present(mode), Some(actual)) if actual == d && mode == m => Ok(()),
        (Seen::Absent, _) => Err(format!("Expected path is absent: {p}.")),
        _ => Err(format!(
            "Path content or mode does not match transaction evidence: {p}."
        )),
    }
}
fn absent_at(root: &Path, p: &str) -> Result<(), String> {
    if metadata(root, p)?.is_none() {
        Ok(())
    } else {
        Err(format!("Expected path is present: {p}."))
    }
}
fn observe(root: &Path, p: &str, g: &Path) -> Result<(Seen, Option<String>), String> {
    let Some(meta) = metadata(root, p)? else {
        return Ok((Seen::Absent, None));
    };
    if !meta.is_file() || meta.file_type().is_symlink() {
        return Err(format!("Transaction path is not a regular file: {p}."));
    }
    let b = fs::read(root.join(portable(p)))
        .map_err(|e| format!("Cannot read transaction path {p}: {e}"))?;
    let mode = observed_mode(root, p, &meta, g)?;
    Ok((Seen::Present(mode), Some(sha256(&b))))
}
#[cfg(unix)]
fn observed_mode(_: &Path, _: &str, m: &fs::Metadata, _: &Path) -> Result<FileMode, String> {
    use std::os::unix::fs::PermissionsExt;
    Ok(if m.permissions().mode() & 0o111 == 0 {
        FileMode::Regular
    } else {
        FileMode::Executable
    })
}
#[cfg(windows)]
fn observed_mode(root: &Path, p: &str, _: &fs::Metadata, g: &Path) -> Result<FileMode, String> {
    let out = git_os(
        g,
        root,
        &[
            OsString::from("ls-files"),
            OsString::from("--stage"),
            OsString::from("--"),
            OsString::from(p),
        ],
        "Git coordinator mode inspection",
    )?;
    if out.is_empty() {
        return Ok(FileMode::Regular);
    }
    let mode = std::str::from_utf8(&out)
        .map_err(|_| "Git returned non-UTF-8 mode evidence.")?
        .split_ascii_whitespace()
        .next()
        .unwrap_or("");
    match mode {
        "100644" => Ok(FileMode::Regular),
        "100755" => Ok(FileMode::Executable),
        _ => Err(format!("Unsupported Git mode for {p}: {mode}.")),
    }
}
fn metadata(root: &Path, p: &str) -> Result<Option<fs::Metadata>, String> {
    super::validate_workspace_relative_path(p)?;
    let rel = portable(p);
    let parts = rel.components().collect::<Vec<_>>();
    let mut current = root.to_path_buf();
    for (i, c) in parts.iter().enumerate() {
        let Component::Normal(part) = c else {
            return Err(format!("Invalid transaction path: {p}."));
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(m) => {
                if m.file_type().is_symlink() {
                    return Err(format!("Transaction path traverses a symlink: {p}."));
                }
                if i + 1 < parts.len() && !m.is_dir() {
                    return Err(format!("Transaction parent is not a directory: {p}."));
                }
                if i + 1 == parts.len() {
                    return Ok(Some(m));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("Cannot inspect transaction path {p}: {e}")),
        }
    }
    Ok(None)
}
fn read_regular(root: &Path, p: &str) -> Result<Vec<u8>, String> {
    let m = metadata(root, p)?.ok_or_else(|| format!("Transaction path is absent: {p}."))?;
    if !m.is_file() {
        return Err(format!("Transaction path is not a regular file: {p}."));
    }
    fs::read(root.join(portable(p))).map_err(|e| format!("Cannot read transaction path {p}: {e}"))
}
fn publish_new(root: &Path, p: &str, b: &[u8]) -> Result<(), String> {
    if metadata(root, p)?.is_some() {
        return Err(format!("Transaction create target already exists: {p}."));
    }
    create_parents(root, p)?;
    atomic_write(&root.join(portable(p)), b, false)
}
fn publish_existing(root: &Path, p: &str, b: &[u8]) -> Result<(), String> {
    let m = metadata(root, p)?
        .ok_or_else(|| format!("Transaction replacement target is absent: {p}."))?;
    if !m.is_file() {
        return Err(format!(
            "Transaction replacement target is not a file: {p}."
        ));
    }
    atomic_write(&root.join(portable(p)), b, true)
}
fn publish_any(root: &Path, p: &str, b: &[u8]) -> Result<(), String> {
    match metadata(root, p)? {
        Some(m) if m.is_file() => publish_existing(root, p, b),
        Some(_) => Err(format!("Recovery target is not a regular file: {p}.")),
        None => publish_new(root, p, b),
    }
}
fn atomic_write(target: &Path, b: &[u8], replace: bool) -> Result<(), String> {
    let parent = target.parent().ok_or("Transaction target has no parent.")?;
    let name = target
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or("Transaction filename is not UTF-8.")?;
    let tmp = parent.join(format!(
        ".{name}.forge-v2-{}-{}.tmp",
        std::process::id(),
        now()?
    ));
    write_new(&tmp, b)?;
    let result = if replace {
        replace_file(target, &tmp)
    } else {
        fs::rename(&tmp, target).map_err(|e| format!("Cannot publish new transaction path: {e}"))
    };
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result?;
    sync_dir(parent)
}
#[cfg(unix)]
fn replace_file(target: &Path, replacement: &Path) -> Result<(), String> {
    fs::rename(replacement, target)
        .map_err(|e| format!("Cannot atomically replace transaction target: {e}"))
}
#[cfg(windows)]
fn replace_file(target: &Path, replacement: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn ReplaceFileW(
            a: *const u16,
            b: *const u16,
            c: *const u16,
            d: u32,
            e: *mut core::ffi::c_void,
            f: *mut core::ffi::c_void,
        ) -> i32;
    }
    let a = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let b = replacement
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let ok = unsafe {
        ReplaceFileW(
            a.as_ptr(),
            b.as_ptr(),
            std::ptr::null(),
            1,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        Err(format!(
            "Cannot atomically replace transaction target: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}
fn remove_path(root: &Path, p: &str) -> Result<(), String> {
    let m =
        metadata(root, p)?.ok_or_else(|| format!("Transaction removal target is absent: {p}."))?;
    if !m.is_file() {
        return Err(format!("Transaction removal target is not a file: {p}."));
    }
    let target = root.join(portable(p));
    fs::remove_file(&target).map_err(|e| format!("Cannot remove transaction path {p}: {e}"))?;
    sync_dir(target.parent().ok_or("Removal target has no parent.")?)
}
fn create_parents(root: &Path, p: &str) -> Result<(), String> {
    let rel = portable(p);
    let parent = rel.parent().unwrap_or(Path::new(""));
    let mut current = root.to_path_buf();
    for c in parent.components() {
        let Component::Normal(part) = c else {
            return Err(format!("Invalid transaction parent: {p}."));
        };
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(m) if m.is_dir() && !m.file_type().is_symlink() => {}
            Ok(_) => return Err(format!("Transaction parent is not a safe directory: {p}.")),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .map_err(|e| format!("Cannot create transaction parent: {e}"))?;
                sync_dir(current.parent().ok_or("Parent has no parent.")?)?
            }
            Err(e) => return Err(format!("Cannot inspect transaction parent: {e}")),
        }
    }
    Ok(())
}
fn remove_empty(root: &Path, p: &str) -> Result<(), String> {
    let mut current = root.join(portable(p));
    while let Some(parent) = current.parent() {
        if parent == root {
            break;
        }
        match fs::remove_dir(parent) {
            Ok(()) => {
                sync_dir(parent.parent().unwrap_or(root))?;
                current = parent.to_path_buf()
            }
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::DirectoryNotEmpty | std::io::ErrorKind::NotFound
                ) =>
            {
                break;
            }
            Err(e) => return Err(format!("Cannot remove empty transaction parent: {e}")),
        }
    }
    Ok(())
}
#[cfg(unix)]
fn set_mode(p: &Path, m: FileMode) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let meta = fs::metadata(p).map_err(|e| format!("Cannot inspect transaction mode: {e}"))?;
    let cur = meta.permissions().mode();
    let next = match m {
        FileMode::Regular => cur & !0o111,
        FileMode::Executable => cur | 0o111,
    };
    fs::set_permissions(p, fs::Permissions::from_mode(next))
        .map_err(|e| format!("Cannot set transaction mode: {e}"))
}
#[cfg(windows)]
fn set_mode(p: &Path, _: FileMode) -> Result<(), String> {
    if p.is_file() {
        Ok(())
    } else {
        Err(format!(
            "Transaction mode target is not a file: {}.",
            p.display()
        ))
    }
}
fn write_json(p: &Path, v: &impl Serialize) -> Result<(), String> {
    let b = serde_json::to_vec_pretty(v)
        .map_err(|e| format!("Cannot serialize coordinator state: {e}"))?;
    write_new(p, &b)
}
fn write_journal(p: &Path, v: &ChangeSetV2Transition) -> Result<(), String> {
    let mut b = serde_json::to_vec(v).map_err(|e| format!("Cannot serialize transition: {e}"))?;
    b.push(b'\n');
    write_new(p, &b)
}
fn write_new(p: &Path, b: &[u8]) -> Result<(), String> {
    let mut f = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(p)
        .map_err(|e| format!("Cannot create coordinator state {}: {e}", p.display()))?;
    f.write_all(b)
        .map_err(|e| format!("Cannot write coordinator state {}: {e}", p.display()))?;
    f.sync_all()
        .map_err(|e| format!("Cannot sync coordinator state {}: {e}", p.display()))
}
fn read_bounded(p: &Path, max: u64) -> Result<Vec<u8>, String> {
    let m = fs::metadata(p)
        .map_err(|e| format!("Cannot inspect coordinator state {}: {e}", p.display()))?;
    if !m.is_file() || m.len() > max {
        return Err(format!(
            "Coordinator state is not a bounded regular file: {}.",
            p.display()
        ));
    }
    fs::read(p).map_err(|e| format!("Cannot read coordinator state {}: {e}", p.display()))
}
fn open_lock(p: &Path, label: &str) -> Result<Lock, String> {
    let f = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(p)
        .map_err(|e| format!("Cannot open coordinator {label} lock: {e}"))?;
    f.try_lock()
        .map_err(|e| format!("Coordinator {label} is already being modified: {e}"))?;
    Ok(Lock(f))
}
fn git(exe: &Path, root: &Path, args: &[&str], label: &str) -> Result<Vec<u8>, String> {
    let a = args.iter().map(OsString::from).collect::<Vec<_>>();
    git_os(exe, root, &a, label)
}
fn git_os(exe: &Path, root: &Path, args: &[OsString], label: &str) -> Result<Vec<u8>, String> {
    let out = Command::new(exe)
        .current_dir(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("Could not start Git: {e}"))?;
    if out.stdout.len().saturating_add(out.stderr.len()) > MAX_GIT {
        return Err("Git output exceeded 32 MiB.".into());
    }
    if !out.status.success() {
        return Err(format!(
            "{label} failed: {}",
            bound(&String::from_utf8_lossy(&out.stderr))
        ));
    }
    Ok(out.stdout)
}
fn backup_name(p: &str) -> String {
    format!("{}.bin", sha256(p.as_bytes()))
}
fn tx_digest(id: &str) -> Result<&str, String> {
    let d = id
        .strip_prefix("transaction:sha256:")
        .ok_or("Transaction ID prefix is invalid.")?;
    if !digest_ok(d) {
        return Err("Transaction ID digest is invalid.".into());
    }
    Ok(d)
}
fn digest_ok(v: &str) -> bool {
    v.len() == 64
        && v.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn portable(p: &str) -> PathBuf {
    p.split('/').collect()
}
fn utf8(p: &Path, l: &str) -> Result<String, String> {
    p.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Coordinator {l} is not UTF-8."))
}
fn now() -> Result<u64, String> {
    u64::try_from(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| format!("Clock error: {e}"))?
            .as_millis(),
    )
    .map_err(|_| "Timestamp overflowed u64.".into())
}
fn bound(v: &str) -> String {
    v.chars().take(2000).collect()
}
fn sync_dir(p: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        File::open(p)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("Cannot sync coordinator directory: {e}"))?
    }
    #[cfg(windows)]
    {
        let _ = p;
    }
    Ok(())
}
fn within(c: &Path, r: &Path) -> bool {
    #[cfg(windows)]
    {
        let c = c.to_string_lossy().to_lowercase();
        let r = r.to_string_lossy().to_lowercase();
        c == r
            || c.strip_prefix(&r)
                .is_some_and(|s| s.starts_with('\\') || s.starts_with('/'))
    }
    #[cfg(not(windows))]
    {
        c == r || c.starts_with(r)
    }
}
#[cfg(test)]
mod tests;
