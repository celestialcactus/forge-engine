use super::*;
use crate::change_set_v2::{
    BlobContentKind, CHANGE_SET_V2_SCHEMA_VERSION, CandidateOperationAdapterConfig,
    ChangeSetV2CandidateAdapter, change_set_id,
};
use crate::{NoCancellation, workspace_snapshot_id};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static SEQ: AtomicU64 = AtomicU64::new(1);
struct Fixture {
    base: PathBuf,
    repo: PathBuf,
    state: PathBuf,
    store: FileBlobStore,
    adapter: Option<ChangeSetV2CandidateAdapter>,
    change_set: ChangeSetV2,
}
impl Fixture {
    fn new() -> Self {
        let n = SEQ.fetch_add(1, Ordering::Relaxed);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "forge-v2-coordinator-{}-{stamp}-{n}",
            std::process::id()
        ));
        let repo = base.join("repo");
        let candidates = base.join("candidates");
        let state = base.join("state");
        let blobs = base.join("blobs");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&candidates).unwrap();
        fs::create_dir_all(&state).unwrap();
        fs::create_dir_all(&blobs).unwrap();
        git_run(&repo, &["init", "--quiet"]);
        git_run(&repo, &["config", "user.email", "forge@example.test"]);
        git_run(&repo, &["config", "user.name", "Forge Test"]);
        git_run(&repo, &["config", "core.autocrlf", "false"]);
        git_run(&repo, &["config", "core.filemode", "true"]);
        fs::write(repo.join("replace.txt"), b"replace before\n").unwrap();
        fs::write(repo.join("delete.bin"), [0u8, 1, 2, 3]).unwrap();
        fs::write(repo.join("move.txt"), b"move before\n").unwrap();
        #[cfg(unix)]
        {
            fs::write(repo.join("mode.sh"), b"#!/bin/sh\n").unwrap();
        }
        git_run(&repo, &["add", "."]);
        git_run(&repo, &["commit", "--quiet", "-m", "base"]);
        let store = FileBlobStore::new(&blobs);
        let create = store
            .stage(b"created\n", BlobContentKind::Utf8Text)
            .unwrap();
        let replace = store
            .stage(b"replace after\n", BlobContentKind::Utf8Text)
            .unwrap();
        let moved = store
            .stage(b"move after\n", BlobContentKind::Utf8Text)
            .unwrap();
        let snapshot = workspace_snapshot_id(&repo).unwrap();
        let mut ops = vec![
            ChangeOperationV2::Create {
                path: "nested/new.txt".into(),
                after: create,
                mode: FileMode::Regular,
            },
            ChangeOperationV2::Replace {
                path: "replace.txt".into(),
                before_sha256: sha256(b"replace before\n"),
                before_mode: FileMode::Regular,
                after: replace,
                after_mode: FileMode::Regular,
            },
            ChangeOperationV2::Delete {
                path: "delete.bin".into(),
                before_sha256: sha256(&[0, 1, 2, 3]),
                before_mode: FileMode::Regular,
            },
            ChangeOperationV2::Move {
                from_path: "move.txt".into(),
                to_path: "moved.txt".into(),
                before_sha256: sha256(b"move before\n"),
                before_mode: FileMode::Regular,
                after: Some(moved),
                after_mode: FileMode::Regular,
            },
        ];
        #[cfg(unix)]
        ops.push(ChangeOperationV2::SetMode {
            path: "mode.sh".into(),
            before_sha256: sha256(b"#!/bin/sh\n"),
            before_mode: FileMode::Regular,
            after_mode: FileMode::Executable,
        });
        let mut change_set = ChangeSetV2 {
            schema_version: CHANGE_SET_V2_SCHEMA_VERSION,
            change_set_id: String::new(),
            snapshot_id: snapshot,
            operations: ops,
        };
        change_set.change_set_id = change_set_id(&change_set);
        let head = git_text(&repo, &["rev-parse", "HEAD"]);
        let config = CandidateOperationAdapterConfig::new(&repo, &candidates, head, store.clone());
        let adapter = ChangeSetV2CandidateAdapter::try_new(config).unwrap();
        Self {
            base,
            repo,
            state,
            store,
            adapter: Some(adapter),
            change_set,
        }
    }
    fn prepare(&mut self) -> (ChangeSetV2Coordinator, String) {
        let adapter = self.adapter.as_mut().unwrap();
        let boundary = adapter.prepare(&self.change_set).unwrap();
        adapter.apply(&boundary, &self.change_set).unwrap();
        let candidate = adapter.candidate_path().unwrap().to_path_buf();
        let coordinator = ChangeSetV2Coordinator::try_new(ChangeSetV2CoordinatorConfig::new(
            &self.repo,
            &self.state,
            self.store.clone(),
        ))
        .unwrap();
        let artifact = coordinator
            .register(&ChangeSetV2Registration {
                boundary,
                candidate_path: candidate,
                change_set: self.change_set.clone(),
            })
            .unwrap();
        assert_eq!(artifact.state, ChangeSetV2CoordinatorState::Prepared);
        (coordinator, artifact.transaction_id)
    }
    fn coordinator(&self) -> ChangeSetV2Coordinator {
        ChangeSetV2Coordinator::try_new(ChangeSetV2CoordinatorConfig::new(
            &self.repo,
            &self.state,
            self.store.clone(),
        ))
        .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = Command::new("git")
            .current_dir(&self.repo)
            .args([
                "worktree",
                "remove",
                "--force",
                self.adapter
                    .as_ref()
                    .and_then(|a| a.candidate_path())
                    .and_then(Path::to_str)
                    .unwrap_or(""),
            ])
            .output();
        let _ = Command::new("git")
            .current_dir(&self.repo)
            .args(["worktree", "prune", "--expire", "now"])
            .output();
        let _ = fs::remove_dir_all(&self.base);
    }
}
fn git_run(root: &Path, args: &[&str]) {
    let o = Command::new("git")
        .current_dir(root)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .unwrap();
    assert!(
        o.status.success(),
        "git {:?}: {}",
        args,
        String::from_utf8_lossy(&o.stderr)
    );
}
fn git_text(root: &Path, args: &[&str]) -> String {
    let o = Command::new("git")
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert!(o.status.success());
    String::from_utf8(o.stdout).unwrap().trim().into()
}

#[test]
fn promotes_full_supported_operation_set_and_survives_restart() {
    let mut f = Fixture::new();
    let (c, id) = f.prepare();
    let a = c.promote(&id, &NoCancellation);
    assert_eq!(
        a.state,
        ChangeSetV2CoordinatorState::Promoted,
        "{:?}",
        a.failure
    );
    assert_eq!(
        fs::read(f.repo.join("nested/new.txt")).unwrap(),
        b"created\n"
    );
    assert_eq!(
        fs::read(f.repo.join("replace.txt")).unwrap(),
        b"replace after\n"
    );
    assert!(!f.repo.join("delete.bin").exists());
    assert!(!f.repo.join("move.txt").exists());
    assert_eq!(fs::read(f.repo.join("moved.txt")).unwrap(), b"move after\n");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_ne!(
            fs::metadata(f.repo.join("mode.sh"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );
    }
    drop(c);
    let restarted = f.coordinator();
    let observed = restarted.inspect(&id).unwrap();
    assert_eq!(observed.state, ChangeSetV2CoordinatorState::Promoted);
    assert_eq!(
        observed.transitions.last().unwrap().state,
        ChangeSetV2CoordinatorState::Promoted
    );
}

#[derive(Clone, Copy)]
struct AbruptAt(HookPoint);
impl Hook for AbruptAt {
    fn reach(&mut self, p: HookPoint) -> Result<(), HookFailure> {
        if p == self.0 {
            Err(HookFailure::Abrupt(format!(
                "injected abrupt interruption at {p:?}"
            )))
        } else {
            Ok(())
        }
    }
}
#[test]
fn restart_rolls_back_a_mutation_not_yet_recorded() {
    let mut f = Fixture::new();
    let (c, id) = f.prepare();
    let interrupted = c.promote_hook(
        &id,
        &NoCancellation,
        &mut AbruptAt(HookPoint::OperationMutated(0)),
    );
    assert_eq!(interrupted.state, ChangeSetV2CoordinatorState::Promoting);
    drop(c);
    let restarted = f.coordinator();
    let a = restarted.inspect(&id).unwrap();
    assert_eq!(
        a.state,
        ChangeSetV2CoordinatorState::RolledBack,
        "{:?}",
        a.failure
    );
    assert_eq!(
        fs::read(f.repo.join("replace.txt")).unwrap(),
        b"replace before\n"
    );
    assert!(f.repo.join("delete.bin").exists());
    assert!(f.repo.join("move.txt").exists());
    assert!(!f.repo.join("moved.txt").exists());
    assert!(!f.repo.join("nested/new.txt").exists());
}

#[test]
fn restart_preserves_divergent_external_content_and_requires_repair() {
    let mut f = Fixture::new();
    let (c, id) = f.prepare();
    let interrupted = c.promote_hook(
        &id,
        &NoCancellation,
        &mut AbruptAt(HookPoint::OperationMutated(0)),
    );
    assert_eq!(interrupted.state, ChangeSetV2CoordinatorState::Promoting);
    let created = f.repo.join("nested/new.txt");
    assert!(created.exists(), "deterministic create must be first");
    fs::write(&created, b"external developer content\n").unwrap();
    drop(c);
    let restarted = f.coordinator();
    let a = restarted.inspect(&id).unwrap();
    assert_eq!(a.state, ChangeSetV2CoordinatorState::RepairRequired);
    assert_eq!(fs::read(created).unwrap(), b"external developer content\n");
}

struct Cancel;
impl Cancellation for Cancel {
    fn reason(&self) -> Option<String> {
        Some("test cancellation".into())
    }
}
#[test]
fn cancellation_before_mutation_is_one_durable_terminal_artifact() {
    let mut f = Fixture::new();
    let (c, id) = f.prepare();
    let a = c.promote(&id, &Cancel);
    assert_eq!(a.state, ChangeSetV2CoordinatorState::RolledBack);
    assert!(a.cancellation_reason.is_some());
    let again = c.inspect(&id).unwrap();
    assert_eq!(again.state, ChangeSetV2CoordinatorState::RolledBack);
    assert_eq!(again.transitions.len(), 2);
}

#[cfg(windows)]
#[test]
fn windows_mode_change_fails_before_transaction_publication() {
    let mut f = Fixture::new();
    let before = sha256(b"replace before\n");
    f.change_set.operations = vec![ChangeOperationV2::SetMode {
        path: "replace.txt".into(),
        before_sha256: before,
        before_mode: FileMode::Regular,
        after_mode: FileMode::Executable,
    }];
    f.change_set.change_set_id = change_set_id(&f.change_set);
    let adapter = f.adapter.as_mut().unwrap();
    let boundary = adapter.prepare(&f.change_set).unwrap();
    adapter.apply(&boundary, &f.change_set).unwrap();
    let candidate = adapter.candidate_path().unwrap().to_path_buf();
    let c = f.coordinator();
    let error = c
        .register(&ChangeSetV2Registration {
            boundary,
            candidate_path: candidate,
            change_set: f.change_set.clone(),
        })
        .unwrap_err();
    assert!(error.contains("Set-mode promotion is not yet proven on Windows"));
    assert!(fs::read_dir(&f.state).unwrap().all(|e| {
        !e.unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("transaction-")
    }));
}
