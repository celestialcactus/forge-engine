use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use super::*;

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct TemporaryDirectory(PathBuf);

impl TemporaryDirectory {
    fn new(label: &str) -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "forge-change-set-v2-{label}-{}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).expect("create test directory");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TemporaryDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn blob(bytes: &[u8], content_kind: BlobContentKind) -> BlobRef {
    BlobRef {
        sha256: sha256(bytes),
        bytes: bytes.len() as u64,
        content_kind,
    }
}

fn change_set(operations: Vec<ChangeOperationV2>) -> ChangeSetV2 {
    let mut value = ChangeSetV2 {
        schema_version: CHANGE_SET_V2_SCHEMA_VERSION,
        change_set_id: String::new(),
        snapshot_id: "workspace:test".to_owned(),
        operations,
    };
    value.change_set_id = change_set_id(&value);
    value
}

#[test]
fn validates_the_complete_bounded_operation_algebra() {
    let after_create = blob(b"created\n", BlobContentKind::Utf8Text);
    let after_replace = blob(b"replacement\n", BlobContentKind::Utf8Text);
    let after_move = blob(&[0, 1, 2, 255], BlobContentKind::Binary);
    let value = change_set(vec![
        ChangeOperationV2::Create {
            path: "src/new.ts".to_owned(),
            after: after_create,
            mode: FileMode::Regular,
        },
        ChangeOperationV2::Replace {
            path: "src/existing.ts".to_owned(),
            before_sha256: sha256(b"before"),
            before_mode: FileMode::Regular,
            after: after_replace,
            after_mode: FileMode::Executable,
        },
        ChangeOperationV2::Delete {
            path: "src/old.ts".to_owned(),
            before_sha256: sha256(b"old"),
            before_mode: FileMode::Regular,
        },
        ChangeOperationV2::Move {
            from_path: "assets/old.bin".to_owned(),
            to_path: "assets/new.bin".to_owned(),
            before_sha256: sha256(b"old-binary"),
            before_mode: FileMode::Regular,
            after: Some(after_move),
            after_mode: FileMode::Regular,
        },
        ChangeOperationV2::SetMode {
            path: "scripts/check.sh".to_owned(),
            before_sha256: sha256(b"#!/bin/sh\n"),
            before_mode: FileMode::Regular,
            after_mode: FileMode::Executable,
        },
    ]);

    let validated = validate_change_set_v2(&value, &LexicalPathIdentity::case_sensitive())
        .expect("complete operation set validates");
    assert_eq!(validated.path_identities.len(), 6);
    assert_eq!(validated.referenced_blobs.len(), 3);
    assert_eq!(validated.change_set_sha256, change_set_sha256(&value));
}

#[test]
fn identity_is_independent_of_operation_order() {
    let create = ChangeOperationV2::Create {
        path: "a.txt".to_owned(),
        after: blob(b"a", BlobContentKind::Utf8Text),
        mode: FileMode::Regular,
    };
    let delete = ChangeOperationV2::Delete {
        path: "b.txt".to_owned(),
        before_sha256: sha256(b"b"),
        before_mode: FileMode::Regular,
    };
    let left = change_set(vec![create.clone(), delete.clone()]);
    let right = change_set(vec![delete, create]);
    assert_eq!(left.change_set_id, right.change_set_id);
    assert_eq!(change_set_sha256(&left), change_set_sha256(&right));
}

#[test]
fn rejects_traversal_no_ops_and_unknown_operation_kinds() {
    let traversal = change_set(vec![ChangeOperationV2::Delete {
        path: "../outside.txt".to_owned(),
        before_sha256: sha256(b"outside"),
        before_mode: FileMode::Regular,
    }]);
    assert!(
        validate_change_set_v2(&traversal, &LexicalPathIdentity::case_sensitive())
            .unwrap_err()
            .contains("Invalid workspace-relative path")
    );

    let no_op = change_set(vec![ChangeOperationV2::Replace {
        path: "same.txt".to_owned(),
        before_sha256: sha256(b"same"),
        before_mode: FileMode::Regular,
        after: blob(b"same", BlobContentKind::Utf8Text),
        after_mode: FileMode::Regular,
    }]);
    assert!(
        validate_change_set_v2(&no_op, &LexicalPathIdentity::case_sensitive())
            .unwrap_err()
            .contains("no-op")
    );

    let unknown = serde_json::json!({
        "schemaVersion": 2,
        "changeSetId": "ignored",
        "snapshotId": "workspace:test",
        "operations": [{ "kind": "symlink", "path": "link", "target": "../outside" }]
    });
    assert!(serde_json::from_value::<ChangeSetV2>(unknown).is_err());
}

#[test]
fn applies_workspace_case_semantics_without_global_lowercasing() {
    let operations = vec![
        ChangeOperationV2::Create {
            path: "Foo.ts".to_owned(),
            after: blob(b"upper", BlobContentKind::Utf8Text),
            mode: FileMode::Regular,
        },
        ChangeOperationV2::Create {
            path: "foo.ts".to_owned(),
            after: blob(b"lower", BlobContentKind::Utf8Text),
            mode: FileMode::Regular,
        },
    ];
    let value = change_set(operations);
    validate_change_set_v2(&value, &LexicalPathIdentity::case_sensitive())
        .expect("case-sensitive workspace keeps distinct paths");
    assert!(
        validate_change_set_v2(&value, &LexicalPathIdentity::case_insensitive())
            .unwrap_err()
            .contains("paths collide")
    );

    let case_only_move = change_set(vec![ChangeOperationV2::Move {
        from_path: "README.md".to_owned(),
        to_path: "Readme.md".to_owned(),
        before_sha256: sha256(b"readme"),
        before_mode: FileMode::Regular,
        after: None,
        after_mode: FileMode::Regular,
    }]);
    validate_change_set_v2(&case_only_move, &LexicalPathIdentity::case_insensitive())
        .expect("case-only rename is one deliberate operation");
}

#[test]
fn applies_windows_and_macos_platform_path_rules() {
    let windows_reserved = change_set(vec![ChangeOperationV2::Create {
        path: "src/CON.txt".to_owned(),
        after: blob(b"reserved", BlobContentKind::Utf8Text),
        mode: FileMode::Regular,
    }]);
    assert!(
        validate_change_set_v2(&windows_reserved, &PlatformPathIdentity::windows(false))
            .unwrap_err()
            .contains("reserved Windows device name")
    );

    let windows_trailing = change_set(vec![ChangeOperationV2::Create {
        path: "src/file. ".to_owned(),
        after: blob(b"trailing", BlobContentKind::Utf8Text),
        mode: FileMode::Regular,
    }]);
    assert!(
        validate_change_set_v2(&windows_trailing, &PlatformPathIdentity::windows(false))
            .unwrap_err()
            .contains("not portable to a Windows workspace")
    );

    let mac_paths = change_set(vec![
        ChangeOperationV2::Create {
            path: "Source/Foo.swift".to_owned(),
            after: blob(b"upper", BlobContentKind::Utf8Text),
            mode: FileMode::Regular,
        },
        ChangeOperationV2::Create {
            path: "Source/foo.swift".to_owned(),
            after: blob(b"lower", BlobContentKind::Utf8Text),
            mode: FileMode::Regular,
        },
    ]);
    assert!(
        validate_change_set_v2(&mac_paths, &PlatformPathIdentity::mac_os(false))
            .unwrap_err()
            .contains("paths collide")
    );
    validate_change_set_v2(&mac_paths, &PlatformPathIdentity::mac_os(true))
        .expect("case-sensitive macOS workspace keeps distinct paths");
}

#[test]
fn rejects_move_cycles_and_conflicting_blob_metadata() {
    let cycle = change_set(vec![
        ChangeOperationV2::Move {
            from_path: "a.ts".to_owned(),
            to_path: "b.ts".to_owned(),
            before_sha256: sha256(b"a"),
            before_mode: FileMode::Regular,
            after: None,
            after_mode: FileMode::Regular,
        },
        ChangeOperationV2::Move {
            from_path: "b.ts".to_owned(),
            to_path: "a.ts".to_owned(),
            before_sha256: sha256(b"b"),
            before_mode: FileMode::Regular,
            after: None,
            after_mode: FileMode::Regular,
        },
    ]);
    assert!(
        validate_change_set_v2(&cycle, &LexicalPathIdentity::case_sensitive())
            .unwrap_err()
            .contains("paths collide")
    );

    let shared = sha256(b"shared");
    let conflict = change_set(vec![
        ChangeOperationV2::Create {
            path: "one".to_owned(),
            after: BlobRef {
                sha256: shared.clone(),
                bytes: 6,
                content_kind: BlobContentKind::Utf8Text,
            },
            mode: FileMode::Regular,
        },
        ChangeOperationV2::Create {
            path: "two".to_owned(),
            after: BlobRef {
                sha256: shared,
                bytes: 7,
                content_kind: BlobContentKind::Binary,
            },
            mode: FileMode::Regular,
        },
    ]);
    assert!(
        validate_change_set_v2(&conflict, &LexicalPathIdentity::case_sensitive())
            .unwrap_err()
            .contains("conflicting metadata")
    );
}

#[test]
fn enforces_aggregate_blob_bounds() {
    let operations = (0..5)
        .map(|index| ChangeOperationV2::Create {
            path: format!("asset-{index}.bin"),
            after: BlobRef {
                sha256: sha256(format!("asset-{index}").as_bytes()),
                bytes: MAXIMUM_BLOB_BYTES,
                content_kind: BlobContentKind::Binary,
            },
            mode: FileMode::Regular,
        })
        .collect();
    let value = change_set(operations);
    assert!(
        validate_change_set_v2(&value, &LexicalPathIdentity::case_sensitive())
            .unwrap_err()
            .contains("aggregate limit")
    );
}

#[test]
fn stages_deduplicates_and_reads_text_and_binary_blobs() {
    let temporary = TemporaryDirectory::new("cas");
    let store = FileBlobStore::new(temporary.path());
    let text = store
        .stage(b"hello\n", BlobContentKind::Utf8Text)
        .expect("stage text");
    let duplicate = store
        .stage(b"hello\n", BlobContentKind::Utf8Text)
        .expect("deduplicate text");
    let binary = store
        .stage(&[0, 159, 146, 150], BlobContentKind::Binary)
        .expect("stage binary");

    assert_eq!(text, duplicate);
    assert_eq!(store.read(&text).expect("read text"), b"hello\n");
    assert_eq!(
        store.read(&binary).expect("read binary"),
        [0, 159, 146, 150]
    );
    assert!(
        store
            .stage(&[0xff], BlobContentKind::Utf8Text)
            .unwrap_err()
            .contains("not valid UTF-8")
    );
}

#[test]
fn concurrent_blob_staging_converges_without_overwrite() {
    use std::sync::{Arc, Barrier};

    let temporary = TemporaryDirectory::new("concurrent");
    let store = Arc::new(FileBlobStore::new(temporary.path()));
    let barrier = Arc::new(Barrier::new(8));
    let handles = (0..8)
        .map(|_| {
            let store = Arc::clone(&store);
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                store.stage(b"shared bytes", BlobContentKind::Binary)
            })
        })
        .collect::<Vec<_>>();
    let references = handles
        .into_iter()
        .map(|handle| handle.join().expect("staging thread").expect("stage blob"))
        .collect::<Vec<_>>();
    assert!(references.windows(2).all(|pair| pair[0] == pair[1]));
    assert_eq!(
        store.read(&references[0]).expect("read shared blob"),
        b"shared bytes"
    );
}

#[test]
fn detects_missing_and_corrupt_staged_blobs() {
    let temporary = TemporaryDirectory::new("corruption");
    let store = FileBlobStore::new(temporary.path());
    let reference = store
        .stage(b"original", BlobContentKind::Binary)
        .expect("stage original");
    let path = temporary
        .path()
        .join("blobs")
        .join(&reference.sha256[..2])
        .join(&reference.sha256);
    fs::write(&path, b"tampered").expect("tamper blob with same size");
    assert!(
        store
            .read(&reference)
            .unwrap_err()
            .contains("digest verification")
    );
    assert!(
        store
            .stage(b"original", BlobContentKind::Binary)
            .unwrap_err()
            .contains("digest verification")
    );
    assert_eq!(fs::read(&path).expect("read corrupt path"), b"tampered");

    let missing = blob(b"missing", BlobContentKind::Binary);
    assert!(store.read(&missing).unwrap_err().contains("Cannot inspect"));
}

#[test]
fn verifies_every_manifest_blob_against_the_store() {
    let temporary = TemporaryDirectory::new("manifest");
    let store = FileBlobStore::new(temporary.path());
    let present = store
        .stage(b"present", BlobContentKind::Binary)
        .expect("stage present");
    let value = change_set(vec![ChangeOperationV2::Create {
        path: "present.bin".to_owned(),
        after: present,
        mode: FileMode::Regular,
    }]);
    let validated = validate_change_set_v2(&value, &LexicalPathIdentity::case_sensitive())
        .expect("validate manifest");
    verify_change_set_blobs(&validated, &store).expect("verify staged references");
}
