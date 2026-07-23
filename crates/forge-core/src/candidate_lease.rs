use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const LEASE_SCHEMA_VERSION: u8 = 1;
const MAX_RECORD_BYTES: u64 = 128 * 1_024;
const MAX_GIT_OUTPUT_BYTES: usize = 32 * 1_048_576;
const MAX_CHANGES: usize = 20;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateLeaseState {
    Retained,
    CleanupFailed,
    Promoted,
    Discarded,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateLeaseChange {
    pub path: String,
    pub before_sha256: String,
    pub after_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CandidateLeaseRegistration {
    pub boundary_id: String,
    pub candidate_path: PathBuf,
    pub base_revision: String,
    pub proposal_id: String,
    pub snapshot_id: String,
    pub changes: Vec<CandidateLeaseChange>,
    pub final_diff_sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CandidateLeaseRecord {
    pub schema_version: u8,
    pub candidate_id: String,
    pub boundary_id: String,
    pub repository_id: String,
    pub repository_root: String,
    pub candidate_path: String,
    pub base_revision: String,
    pub proposal_id: String,
    pub snapshot_id: String,
    pub changes: Vec<CandidateLeaseChange>,
    pub final_diff_sha256: String,
    pub created_at_unix_ms: u64,
    pub updated_at_unix_ms: u64,
    pub state: CandidateLeaseState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cleanup_failure: Option<String>,
}

pub(crate) struct CandidateLeaseLock(File);

impl Drop for CandidateLeaseLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

#[derive(Clone, Debug)]
pub struct FileCandidateLeaseStore {
    repository_root: PathBuf,
    candidate_parent: PathBuf,
    state_root: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CandidateIdentity<'a> {
    boundary_id: &'a str,
    repository_id: &'a str,
    candidate_path: &'a str,
    base_revision: &'a str,
    proposal_id: &'a str,
    snapshot_id: &'a str,
    changes: &'a [CandidateLeaseChange],
    final_diff_sha256: &'a str,
}

impl FileCandidateLeaseStore {
    pub fn try_new(
        repository_root: impl AsRef<Path>,
        candidate_parent: impl AsRef<Path>,
        state_root: impl AsRef<Path>,
    ) -> Result<Self, String> {
        let repository_root = fs::canonicalize(repository_root.as_ref())
            .map_err(|error| format!("Cannot resolve lease repository root: {error}"))?;
        fs::create_dir_all(candidate_parent.as_ref())
            .map_err(|error| format!("Cannot create candidate parent: {error}"))?;
        let candidate_parent = fs::canonicalize(candidate_parent.as_ref())
            .map_err(|error| format!("Cannot resolve candidate parent: {error}"))?;
        fs::create_dir_all(state_root.as_ref())
            .map_err(|error| format!("Cannot create candidate lease state root: {error}"))?;
        let state_root = fs::canonicalize(state_root.as_ref())
            .map_err(|error| format!("Cannot resolve candidate lease state root: {error}"))?;

        if path_is_within(&candidate_parent, &repository_root) {
            return Err("candidate_parent must be outside the governed repository.".to_owned());
        }
        if !path_is_within(&state_root, &candidate_parent) || state_root == candidate_parent {
            return Err("Candidate lease state must be a child of candidate_parent.".to_owned());
        }

        Ok(Self {
            repository_root,
            candidate_parent,
            state_root,
        })
    }

    pub fn register_retained(
        &self,
        registration: CandidateLeaseRegistration,
    ) -> Result<CandidateLeaseRecord, String> {
        let candidate_path = fs::canonicalize(&registration.candidate_path)
            .map_err(|error| format!("Cannot resolve retained candidate path: {error}"))?;
        self.validate_candidate_path(&candidate_path)?;
        validate_registration(&registration)?;

        let repository_root = utf8_path(&self.repository_root, "repository root")?;
        let candidate_path_text = utf8_path(&candidate_path, "candidate path")?;
        let repository_id = repository_id(&repository_root, &registration.base_revision);
        let identity = CandidateIdentity {
            boundary_id: &registration.boundary_id,
            repository_id: &repository_id,
            candidate_path: &candidate_path_text,
            base_revision: &registration.base_revision,
            proposal_id: &registration.proposal_id,
            snapshot_id: &registration.snapshot_id,
            changes: &registration.changes,
            final_diff_sha256: &registration.final_diff_sha256,
        };
        let candidate_id = format!(
            "candidate:{}",
            digest(&serde_json::to_vec(&identity).expect("candidate identity serialization"))
        );
        let _lock = self.lock(&candidate_id)?;
        if self.state_path(&candidate_id, "retained")?.exists() {
            return self.load(&candidate_id);
        }
        let now = unix_ms()?;
        let record = CandidateLeaseRecord {
            schema_version: LEASE_SCHEMA_VERSION,
            candidate_id,
            boundary_id: registration.boundary_id,
            repository_id,
            repository_root,
            candidate_path: candidate_path_text,
            base_revision: registration.base_revision,
            proposal_id: registration.proposal_id,
            snapshot_id: registration.snapshot_id,
            changes: registration.changes,
            final_diff_sha256: registration.final_diff_sha256,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
            state: CandidateLeaseState::Retained,
            cleanup_failure: None,
        };
        self.write_transition(&record, "retained")?;
        Ok(record)
    }

    pub fn load(&self, candidate_id: &str) -> Result<CandidateLeaseRecord, String> {
        validate_candidate_id(candidate_id)?;
        for (suffix, state) in [
            ("discarded", CandidateLeaseState::Discarded),
            ("promoted", CandidateLeaseState::Promoted),
            ("cleanup-failed", CandidateLeaseState::CleanupFailed),
            ("retained", CandidateLeaseState::Retained),
        ] {
            let path = self.state_path(candidate_id, suffix)?;
            if path.exists() {
                let record = read_record(&path)?;
                self.validate_record(&record, candidate_id, &state)?;
                return Ok(record);
            }
        }
        Err(format!("Unknown candidate lease: {candidate_id}."))
    }

    pub fn discard(
        &self,
        candidate_id: &str,
        git_executable: impl AsRef<Path>,
    ) -> Result<CandidateLeaseRecord, String> {
        let _lock = self.lock(candidate_id)?;
        let record = self.load(candidate_id)?;
        self.discard_locked(record, git_executable.as_ref())
    }

    pub(crate) fn discard_locked(
        &self,
        record: CandidateLeaseRecord,
        git_executable: &Path,
    ) -> Result<CandidateLeaseRecord, String> {
        if record.state == CandidateLeaseState::Discarded {
            return Ok(record);
        }
        let candidate_path = PathBuf::from(&record.candidate_path);
        self.validate_candidate_path(&candidate_path)?;

        let cleanup = (|| -> Result<(), String> {
            if candidate_path.exists() {
                successful_git(
                    git_executable,
                    &self.repository_root,
                    &[
                        OsString::from("worktree"),
                        OsString::from("remove"),
                        OsString::from("--force"),
                        git_path(&candidate_path),
                    ],
                    "Git retained-candidate removal",
                )?;
            }
            successful_git(
                git_executable,
                &self.repository_root,
                &strings(&["worktree", "prune", "--expire", "now"]),
                "Git worktree metadata prune",
            )?;
            if candidate_path.exists() {
                return Err("Candidate directory still exists after discard.".to_owned());
            }
            Ok(())
        })();

        if let Err(error) = cleanup {
            let mut failed = record;
            failed.state = CandidateLeaseState::CleanupFailed;
            failed.updated_at_unix_ms = unix_ms()?;
            failed.cleanup_failure = Some(bounded_message(&error));
            if !self
                .state_path(&failed.candidate_id, "cleanup-failed")?
                .exists()
            {
                self.write_transition(&failed, "cleanup-failed")?;
            }
            return Err(error);
        }

        self.record_discarded_locked(record)
    }

    pub(crate) fn acquire_lock(&self, candidate_id: &str) -> Result<CandidateLeaseLock, String> {
        self.lock(candidate_id)
    }

    pub(crate) fn validate_candidate_path_for_lifecycle(
        &self,
        candidate_path: &Path,
    ) -> Result<(), String> {
        self.validate_candidate_path(candidate_path)
    }

    pub(crate) fn record_promoted_locked(
        &self,
        mut record: CandidateLeaseRecord,
    ) -> Result<CandidateLeaseRecord, String> {
        if record.state == CandidateLeaseState::Promoted {
            return Ok(record);
        }
        if record.state != CandidateLeaseState::Retained {
            return Err("Only a retained candidate can be promoted.".to_owned());
        }
        record.state = CandidateLeaseState::Promoted;
        record.updated_at_unix_ms = unix_ms()?;
        record.cleanup_failure = None;
        if !self.state_path(&record.candidate_id, "promoted")?.exists() {
            self.write_transition(&record, "promoted")?;
        }
        Ok(record)
    }

    pub fn record_discarded_after_cleanup(
        &self,
        candidate_id: &str,
    ) -> Result<CandidateLeaseRecord, String> {
        let _lock = self.lock(candidate_id)?;
        let record = self.load(candidate_id)?;
        if record.state == CandidateLeaseState::Discarded {
            return Ok(record);
        }
        let candidate_path = PathBuf::from(&record.candidate_path);
        self.validate_candidate_path(&candidate_path)?;
        if candidate_path.exists() {
            return Err("Cannot record discard while the candidate path still exists.".to_owned());
        }
        self.record_discarded_locked(record)
    }
    fn record_discarded_locked(
        &self,
        mut record: CandidateLeaseRecord,
    ) -> Result<CandidateLeaseRecord, String> {
        record.state = CandidateLeaseState::Discarded;
        record.updated_at_unix_ms = unix_ms()?;
        record.cleanup_failure = None;
        if !self.state_path(&record.candidate_id, "discarded")?.exists() {
            self.write_transition(&record, "discarded")?;
        }
        Ok(record)
    }

    fn validate_candidate_path(&self, candidate_path: &Path) -> Result<(), String> {
        let parent_matches = candidate_path
            .parent()
            .is_some_and(|parent| paths_equal(parent, &self.candidate_parent));
        let forge_named = candidate_path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.starts_with("forge-") && !name.contains(['/', '\\', '\0']));
        if !candidate_path.is_absolute()
            || !parent_matches
            || !forge_named
            || path_is_within(candidate_path, &self.state_root)
        {
            return Err("Candidate lease path is not a direct Forge candidate child.".to_owned());
        }
        Ok(())
    }

    fn validate_record(
        &self,
        record: &CandidateLeaseRecord,
        candidate_id: &str,
        expected_state: &CandidateLeaseState,
    ) -> Result<(), String> {
        if record.schema_version != LEASE_SCHEMA_VERSION
            || record.candidate_id != candidate_id
            || &record.state != expected_state
            || record.repository_root != utf8_path(&self.repository_root, "repository root")?
            || record.repository_id != repository_id(&record.repository_root, &record.base_revision)
            || !bounded_identifier(&record.boundary_id, 512)
            || !bounded_identifier(&record.base_revision, 128)
            || !bounded_identifier(&record.proposal_id, 128)
            || !bounded_identifier(&record.snapshot_id, 128)
            || !is_digest(&record.final_diff_sha256)
            || record.changes.is_empty()
            || record.changes.len() > MAX_CHANGES
        {
            return Err("Candidate lease record failed identity validation.".to_owned());
        }
        self.validate_candidate_path(Path::new(&record.candidate_path))?;
        for change in &record.changes {
            validate_change(change)?;
        }
        Ok(())
    }

    fn state_path(&self, candidate_id: &str, suffix: &str) -> Result<PathBuf, String> {
        let digest = validate_candidate_id(candidate_id)?;
        Ok(self.state_root.join(format!("{digest}.{suffix}.json")))
    }

    fn lock(&self, candidate_id: &str) -> Result<CandidateLeaseLock, String> {
        let digest = validate_candidate_id(candidate_id)?;
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(self.state_root.join(format!("{digest}.lock")))
            .map_err(|error| format!("Cannot open candidate lease lock: {error}"))?;
        file.try_lock()
            .map_err(|error| format!("Candidate lease is already being modified: {error}"))?;
        Ok(CandidateLeaseLock(file))
    }

    fn write_transition(&self, record: &CandidateLeaseRecord, suffix: &str) -> Result<(), String> {
        let target = self.state_path(&record.candidate_id, suffix)?;
        if target.exists() {
            return Err(format!(
                "Candidate lease transition already exists: {suffix}."
            ));
        }
        let bytes = serde_json::to_vec_pretty(record)
            .map_err(|error| format!("Cannot serialize candidate lease: {error}"))?;
        if bytes.len() as u64 > MAX_RECORD_BYTES {
            return Err("Candidate lease exceeds the 128 KiB record ceiling.".to_owned());
        }
        if bytes
            .windows(b"replacementText".len())
            .any(|part| part == b"replacementText")
        {
            return Err("Candidate lease must not contain replacement content.".to_owned());
        }
        let temporary = self.state_root.join(format!(
            ".{}.{}-{}.tmp",
            validate_candidate_id(&record.candidate_id)?,
            std::process::id(),
            unix_ms()?
        ));
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| format!("Cannot create candidate lease transition: {error}"))?;
        let write_result = (|| -> Result<(), String> {
            file.write_all(&bytes)
                .map_err(|error| format!("Cannot write candidate lease transition: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("Cannot sync candidate lease transition: {error}"))?;
            fs::rename(&temporary, &target)
                .map_err(|error| format!("Cannot publish candidate lease transition: {error}"))?;
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }
}

fn validate_registration(registration: &CandidateLeaseRegistration) -> Result<(), String> {
    if !bounded_identifier(&registration.boundary_id, 512)
        || !bounded_identifier(&registration.base_revision, 128)
        || !bounded_identifier(&registration.proposal_id, 128)
        || !bounded_identifier(&registration.snapshot_id, 128)
        || !is_digest(&registration.final_diff_sha256)
        || registration.changes.is_empty()
        || registration.changes.len() > MAX_CHANGES
    {
        return Err("Candidate lease registration is incomplete or out of bounds.".to_owned());
    }
    for change in &registration.changes {
        validate_change(change)?;
    }
    Ok(())
}

fn validate_change(change: &CandidateLeaseChange) -> Result<(), String> {
    if change.path.is_empty()
        || change.path.len() > 4_096
        || change.path.starts_with('/')
        || change.path.contains('\\')
        || change.path.contains(':')
        || change.path.contains('\0')
        || change
            .path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !is_digest(&change.before_sha256)
        || !is_digest(&change.after_sha256)
    {
        return Err(format!("Invalid candidate lease change: {}.", change.path));
    }
    Ok(())
}

fn bounded_identifier(value: &str, maximum_bytes: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum_bytes && !value.chars().any(char::is_control)
}

fn validate_candidate_id(candidate_id: &str) -> Result<&str, String> {
    let digest = candidate_id
        .strip_prefix("candidate:")
        .ok_or_else(|| "Candidate ID must begin with candidate:.".to_owned())?;
    if !is_digest(digest) {
        return Err("Candidate ID must contain a lowercase SHA-256 digest.".to_owned());
    }
    Ok(digest)
}

fn repository_id(repository_root: &str, base_revision: &str) -> String {
    digest(format!("{repository_root}\n{base_revision}").as_bytes())
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn utf8_path(path: &Path, label: &str) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("Candidate lease {label} is not valid UTF-8."))
}

fn unix_ms() -> Result<u64, String> {
    let value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("System clock cannot timestamp candidate lease: {error}"))?
        .as_millis();
    u64::try_from(value).map_err(|_| "Candidate lease timestamp overflowed u64.".to_owned())
}

fn read_record(path: &Path) -> Result<CandidateLeaseRecord, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Cannot inspect candidate lease record: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES {
        return Err("Candidate lease record is not a bounded regular file.".to_owned());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Cannot read candidate lease record: {error}"))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Cannot parse candidate lease record: {error}"))
}

fn successful_git(
    executable: &Path,
    root: &Path,
    arguments: &[OsString],
    operation: &str,
) -> Result<(), String> {
    let output = Command::new(executable)
        .current_dir(root)
        .args(arguments)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Could not start Git: {error}"))?;
    if output.stdout.len().saturating_add(output.stderr.len()) > MAX_GIT_OUTPUT_BYTES {
        return Err("Git output exceeded the 32 MiB candidate lease ceiling.".to_owned());
    }
    if !output.status.success() {
        return Err(format!(
            "{operation} failed: {}",
            bounded_message(&String::from_utf8_lossy(&output.stderr))
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

fn bounded_message(value: &str) -> String {
    value.chars().take(2_000).collect()
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
