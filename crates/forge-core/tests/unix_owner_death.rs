#![cfg(unix)]

use std::{
    env, fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use forge_core::{
    BaselineIsolationProvider, IsolatedProcessSpec, IsolationPolicy, IsolationProvider,
    IsolationRequest, NoCancellation,
};

static FIXTURE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const WATCHDOG: &str = env!("CARGO_BIN_EXE_forge-process-watchdog");

fn fixture_root(label: &str) -> PathBuf {
    let sequence = FIXTURE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time")
        .as_nanos();
    let root = env::temp_dir().join(format!(
        "forge-unix-owner-death-{label}-{}-{unique}-{sequence}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("create owner-death fixture");
    root
}

fn helper_arguments(name: &str) -> Vec<String> {
    vec![
        "--exact".to_owned(),
        name.to_owned(),
        "--ignored".to_owned(),
        "--nocapture".to_owned(),
    ]
}

fn tree_spec(root: &Path) -> IsolatedProcessSpec {
    IsolatedProcessSpec {
        executable: env::current_exe().expect("test executable"),
        arguments: helper_arguments("verifier_tree_helper"),
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
        readable_roots: Vec::new(),
        denied_read_roots: Vec::new(),
        denied_write_roots: Vec::new(),
        timeout: Duration::from_secs(30),
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

#[test]
fn watchdog_terminates_nested_tree_after_owner_sigkill() {
    let root = fixture_root("kill");
    let mut owner = Command::new(env::current_exe().expect("test executable"))
        .args(helper_arguments("verifier_owner_helper"))
        .env("FORGE_OWNER_FIXTURE_ROOT", &root)
        .env("FORGE_OWNER_WATCHDOG", WATCHDOG)
        .spawn()
        .expect("spawn verifier owner helper");
    wait_for_path(&root.join("tree-started.txt"), Duration::from_secs(10));
    let owner_id = i32::try_from(owner.id()).expect("owner PID");
    // SAFETY: owner_id is the live fixture process spawned above.
    assert_eq!(unsafe { libc::kill(owner_id, libc::SIGKILL) }, 0);
    owner.wait().expect("reap verifier owner");
    thread::sleep(Duration::from_millis(1_500));
    assert!(
        !root.join("descendant-survived.txt").exists(),
        "watchdog left a verifier descendant running after owner death"
    );
}

#[test]
fn missing_watchdog_fails_before_verifier_execution() {
    let root = fixture_root("missing");
    let provider =
        BaselineIsolationProvider::with_unix_watchdog_executable(root.join("missing-watchdog"));
    let error = provider
        .execute(
            &IsolationPolicy::trusted(),
            &IsolationRequest::trusted(),
            &tree_spec(&root),
            &NoCancellation,
        )
        .expect_err("missing watchdog must fail closed");
    assert!(error.contains("watchdog"), "{error}");
    assert!(!root.join("tree-started.txt").exists());
}

#[test]
fn non_executable_watchdog_fails_before_verifier_execution() {
    let root = fixture_root("not-executable");
    let watchdog = root.join("forge-process-watchdog");
    fs::write(&watchdog, "#!/bin/sh\nexit 0\n").expect("write invalid watchdog fixture");
    fs::set_permissions(&watchdog, fs::Permissions::from_mode(0o644))
        .expect("remove executable mode");
    let provider = BaselineIsolationProvider::with_unix_watchdog_executable(watchdog);
    let error = provider
        .execute(
            &IsolationPolicy::trusted(),
            &IsolationRequest::trusted(),
            &tree_spec(&root),
            &NoCancellation,
        )
        .expect_err("non-executable watchdog must fail closed");
    assert!(error.contains("not an executable file"), "{error}");
    assert!(!root.join("tree-started.txt").exists());
}

#[test]
#[ignore]
fn verifier_owner_helper() {
    let root = PathBuf::from(env::var_os("FORGE_OWNER_FIXTURE_ROOT").expect("fixture root"));
    let watchdog = PathBuf::from(env::var_os("FORGE_OWNER_WATCHDOG").expect("watchdog executable"));
    let provider = BaselineIsolationProvider::with_unix_watchdog_executable(watchdog);
    let _ = provider.execute(
        &IsolationPolicy::trusted(),
        &IsolationRequest::trusted(),
        &tree_spec(&root),
        &NoCancellation,
    );
}

#[test]
#[ignore]
#[allow(clippy::zombie_processes)]
fn verifier_tree_helper() {
    let _descendant = Command::new(env::current_exe().expect("test executable"))
        .args(helper_arguments("verifier_descendant_helper"))
        .spawn()
        .expect("spawn verifier descendant");
    thread::sleep(Duration::from_secs(30));
}

#[test]
#[ignore]
#[allow(clippy::zombie_processes)]
fn verifier_descendant_helper() {
    let _grandchild = Command::new(env::current_exe().expect("test executable"))
        .args(helper_arguments("verifier_grandchild_helper"))
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
