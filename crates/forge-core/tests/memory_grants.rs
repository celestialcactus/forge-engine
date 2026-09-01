use forge_core::{
    MemoryCaptureMode, MemoryFreshness, MemoryGrantId, MemoryGrantScope, MemoryObservation,
    MemoryObservationInput, MemoryObservationRelation, MemoryOperation, MemoryProvenance,
    MemoryScope, MemoryStandingGrant, MemoryStatementKind, MemoryStore, MemoryStoreLimits,
    MemorySubjectKind, PreferenceAdmission,
};

const ACTOR: &str = "developer:fixture";

fn developer_scope() -> MemoryScope {
    MemoryScope::Developer {
        actor_id: ACTOR.to_owned(),
    }
}

fn repository_grant_scope() -> MemoryGrantScope {
    MemoryGrantScope::Repository {
        workspace_id: "workspace:fixture".to_owned(),
        repository_id: "repository:forge".to_owned(),
    }
}

fn preference(
    statement: &str,
    grant_id: MemoryGrantId,
    actor_id: &str,
    observed_at_millis: i64,
) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::DeveloperPreference,
        statement_kind: MemoryStatementKind::DeveloperPreference,
        subject: "developer preference".to_owned(),
        statement: statement.to_owned(),
        scope: MemoryScope::Developer {
            actor_id: actor_id.to_owned(),
        },
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: "memory:cli8a:auto".to_owned(),
            actor_id: actor_id.to_owned(),
            source_id: format!("input:{observed_at_millis}"),
            input_sha256: "a".repeat(64),
            admission: Some(PreferenceAdmission::StandingGrant { grant_id }),
        },
        relation: MemoryObservationRelation::Supports,
        confidence: 100,
        observed_at_millis,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    })
    .unwrap()
}

#[test]
fn grant_identity_is_stable_and_bound_to_actor_and_scope() {
    let first = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        repository_grant_scope(),
        MemoryCaptureMode::Ask,
        10,
    )
    .unwrap();
    let changed_mode = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        repository_grant_scope(),
        MemoryCaptureMode::Auto,
        20,
    )
    .unwrap();
    let other_scope = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        MemoryGrantScope::Repository {
            workspace_id: "workspace:fixture".to_owned(),
            repository_id: "repository:other".to_owned(),
        },
        MemoryCaptureMode::Auto,
        20,
    )
    .unwrap();

    assert_eq!(first.grant_id, changed_mode.grant_id);
    assert_ne!(first.grant_id, other_scope.grant_id);
    assert!(
        changed_mode
            .grant_id
            .0
            .starts_with("memory_grant:v1:sha256:")
    );
    changed_mode.validate_identity().unwrap();

    let mut tampered = changed_mode;
    tampered.grant_id = MemoryGrantId(format!("memory_grant:v1:sha256:{}", "f".repeat(64)));
    assert_eq!(
        tampered.validate_identity().unwrap_err().code(),
        "memory_grant_identity_mismatch"
    );
}

#[test]
fn only_an_active_exact_auto_grant_admits_a_preference() {
    let root = test_root("grant-admission");
    let grant_scope = repository_grant_scope();
    let ask = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        grant_scope.clone(),
        MemoryCaptureMode::Ask,
        10,
    )
    .unwrap();
    let observation = preference(
        "I prefer concise test output.",
        ask.grant_id.clone(),
        ACTOR,
        20,
    );
    let mut store =
        MemoryStore::open(&root, developer_scope(), MemoryStoreLimits::default()).unwrap();
    store
        .apply(MemoryOperation::SetCaptureMode { grant: ask.clone() })
        .unwrap();
    assert_eq!(
        store
            .apply(MemoryOperation::AutoCapture {
                observation: observation.clone(),
                grant_id: ask.grant_id.clone(),
                grant_scope: grant_scope.clone(),
            })
            .unwrap_err()
            .code(),
        "memory_admission_grant_inactive"
    );

    let auto = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        grant_scope.clone(),
        MemoryCaptureMode::Auto,
        30,
    )
    .unwrap();
    store
        .apply(MemoryOperation::SetCaptureMode {
            grant: auto.clone(),
        })
        .unwrap();
    assert_eq!(
        store
            .apply(MemoryOperation::AutoCapture {
                observation: observation.clone(),
                grant_id: auto.grant_id.clone(),
                grant_scope: MemoryGrantScope::Repository {
                    workspace_id: "workspace:fixture".to_owned(),
                    repository_id: "repository:other".to_owned(),
                },
            })
            .unwrap_err()
            .code(),
        "memory_admission_scope_mismatch"
    );
    let admitted = store
        .apply(MemoryOperation::AutoCapture {
            observation: observation.clone(),
            grant_id: auto.grant_id,
            grant_scope,
        })
        .unwrap();
    assert_eq!(admitted.active_observation, Some(observation));
    assert_eq!(store.inspect(false).active_count, 1);
    drop(store);
    cleanup(&root);
}

#[test]
fn mismatched_actor_and_repository_store_cannot_create_or_use_grant() {
    let root = test_root("grant-authority");
    let grant_scope = repository_grant_scope();
    let grant = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        grant_scope.clone(),
        MemoryCaptureMode::Auto,
        10,
    )
    .unwrap();
    let repository_scope = MemoryScope::Repository {
        workspace_id: "workspace:fixture".to_owned(),
        repository_id: "repository:forge".to_owned(),
    };
    let mut repository_store =
        MemoryStore::open(&root, repository_scope, MemoryStoreLimits::default()).unwrap();
    assert_eq!(
        repository_store
            .apply(MemoryOperation::SetCaptureMode {
                grant: grant.clone(),
            })
            .unwrap_err()
            .code(),
        "memory_admission_actor_mismatch"
    );
    drop(repository_store);

    let mut store =
        MemoryStore::open(&root, developer_scope(), MemoryStoreLimits::default()).unwrap();
    let developer_wide = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        MemoryGrantScope::Developer {
            actor_id: ACTOR.to_owned(),
        },
        MemoryCaptureMode::Auto,
        10,
    )
    .unwrap();
    assert_eq!(
        store
            .apply(MemoryOperation::SetCaptureMode {
                grant: developer_wide,
            })
            .unwrap_err()
            .code(),
        "memory_scope_unavailable"
    );
    store
        .apply(MemoryOperation::SetCaptureMode {
            grant: grant.clone(),
        })
        .unwrap();
    let other_actor = preference(
        "I prefer concise test output.",
        grant.grant_id.clone(),
        "developer:other",
        20,
    );
    assert_eq!(
        store
            .apply(MemoryOperation::AutoCapture {
                observation: other_actor,
                grant_id: grant.grant_id,
                grant_scope,
            })
            .unwrap_err()
            .code(),
        "memory_scope_mismatch"
    );
    drop(store);
    cleanup(&root);
}

#[test]
fn immediate_undo_rewrites_content_away_and_survives_restart() {
    let root = test_root("grant-undo");
    let statement = "I prefer concise test output.";
    let grant_scope = repository_grant_scope();
    let grant = MemoryStandingGrant::new(
        ACTOR.to_owned(),
        grant_scope.clone(),
        MemoryCaptureMode::Auto,
        10,
    )
    .unwrap();
    let observation = preference(statement, grant.grant_id.clone(), ACTOR, 20);
    let target = observation.observation_id.clone();
    let mut store =
        MemoryStore::open(&root, developer_scope(), MemoryStoreLimits::default()).unwrap();
    store
        .apply(MemoryOperation::SetCaptureMode {
            grant: grant.clone(),
        })
        .unwrap();
    store
        .apply(MemoryOperation::AutoCapture {
            observation,
            grant_id: grant.grant_id.clone(),
            grant_scope,
        })
        .unwrap();
    let undone = store
        .apply(MemoryOperation::UndoAutoCapture {
            target,
            grant_id: grant.grant_id,
            actor_id: ACTOR.to_owned(),
            occurred_at_millis: 30,
        })
        .unwrap();
    assert_eq!(
        undone.status,
        forge_core::MemoryOperationStatus::AutoCaptureUndone
    );
    assert_eq!(undone.active_count, 0);
    assert_eq!(undone.recovery_count, 0);
    drop(store);

    let reopened =
        MemoryStore::open(&root, developer_scope(), MemoryStoreLimits::default()).unwrap();
    assert_eq!(reopened.inspect(true).active_count, 0);
    assert_eq!(reopened.inspect(true).recovery_count, 0);
    drop(reopened);
    for entry in walk_files(&root) {
        let bytes = std::fs::read(entry).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains(statement));
    }
    cleanup(&root);
}

fn walk_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                pending.push(entry.path());
            } else {
                files.push(entry.path());
            }
        }
    }
    files
}

fn test_root(label: &str) -> std::path::PathBuf {
    let root = std::env::temp_dir().join(format!(
        "forge-memory-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&root).unwrap();
    root
}

fn cleanup(root: &std::path::Path) {
    std::fs::remove_dir_all(root).unwrap();
}
