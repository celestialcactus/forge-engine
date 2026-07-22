use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    ffi::OsString,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering as AtomicOrdering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use sha2::{Digest, Sha256};

use crate::{
    ApplicationChange, AppliedChangeEvidence, ApplyEvidence, BoundaryEvidence, BoundedTextEvidence,
    Cancellation, CandidateRetentionEvidence, ChangeApplicationManifest, ChangeTransactionAdapter,
    VerificationEvidence, VerificationSelection,
};

const MAX_GIT_OUTPUT: usize = 32 * 1_048_576;
const MAX_CHECKS: usize = 32;
const MAX_ARGUMENTS: usize = 64;
const MIN_OUTPUT: usize = 1_024;
const MAX_OUTPUT: usize = 1_048_576;
const MIN_DIFF: usize = 1_000;
const MAX_DIFF: usize = 1_000_000;
const MAX_TIMEOUT: Duration = Duration::from_secs(600);
const IGNORED_DIRECTORIES: [&str; 5] = [".git", ".forge", "dist", "node_modules", "target"];

#[derive(Clone, Debug)]
pub struct VerificationCheck {
    pub check_id: String,
    pub executable: PathBuf,
    pub arguments: Vec<String>,
    pub environment: Vec<(String, String)>,
    pub timeout: Duration,
    pub max_output_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct WorktreeAdapterConfig {
    pub repository_root: PathBuf,
    pub candidate_parent: PathBuf,
    pub expected_base_revision: String,
    pub git_executable: PathBuf,
    pub verification_checks: Vec<VerificationCheck>,
    pub max_diff_bytes: usize,
}

impl WorktreeAdapterConfig {
    pub fn new(
        repository_root: impl Into<PathBuf>,
        candidate_parent: impl Into<PathBuf>,
        expected_base_revision: impl Into<String>,
        verification_checks: Vec<VerificationCheck>,
    ) -> Self {
        Self {
            repository_root: repository_root.into(),
            candidate_parent: candidate_parent.into(),
            expected_base_revision: expected_base_revision.into(),
            git_executable: PathBuf::from("git"),
            verification_checks,
            max_diff_bytes: 100_000,
        }
    }
}

#[derive(Clone, Debug)]
struct WorkspaceEntry {
    path: String,
    bytes: u64,
}

#[derive(Clone, Debug)]
struct PreparedBoundary {
    boundary_id: String,
    candidate_path: PathBuf,
    base_revision: String,
    snapshot_id: String,
    original_fingerprint: String,
    changes: Vec<ApplicationChange>,
}

struct CommandResult {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

struct CapturedStream {
    bytes: Vec<u8>,
    total_bytes: u64,
}

pub struct CleanRevisionWorktreeAdapter {
    config: WorktreeAdapterConfig,
    checks: HashMap<String, VerificationCheck>,
    boundary: Option<PreparedBoundary>,
}

impl CleanRevisionWorktreeAdapter {
    pub fn try_new(mut config: WorktreeAdapterConfig) -> Result<Self, String> {
        if config.expected_base_revision.trim().is_empty() {
            return Err("expected_base_revision must not be empty.".to_owned());
        }
        if !(MIN_DIFF..=MAX_DIFF).contains(&config.max_diff_bytes) {
            return Err(format!(
                "max_diff_bytes must be from {MIN_DIFF} to {MAX_DIFF}."
            ));
        }
        if config.verification_checks.is_empty() || config.verification_checks.len() > MAX_CHECKS {
            return Err(format!(
                "verification_checks must contain 1 to {MAX_CHECKS} entries."
            ));
        }
        config.repository_root = fs::canonicalize(&config.repository_root)
            .map_err(|error| format!("Cannot resolve repository root: {error}"))?;
        fs::create_dir_all(&config.candidate_parent)
            .map_err(|error| format!("Cannot create candidate parent: {error}"))?;
        config.candidate_parent = fs::canonicalize(&config.candidate_parent)
            .map_err(|error| format!("Cannot resolve candidate parent: {error}"))?;
        if path_is_within(&config.candidate_parent, &config.repository_root) {
            return Err(
                "candidate_parent must be outside the governed repository workspace.".to_owned(),
            );
        }
        let mut checks = HashMap::new();
        for check in &config.verification_checks {
            validate_check(check)?;
            if checks
                .insert(check.check_id.clone(), check.clone())
                .is_some()
            {
                return Err(format!(
                    "Duplicate verification check ID: {}.",
                    check.check_id
                ));
            }
        }
        Ok(Self {
            config,
            checks,
            boundary: None,
        })
    }

    pub fn retained_candidate_path(&self) -> Option<&Path> {
        self.boundary
            .as_ref()
            .map(|boundary| boundary.candidate_path.as_path())
    }

    pub fn discard_retained_candidate(&mut self) -> Result<String, String> {
        let boundary = self
            .boundary
            .as_ref()
            .ok_or_else(|| "No candidate boundary is retained.".to_owned())?;
        let evidence = BoundaryEvidence {
            boundary_id: boundary.boundary_id.clone(),
            base_revision: boundary.base_revision.clone(),
            original_workspace_unchanged: true,
        };
        self.recover(&evidence, "Explicit candidate discard.")
    }

    fn run_git(&self, cwd: &Path, arguments: &[OsString]) -> Result<CommandResult, String> {
        let output = Command::new(&self.config.git_executable)
            .current_dir(cwd)
            .args(arguments)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Could not start Git: {error}"))?;
        if output.stdout.len().saturating_add(output.stderr.len()) > MAX_GIT_OUTPUT {
            return Err("Git output exceeded the 32 MiB transaction ceiling.".to_owned());
        }
        Ok(CommandResult {
            status: output.status,
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }

    fn successful_git(
        &self,
        cwd: &Path,
        arguments: &[OsString],
        operation: &str,
    ) -> Result<Vec<u8>, String> {
        let result = self.run_git(cwd, arguments)?;
        if !result.status.success() {
            return Err(format!(
                "{operation} failed: {}",
                bounded_error(&result.stderr)
            ));
        }
        Ok(result.stdout)
    }

    fn head_revision(&self, root: &Path) -> Result<String, String> {
        let output = self.successful_git(
            root,
            &strings(&["rev-parse", "--verify", "HEAD"]),
            "Git HEAD resolution",
        )?;
        let revision = String::from_utf8(output)
            .map_err(|_| "Git returned a non-UTF-8 HEAD revision.".to_owned())?
            .trim()
            .to_owned();
        if revision.is_empty() {
            return Err("Git returned an empty HEAD revision.".to_owned());
        }
        Ok(revision)
    }

    fn require_clean_repository(&self) -> Result<(), String> {
        let output = self.successful_git(
            &self.config.repository_root,
            &strings(&["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
            "Git clean-state check",
        )?;
        if !output.is_empty() {
            return Err(
                "The governed workspace must be Git-clean before candidate preparation.".to_owned(),
            );
        }
        Ok(())
    }

    fn require_snapshot_files_tracked(&self, files: &[WorkspaceEntry]) -> Result<(), String> {
        let output = self.successful_git(
            &self.config.repository_root,
            &strings(&["ls-files", "-z", "--cached"]),
            "Git tracked-file inventory",
        )?;
        let tracked = nul_paths(&output)?;
        let missing = files
            .iter()
            .filter(|file| !tracked.contains(&file.path))
            .map(|file| file.path.clone())
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(format!(
                "The snapshot depends on files absent from a clean revision: {}.",
                missing.join(", ")
            ));
        }
        Ok(())
    }

    fn original_workspace_unchanged(&self, boundary: &PreparedBoundary) -> Result<bool, String> {
        if self.head_revision(&self.config.repository_root)? != boundary.base_revision
            || self.require_clean_repository().is_err()
        {
            return Ok(false);
        }
        let (snapshot_id, files) = snapshot_inventory(&self.config.repository_root)?;
        if snapshot_id != boundary.snapshot_id {
            return Ok(false);
        }
        Ok(workspace_fingerprint(&self.config.repository_root, &files)?
            == boundary.original_fingerprint)
    }

    fn matching_boundary(&self, evidence: &BoundaryEvidence) -> Result<PreparedBoundary, String> {
        let boundary = self
            .boundary
            .as_ref()
            .ok_or_else(|| "No candidate boundary is prepared.".to_owned())?;
        if evidence.boundary_id != boundary.boundary_id
            || evidence.base_revision != boundary.base_revision
        {
            return Err("Boundary evidence does not match the prepared candidate.".to_owned());
        }
        Ok(boundary.clone())
    }

    fn candidate_diff(&self, boundary: &PreparedBoundary) -> Result<BoundedTextEvidence, String> {
        let output = self.successful_git(
            &boundary.candidate_path,
            &strings(&["diff", "--no-ext-diff", "--no-color", "--binary", "--", "."]),
            "Candidate diff",
        )?;
        Ok(bounded_text(&output, self.config.max_diff_bytes))
    }

    fn require_exact_candidate_changes(&self, boundary: &PreparedBoundary) -> Result<(), String> {
        let changed = nul_paths(&self.successful_git(
            &boundary.candidate_path,
            &strings(&["diff", "--name-only", "-z", "--no-ext-diff", "--", "."]),
            "Candidate changed-file inventory",
        )?)?;
        let staged = nul_paths(&self.successful_git(
            &boundary.candidate_path,
            &strings(&["diff", "--cached", "--name-only", "-z", "--", "."]),
            "Candidate staged-file inventory",
        )?)?;
        let untracked = nul_paths(&self.successful_git(
            &boundary.candidate_path,
            &strings(&["ls-files", "--others", "--exclude-standard", "-z"]),
            "Candidate untracked-file inventory",
        )?)?;
        let expected = boundary
            .changes
            .iter()
            .map(|change| change.path.clone())
            .collect::<HashSet<_>>();
        if changed != expected || !staged.is_empty() || !untracked.is_empty() {
            return Err(
                "Candidate contains paths outside the exact application manifest.".to_owned(),
            );
        }
        Ok(())
    }

    fn require_final_digests(&self, boundary: &PreparedBoundary) -> Result<(), String> {
        for change in &boundary.changes {
            let path = regular_file_without_symlinks(&boundary.candidate_path, &change.path)?;
            if digest_file(&path)? != change.after_sha256 {
                return Err(format!(
                    "Post-verification digest mismatch: {}.",
                    change.path
                ));
            }
        }
        Ok(())
    }

    fn cleanup_boundary(&self, boundary: &PreparedBoundary) -> Result<String, String> {
        self.successful_git(
            &self.config.repository_root,
            &[
                OsString::from("worktree"),
                OsString::from("remove"),
                OsString::from("--force"),
                git_path(&boundary.candidate_path),
            ],
            "Git worktree removal",
        )?;
        self.successful_git(
            &self.config.repository_root,
            &strings(&["worktree", "prune", "--expire", "now"]),
            "Git worktree metadata prune",
        )?;
        if boundary.candidate_path.exists() {
            return Err("Candidate directory still exists after worktree removal.".to_owned());
        }
        Ok(format!(
            "Removed candidate boundary {} and pruned its Git metadata.",
            boundary.boundary_id
        ))
    }
}
impl ChangeTransactionAdapter for CleanRevisionWorktreeAdapter {
    fn prepare(
        &mut self,
        manifest: &ChangeApplicationManifest,
    ) -> Result<BoundaryEvidence, String> {
        if self.boundary.is_some() {
            return Err("This adapter already owns a candidate boundary.".to_owned());
        }
        self.require_clean_repository()?;
        let base_revision = self.head_revision(&self.config.repository_root)?;
        if base_revision != self.config.expected_base_revision {
            return Err(format!(
                "HEAD revision {base_revision} does not match expected base {}.",
                self.config.expected_base_revision
            ));
        }

        let (snapshot_id, files) = snapshot_inventory(&self.config.repository_root)?;
        if snapshot_id != manifest.snapshot_id {
            return Err(format!(
                "Workspace snapshot {snapshot_id} does not match manifest snapshot {}.",
                manifest.snapshot_id
            ));
        }
        self.require_snapshot_files_tracked(&files)?;
        let original_fingerprint = workspace_fingerprint(&self.config.repository_root, &files)?;
        for change in &manifest.changes {
            let path = regular_file_without_symlinks(&self.config.repository_root, &change.path)?;
            if digest_file(&path)? != change.before_sha256 {
                return Err(format!("Stale base digest: {}.", change.path));
            }
        }

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| format!("System clock cannot identify a candidate: {error}"))?
            .as_nanos();
        let candidate_path = self.config.candidate_parent.join(format!(
            "forge-{}-{}-{unique}",
            manifest.proposal_id.trim_start_matches("change:"),
            std::process::id()
        ));
        let boundary_id = format!(
            "worktree:{}:{unique}",
            manifest.proposal_id.trim_start_matches("change:")
        );

        self.successful_git(
            &self.config.repository_root,
            &[
                OsString::from("worktree"),
                OsString::from("add"),
                OsString::from("--quiet"),
                OsString::from("--detach"),
                git_path(&candidate_path),
                OsString::from(&base_revision),
            ],
            "Git worktree creation",
        )?;

        let prepared = PreparedBoundary {
            boundary_id: boundary_id.clone(),
            candidate_path,
            base_revision: base_revision.clone(),
            snapshot_id,
            original_fingerprint,
            changes: manifest.changes.clone(),
        };
        let validation = (|| -> Result<(), String> {
            if self.head_revision(&prepared.candidate_path)? != prepared.base_revision {
                return Err("Candidate worktree resolved a different base revision.".to_owned());
            }
            for change in &prepared.changes {
                let path = regular_file_without_symlinks(&prepared.candidate_path, &change.path)?;
                if digest_file(&path)? != change.before_sha256 {
                    return Err(format!(
                        "Candidate checkout digest differs from the proposal base: {}.",
                        change.path
                    ));
                }
            }
            if !self.original_workspace_unchanged(&prepared)? {
                return Err("Original workspace changed during candidate preparation.".to_owned());
            }
            Ok(())
        })();

        if let Err(error) = validation {
            return match self.cleanup_boundary(&prepared) {
                Ok(_) => Err(error),
                Err(cleanup_error) => Err(format!(
                    "{error} Candidate cleanup also failed: {cleanup_error}"
                )),
            };
        }

        self.boundary = Some(prepared);
        Ok(BoundaryEvidence {
            boundary_id,
            base_revision,
            original_workspace_unchanged: true,
        })
    }

    fn apply(
        &mut self,
        boundary: &BoundaryEvidence,
        manifest: &ChangeApplicationManifest,
    ) -> Result<ApplyEvidence, String> {
        let prepared = self.matching_boundary(boundary)?;
        if manifest.proposal_id != crate::proposal_id_for_manifest(manifest)
            || manifest.snapshot_id != prepared.snapshot_id
            || manifest.changes != prepared.changes
        {
            return Err("Application manifest changed after boundary preparation.".to_owned());
        }
        if !self.original_workspace_unchanged(&prepared)? {
            return Err("Original workspace changed before candidate application.".to_owned());
        }

        let mut applied = Vec::with_capacity(prepared.changes.len());
        for change in &prepared.changes {
            let path = regular_file_without_symlinks(&prepared.candidate_path, &change.path)?;
            if digest_file(&path)? != change.before_sha256 {
                return Err(format!(
                    "Candidate base changed before apply: {}.",
                    change.path
                ));
            }
            fs::write(&path, change.replacement_text.as_bytes())
                .map_err(|error| format!("Could not write candidate {}: {error}", change.path))?;
            let after_sha256 = digest_file(&path)?;
            if after_sha256 != change.after_sha256 {
                return Err(format!("Candidate write digest mismatch: {}.", change.path));
            }
            applied.push(AppliedChangeEvidence {
                path: change.path.clone(),
                after_sha256,
            });
        }

        if !self.original_workspace_unchanged(&prepared)? {
            return Err("Original workspace changed during candidate application.".to_owned());
        }
        Ok(ApplyEvidence {
            changes: applied,
            diff: Some(self.candidate_diff(&prepared)?),
        })
    }

    fn verify(
        &mut self,
        boundary: &BoundaryEvidence,
        selection: &VerificationSelection,
        cancellation: &dyn Cancellation,
    ) -> Result<VerificationEvidence, String> {
        let prepared = self.matching_boundary(boundary)?;
        let check = self
            .checks
            .get(&selection.check_id)
            .ok_or_else(|| {
                format!(
                    "Verification check {} is not present in policy.",
                    selection.check_id
                )
            })?
            .clone();
        if !self.original_workspace_unchanged(&prepared)? {
            return Err("Original workspace changed before candidate verification.".to_owned());
        }

        let result = run_bounded_process(&check, &prepared.candidate_path, cancellation)?;
        if !self.original_workspace_unchanged(&prepared)? {
            return Err("Original workspace changed during candidate verification.".to_owned());
        }
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
        })
    }

    fn retain(
        &mut self,
        boundary: &BoundaryEvidence,
    ) -> Result<CandidateRetentionEvidence, String> {
        let prepared = self.matching_boundary(boundary)?;
        self.require_exact_candidate_changes(&prepared)?;
        self.require_final_digests(&prepared)?;
        let original_workspace_unchanged = self.original_workspace_unchanged(&prepared)?;
        if !original_workspace_unchanged {
            return Err("Original workspace changed before candidate retention.".to_owned());
        }
        Ok(CandidateRetentionEvidence {
            boundary_id: prepared.boundary_id.clone(),
            retained: true,
            original_workspace_unchanged,
            final_diff: self.candidate_diff(&prepared)?,
        })
    }

    fn recover(&mut self, boundary: &BoundaryEvidence, _cause: &str) -> Result<String, String> {
        let prepared = self.matching_boundary(boundary)?;
        let message = self.cleanup_boundary(&prepared)?;
        self.boundary = None;
        if !self.original_workspace_unchanged(&prepared)? {
            return Err(
                "Candidate boundary was removed, but the original workspace changed.".to_owned(),
            );
        }
        Ok(message)
    }
}

fn validate_check(check: &VerificationCheck) -> Result<(), String> {
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
    if check.environment.iter().any(|(name, value)| {
        name.is_empty() || name.contains('=') || name.contains('\0') || value.contains('\0')
    }) {
        return Err(format!(
            "Verification check {} has invalid fixed environment.",
            check.check_id
        ));
    }
    Ok(())
}
fn strings(values: &[&str]) -> Vec<OsString> {
    values.iter().map(OsString::from).collect()
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

fn bounded_error(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(2_000)])
        .trim()
        .to_owned()
}

fn nul_paths(bytes: &[u8]) -> Result<HashSet<String>, String> {
    bytes
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| {
            String::from_utf8(part.to_vec())
                .map(|path| path.replace('\\', "/"))
                .map_err(|_| "Git returned a non-UTF-8 path.".to_owned())
        })
        .collect()
}

fn path_is_within(candidate: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate = candidate.to_string_lossy().to_lowercase();
        let root = root.to_string_lossy().to_lowercase();
        candidate == root
            || candidate
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'))
    }
    #[cfg(not(windows))]
    {
        candidate == root || candidate.starts_with(root)
    }
}

fn utf16_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

fn portable_relative(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Workspace path escaped its root.".to_owned())?;
    let mut parts = Vec::new();
    for component in relative.components() {
        match component {
            Component::Normal(value) => parts.push(
                value
                    .to_str()
                    .ok_or_else(|| "Workspace path is not valid UTF-8.".to_owned())?,
            ),
            _ => return Err("Workspace path is not canonical.".to_owned()),
        }
    }
    Ok(parts.join("/"))
}

pub fn workspace_snapshot_id(root: &Path) -> Result<String, String> {
    snapshot_inventory(root).map(|(snapshot_id, _)| snapshot_id)
}

fn snapshot_inventory(root: &Path) -> Result<(String, Vec<WorkspaceEntry>), String> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while !pending.is_empty() {
        let directory = pending.remove(0);
        let mut entries = fs::read_dir(&directory)
            .map_err(|error| format!("Cannot read workspace directory: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot enumerate workspace directory: {error}"))?;
        entries.sort_by(|left, right| {
            utf16_cmp(
                &left.file_name().to_string_lossy(),
                &right.file_name().to_string_lossy(),
            )
        });

        for entry in entries {
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Cannot inspect workspace entry: {error}"))?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                let name = entry
                    .file_name()
                    .to_str()
                    .ok_or_else(|| "Workspace directory name is not valid UTF-8.".to_owned())?
                    .to_owned();
                if !IGNORED_DIRECTORIES.contains(&name.as_str()) {
                    pending.push(path);
                }
                continue;
            }
            if !file_type.is_file() {
                continue;
            }
            if files.len() >= 10_000 {
                return Err(
                    "Workspace contains more than the Slice 1 limit of 10000 files.".to_owned(),
                );
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Cannot inspect workspace file: {error}"))?;
            files.push(WorkspaceEntry {
                path: portable_relative(root, &path)?,
                bytes: metadata.len(),
            });
        }
        pending.sort_by(|left, right| {
            utf16_cmp(
                &portable_relative(root, left).unwrap_or_default(),
                &portable_relative(root, right).unwrap_or_default(),
            )
        });
    }

    files.sort_by(|left, right| utf16_cmp(&left.path, &right.path));
    let mut digest = Sha256::new();
    for file in &files {
        digest.update(file.path.as_bytes());
        digest.update([0]);
        digest.update(file.bytes.to_string().as_bytes());
        digest.update(b"\n");
    }
    let full = hex_digest(&digest.finalize());
    Ok((format!("workspace:{}", &full[..16]), files))
}

fn workspace_fingerprint(root: &Path, files: &[WorkspaceEntry]) -> Result<String, String> {
    let mut digest = Sha256::new();
    for file in files {
        let path = regular_file_without_symlinks(root, &file.path)?;
        let content = fs::read(&path).map_err(|error| {
            format!("Cannot read governed workspace file {}: {error}", file.path)
        })?;
        digest.update(file.path.as_bytes());
        digest.update([0]);
        digest.update(Sha256::digest(&content));
        digest.update(b"\n");
    }
    Ok(hex_digest(&digest.finalize()))
}

fn regular_file_without_symlinks(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("Cannot inspect governed path {relative}: {error}"))?;
        if metadata.file_type().is_symlink() {
            return Err(format!(
                "Governed path contains a symbolic link: {relative}."
            ));
        }
    }
    let metadata = fs::metadata(&path)
        .map_err(|error| format!("Cannot inspect governed file {relative}: {error}"))?;
    if !metadata.is_file() {
        return Err(format!("Governed path is not a regular file: {relative}."));
    }
    Ok(path)
}

fn digest_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path)
        .map_err(|error| format!("Cannot read governed file {}: {error}", path.display()))?;
    Ok(hex_digest(&Sha256::digest(bytes)))
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
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

struct BoundedProcessResult {
    status: Option<ExitStatus>,
    timed_out: bool,
    cancelled: bool,
    stdout: CapturedStream,
    stderr: CapturedStream,
}

fn run_bounded_process(
    check: &VerificationCheck,
    cwd: &Path,
    cancellation: &dyn Cancellation,
) -> Result<BoundedProcessResult, String> {
    let mut command = Command::new(&check.executable);
    command
        .current_dir(cwd)
        .args(&check.arguments)
        .envs(check.environment.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x0000_0200);

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not start policy verification check {}: {error}",
            check.check_id
        )
    })?;
    let process_id = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Verification stdout pipe is unavailable.".to_owned())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Verification stderr pipe is unavailable.".to_owned())?;
    let budget = Arc::new(AtomicUsize::new(0));
    let stdout_capture = capture_stream(stdout, Arc::clone(&budget), check.max_output_bytes);
    let stderr_capture = capture_stream(stderr, Arc::clone(&budget), check.max_output_bytes);

    let started = Instant::now();
    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if cancellation.reason().is_some() {
            cancelled = true;
            terminate_process_tree(&mut child, process_id);
            break child.wait().ok();
        }
        if started.elapsed() >= check.timeout {
            timed_out = true;
            terminate_process_tree(&mut child, process_id);
            break child.wait().ok();
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                terminate_remaining_descendants(&mut child, process_id);
                break Some(status);
            }
            Ok(None) => thread::sleep(Duration::from_millis(10)),
            Err(error) => {
                terminate_process_tree(&mut child, process_id);
                let _ = child.wait();
                return Err(format!("Could not observe verification process: {error}"));
            }
        }
    };

    let stdout = stdout_capture
        .join()
        .map_err(|_| "Verification stdout capture panicked.".to_owned())??;
    let stderr = stderr_capture
        .join()
        .map_err(|_| "Verification stderr capture panicked.".to_owned())??;
    Ok(BoundedProcessResult {
        status,
        timed_out,
        cancelled,
        stdout,
        stderr,
    })
}

fn capture_stream<R: Read + Send + 'static>(
    mut stream: R,
    budget: Arc<AtomicUsize>,
    maximum_bytes: usize,
) -> thread::JoinHandle<Result<CapturedStream, String>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let mut total_bytes = 0_u64;
        let mut buffer = [0_u8; 8_192];
        loop {
            let count = stream
                .read(&mut buffer)
                .map_err(|error| format!("Could not capture verification output: {error}"))?;
            if count == 0 {
                break;
            }
            total_bytes = total_bytes.saturating_add(count as u64);
            let reserved = reserve_output(&budget, maximum_bytes, count);
            bytes.extend_from_slice(&buffer[..reserved]);
        }
        Ok(CapturedStream { bytes, total_bytes })
    })
}

fn reserve_output(budget: &AtomicUsize, maximum_bytes: usize, requested: usize) -> usize {
    let mut current = budget.load(AtomicOrdering::Relaxed);
    loop {
        if current >= maximum_bytes {
            return 0;
        }
        let reserved = requested.min(maximum_bytes - current);
        match budget.compare_exchange_weak(
            current,
            current + reserved,
            AtomicOrdering::AcqRel,
            AtomicOrdering::Relaxed,
        ) {
            Ok(_) => return reserved,
            Err(actual) => current = actual,
        }
    }
}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child, process_id: u32) {
    // SAFETY: the child was placed in a new process group whose ID is its PID.
    unsafe {
        libc::kill(-(process_id as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child, process_id: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(child: &mut Child, _process_id: u32) {
    let _ = child.kill();
}

#[cfg(unix)]
fn terminate_remaining_descendants(child: &mut Child, process_id: u32) {
    terminate_process_tree(child, process_id);
}

#[cfg(windows)]
fn terminate_remaining_descendants(_child: &mut Child, process_id: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &process_id.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(any(unix, windows)))]
fn terminate_remaining_descendants(_child: &mut Child, _process_id: u32) {}
