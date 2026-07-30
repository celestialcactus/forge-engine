use std::{
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, ExitStatus},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{BoundedTextEvidence, workspace_snapshot_id};

use super::{
    ChangeOperationV2, ChangeSetV2, FileBlobStore, FileMode, PathIdentityResolver,
    ValidatedChangeSetV2, validate_change_set_v2, validate_workspace_relative_path,
    verify_change_set_blobs,
};

const MAX_GIT_OUTPUT_BYTES: usize = 32 * 1_048_576;
const MIN_DIFF_BYTES: usize = 1_000;
const MAX_DIFF_BYTES: usize = 1_000_000;
static CANDIDATE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct CandidateOperationAdapterConfig {
    pub repository_root: PathBuf,
    pub candidate_parent: PathBuf,
    pub expected_base_revision: String,
    pub git_executable: PathBuf,
    pub blob_store: FileBlobStore,
    pub max_diff_bytes: usize,
}

impl CandidateOperationAdapterConfig {
    pub fn new(
        repository_root: impl Into<PathBuf>,
        candidate_parent: impl Into<PathBuf>,
        expected_base_revision: impl Into<String>,
        blob_store: FileBlobStore,
    ) -> Self {
        Self {
            repository_root: repository_root.into(),
            candidate_parent: candidate_parent.into(),
            expected_base_revision: expected_base_revision.into(),
            git_executable: PathBuf::from("git"),
            blob_store,
            max_diff_bytes: 100_000,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateOperationBoundaryEvidence {
    pub boundary_id: String,
    pub change_set_id: String,
    pub base_revision: String,
    pub snapshot_id: String,
    pub original_workspace_unchanged: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateOperationKind {
    Create,
    Replace,
    Delete,
    Move,
    SetMode,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateOperationEvidence {
    pub sequence: u32,
    pub kind: CandidateOperationKind,
    pub paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_mode: Option<FileMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_mode: Option<FileMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blob_sha256: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateOperationApplyEvidence {
    pub boundary_id: String,
    pub change_set_id: String,
    pub base_revision: String,
    pub original_workspace_unchanged: bool,
    pub operations: Vec<CandidateOperationEvidence>,
    pub diff: BoundedTextEvidence,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepositoryFileIdentityEvidence {
    pub canonical_path: String,
    pub sha256: String,
    pub mode: FileMode,
}

#[derive(Clone, Debug)]
pub struct RepositoryPathIdentity {
    case_sensitive: bool,
    tracked_by_identity: HashMap<String, String>,
}

impl RepositoryPathIdentity {
    pub fn inspect(repository_root: &Path, git_executable: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(repository_root)
            .map_err(|error| format!("Cannot resolve repository root: {error}"))?;
        let ignore_case =
            git_boolean_config(&root, git_executable, "core.ignorecase")?.unwrap_or(false);
        let output = successful_git(
            git_executable,
            &root,
            &[
                OsString::from("ls-files"),
                OsString::from("-z"),
                OsString::from("--cached"),
            ],
            "Git tracked-path inventory",
        )?;
        let mut tracked_by_identity = HashMap::new();
        for path in nul_paths(&output)? {
            validate_platform_path(&path)?;
            let identity = fold_path(&path, !ignore_case);
            if let Some(existing) = tracked_by_identity.insert(identity, path.clone()) {
                return Err(format!(
                    "Repository path identity is ambiguous: {existing} and {path}."
                ));
            }
        }
        Ok(Self {
            case_sensitive: !ignore_case,
            tracked_by_identity,
        })
    }

    pub fn case_sensitive(&self) -> bool {
        self.case_sensitive
    }

    pub fn canonical_path(&self, path: &str) -> Result<String, String> {
        let identity = self.identity_for(path)?;
        Ok(self
            .tracked_by_identity
            .get(&identity)
            .cloned()
            .unwrap_or_else(|| path.to_owned()))
    }
    pub fn observe_tracked_file(
        &self,
        repository_root: &Path,
        git_executable: &Path,
        path: &str,
    ) -> Result<RepositoryFileIdentityEvidence, String> {
        let canonical_path = self
            .tracked_path(path)?
            .ok_or_else(|| format!("Path is not tracked by Git: {path}."))?
            .to_owned();
        let file = regular_file_without_symlinks(repository_root, &canonical_path)?;
        let bytes = fs::read(&file)
            .map_err(|error| format!("Cannot read tracked file {canonical_path}: {error}"))?;
        Ok(RepositoryFileIdentityEvidence {
            sha256: hex_digest(&bytes),
            mode: tracked_mode(git_executable, repository_root, &canonical_path)?,
            canonical_path,
        })
    }

    fn tracked_path(&self, path: &str) -> Result<Option<&str>, String> {
        let identity = self.identity_for(path)?;
        Ok(self.tracked_by_identity.get(&identity).map(String::as_str))
    }
}

impl PathIdentityResolver for RepositoryPathIdentity {
    fn identity_for(&self, workspace_relative_path: &str) -> Result<String, String> {
        validate_platform_path(workspace_relative_path)?;
        let identity = fold_path(workspace_relative_path, self.case_sensitive);
        if !self.case_sensitive
            && !workspace_relative_path.is_ascii()
            && !self.tracked_by_identity.contains_key(&identity)
        {
            return Err(format!(
                "New non-ASCII path identity is not yet supported on a case-insensitive repository: {workspace_relative_path}."
            ));
        }
        Ok(identity)
    }
}

#[derive(Clone, Debug)]
struct PreparedCandidate {
    evidence: CandidateOperationBoundaryEvidence,
    candidate_path: PathBuf,
    change_set: ChangeSetV2,
    validated: ValidatedChangeSetV2,
    repository_identity: RepositoryPathIdentity,
}

#[derive(Debug)]
struct CommandResult {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

#[derive(Clone, Debug)]
struct ObservedFile {
    path: String,
    sha256: String,
    mode: FileMode,
}

pub struct ChangeSetV2CandidateAdapter {
    config: CandidateOperationAdapterConfig,
    boundary: Option<PreparedCandidate>,
}

impl ChangeSetV2CandidateAdapter {
    pub fn try_new(mut config: CandidateOperationAdapterConfig) -> Result<Self, String> {
        if config.expected_base_revision.trim().is_empty()
            || config.expected_base_revision.len() > 128
            || config.expected_base_revision.chars().any(char::is_control)
        {
            return Err("expected_base_revision must be bounded and non-empty.".to_owned());
        }
        if !(MIN_DIFF_BYTES..=MAX_DIFF_BYTES).contains(&config.max_diff_bytes) {
            return Err(format!(
                "max_diff_bytes must be from {MIN_DIFF_BYTES} to {MAX_DIFF_BYTES}."
            ));
        }
        config.repository_root = fs::canonicalize(&config.repository_root)
            .map_err(|error| format!("Cannot resolve repository root: {error}"))?;
        fs::create_dir_all(&config.candidate_parent)
            .map_err(|error| format!("Cannot create candidate parent: {error}"))?;
        config.candidate_parent = fs::canonicalize(&config.candidate_parent)
            .map_err(|error| format!("Cannot resolve candidate parent: {error}"))?;
        fs::create_dir_all(config.blob_store.root())
            .map_err(|error| format!("Cannot create blob-store root: {error}"))?;
        let blob_root = fs::canonicalize(config.blob_store.root())
            .map_err(|error| format!("Cannot resolve blob-store root: {error}"))?;
        if path_is_within(&config.candidate_parent, &config.repository_root)
            || path_is_within(&blob_root, &config.repository_root)
        {
            return Err(
                "candidate_parent and blob_store must be outside the governed workspace."
                    .to_owned(),
            );
        }
        if path_is_within(&config.candidate_parent, &blob_root)
            || path_is_within(&blob_root, &config.candidate_parent)
        {
            return Err("candidate_parent and blob_store must not overlap.".to_owned());
        }
        successful_git(
            &config.git_executable,
            &config.repository_root,
            &[
                OsString::from("rev-parse"),
                OsString::from("--show-toplevel"),
            ],
            "Git repository discovery",
        )?;
        Ok(Self {
            config,
            boundary: None,
        })
    }

    pub fn candidate_path(&self) -> Option<&Path> {
        self.boundary
            .as_ref()
            .map(|boundary| boundary.candidate_path.as_path())
    }

    pub fn prepare(
        &mut self,
        change_set: &ChangeSetV2,
    ) -> Result<CandidateOperationBoundaryEvidence, String> {
        if self.boundary.is_some() {
            return Err("This adapter already owns a candidate boundary.".to_owned());
        }
        self.require_clean_repository(&self.config.repository_root)?;
        let base_revision = self.head_revision(&self.config.repository_root)?;
        if base_revision != self.config.expected_base_revision {
            return Err(format!(
                "HEAD revision {base_revision} does not match expected base {}.",
                self.config.expected_base_revision
            ));
        }
        let snapshot_id = workspace_snapshot_id(&self.config.repository_root)?;
        if snapshot_id != change_set.snapshot_id {
            return Err(format!(
                "Workspace snapshot {snapshot_id} does not match ChangeSet snapshot {}.",
                change_set.snapshot_id
            ));
        }
        let repository_identity = RepositoryPathIdentity::inspect(
            &self.config.repository_root,
            &self.config.git_executable,
        )?;
        let validated = validate_change_set_v2(change_set, &repository_identity)?;
        verify_change_set_blobs(&validated, &self.config.blob_store)?;
        self.validate_preconditions(
            &self.config.repository_root,
            change_set,
            &repository_identity,
        )?;

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("System clock cannot identify a candidate: {error}"))?
            .as_nanos();
        let sequence = CANDIDATE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let short_id = change_set
            .change_set_id
            .trim_start_matches("changeset:sha256:")
            .chars()
            .take(16)
            .collect::<String>();
        let candidate_path = self.config.candidate_parent.join(format!(
            "forge-v2-{short_id}-{}-{unique}-{sequence}",
            std::process::id()
        ));
        let boundary_id = format!("worktree:v2:{short_id}:{unique}:{sequence}");
        successful_git(
            &self.config.git_executable,
            &self.config.repository_root,
            &[
                OsString::from("worktree"),
                OsString::from("add"),
                OsString::from("--quiet"),
                OsString::from("--detach"),
                git_path(&candidate_path),
                OsString::from(&base_revision),
            ],
            "Git v2 candidate worktree creation",
        )?;

        let evidence = CandidateOperationBoundaryEvidence {
            boundary_id,
            change_set_id: change_set.change_set_id.clone(),
            base_revision: base_revision.clone(),
            snapshot_id,
            original_workspace_unchanged: true,
        };
        let prepared = PreparedCandidate {
            evidence: evidence.clone(),
            candidate_path,
            change_set: change_set.clone(),
            validated,
            repository_identity,
        };
        let validation = (|| -> Result<(), String> {
            if self.head_revision(&prepared.candidate_path)? != base_revision {
                return Err("Candidate worktree resolved a different base revision.".to_owned());
            }
            self.validate_preconditions(
                &prepared.candidate_path,
                &prepared.change_set,
                &prepared.repository_identity,
            )?;
            if !self.original_workspace_unchanged(&prepared)? {
                return Err(
                    "Original workspace changed during v2 candidate preparation.".to_owned(),
                );
            }
            Ok(())
        })();
        if let Err(error) = validation {
            return match self.cleanup_candidate(&prepared) {
                Ok(_) => Err(error),
                Err(cleanup) => Err(format!("{error} Candidate cleanup also failed: {cleanup}")),
            };
        }
        self.boundary = Some(prepared);
        Ok(evidence)
    }

    pub fn apply(
        &mut self,
        boundary: &CandidateOperationBoundaryEvidence,
        change_set: &ChangeSetV2,
    ) -> Result<CandidateOperationApplyEvidence, String> {
        let prepared = self.matching_boundary(boundary)?.clone();
        if change_set != &prepared.change_set
            || change_set.change_set_id != boundary.change_set_id
            || prepared.validated.change_set_sha256 != super::change_set_sha256(change_set)
        {
            return Err("ChangeSet changed after candidate preparation.".to_owned());
        }
        let result = (|| -> Result<CandidateOperationApplyEvidence, String> {
            verify_change_set_blobs(&prepared.validated, &self.config.blob_store)?;
            if !self.original_workspace_unchanged(&prepared)? {
                return Err(
                    "Original workspace changed before v2 candidate application.".to_owned(),
                );
            }
            self.validate_preconditions(
                &prepared.candidate_path,
                change_set,
                &prepared.repository_identity,
            )?;

            let mut operations = change_set
                .operations
                .iter()
                .map(|operation| {
                    serde_json::to_vec(operation)
                        .map(|sort_key| (sort_key, operation))
                        .map_err(|error| {
                            format!("Cannot encode ChangeSet v2 operation ordering key: {error}")
                        })
                })
                .collect::<Result<Vec<_>, _>>()?;
            operations.sort_by(|left, right| left.0.cmp(&right.0));
            let mut evidence = Vec::with_capacity(operations.len());
            for (index, (_, operation)) in operations.into_iter().enumerate() {
                self.apply_operation(&prepared, operation)?;
                evidence.push(
                    self.operation_evidence(
                        &prepared,
                        operation,
                        u32::try_from(index + 1)
                            .map_err(|_| "Operation sequence overflowed u32.".to_owned())?,
                    )?,
                );
            }
            self.require_exact_candidate_paths(&prepared)?;
            self.verify_results(&prepared)?;
            if !self.original_workspace_unchanged(&prepared)? {
                return Err(
                    "Original workspace changed during v2 candidate application.".to_owned(),
                );
            }
            Ok(CandidateOperationApplyEvidence {
                boundary_id: prepared.evidence.boundary_id.clone(),
                change_set_id: prepared.evidence.change_set_id.clone(),
                base_revision: prepared.evidence.base_revision.clone(),
                original_workspace_unchanged: true,
                operations: evidence,
                diff: self.candidate_diff(&prepared)?,
            })
        })();
        if let Err(error) = result {
            let cleanup = self.cleanup_candidate(&prepared);
            self.boundary = None;
            return match cleanup {
                Ok(_) => Err(error),
                Err(cleanup_error) => Err(format!(
                    "{error} Candidate recovery also failed: {cleanup_error}"
                )),
            };
        }
        result
    }

    pub fn discard(
        &mut self,
        boundary: &CandidateOperationBoundaryEvidence,
    ) -> Result<String, String> {
        let prepared = self.matching_boundary(boundary)?.clone();
        let message = self.cleanup_candidate(&prepared)?;
        self.boundary = None;
        if !self.original_workspace_unchanged(&prepared)? {
            return Err(
                "V2 candidate was discarded, but the original workspace changed.".to_owned(),
            );
        }
        Ok(message)
    }

    fn matching_boundary(
        &self,
        evidence: &CandidateOperationBoundaryEvidence,
    ) -> Result<&PreparedCandidate, String> {
        let prepared = self
            .boundary
            .as_ref()
            .ok_or_else(|| "No v2 candidate boundary is prepared.".to_owned())?;
        if &prepared.evidence != evidence {
            return Err("Boundary evidence does not match the prepared v2 candidate.".to_owned());
        }
        Ok(prepared)
    }

    fn validate_preconditions(
        &self,
        root: &Path,
        change_set: &ChangeSetV2,
        identity: &RepositoryPathIdentity,
    ) -> Result<(), String> {
        for operation in &change_set.operations {
            match operation {
                ChangeOperationV2::Create { path, .. } => {
                    self.require_new_target(root, path, identity)?;
                }
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
                } => {
                    let observed = self.observe_tracked_file(root, path, identity)?;
                    require_before(&observed, before_sha256, *before_mode)?;
                }
                ChangeOperationV2::Move {
                    from_path,
                    to_path,
                    before_sha256,
                    before_mode,
                    ..
                } => {
                    let observed = self.observe_tracked_file(root, from_path, identity)?;
                    require_before(&observed, before_sha256, *before_mode)?;
                    let from_identity = identity.identity_for(from_path)?;
                    let to_identity = identity.identity_for(to_path)?;
                    if from_identity != to_identity {
                        self.require_new_target(root, to_path, identity)?;
                    } else if identity.canonical_path(from_path)? != *from_path {
                        return Err(format!(
                            "Move source is not the canonical tracked path: {from_path}."
                        ));
                    }
                }
            }
        }
        Ok(())
    }

    fn observe_tracked_file(
        &self,
        root: &Path,
        path: &str,
        identity: &RepositoryPathIdentity,
    ) -> Result<ObservedFile, String> {
        let canonical = identity
            .tracked_path(path)?
            .ok_or_else(|| format!("Operation source is not tracked: {path}."))?;
        if canonical != path {
            return Err(format!(
                "Operation source must use canonical repository spelling {canonical}, not {path}."
            ));
        }
        let absolute = regular_file_without_symlinks(root, path)?;
        let bytes = fs::read(&absolute)
            .map_err(|error| format!("Cannot read candidate operand {path}: {error}"))?;
        let mode = tracked_mode(&self.config.git_executable, root, path)?;
        Ok(ObservedFile {
            path: path.to_owned(),
            sha256: hex_digest(&Sha256::digest(bytes)),
            mode,
        })
    }

    fn require_new_target(
        &self,
        root: &Path,
        path: &str,
        identity: &RepositoryPathIdentity,
    ) -> Result<(), String> {
        if let Some(existing) = identity.tracked_path(path)? {
            return Err(format!(
                "Create or move target collides with tracked path {existing}: {path}."
            ));
        }
        require_safe_parent(root, path)?;
        match fs::symlink_metadata(root.join(path_from_portable(path))) {
            Ok(_) => return Err(format!("Create or move target already exists: {path}.")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot inspect candidate target {path}: {error}")),
        }
        if git_path_is_ignored(&self.config.git_executable, root, path)? {
            return Err(format!(
                "Create or move target is ignored by Git policy: {path}."
            ));
        }
        Ok(())
    }

    fn apply_operation(
        &self,
        prepared: &PreparedCandidate,
        operation: &ChangeOperationV2,
    ) -> Result<(), String> {
        let root = &prepared.candidate_path;
        match operation {
            ChangeOperationV2::Create { path, after, mode } => {
                create_parent_directories(root, path)?;
                let bytes = self.config.blob_store.read(after)?;
                write_new_synced(&root.join(path_from_portable(path)), &bytes)?;
                set_working_mode(&root.join(path_from_portable(path)), *mode)?;
                self.git_add(root, &[path])?;
                self.set_index_mode(root, path, *mode)
            }
            ChangeOperationV2::Replace {
                path,
                after,
                after_mode,
                ..
            } => {
                let bytes = self.config.blob_store.read(after)?;
                write_existing_synced(&root.join(path_from_portable(path)), &bytes)?;
                set_working_mode(&root.join(path_from_portable(path)), *after_mode)?;
                self.set_index_mode(root, path, *after_mode)
            }
            ChangeOperationV2::Delete { path, .. } => {
                fs::remove_file(root.join(path_from_portable(path)))
                    .map_err(|error| format!("Cannot delete v2 candidate path {path}: {error}"))?;
                self.git_add(root, &[path])
            }
            ChangeOperationV2::Move {
                from_path,
                to_path,
                after,
                after_mode,
                ..
            } => {
                create_parent_directories(root, to_path)?;
                move_path(
                    &root.join(path_from_portable(from_path)),
                    &root.join(path_from_portable(to_path)),
                )?;
                if let Some(blob) = after {
                    let bytes = self.config.blob_store.read(blob)?;
                    write_existing_synced(&root.join(path_from_portable(to_path)), &bytes)?;
                }
                set_working_mode(&root.join(path_from_portable(to_path)), *after_mode)?;
                self.git_add(root, &[from_path, to_path])?;
                self.set_index_mode(root, to_path, *after_mode)
            }
            ChangeOperationV2::SetMode {
                path, after_mode, ..
            } => {
                set_working_mode(&root.join(path_from_portable(path)), *after_mode)?;
                self.set_index_mode(root, path, *after_mode)
            }
        }
    }

    fn operation_evidence(
        &self,
        prepared: &PreparedCandidate,
        operation: &ChangeOperationV2,
        sequence: u32,
    ) -> Result<CandidateOperationEvidence, String> {
        let canonical = |path: &str| prepared.repository_identity.canonical_path(path);
        Ok(match operation {
            ChangeOperationV2::Create { path, after, mode } => CandidateOperationEvidence {
                sequence,
                kind: CandidateOperationKind::Create,
                paths: vec![canonical(path)?],
                before_sha256: None,
                after_sha256: Some(after.sha256.clone()),
                before_mode: None,
                after_mode: Some(*mode),
                blob_sha256: Some(after.sha256.clone()),
            },
            ChangeOperationV2::Replace {
                path,
                before_sha256,
                before_mode,
                after,
                after_mode,
            } => CandidateOperationEvidence {
                sequence,
                kind: CandidateOperationKind::Replace,
                paths: vec![canonical(path)?],
                before_sha256: Some(before_sha256.clone()),
                after_sha256: Some(after.sha256.clone()),
                before_mode: Some(*before_mode),
                after_mode: Some(*after_mode),
                blob_sha256: Some(after.sha256.clone()),
            },
            ChangeOperationV2::Delete {
                path,
                before_sha256,
                before_mode,
            } => CandidateOperationEvidence {
                sequence,
                kind: CandidateOperationKind::Delete,
                paths: vec![canonical(path)?],
                before_sha256: Some(before_sha256.clone()),
                after_sha256: None,
                before_mode: Some(*before_mode),
                after_mode: None,
                blob_sha256: None,
            },
            ChangeOperationV2::Move {
                from_path,
                to_path,
                before_sha256,
                before_mode,
                after,
                after_mode,
            } => CandidateOperationEvidence {
                sequence,
                kind: CandidateOperationKind::Move,
                paths: vec![canonical(from_path)?, to_path.clone()],
                before_sha256: Some(before_sha256.clone()),
                after_sha256: Some(
                    after
                        .as_ref()
                        .map(|blob| blob.sha256.clone())
                        .unwrap_or_else(|| before_sha256.clone()),
                ),
                before_mode: Some(*before_mode),
                after_mode: Some(*after_mode),
                blob_sha256: after.as_ref().map(|blob| blob.sha256.clone()),
            },
            ChangeOperationV2::SetMode {
                path,
                before_sha256,
                before_mode,
                after_mode,
            } => CandidateOperationEvidence {
                sequence,
                kind: CandidateOperationKind::SetMode,
                paths: vec![canonical(path)?],
                before_sha256: Some(before_sha256.clone()),
                after_sha256: Some(before_sha256.clone()),
                before_mode: Some(*before_mode),
                after_mode: Some(*after_mode),
                blob_sha256: None,
            },
        })
    }
    fn verify_results(&self, prepared: &PreparedCandidate) -> Result<(), String> {
        let candidate_identity =
            RepositoryPathIdentity::inspect(&prepared.candidate_path, &self.config.git_executable)?;
        for operation in &prepared.change_set.operations {
            match operation {
                ChangeOperationV2::Create { path, after, mode }
                | ChangeOperationV2::Replace {
                    path,
                    after,
                    after_mode: mode,
                    ..
                } => self.require_after_file(
                    &prepared.candidate_path,
                    path,
                    &after.sha256,
                    *mode,
                    &candidate_identity,
                )?,
                ChangeOperationV2::Delete { path, .. } => {
                    require_path_absent(&prepared.candidate_path, path)?;
                }
                ChangeOperationV2::Move {
                    from_path,
                    to_path,
                    before_sha256,
                    after,
                    after_mode,
                    ..
                } => {
                    require_path_absent(&prepared.candidate_path, from_path)?;
                    let expected = after
                        .as_ref()
                        .map(|blob| blob.sha256.as_str())
                        .unwrap_or(before_sha256);
                    self.require_after_file(
                        &prepared.candidate_path,
                        to_path,
                        expected,
                        *after_mode,
                        &candidate_identity,
                    )?;
                }
                ChangeOperationV2::SetMode {
                    path,
                    before_sha256,
                    after_mode,
                    ..
                } => self.require_after_file(
                    &prepared.candidate_path,
                    path,
                    before_sha256,
                    *after_mode,
                    &candidate_identity,
                )?,
            }
        }
        Ok(())
    }

    fn require_after_file(
        &self,
        root: &Path,
        path: &str,
        expected_sha256: &str,
        expected_mode: FileMode,
        identity: &RepositoryPathIdentity,
    ) -> Result<(), String> {
        let canonical = identity.canonical_path(path)?;
        if canonical != path {
            return Err(format!(
                "Candidate result has non-canonical repository spelling {path}; expected {canonical}."
            ));
        }
        let absolute = regular_file_without_symlinks(root, path)?;
        let bytes = fs::read(&absolute)
            .map_err(|error| format!("Cannot read v2 candidate result {path}: {error}"))?;
        if hex_digest(&Sha256::digest(bytes)) != expected_sha256 {
            return Err(format!("Candidate result digest mismatch: {path}."));
        }
        if tracked_mode(&self.config.git_executable, root, path)? != expected_mode {
            return Err(format!("Candidate result mode mismatch: {path}."));
        }
        Ok(())
    }

    fn require_exact_candidate_paths(&self, prepared: &PreparedCandidate) -> Result<(), String> {
        let output = successful_git(
            &self.config.git_executable,
            &prepared.candidate_path,
            &[
                OsString::from("diff"),
                OsString::from("HEAD"),
                OsString::from("--no-renames"),
                OsString::from("--name-only"),
                OsString::from("-z"),
                OsString::from("--no-ext-diff"),
                OsString::from("--"),
                OsString::from("."),
            ],
            "V2 candidate changed-path inventory",
        )?;
        let changed = nul_paths(&output)?.into_iter().collect::<HashSet<_>>();
        let expected = prepared
            .change_set
            .operations
            .iter()
            .flat_map(operation_paths)
            .map(str::to_owned)
            .collect::<HashSet<_>>();
        if changed != expected {
            return Err(format!(
                "Candidate changed paths do not match the exact v2 manifest: expected {expected:?}, observed {changed:?}."
            ));
        }
        Ok(())
    }

    fn candidate_diff(&self, prepared: &PreparedCandidate) -> Result<BoundedTextEvidence, String> {
        let bytes = successful_git(
            &self.config.git_executable,
            &prepared.candidate_path,
            &[
                OsString::from("diff"),
                OsString::from("HEAD"),
                OsString::from("--binary"),
                OsString::from("--no-ext-diff"),
                OsString::from("--no-color"),
                OsString::from("--"),
                OsString::from("."),
            ],
            "V2 candidate diff",
        )?;
        Ok(bounded_text(&bytes, self.config.max_diff_bytes))
    }

    fn original_workspace_unchanged(&self, prepared: &PreparedCandidate) -> Result<bool, String> {
        if self.head_revision(&self.config.repository_root)? != prepared.evidence.base_revision
            || self
                .require_clean_repository(&self.config.repository_root)
                .is_err()
            || workspace_snapshot_id(&self.config.repository_root)? != prepared.evidence.snapshot_id
        {
            return Ok(false);
        }
        Ok(self
            .validate_preconditions(
                &self.config.repository_root,
                &prepared.change_set,
                &prepared.repository_identity,
            )
            .is_ok())
    }

    fn cleanup_candidate(&self, prepared: &PreparedCandidate) -> Result<String, String> {
        successful_git(
            &self.config.git_executable,
            &self.config.repository_root,
            &[
                OsString::from("worktree"),
                OsString::from("remove"),
                OsString::from("--force"),
                git_path(&prepared.candidate_path),
            ],
            "V2 candidate worktree removal",
        )?;
        successful_git(
            &self.config.git_executable,
            &self.config.repository_root,
            &[
                OsString::from("worktree"),
                OsString::from("prune"),
                OsString::from("--expire"),
                OsString::from("now"),
            ],
            "V2 worktree metadata prune",
        )?;
        if prepared.candidate_path.exists() {
            return Err("V2 candidate directory still exists after cleanup.".to_owned());
        }
        Ok(format!(
            "Removed v2 candidate boundary {}.",
            prepared.evidence.boundary_id
        ))
    }

    fn require_clean_repository(&self, root: &Path) -> Result<(), String> {
        let output = successful_git(
            &self.config.git_executable,
            root,
            &[
                OsString::from("status"),
                OsString::from("--porcelain=v1"),
                OsString::from("-z"),
                OsString::from("--untracked-files=all"),
            ],
            "Git v2 clean-state check",
        )?;
        if !output.is_empty() {
            return Err(
                "The governed workspace must be Git-clean for v2 candidate work.".to_owned(),
            );
        }
        Ok(())
    }

    fn head_revision(&self, root: &Path) -> Result<String, String> {
        let output = successful_git(
            &self.config.git_executable,
            root,
            &[OsString::from("rev-parse"), OsString::from("HEAD")],
            "Git v2 HEAD resolution",
        )?;
        String::from_utf8(output)
            .map(|value| value.trim().to_owned())
            .map_err(|_| "Git HEAD output is not UTF-8.".to_owned())
    }

    fn git_add(&self, root: &Path, paths: &[&str]) -> Result<(), String> {
        let mut arguments = vec![
            OsString::from("add"),
            OsString::from("-A"),
            OsString::from("--"),
        ];
        arguments.extend(paths.iter().map(OsString::from));
        successful_git(
            &self.config.git_executable,
            root,
            &arguments,
            "Git v2 candidate index update",
        )?;
        Ok(())
    }

    fn set_index_mode(&self, root: &Path, path: &str, mode: FileMode) -> Result<(), String> {
        let mode_argument = match mode {
            FileMode::Regular => "--chmod=-x",
            FileMode::Executable => "--chmod=+x",
        };
        successful_git(
            &self.config.git_executable,
            root,
            &[
                OsString::from("update-index"),
                OsString::from(mode_argument),
                OsString::from("--"),
                OsString::from(path),
            ],
            "Git v2 mode update",
        )?;
        Ok(())
    }
}

fn require_before(
    observed: &ObservedFile,
    expected_sha256: &str,
    expected_mode: FileMode,
) -> Result<(), String> {
    if observed.sha256 != expected_sha256 {
        return Err(format!("Stale before digest: {}.", observed.path));
    }
    if observed.mode != expected_mode {
        return Err(format!("Stale before mode: {}.", observed.path));
    }
    Ok(())
}

fn operation_paths(operation: &ChangeOperationV2) -> Vec<&str> {
    match operation {
        ChangeOperationV2::Create { path, .. }
        | ChangeOperationV2::Replace { path, .. }
        | ChangeOperationV2::Delete { path, .. }
        | ChangeOperationV2::SetMode { path, .. } => vec![path],
        ChangeOperationV2::Move {
            from_path, to_path, ..
        } => vec![from_path, to_path],
    }
}

fn validate_platform_path(path: &str) -> Result<(), String> {
    validate_workspace_relative_path(path)?;
    #[cfg(windows)]
    super::validate_windows_path(path)?;
    Ok(())
}

fn fold_path(path: &str, case_sensitive: bool) -> String {
    if case_sensitive {
        path.to_owned()
    } else {
        path.to_lowercase()
    }
}

fn git_boolean_config(
    root: &Path,
    git_executable: &Path,
    key: &str,
) -> Result<Option<bool>, String> {
    let result = run_git(
        git_executable,
        root,
        &[
            OsString::from("config"),
            OsString::from("--bool"),
            OsString::from("--get"),
            OsString::from(key),
        ],
    )?;
    if !result.status.success() {
        if result.status.code() == Some(1) && result.stdout.is_empty() {
            return Ok(None);
        }
        return Err(format!(
            "Cannot read Git config {key}: {}",
            bounded_error(&result.stderr)
        ));
    }
    match String::from_utf8(result.stdout)
        .map_err(|_| format!("Git config {key} is not UTF-8."))?
        .trim()
    {
        "true" => Ok(Some(true)),
        "false" => Ok(Some(false)),
        value => Err(format!(
            "Git config {key} returned invalid boolean {value}."
        )),
    }
}

fn tracked_mode(git_executable: &Path, root: &Path, path: &str) -> Result<FileMode, String> {
    let output = successful_git(
        git_executable,
        root,
        &[
            OsString::from("ls-files"),
            OsString::from("--stage"),
            OsString::from("-z"),
            OsString::from("--"),
            OsString::from(path),
        ],
        "Git tracked-mode lookup",
    )?;
    let entries = output
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .collect::<Vec<_>>();
    if entries.len() != 1 {
        return Err(format!("Expected one tracked index entry for {path}."));
    }
    let record = std::str::from_utf8(entries[0])
        .map_err(|_| format!("Git index entry is not UTF-8: {path}."))?;
    let mode = record
        .split_once(' ')
        .map(|(mode, _)| mode)
        .ok_or_else(|| format!("Malformed Git index entry for {path}."))?;
    match mode {
        "100644" => Ok(FileMode::Regular),
        "100755" => Ok(FileMode::Executable),
        "120000" => Err(format!("Symbolic-link operands are unsupported: {path}.")),
        _ => Err(format!("Unsupported Git file mode {mode} for {path}.")),
    }
}

fn git_path_is_ignored(git_executable: &Path, root: &Path, path: &str) -> Result<bool, String> {
    let result = run_git(
        git_executable,
        root,
        &[
            OsString::from("check-ignore"),
            OsString::from("--quiet"),
            OsString::from("--no-index"),
            OsString::from("--"),
            OsString::from(path),
        ],
    )?;
    match result.status.code() {
        Some(0) => Ok(true),
        Some(1) => Ok(false),
        _ => Err(format!(
            "Git ignore check failed for {path}: {}",
            bounded_error(&result.stderr)
        )),
    }
}
fn successful_git(
    git_executable: &Path,
    root: &Path,
    arguments: &[OsString],
    label: &str,
) -> Result<Vec<u8>, String> {
    let result = run_git(git_executable, root, arguments)?;
    if !result.status.success() {
        return Err(format!("{label} failed: {}", bounded_error(&result.stderr)));
    }
    Ok(result.stdout)
}

fn run_git(
    git_executable: &Path,
    root: &Path,
    arguments: &[OsString],
) -> Result<CommandResult, String> {
    let output = Command::new(git_executable)
        .args(arguments)
        .current_dir(root)
        .output()
        .map_err(|error| format!("Cannot launch Git: {error}"))?;
    if output.stdout.len().saturating_add(output.stderr.len()) > MAX_GIT_OUTPUT_BYTES {
        return Err("Git output exceeded the v2 adapter bound.".to_owned());
    }
    Ok(CommandResult {
        status: output.status,
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

fn nul_paths(bytes: &[u8]) -> Result<Vec<String>, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| {
            std::str::from_utf8(part)
                .map(str::to_owned)
                .map_err(|_| "Git path output is not UTF-8.".to_owned())
        })
        .collect()
}

fn path_from_portable(path: &str) -> PathBuf {
    path.split('/').collect()
}

fn git_path(path: &Path) -> OsString {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return OsString::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return OsString::from(rest);
        }
    }
    path.as_os_str().to_owned()
}

fn require_safe_parent(root: &Path, relative: &str) -> Result<(), String> {
    let parts = relative.split('/').collect::<Vec<_>>();
    let mut current = root.to_path_buf();
    for part in &parts[..parts.len().saturating_sub(1)] {
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!(
                    "Candidate path contains a symbolic link: {relative}."
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(format!("Candidate parent is not a directory: {relative}."));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => {
                return Err(format!(
                    "Cannot inspect candidate parent {relative}: {error}"
                ));
            }
        }
    }
    Ok(())
}

fn create_parent_directories(root: &Path, relative: &str) -> Result<(), String> {
    require_safe_parent(root, relative)?;
    let parent = root
        .join(path_from_portable(relative))
        .parent()
        .ok_or_else(|| format!("Candidate path has no parent: {relative}."))?
        .to_path_buf();
    fs::create_dir_all(&parent)
        .map_err(|error| format!("Cannot create candidate parent for {relative}: {error}"))?;
    require_safe_parent(root, relative)
}

fn regular_file_without_symlinks(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for component in path_from_portable(relative).components() {
        match component {
            Component::Normal(value) => path.push(value),
            _ => return Err(format!("Candidate path is not canonical: {relative}.")),
        }
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Cannot inspect candidate operand {relative}: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Candidate operand contains a symbolic link: {relative}."
            ));
        }
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Cannot inspect candidate file {relative}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!(
            "Candidate operand is not a regular file: {relative}."
        ));
    }
    Ok(path)
}

fn require_path_absent(root: &Path, relative: &str) -> Result<(), String> {
    match fs::symlink_metadata(root.join(path_from_portable(relative))) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Cannot inspect removed candidate path {relative}: {error}"
        )),
        Ok(_) => Err(format!("Candidate path should be absent: {relative}.")),
    }
}

fn write_new_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("Cannot create candidate file {}: {error}", path.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("Cannot write candidate file {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("Cannot sync candidate file {}: {error}", path.display()))
}

fn write_existing_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(path)
        .map_err(|error| format!("Cannot open candidate file {}: {error}", path.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("Cannot write candidate file {}: {error}", path.display()))?;
    file.sync_all()
        .map_err(|error| format!("Cannot sync candidate file {}: {error}", path.display()))
}

fn move_path(source: &Path, target: &Path) -> Result<(), String> {
    let is_case_only = source.parent() == target.parent()
        && source
            .file_name()
            .zip(target.file_name())
            .is_some_and(|(left, right)| {
                left != right
                    && left
                        .to_string_lossy()
                        .eq_ignore_ascii_case(&right.to_string_lossy())
            });
    if is_case_only {
        let temporary = source.with_file_name(format!(
            ".forge-v2-case-move-{}-{}",
            std::process::id(),
            CANDIDATE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::rename(source, &temporary)
            .map_err(|error| format!("Cannot start case-only candidate move: {error}"))?;
        return fs::rename(&temporary, target)
            .map_err(|error| format!("Cannot finish case-only candidate move: {error}"));
    }
    fs::rename(source, target).map_err(|error| format!("Cannot move candidate path: {error}"))
}

#[cfg(unix)]
fn set_working_mode(path: &Path, mode: FileMode) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect candidate mode {}: {error}", path.display()))?;
    let current = metadata.permissions().mode();
    let next = match mode {
        FileMode::Regular => current & !0o111,
        FileMode::Executable => current | 0o111,
    };
    fs::set_permissions(path, fs::Permissions::from_mode(next))
        .map_err(|error| format!("Cannot set candidate mode {}: {error}", path.display()))
}

#[cfg(windows)]
fn set_working_mode(path: &Path, _mode: FileMode) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!(
            "Candidate mode target is not a file: {}.",
            path.display()
        ));
    }
    Ok(())
}

fn bounded_text(bytes: &[u8], maximum_bytes: usize) -> BoundedTextEvidence {
    let mut end = bytes.len().min(maximum_bytes);
    while end > 0 && std::str::from_utf8(&bytes[..end]).is_err() {
        end -= 1;
    }
    BoundedTextEvidence {
        text: String::from_utf8_lossy(&bytes[..end]).into_owned(),
        total_bytes: bytes.len() as u64,
        sha256: hex_digest(&Sha256::digest(bytes)),
        truncated: bytes.len() > end,
    }
}

fn bounded_error(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(4_096)]).into_owned()
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn path_is_within(candidate: &Path, root: &Path) -> bool {
    candidate == root || candidate.starts_with(root)
}
