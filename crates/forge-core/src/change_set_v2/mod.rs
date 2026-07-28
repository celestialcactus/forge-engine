mod blob_store;
mod candidate_adapter;

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub use blob_store::FileBlobStore;
pub use candidate_adapter::*;

pub const CHANGE_SET_V2_SCHEMA_VERSION: u8 = 2;
pub const MAXIMUM_CHANGE_OPERATIONS: usize = 20;
pub const MAXIMUM_BLOB_BYTES: u64 = 1_048_576;
pub const MAXIMUM_AGGREGATE_BLOB_BYTES: u64 = 4_194_304;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlobContentKind {
    Utf8Text,
    Binary,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlobRef {
    pub sha256: String,
    pub bytes: u64,
    pub content_kind: BlobContentKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileMode {
    Regular,
    Executable,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ChangeOperationV2 {
    Create {
        path: String,
        after: BlobRef,
        mode: FileMode,
    },
    Replace {
        path: String,
        before_sha256: String,
        before_mode: FileMode,
        after: BlobRef,
        after_mode: FileMode,
    },
    Delete {
        path: String,
        before_sha256: String,
        before_mode: FileMode,
    },
    Move {
        from_path: String,
        to_path: String,
        before_sha256: String,
        before_mode: FileMode,
        #[serde(skip_serializing_if = "Option::is_none")]
        after: Option<BlobRef>,
        after_mode: FileMode,
    },
    SetMode {
        path: String,
        before_sha256: String,
        before_mode: FileMode,
        after_mode: FileMode,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChangeSetV2 {
    pub schema_version: u8,
    pub change_set_id: String,
    pub snapshot_id: String,
    pub operations: Vec<ChangeOperationV2>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidatedChangeSetV2 {
    pub change_set_sha256: String,
    pub path_identities: Vec<String>,
    pub referenced_blobs: Vec<BlobRef>,
}

pub trait PathIdentityResolver {
    fn identity_for(&self, workspace_relative_path: &str) -> Result<String, String>;
}

#[derive(Clone, Copy, Debug)]
pub struct LexicalPathIdentity {
    case_sensitive: bool,
}

impl LexicalPathIdentity {
    pub fn case_sensitive() -> Self {
        Self {
            case_sensitive: true,
        }
    }

    pub fn case_insensitive() -> Self {
        Self {
            case_sensitive: false,
        }
    }
}

impl PathIdentityResolver for LexicalPathIdentity {
    fn identity_for(&self, workspace_relative_path: &str) -> Result<String, String> {
        Ok(if self.case_sensitive {
            workspace_relative_path.to_owned()
        } else {
            workspace_relative_path.to_lowercase()
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WorkspacePathPlatform {
    Windows,
    MacOs,
    Unix,
}

#[derive(Clone, Copy, Debug)]
pub struct PlatformPathIdentity {
    platform: WorkspacePathPlatform,
    case_sensitive: bool,
}

impl PlatformPathIdentity {
    pub fn windows(case_sensitive: bool) -> Self {
        Self {
            platform: WorkspacePathPlatform::Windows,
            case_sensitive,
        }
    }

    pub fn mac_os(case_sensitive: bool) -> Self {
        Self {
            platform: WorkspacePathPlatform::MacOs,
            case_sensitive,
        }
    }

    pub fn unix() -> Self {
        Self {
            platform: WorkspacePathPlatform::Unix,
            case_sensitive: true,
        }
    }
}

impl PathIdentityResolver for PlatformPathIdentity {
    fn identity_for(&self, workspace_relative_path: &str) -> Result<String, String> {
        validate_workspace_relative_path(workspace_relative_path)?;
        if self.platform == WorkspacePathPlatform::Windows {
            validate_windows_path(workspace_relative_path)?;
        }
        Ok(if self.case_sensitive {
            workspace_relative_path.to_owned()
        } else {
            workspace_relative_path.to_lowercase()
        })
    }
}

fn validate_windows_path(path: &str) -> Result<(), String> {
    const INVALID_CHARACTERS: [char; 6] = ['<', '>', '"', '|', '?', '*'];
    for part in path.split('/') {
        if part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|value| INVALID_CHARACTERS.contains(&value))
        {
            return Err(format!(
                "Path is not portable to a Windows workspace: {path}."
            ));
        }
        let device_name = part
            .split('.')
            .next()
            .expect("workspace path segment")
            .to_ascii_uppercase();
        let is_reserved = matches!(device_name.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || device_name.strip_prefix("COM").is_some_and(|value| {
                matches!(value, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
            || device_name.strip_prefix("LPT").is_some_and(|value| {
                matches!(value, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
        if is_reserved {
            return Err(format!("Path uses a reserved Windows device name: {path}."));
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChangeSetIdentity<'a> {
    schema_version: u8,
    snapshot_id: &'a str,
    operations: Vec<&'a ChangeOperationV2>,
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub fn validate_workspace_relative_path(path: &str) -> Result<(), String> {
    let first = path.split('/').next().unwrap_or_default();
    let is_reserved_control_path =
        first.eq_ignore_ascii_case(".git") || first.eq_ignore_ascii_case(".forge");
    if path.is_empty()
        || path.len() > 4_096
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.contains('\0')
        || path.chars().any(char::is_control)
        || is_reserved_control_path
        || !path
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
    {
        return Err(format!("Invalid workspace-relative path: {path}."));
    }
    Ok(())
}

pub fn validate_blob_ref(blob: &BlobRef) -> Result<(), String> {
    if !is_sha256(&blob.sha256) {
        return Err("Blob reference must contain a lowercase SHA-256 digest.".to_owned());
    }
    if blob.bytes > MAXIMUM_BLOB_BYTES {
        return Err(format!(
            "Blob {} exceeds the {} byte limit.",
            blob.sha256, MAXIMUM_BLOB_BYTES
        ));
    }
    Ok(())
}

fn canonical_operation_bytes(operation: &ChangeOperationV2) -> Vec<u8> {
    serde_json::to_vec(operation).expect("ChangeSet v2 operation serialization")
}

pub fn change_set_sha256(change_set: &ChangeSetV2) -> String {
    let mut operations = change_set.operations.iter().collect::<Vec<_>>();
    operations.sort_by_key(|operation| canonical_operation_bytes(operation));
    let identity = ChangeSetIdentity {
        schema_version: change_set.schema_version,
        snapshot_id: &change_set.snapshot_id,
        operations,
    };
    sha256(&serde_json::to_vec(&identity).expect("ChangeSet v2 identity serialization"))
}

pub fn change_set_id(change_set: &ChangeSetV2) -> String {
    format!("changeset:sha256:{}", change_set_sha256(change_set))
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

fn operation_blobs(operation: &ChangeOperationV2) -> Vec<&BlobRef> {
    match operation {
        ChangeOperationV2::Create { after, .. } | ChangeOperationV2::Replace { after, .. } => {
            vec![after]
        }
        ChangeOperationV2::Move { after, .. } => after.iter().collect(),
        ChangeOperationV2::Delete { .. } | ChangeOperationV2::SetMode { .. } => Vec::new(),
    }
}

fn validate_before_digest(path: &str, digest: &str) -> Result<(), String> {
    if !is_sha256(digest) {
        return Err(format!(
            "Operation for {path} must contain a lowercase before SHA-256 digest."
        ));
    }
    Ok(())
}

fn validate_operation(operation: &ChangeOperationV2) -> Result<(), String> {
    for path in operation_paths(operation) {
        validate_workspace_relative_path(path)?;
    }
    for blob in operation_blobs(operation) {
        validate_blob_ref(blob)?;
    }
    match operation {
        ChangeOperationV2::Create { .. } => Ok(()),
        ChangeOperationV2::Replace {
            path,
            before_sha256,
            before_mode,
            after,
            after_mode,
        } => {
            validate_before_digest(path, before_sha256)?;
            if before_sha256 == &after.sha256 && before_mode == after_mode {
                return Err(format!("Replacement for {path} is a no-op."));
            }
            Ok(())
        }
        ChangeOperationV2::Delete {
            path,
            before_sha256,
            ..
        } => validate_before_digest(path, before_sha256),
        ChangeOperationV2::SetMode {
            path,
            before_sha256,
            before_mode,
            after_mode,
        } => {
            validate_before_digest(path, before_sha256)?;
            if before_mode == after_mode {
                return Err(format!("Mode change for {path} is a no-op."));
            }
            Ok(())
        }
        ChangeOperationV2::Move {
            from_path,
            to_path,
            before_sha256,
            before_mode,
            after,
            after_mode,
        } => {
            validate_before_digest(from_path, before_sha256)?;
            if from_path == to_path {
                return Err(format!(
                    "Move for {from_path} has the same source and target."
                ));
            }
            if after
                .as_ref()
                .is_some_and(|blob| blob.sha256 == *before_sha256)
                && before_mode == after_mode
            {
                return Err(format!(
                    "Move for {from_path} embeds unchanged after-content; omit the blob reference."
                ));
            }
            Ok(())
        }
    }
}

pub fn validate_change_set_v2(
    change_set: &ChangeSetV2,
    path_identity: &dyn PathIdentityResolver,
) -> Result<ValidatedChangeSetV2, String> {
    if change_set.schema_version != CHANGE_SET_V2_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported ChangeSet schema version: {}.",
            change_set.schema_version
        ));
    }
    if change_set.snapshot_id.trim().is_empty()
        || change_set.snapshot_id.len() > 256
        || change_set.snapshot_id.chars().any(char::is_control)
    {
        return Err("snapshotId must be bounded and non-empty.".to_owned());
    }
    if change_set.operations.is_empty() || change_set.operations.len() > MAXIMUM_CHANGE_OPERATIONS {
        return Err(format!(
            "ChangeSet v2 must contain 1 to {MAXIMUM_CHANGE_OPERATIONS} operations."
        ));
    }

    let expected_id = change_set_id(change_set);
    if change_set.change_set_id != expected_id {
        return Err(format!(
            "changeSetId {} does not match {expected_id}.",
            change_set.change_set_id
        ));
    }

    let mut claimed_paths = HashMap::<String, String>::new();
    let mut identities = Vec::new();
    let mut blobs = HashMap::<String, BlobRef>::new();
    let mut aggregate_bytes = 0_u64;

    for operation in &change_set.operations {
        validate_operation(operation)?;
        let paths = operation_paths(operation);
        let mut operation_identities = Vec::new();
        for path in paths {
            let identity = path_identity.identity_for(path)?;
            if identity.trim().is_empty() || identity.chars().any(char::is_control) {
                return Err(format!("Path identity resolver rejected {path}."));
            }
            operation_identities.push((path, identity));
        }

        let is_case_only_move = matches!(operation, ChangeOperationV2::Move { .. })
            && operation_identities.len() == 2
            && operation_identities[0].1 == operation_identities[1].1;
        for (index, (path, identity)) in operation_identities.into_iter().enumerate() {
            if is_case_only_move && index == 1 {
                continue;
            }
            if let Some((_, existing)) = claimed_paths.iter().find(|(existing_identity, _)| {
                identity.starts_with(&format!("{existing_identity}/"))
                    || existing_identity.starts_with(&format!("{identity}/"))
            }) {
                return Err(format!(
                    "ChangeSet file paths overlap as an ancestor and descendant: {existing} and {path}."
                ));
            }
            if let Some(existing) = claimed_paths.insert(identity.clone(), path.to_owned()) {
                return Err(format!(
                    "ChangeSet paths collide in this workspace: {existing} and {path}."
                ));
            }
            identities.push(identity);
        }

        for blob in operation_blobs(operation) {
            if let Some(existing) = blobs.get(&blob.sha256) {
                if existing != blob {
                    return Err(format!(
                        "Blob {} is referenced with conflicting metadata.",
                        blob.sha256
                    ));
                }
            } else {
                aggregate_bytes = aggregate_bytes
                    .checked_add(blob.bytes)
                    .ok_or_else(|| "Aggregate blob size overflowed u64.".to_owned())?;
                blobs.insert(blob.sha256.clone(), blob.clone());
            }
        }
    }

    if aggregate_bytes > MAXIMUM_AGGREGATE_BLOB_BYTES {
        return Err(format!(
            "ChangeSet blob references exceed the {} byte aggregate limit.",
            MAXIMUM_AGGREGATE_BLOB_BYTES
        ));
    }

    identities.sort();
    let mut referenced_blobs = blobs.into_values().collect::<Vec<_>>();
    referenced_blobs.sort_by(|left, right| left.sha256.cmp(&right.sha256));
    Ok(ValidatedChangeSetV2 {
        change_set_sha256: change_set_sha256(change_set),
        path_identities: identities,
        referenced_blobs,
    })
}

pub fn verify_change_set_blobs(
    validated: &ValidatedChangeSetV2,
    store: &FileBlobStore,
) -> Result<(), String> {
    for blob in &validated.referenced_blobs {
        store.read(blob)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests;
