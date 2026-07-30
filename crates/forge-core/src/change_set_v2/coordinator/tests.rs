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
        let ops = vec![
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
        let ops = {
            let mut ops = ops;
            ops.push(ChangeOperationV2::SetMode {
                path: "mode.sh".into(),
                before_sha256: sha256(b"#!/bin/sh\n"),
                before_mode: FileMode::Regular,
                after_mode: FileMode::Executable,
            });
            ops
        };
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
                verification: Vec::new(),
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
    let prepared = c.inspect(&id).unwrap();
    assert!(prepared.candidate_retained);
    assert!(Path::new(&prepared.candidate_path).exists());
    assert_eq!(
        prepared.operation_count as usize,
        f.change_set.operations.len()
    );
    let a = c.promote(&id, &NoCancellation);
    assert!(!a.candidate_retained);
    assert!(!Path::new(&a.candidate_path).exists());
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
struct OrdinaryAt(HookPoint);
impl Hook for OrdinaryAt {
    fn reach(&mut self, point: HookPoint) -> Result<(), HookFailure> {
        if point == self.0 {
            Err(HookFailure::Ordinary("injected recoverable failure".into()))
        } else {
            Ok(())
        }
    }
}

#[test]
fn recoverable_operation_failure_rolls_back_before_returning() {
    let mut fixture = Fixture::new();
    let (coordinator, id) = fixture.prepare();
    let artifact = coordinator.promote_hook(
        &id,
        &NoCancellation,
        &mut OrdinaryAt(HookPoint::OperationRecorded(0)),
    );
    assert_eq!(artifact.state, ChangeSetV2CoordinatorState::RolledBack);
    assert!(artifact.recovery_performed);
    assert!(!fixture.repo.join("nested/new.txt").exists());
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
    assert!(a.recovery_performed);
    assert!(
        a.failure
            .as_deref()
            .is_some_and(|message| message.contains("divergent"))
    );
    assert_eq!(fs::read(created).unwrap(), b"external developer content\n");
}

#[derive(Clone, Copy)]
enum RollbackCrashPoint {
    Started,
    FirstRestored,
    BeforeTerminal,
}

struct FailThenCrash(RollbackCrashPoint);
impl Hook for FailThenCrash {
    fn reach(&mut self, point: HookPoint) -> Result<(), HookFailure> {
        match point {
            HookPoint::OperationRecorded(0) => {
                Err(HookFailure::Ordinary("start rollback fault path".into()))
            }
            HookPoint::RollbackStarted if matches!(self.0, RollbackCrashPoint::Started) => Err(
                HookFailure::Abrupt("crash after rolling_back transition".into()),
            ),
            HookPoint::RollbackRestored(_)
                if matches!(self.0, RollbackCrashPoint::FirstRestored) =>
            {
                Err(HookFailure::Abrupt(
                    "crash during rollback restoration".into(),
                ))
            }
            HookPoint::BeforeRolledBack if matches!(self.0, RollbackCrashPoint::BeforeTerminal) => {
                Err(HookFailure::Abrupt(
                    "crash before rolled_back transition".into(),
                ))
            }
            _ => Ok(()),
        }
    }
}

#[test]
fn restart_completes_every_interrupted_rollback_phase() {
    for point in [
        RollbackCrashPoint::Started,
        RollbackCrashPoint::FirstRestored,
        RollbackCrashPoint::BeforeTerminal,
    ] {
        let mut fixture = Fixture::new();
        let (coordinator, id) = fixture.prepare();
        let interrupted = coordinator.promote_hook(&id, &NoCancellation, &mut FailThenCrash(point));
        assert_eq!(interrupted.state, ChangeSetV2CoordinatorState::RollingBack);
        drop(coordinator);
        let restarted = fixture.coordinator();
        let recovered = restarted.inspect(&id).unwrap();
        assert_eq!(
            recovered.state,
            ChangeSetV2CoordinatorState::RolledBack,
            "{:?}",
            recovered.failure
        );
        assert_eq!(
            fs::read(fixture.repo.join("replace.txt")).unwrap(),
            b"replace before\n"
        );
        assert!(!fixture.repo.join("nested/new.txt").exists());
    }
}
#[test]
fn invalid_durable_transition_graph_fails_closed() {
    use std::io::Write as _;

    let mut fixture = Fixture::new();
    let (coordinator, id) = fixture.prepare();
    let path = coordinator.tx_dir(&id).unwrap().join("transitions.jsonl");
    let invalid = ChangeSetV2Transition {
        sequence: 2,
        state: ChangeSetV2CoordinatorState::Promoted,
        operation_sequence: None,
        at_unix_ms: now().unwrap(),
        message: Some("invalid direct terminal transition".into()),
    };
    let mut file = fs::OpenOptions::new().append(true).open(path).unwrap();
    serde_json::to_writer(&mut file, &invalid).unwrap();
    file.write_all(b"\n").unwrap();
    file.sync_all().unwrap();
    let error = coordinator.inspect(&id).unwrap_err();
    assert!(error.contains("transition graph is invalid"));
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
    assert!(!a.candidate_retained);
    assert!(!Path::new(&a.candidate_path).exists());
    let again = c.inspect(&id).unwrap();
    assert_eq!(again.state, ChangeSetV2CoordinatorState::RolledBack);
    assert_eq!(again.transitions.len(), 2);
}

#[cfg(windows)]
#[test]
fn windows_mode_change_fails_before_transaction_publication() {
    let fixture = Fixture::new();
    let mut change_set = ChangeSetV2 {
        schema_version: CHANGE_SET_V2_SCHEMA_VERSION,
        change_set_id: String::new(),
        snapshot_id: fixture.change_set.snapshot_id.clone(),
        operations: vec![ChangeOperationV2::SetMode {
            path: "replace.txt".into(),
            before_sha256: sha256(b"replace before\n"),
            before_mode: FileMode::Regular,
            after_mode: FileMode::Executable,
        }],
    };
    change_set.change_set_id = change_set_id(&change_set);
    let coordinator = fixture.coordinator();
    let identity = RepositoryPathIdentity::inspect(&fixture.repo, Path::new("git")).unwrap();
    let error = coordinator
        .platform_support(&change_set, &identity)
        .unwrap_err();
    assert!(error.contains("Set-mode promotion is not yet proven on Windows"));
    assert!(fs::read_dir(&fixture.state).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("transaction-")
    }));
}
