use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use super::{
    BaselineIsolationProvider, IsolatedProcessSpec, IsolationPolicy, IsolationProvider,
    IsolationRequest,
};
use crate::{Cancellation, NoCancellation};

static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct CancelAfter {
    started: Instant,
    delay: Duration,
}

impl Cancellation for CancelAfter {
    fn reason(&self) -> Option<String> {
        (self.started.elapsed() >= self.delay)
            .then(|| "Process ownership cancellation fixture.".to_owned())
    }
}

fn fixture_root(label: &str) -> PathBuf {
    let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = env::temp_dir().join(format!(
        "forge-process-ownership-{label}-{}-{unique}-{sequence}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create process ownership fixture");
    root
}

fn tree_spec(root: &Path, timeout: Duration) -> IsolatedProcessSpec {
    IsolatedProcessSpec {
        executable: env::current_exe().expect("test executable"),
        arguments: vec![
            "--exact".to_owned(),
            "isolation::process_ownership_tests::verifier_tree_helper".to_owned(),
            "--ignored".to_owned(),
            "--nocapture".to_owned(),
        ],
        environment: vec![
            (
                "FORGE_TREE_STARTED_MARKER".to_owned(),
                root.join("tree-started.txt").to_string_lossy().into_owned(),
            ),
            (
                "FORGE_DESCENDANT_MARKER".to_owned(),
                root.join("descendant-survived.txt")
                    .to_string_lossy()
                    .into_owned(),
            ),
        ],
        inherited_environment: Vec::new(),
        working_directory: root.to_path_buf(),
        timeout,
        max_output_bytes: 16_384,
    }
}

fn wait_for_path(path: &Path, timeout: Duration) {
    let started = Instant::now();
    while !path.exists() {
        assert!(
            started.elapsed() < timeout,
            "fixture marker was not created"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn assert_descendant_cannot_finish(root: &Path) {
    thread::sleep(Duration::from_millis(1_200));
    assert!(
        !root.join("descendant-survived.txt").exists(),
        "nested verifier descendant survived process-tree termination"
    );
}

#[test]
fn repeated_timeout_and_cancellation_terminate_nested_process_trees() {
    for iteration in 0..3 {
        let timeout_root = fixture_root(&format!("timeout-{iteration}"));
        let timeout = BaselineIsolationProvider
            .execute(
                &IsolationPolicy::trusted(),
                &IsolationRequest::trusted(),
                &tree_spec(&timeout_root, Duration::from_millis(500)),
                &NoCancellation,
            )
            .expect("timeout process ownership result");
        assert!(timeout.timed_out);
        assert!(!timeout.cancelled);
        assert!(timeout_root.join("tree-started.txt").exists());
        assert_descendant_cannot_finish(&timeout_root);

        let cancellation_root = fixture_root(&format!("cancellation-{iteration}"));
        let cancellation = CancelAfter {
            started: Instant::now(),
            delay: Duration::from_millis(500),
        };
        let cancelled = BaselineIsolationProvider
            .execute(
                &IsolationPolicy::trusted(),
                &IsolationRequest::trusted(),
                &tree_spec(&cancellation_root, Duration::from_secs(5)),
                &cancellation,
            )
            .expect("cancelled process ownership result");
        assert!(!cancelled.timed_out);
        assert!(cancelled.cancelled);
        assert!(cancellation_root.join("tree-started.txt").exists());
        assert_descendant_cannot_finish(&cancellation_root);
    }
}

#[test]
fn direct_child_exit_terminates_remaining_nested_descendants() {
    let root = fixture_root("direct-exit");
    let mut spec = tree_spec(&root, Duration::from_secs(5));
    spec.arguments[1] =
        "isolation::process_ownership_tests::verifier_detaching_tree_helper".to_owned();
    let outcome = BaselineIsolationProvider
        .execute(
            &IsolationPolicy::trusted(),
            &IsolationRequest::trusted(),
            &spec,
            &NoCancellation,
        )
        .expect("direct-exit process ownership result");
    assert!(outcome.status.is_some_and(|status| status.success()));
    assert!(!outcome.timed_out);
    assert!(!outcome.cancelled);
    assert!(root.join("tree-started.txt").exists());
    assert_descendant_cannot_finish(&root);
}

#[cfg(windows)]
#[test]
fn job_handle_closure_terminates_nested_tree_after_owner_is_killed() {
    let root = fixture_root("owner-death");
    let mut owner = Command::new(env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "isolation::process_ownership_tests::verifier_owner_helper",
            "--ignored",
            "--nocapture",
        ])
        .env("FORGE_OWNER_FIXTURE_ROOT", &root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn verifier owner helper");
    wait_for_path(&root.join("tree-started.txt"), Duration::from_secs(5));
    owner.kill().expect("kill verifier owner helper");
    owner.wait().expect("reap verifier owner helper");
    assert_descendant_cannot_finish(&root);
}

#[test]
#[ignore]
fn verifier_owner_helper() {
    let root = PathBuf::from(env::var_os("FORGE_OWNER_FIXTURE_ROOT").expect("fixture root"));
    let _ = BaselineIsolationProvider.execute(
        &IsolationPolicy::trusted(),
        &IsolationRequest::trusted(),
        &tree_spec(&root, Duration::from_secs(30)),
        &NoCancellation,
    );
}

#[test]
#[ignore]
#[allow(clippy::zombie_processes)]
fn verifier_detaching_tree_helper() {
    let _descendant = Command::new(env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "isolation::process_ownership_tests::verifier_descendant_helper",
            "--ignored",
            "--nocapture",
        ])
        .spawn()
        .expect("spawn verifier descendant");
    let marker =
        PathBuf::from(env::var_os("FORGE_TREE_STARTED_MARKER").expect("started marker path"));
    wait_for_path(&marker, Duration::from_secs(5));
}

#[test]
#[ignore]
#[allow(clippy::zombie_processes)]
fn verifier_tree_helper() {
    let _descendant = Command::new(env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "isolation::process_ownership_tests::verifier_descendant_helper",
            "--ignored",
            "--nocapture",
        ])
        .spawn()
        .expect("spawn verifier descendant");
    thread::sleep(Duration::from_secs(30));
}

#[test]
#[ignore]
#[allow(clippy::zombie_processes)]
fn verifier_descendant_helper() {
    let _grandchild = Command::new(env::current_exe().expect("test executable"))
        .args([
            "--exact",
            "isolation::process_ownership_tests::verifier_grandchild_helper",
            "--ignored",
            "--nocapture",
        ])
        .spawn()
        .expect("spawn verifier grandchild");
    fs::write(
        env::var_os("FORGE_TREE_STARTED_MARKER").expect("started marker"),
        "started\n",
    )
    .expect("write started marker");
    thread::sleep(Duration::from_secs(30));
}

#[test]
#[ignore]
fn verifier_grandchild_helper() {
    thread::sleep(Duration::from_secs(1));
    fs::write(
        env::var_os("FORGE_DESCENDANT_MARKER").expect("descendant marker"),
        "survived\n",
    )
    .expect("write descendant marker");
}
