use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

use forge_core::{
    BlobContentKind, BlobRef, CHANGE_SET_V2_SCHEMA_VERSION, CandidateOperationAdapterConfig,
    CandidateOperationKind, ChangeOperationV2, ChangeSetV2, ChangeSetV2CandidateAdapter,
    FileBlobStore, FileMode, PathIdentityResolver, RepositoryPathIdentity, change_set_id, sha256,
    validate_change_set_v2, workspace_snapshot_id,
};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);

struct Fixture {
    root: PathBuf,
    repository: PathBuf,
    candidate_parent: PathBuf,
    blob_root: PathBuf,
    head: String,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "forge-v2-candidate-{label}-{}-{sequence}",
            std::process::id()
        ));
        let repository = root.join("repository");
        let candidate_parent = root.join("candidates");
        let blob_root = root.join("blob-store");
        fs::create_dir_all(&repository).expect("create repository");
        fs::create_dir_all(&candidate_parent).expect("create candidate parent");
        fs::create_dir_all(&blob_root).expect("create blob root");
        git(&repository, &["init", "--quiet"]);
        git(
            &repository,
            &["config", "user.email", "forge@example.invalid"],
        );
        git(&repository, &["config", "user.name", "Forge Tests"]);
        git(&repository, &["config", "core.ignorecase", "false"]);
        git(&repository, &["config", "core.autocrlf", "false"]);
        fs::create_dir_all(repository.join("src")).expect("create src");
        fs::create_dir_all(repository.join("assets")).expect("create assets");
        fs::create_dir_all(repository.join("scripts")).expect("create scripts");
        fs::write(repository.join("src/replace.txt"), b"before\n").expect("write replacement base");
        fs::write(repository.join("obsolete.txt"), b"obsolete\n").expect("write delete base");
        fs::write(repository.join("assets/old.bin"), [0_u8, 1, 2, 3]).expect("write move base");
        fs::write(repository.join("scripts/check.sh"), b"#!/bin/sh\nexit 0\n")
            .expect("write mode base");
        fs::write(repository.join(".gitignore"), b"ignored/\n").expect("write ignore file");
        git(&repository, &["add", "."]);
        git(
            &repository,
            &["update-index", "--chmod=-x", "--", "scripts/check.sh"],
        );
        git(&repository, &["commit", "--quiet", "-m", "fixture"]);
        let head = git_text(&repository, &["rev-parse", "HEAD"]);
        Self {
            root,
            repository,
            candidate_parent,
            blob_root,
            head,
        }
    }

    fn store(&self) -> FileBlobStore {
        FileBlobStore::new(&self.blob_root)
    }

    fn adapter(&self) -> ChangeSetV2CandidateAdapter {
        ChangeSetV2CandidateAdapter::try_new(CandidateOperationAdapterConfig::new(
            &self.repository,
            &self.candidate_parent,
            &self.head,
            self.store(),
        ))
        .expect("create candidate adapter")
    }

    fn snapshot_id(&self) -> String {
        workspace_snapshot_id(&self.repository).expect("workspace snapshot")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = Command::new("git")
            .args(["worktree", "prune", "--expire", "now"])
            .current_dir(&self.repository)
            .output();
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn git(root: &Path, arguments: &[&str]) {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .expect("launch git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_text(root: &Path, arguments: &[&str]) -> String {
    let output = Command::new("git")
        .args(arguments)
        .current_dir(root)
        .output()
        .expect("launch git");
    assert!(
        output.status.success(),
        "git {arguments:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout)
        .expect("git text")
        .trim()
        .to_owned()
}

fn finalize(snapshot_id: String, operations: Vec<ChangeOperationV2>) -> ChangeSetV2 {
    let mut change_set = ChangeSetV2 {
        schema_version: CHANGE_SET_V2_SCHEMA_VERSION,
        change_set_id: String::new(),
        snapshot_id,
        operations,
    };
    change_set.change_set_id = change_set_id(&change_set);
    change_set
}

fn stage(store: &FileBlobStore, bytes: &[u8], kind: BlobContentKind) -> BlobRef {
    store.stage(bytes, kind).expect("stage blob")
}

fn index_mode(root: &Path, path: &str) -> String {
    git_text(root, &["ls-files", "--stage", "--", path])
        .split_once(' ')
        .expect("index mode")
        .0
        .to_owned()
}

#[test]
fn applies_every_v2_operation_inside_a_recoverable_candidate() {
    let fixture = Fixture::new("complete");
    let store = fixture.store();
    let created = stage(&store, &[255, 0, 1, 2], BlobContentKind::Binary);
    let replacement = stage(&store, b"after\n", BlobContentKind::Utf8Text);
    let moved = stage(&store, &[9, 8, 7, 6], BlobContentKind::Binary);
    let change_set = finalize(
        fixture.snapshot_id(),
        vec![
            ChangeOperationV2::Create {
                path: "generated/new.bin".to_owned(),
                after: created.clone(),
                mode: FileMode::Regular,
            },
            ChangeOperationV2::Replace {
                path: "src/replace.txt".to_owned(),
                before_sha256: sha256(b"before\n"),
                before_mode: FileMode::Regular,
                after: replacement.clone(),
                after_mode: FileMode::Regular,
            },
            ChangeOperationV2::Delete {
                path: "obsolete.txt".to_owned(),
                before_sha256: sha256(b"obsolete\n"),
                before_mode: FileMode::Regular,
            },
            ChangeOperationV2::Move {
                from_path: "assets/old.bin".to_owned(),
                to_path: "assets/new.bin".to_owned(),
                before_sha256: sha256(&[0, 1, 2, 3]),
                before_mode: FileMode::Regular,
                after: Some(moved.clone()),
                after_mode: FileMode::Regular,
            },
            ChangeOperationV2::SetMode {
                path: "scripts/check.sh".to_owned(),
                before_sha256: sha256(b"#!/bin/sh\nexit 0\n"),
                before_mode: FileMode::Regular,
                after_mode: FileMode::Executable,
            },
        ],
    );

    let mut adapter = fixture.adapter();
    let boundary = adapter.prepare(&change_set).expect("prepare candidate");
    let candidate = adapter
        .candidate_path()
        .expect("candidate path")
        .to_path_buf();
    let application = adapter
        .apply(&boundary, &change_set)
        .expect("apply operations");

    assert_eq!(application.operations.len(), 5);
    assert_eq!(
        application
            .operations
            .iter()
            .map(|operation| operation.kind)
            .collect::<HashSet<_>>(),
        HashSet::from([
            CandidateOperationKind::Create,
            CandidateOperationKind::Replace,
            CandidateOperationKind::Delete,
            CandidateOperationKind::Move,
            CandidateOperationKind::SetMode,
        ])
    );
    assert!(application.original_workspace_unchanged);
    assert!(!application.diff.text.is_empty());
    assert_eq!(
        fs::read(candidate.join("generated/new.bin")).unwrap(),
        [255, 0, 1, 2]
    );
    assert_eq!(
        fs::read(candidate.join("src/replace.txt")).unwrap(),
        b"after\n"
    );
    assert!(!candidate.join("obsolete.txt").exists());
    assert!(!candidate.join("assets/old.bin").exists());
    assert_eq!(
        fs::read(candidate.join("assets/new.bin")).unwrap(),
        [9, 8, 7, 6]
    );
    assert_eq!(index_mode(&candidate, "scripts/check.sh"), "100755");

    assert_eq!(
        fs::read(fixture.repository.join("src/replace.txt")).unwrap(),
        b"before\n"
    );
    assert!(fixture.repository.join("obsolete.txt").is_file());
    assert!(fixture.repository.join("assets/old.bin").is_file());
    assert!(!fixture.repository.join("generated/new.bin").exists());
    assert!(git_text(&fixture.repository, &["status", "--porcelain"]).is_empty());

    adapter.discard(&boundary).expect("discard candidate");
    assert!(!candidate.exists());
}

#[test]
fn repository_identity_rejects_case_aliases_and_unproven_unicode_targets() {
    let fixture = Fixture::new("identity");
    git(&fixture.repository, &["config", "core.ignorecase", "true"]);
    let identity = RepositoryPathIdentity::inspect(&fixture.repository, Path::new("git"))
        .expect("inspect repository identity");
    assert!(!identity.case_sensitive());
    assert_eq!(
        identity.identity_for("src/replace.txt").unwrap(),
        identity.identity_for("SRC/REPLACE.TXT").unwrap()
    );

    let colliding = finalize(
        fixture.snapshot_id(),
        vec![ChangeOperationV2::Create {
            path: "SRC/REPLACE.TXT".to_owned(),
            after: stage(&fixture.store(), b"collision", BlobContentKind::Utf8Text),
            mode: FileMode::Regular,
        }],
    );
    validate_change_set_v2(&colliding, &identity).expect("single manifest path validates");
    let mut adapter = fixture.adapter();
    assert!(
        adapter
            .prepare(&colliding)
            .unwrap_err()
            .contains("collides with tracked path")
    );
    assert!(
        identity
            .identity_for("generated/caf\u{e9}.txt")
            .unwrap_err()
            .contains("non-ASCII")
    );
}

#[test]
fn rejects_ignored_targets_before_candidate_creation() {
    let fixture = Fixture::new("ignored");
    let blob = stage(&fixture.store(), b"ignored", BlobContentKind::Utf8Text);
    let change_set = finalize(
        fixture.snapshot_id(),
        vec![ChangeOperationV2::Create {
            path: "ignored/output.txt".to_owned(),
            after: blob,
            mode: FileMode::Regular,
        }],
    );
    let mut adapter = fixture.adapter();
    assert!(
        adapter
            .prepare(&change_set)
            .unwrap_err()
            .contains("ignored by Git policy")
    );
    assert!(adapter.candidate_path().is_none());
}

#[test]
fn same_size_concurrent_edit_aborts_and_removes_the_candidate() {
    let fixture = Fixture::new("concurrent-edit");
    let replacement = stage(&fixture.store(), b"after\n", BlobContentKind::Utf8Text);
    let change_set = finalize(
        fixture.snapshot_id(),
        vec![ChangeOperationV2::Replace {
            path: "src/replace.txt".to_owned(),
            before_sha256: sha256(b"before\n"),
            before_mode: FileMode::Regular,
            after: replacement,
            after_mode: FileMode::Regular,
        }],
    );
    let mut adapter = fixture.adapter();
    let boundary = adapter.prepare(&change_set).expect("prepare candidate");
    let candidate = adapter.candidate_path().unwrap().to_path_buf();
    fs::write(fixture.repository.join("src/replace.txt"), b"BEFORE\n")
        .expect("same-size external edit");
    assert!(
        adapter
            .apply(&boundary, &change_set)
            .unwrap_err()
            .contains("Original workspace changed")
    );
    assert!(!candidate.exists());
    assert!(adapter.candidate_path().is_none());
    assert_eq!(
        fs::read(fixture.repository.join("src/replace.txt")).unwrap(),
        b"BEFORE\n"
    );
}

#[test]
fn cas_corruption_after_prepare_aborts_and_removes_the_candidate() {
    let fixture = Fixture::new("cas-corruption");
    let replacement = stage(&fixture.store(), b"after\n", BlobContentKind::Utf8Text);
    let change_set = finalize(
        fixture.snapshot_id(),
        vec![ChangeOperationV2::Replace {
            path: "src/replace.txt".to_owned(),
            before_sha256: sha256(b"before\n"),
            before_mode: FileMode::Regular,
            after: replacement.clone(),
            after_mode: FileMode::Regular,
        }],
    );
    let mut adapter = fixture.adapter();
    let boundary = adapter.prepare(&change_set).expect("prepare candidate");
    let candidate = adapter.candidate_path().unwrap().to_path_buf();
    let blob_path = fixture
        .blob_root
        .join("blobs")
        .join(&replacement.sha256[..2])
        .join(&replacement.sha256);
    fs::write(blob_path, b"AFTER\n").expect("tamper staged blob with same size");
    assert!(
        adapter
            .apply(&boundary, &change_set)
            .unwrap_err()
            .contains("digest verification")
    );
    assert!(!candidate.exists());
    assert_eq!(
        fs::read(fixture.repository.join("src/replace.txt")).unwrap(),
        b"before\n"
    );
}

#[test]
fn manifest_rejects_control_paths_and_file_hierarchy_conflicts() {
    let control = finalize(
        "workspace:test".to_owned(),
        vec![ChangeOperationV2::Create {
            path: ".GiT/config".to_owned(),
            after: BlobRef {
                sha256: sha256(b"bad"),
                bytes: 3,
                content_kind: BlobContentKind::Utf8Text,
            },
            mode: FileMode::Regular,
        }],
    );
    assert!(
        validate_change_set_v2(&control, &forge_core::LexicalPathIdentity::case_sensitive())
            .unwrap_err()
            .contains("Invalid workspace-relative path")
    );

    let overlapping = finalize(
        "workspace:test".to_owned(),
        vec![
            ChangeOperationV2::Create {
                path: "generated".to_owned(),
                after: BlobRef {
                    sha256: sha256(b"file"),
                    bytes: 4,
                    content_kind: BlobContentKind::Utf8Text,
                },
                mode: FileMode::Regular,
            },
            ChangeOperationV2::Create {
                path: "generated/child.txt".to_owned(),
                after: BlobRef {
                    sha256: sha256(b"child"),
                    bytes: 5,
                    content_kind: BlobContentKind::Utf8Text,
                },
                mode: FileMode::Regular,
            },
        ],
    );
    assert!(
        validate_change_set_v2(
            &overlapping,
            &forge_core::LexicalPathIdentity::case_sensitive()
        )
        .unwrap_err()
        .contains("ancestor and descendant")
    );
}

#[test]
fn repository_file_observation_returns_a_sha256_identity() {
    let fixture = Fixture::new("observed-sha256");
    let identity = RepositoryPathIdentity::inspect(&fixture.repository, Path::new("git"))
        .expect("repository identity");
    let observed = identity
        .observe_tracked_file(&fixture.repository, Path::new("git"), "src/replace.txt")
        .expect("file identity");
    assert_eq!(observed.canonical_path, "src/replace.txt");
    assert_eq!(observed.sha256, sha256(b"before\n"));
    assert_eq!(observed.sha256.len(), 64);
}
