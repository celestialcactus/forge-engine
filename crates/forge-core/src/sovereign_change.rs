use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::{Deserialize, Serialize};

use crate::{
    CHANGE_SET_V2_SCHEMA_VERSION, Cancellation, CandidateOperationApplyEvidence,
    CandidateOperationBoundaryEvidence, ChangeOperationV2, ChangeSetV2,
    ChangeSetV2CandidateAdapter, ChangeSetV2Coordinator, ChangeSetV2CoordinatorArtifact,
    ChangeSetV2CoordinatorConfig, ChangeSetV2Registration, FileBlobStore, FileMode,
    IsolationRequest, RepositoryPathIdentity, VerificationCheck, VerificationEvidence,
    VerificationRunner, change_set_id, workspace_snapshot_id,
};

pub const SOVEREIGN_CHANGE_PROPOSAL_SCHEMA_VERSION: u8 = 1;
const MAX_SELECTED_CHECKS: usize = 8;
const MAX_DURABLE_VERIFICATION_BYTES: usize = 128 * 1024;
const DEFAULT_MAX_DIFF_BYTES: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "encoding",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum DraftContent {
    Utf8 {
        value: String,
    },
    Hex {
        value: String,
        content_kind: crate::BlobContentKind,
    },
}

impl DraftContent {
    fn stage(&self, store: &FileBlobStore) -> Result<crate::BlobRef, String> {
        match self {
            Self::Utf8 { value } => store.stage(value.as_bytes(), crate::BlobContentKind::Utf8Text),
            Self::Hex {
                value,
                content_kind,
            } => store.stage(&decode_hex(value)?, *content_kind),
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
pub enum DraftChangeOperation {
    Create {
        path: String,
        after: DraftContent,
        #[serde(default)]
        mode: Option<FileMode>,
    },
    Replace {
        path: String,
        after: DraftContent,
        #[serde(default)]
        after_mode: Option<FileMode>,
    },
    Delete {
        path: String,
    },
    Move {
        from_path: String,
        to_path: String,
        #[serde(default)]
        after: Option<DraftContent>,
        #[serde(default)]
        after_mode: Option<FileMode>,
    },
    SetMode {
        path: String,
        after_mode: FileMode,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SovereignChangeProposal {
    pub schema_version: u8,
    pub operations: Vec<DraftChangeOperation>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SovereignChangeProposalStatus {
    VerifiedCandidate,
    VerificationFailed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SovereignChangeProposalArtifact {
    pub schema_version: u8,
    pub status: SovereignChangeProposalStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change_set: Option<ChangeSetV2>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boundary: Option<CandidateOperationBoundaryEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application: Option<CandidateOperationApplyEvidence>,
    pub verification: Vec<VerificationEvidence>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction: Option<ChangeSetV2CoordinatorArtifact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub candidate_cleanup: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

#[derive(Clone, Debug)]
pub struct SovereignChangeConfig {
    pub repository_root: PathBuf,
    pub engine_root: PathBuf,
    pub git_executable: PathBuf,
    pub max_diff_bytes: usize,
}

impl SovereignChangeConfig {
    pub fn new(repository_root: impl Into<PathBuf>, engine_root: impl Into<PathBuf>) -> Self {
        Self {
            repository_root: repository_root.into(),
            engine_root: engine_root.into(),
            git_executable: PathBuf::from("git"),
            max_diff_bytes: DEFAULT_MAX_DIFF_BYTES,
        }
    }
}

pub struct SovereignChangeService {
    repository_root: PathBuf,
    candidate_parent: PathBuf,
    state_root: PathBuf,
    blob_store: FileBlobStore,
    git_executable: PathBuf,
    max_diff_bytes: usize,
}

impl SovereignChangeService {
    pub fn try_new(mut config: SovereignChangeConfig) -> Result<Self, String> {
        config.repository_root = fs::canonicalize(&config.repository_root)
            .map_err(|error| format!("Cannot resolve sovereign repository root: {error}"))?;
        fs::create_dir_all(&config.engine_root)
            .map_err(|error| format!("Cannot create Forge engine root: {error}"))?;
        config.engine_root = fs::canonicalize(&config.engine_root)
            .map_err(|error| format!("Cannot resolve Forge engine root: {error}"))?;
        if path_is_within(&config.engine_root, &config.repository_root)
            || path_is_within(&config.repository_root, &config.engine_root)
        {
            return Err(
                "Forge engine root must be outside and must not contain the governed workspace."
                    .into(),
            );
        }
        let root_text = config
            .repository_root
            .to_str()
            .ok_or("Sovereign repository root is not valid UTF-8.")?;
        let workspace_key = crate::sha256(root_text.as_bytes());
        let workspace_root = config
            .engine_root
            .join("workspaces")
            .join(&workspace_key[..24]);
        let candidate_parent = workspace_root.join("candidates");
        let state_root = workspace_root.join("transactions");
        let blob_root = workspace_root.join("blobs");
        for path in [&candidate_parent, &state_root, &blob_root] {
            fs::create_dir_all(path)
                .map_err(|error| format!("Cannot create Forge change state: {error}"))?;
        }
        let service = Self {
            repository_root: config.repository_root,
            candidate_parent,
            state_root,
            blob_store: FileBlobStore::new(blob_root),
            git_executable: config.git_executable,
            max_diff_bytes: config.max_diff_bytes,
        };
        service.coordinator()?;
        Ok(service)
    }

    pub fn propose(
        &self,
        proposal: &SovereignChangeProposal,
        verification_checks: Vec<VerificationCheck>,
        selected_check_ids: &[String],
        cancellation: &dyn Cancellation,
    ) -> SovereignChangeProposalArtifact {
        let mut artifact = SovereignChangeProposalArtifact {
            schema_version: 1,
            status: SovereignChangeProposalStatus::Failed,
            change_set: None,
            boundary: None,
            application: None,
            verification: Vec::new(),
            transaction: None,
            candidate_cleanup: None,
            failure: None,
        };
        let result = (|| -> Result<(), String> {
            validate_selected_checks(selected_check_ids)?;
            let verification = VerificationRunner::try_new(verification_checks)?;
            let change_set = self.build_change_set(proposal)?;
            artifact.change_set = Some(change_set.clone());
            let expected_base_revision = self.head()?;
            let mut adapter_config = crate::CandidateOperationAdapterConfig::new(
                &self.repository_root,
                &self.candidate_parent,
                expected_base_revision,
                self.blob_store.clone(),
            );
            adapter_config.git_executable = self.git_executable.clone();
            adapter_config.max_diff_bytes = self.max_diff_bytes;
            let mut adapter = ChangeSetV2CandidateAdapter::try_new(adapter_config)?;
            let boundary = adapter.prepare(&change_set)?;
            artifact.boundary = Some(boundary.clone());
            let application = adapter.apply(&boundary, &change_set)?;
            artifact.application = Some(application);
            let candidate_path = adapter
                .candidate_path()
                .ok_or("Candidate path is unavailable after application.")?
                .to_path_buf();
            for check_id in selected_check_ids {
                if let Some(reason) = cancellation.reason() {
                    artifact.status = SovereignChangeProposalStatus::Cancelled;
                    artifact.failure = Some(reason);
                    artifact.candidate_cleanup = Some(adapter.discard(&boundary)?);
                    return Ok(());
                }
                let evidence = match verification.execute(
                    &candidate_path,
                    &crate::VerificationSelection {
                        check_id: check_id.clone(),
                        isolation: IsolationRequest::trusted(),
                    },
                    cancellation,
                ) {
                    Ok(evidence) => evidence,
                    Err(error) => {
                        artifact.candidate_cleanup = Some(adapter.discard(&boundary)?);
                        return Err(error);
                    }
                };
                let success = evidence.success;
                let cancelled = evidence.cancelled;
                artifact.verification.push(evidence);
                if !success {
                    artifact.status = if cancelled {
                        SovereignChangeProposalStatus::Cancelled
                    } else {
                        SovereignChangeProposalStatus::VerificationFailed
                    };
                    artifact.failure = Some(format!("Verification check {check_id} did not pass."));
                    artifact.candidate_cleanup = Some(adapter.discard(&boundary)?);
                    return Ok(());
                }
            }
            if let Some(reason) = cancellation.reason() {
                artifact.status = SovereignChangeProposalStatus::Cancelled;
                artifact.failure = Some(reason);
                artifact.candidate_cleanup = Some(adapter.discard(&boundary)?);
                return Ok(());
            }
            let encoded = serde_json::to_vec(&artifact.verification)
                .map_err(|error| format!("Cannot encode verification evidence: {error}"))?;
            if encoded.len() > MAX_DURABLE_VERIFICATION_BYTES {
                artifact.candidate_cleanup = Some(adapter.discard(&boundary)?);
                return Err(format!(
                    "Verification evidence exceeds the {MAX_DURABLE_VERIFICATION_BYTES} byte durable limit."
                ));
            }
            let transaction = self.coordinator()?.register(&ChangeSetV2Registration {
                boundary,
                candidate_path,
                change_set,
                verification: artifact.verification.clone(),
            });
            match transaction {
                Ok(transaction) => {
                    artifact.status = SovereignChangeProposalStatus::VerifiedCandidate;
                    artifact.transaction = Some(transaction);
                    Ok(())
                }
                Err(error) => {
                    artifact.candidate_cleanup = Some(
                        adapter
                            .discard(artifact.boundary.as_ref().expect("boundary was recorded"))?,
                    );
                    Err(error)
                }
            }
        })();
        if let Err(error) = result {
            artifact.status = SovereignChangeProposalStatus::Failed;
            artifact.failure = Some(error);
        }
        artifact
    }

    pub fn inspect(&self, transaction_id: &str) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        self.coordinator()?.inspect(transaction_id)
    }

    pub fn accept(
        &self,
        transaction_id: &str,
        cancellation: &dyn Cancellation,
    ) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        Ok(self.coordinator()?.promote(transaction_id, cancellation))
    }

    pub fn discard(
        &self,
        transaction_id: &str,
        cancellation: &dyn Cancellation,
    ) -> Result<ChangeSetV2CoordinatorArtifact, String> {
        Ok(self.coordinator()?.discard(transaction_id, cancellation))
    }

    fn coordinator(&self) -> Result<ChangeSetV2Coordinator, String> {
        let mut config = ChangeSetV2CoordinatorConfig::new(
            &self.repository_root,
            &self.state_root,
            self.blob_store.clone(),
        );
        config.git_executable = self.git_executable.clone();
        ChangeSetV2Coordinator::try_new(config)
    }

    fn build_change_set(&self, proposal: &SovereignChangeProposal) -> Result<ChangeSetV2, String> {
        if proposal.schema_version != SOVEREIGN_CHANGE_PROPOSAL_SCHEMA_VERSION {
            return Err("Unsupported sovereign proposal schema version.".into());
        }
        let identity =
            RepositoryPathIdentity::inspect(&self.repository_root, &self.git_executable)?;
        let mut operations = Vec::with_capacity(proposal.operations.len());
        for operation in &proposal.operations {
            operations.push(match operation {
                DraftChangeOperation::Create { path, after, mode } => ChangeOperationV2::Create {
                    path: path.clone(),
                    after: after.stage(&self.blob_store)?,
                    mode: mode.unwrap_or(FileMode::Regular),
                },
                DraftChangeOperation::Replace {
                    path,
                    after,
                    after_mode,
                } => {
                    let before = identity.observe_tracked_file(
                        &self.repository_root,
                        &self.git_executable,
                        path,
                    )?;
                    ChangeOperationV2::Replace {
                        path: before.canonical_path,
                        before_sha256: before.sha256,
                        before_mode: before.mode,
                        after: after.stage(&self.blob_store)?,
                        after_mode: after_mode.unwrap_or(before.mode),
                    }
                }
                DraftChangeOperation::Delete { path } => {
                    let before = identity.observe_tracked_file(
                        &self.repository_root,
                        &self.git_executable,
                        path,
                    )?;
                    ChangeOperationV2::Delete {
                        path: before.canonical_path,
                        before_sha256: before.sha256,
                        before_mode: before.mode,
                    }
                }
                DraftChangeOperation::Move {
                    from_path,
                    to_path,
                    after,
                    after_mode,
                } => {
                    let before = identity.observe_tracked_file(
                        &self.repository_root,
                        &self.git_executable,
                        from_path,
                    )?;
                    ChangeOperationV2::Move {
                        from_path: before.canonical_path,
                        to_path: to_path.clone(),
                        before_sha256: before.sha256,
                        before_mode: before.mode,
                        after: after
                            .as_ref()
                            .map(|content| content.stage(&self.blob_store))
                            .transpose()?,
                        after_mode: after_mode.unwrap_or(before.mode),
                    }
                }
                DraftChangeOperation::SetMode { path, after_mode } => {
                    let before = identity.observe_tracked_file(
                        &self.repository_root,
                        &self.git_executable,
                        path,
                    )?;
                    ChangeOperationV2::SetMode {
                        path: before.canonical_path,
                        before_sha256: before.sha256,
                        before_mode: before.mode,
                        after_mode: *after_mode,
                    }
                }
            });
        }
        let mut change_set = ChangeSetV2 {
            schema_version: CHANGE_SET_V2_SCHEMA_VERSION,
            change_set_id: String::new(),
            snapshot_id: workspace_snapshot_id(&self.repository_root)?,
            operations,
        };
        change_set.change_set_id = change_set_id(&change_set);
        Ok(change_set)
    }

    fn head(&self) -> Result<String, String> {
        let output = Command::new(&self.git_executable)
            .current_dir(&self.repository_root)
            .args(["rev-parse", "HEAD"])
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|error| format!("Cannot resolve repository HEAD: {error}"))?;
        if !output.status.success() {
            return Err("Git could not resolve repository HEAD.".into());
        }
        String::from_utf8(output.stdout)
            .map(|value| value.trim().to_owned())
            .map_err(|_| "Git returned non-UTF-8 HEAD.".into())
    }
}

fn validate_selected_checks(check_ids: &[String]) -> Result<(), String> {
    if check_ids.is_empty() || check_ids.len() > MAX_SELECTED_CHECKS {
        return Err(format!(
            "selectedCheckIds must contain 1 to {MAX_SELECTED_CHECKS} entries."
        ));
    }
    let mut unique = HashSet::new();
    for check_id in check_ids {
        if check_id.trim().is_empty() || !unique.insert(check_id) {
            return Err("selectedCheckIds must be non-empty and unique.".into());
        }
    }
    Ok(())
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    if !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(
            "Hex proposal content must contain an even number of hexadecimal digits.".into(),
        );
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).map_err(|_| "Hex proposal content is invalid.")?;
            u8::from_str_radix(text, 16).map_err(|_| "Hex proposal content is invalid.".into())
        })
        .collect()
}

fn path_is_within(candidate: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate = candidate.to_string_lossy().to_lowercase();
        let root = root.to_string_lossy().to_lowercase();
        candidate == root || candidate.starts_with(&format!("{root}\\"))
    }
    #[cfg(not(windows))]
    {
        candidate == root || candidate.starts_with(root)
    }
}
