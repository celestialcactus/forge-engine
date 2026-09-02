use forge_core::{
    MemoryCorrectionDisposition, MemoryFreshness, MemoryObservation, MemoryObservationInput,
    MemoryObservationRelation, MemoryOperation, MemoryProvenance, MemoryScope, MemoryStatementKind,
    MemoryStore, MemoryStoreLimits, MemorySubjectKind, PreferenceAdmission,
};

fn digest(character: char) -> String {
    character.to_string().repeat(64)
}

fn scope() -> MemoryScope {
    MemoryScope::Repository {
        workspace_id: "workspace:fixture".to_owned(),
        repository_id: "repository:forge".to_owned(),
    }
}

fn decision(
    statement: &str,
    observed_at_millis: i64,
    relation: MemoryObservationRelation,
    admission: PreferenceAdmission,
) -> Result<MemoryObservation, forge_core::MemoryContractError> {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::RepositoryConvention,
        statement_kind: MemoryStatementKind::ReviewedDecision,
        subject: "authority boundary".to_owned(),
        statement: statement.to_owned(),
        scope: scope(),
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: format!("run:{observed_at_millis}"),
            actor_id: "developer:fixture".to_owned(),
            source_id: format!("input:{observed_at_millis}"),
            input_sha256: digest('a'),
            admission: Some(admission),
        },
        relation,
        confidence: 100,
        observed_at_millis,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    })
}

#[test]
fn reviewed_repository_decision_requires_explicit_developer_admission() {
    assert!(
        decision(
            "Rust owns lifecycle authority.",
            1,
            MemoryObservationRelation::Supports,
            PreferenceAdmission::ExplicitRemember,
        )
        .is_ok()
    );
    assert_eq!(
        decision(
            "Rust owns lifecycle authority.",
            1,
            MemoryObservationRelation::Supports,
            PreferenceAdmission::StandingGrant {
                grant_id: forge_core::MemoryGrantId("grant:fixture".to_owned()),
            },
        )
        .unwrap_err()
        .code(),
        "memory_reviewed_decision_admission_required"
    );

    let model = MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::RepositoryConvention,
        statement_kind: MemoryStatementKind::ReviewedDecision,
        subject: "authority boundary".to_owned(),
        statement: "TypeScript owns lifecycle authority.".to_owned(),
        scope: scope(),
        provenance: MemoryProvenance::ModelOutput {
            run_id: "run:model".to_owned(),
            request_id: "request:model".to_owned(),
            output_sha256: digest('b'),
        },
        relation: MemoryObservationRelation::Supports,
        confidence: 100,
        observed_at_millis: 1,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    });
    assert_eq!(
        model.unwrap_err().code(),
        "memory_reviewed_decision_admission_required"
    );
}

#[test]
fn correction_and_restore_keep_exactly_one_active_version() {
    let root = test_root("lifecycle-restore");
    let original = decision(
        "Rust owns lifecycle authority.",
        10,
        MemoryObservationRelation::Supports,
        PreferenceAdmission::ExplicitRemember,
    )
    .unwrap();
    let replacement = decision(
        "Rust owns authority; TypeScript orchestrates UX.",
        20,
        MemoryObservationRelation::Corrects {
            observation_id: original.observation_id.clone(),
        },
        PreferenceAdmission::ReviewedAcceptance,
    )
    .unwrap();

    let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    store
        .apply(MemoryOperation::Remember {
            observation: original.clone(),
        })
        .unwrap();
    store
        .apply(MemoryOperation::Correct {
            target: original.observation_id.clone(),
            replacement: replacement.clone(),
            disposition: MemoryCorrectionDisposition::KeepBounded,
            occurred_at_millis: 20,
        })
        .unwrap();
    let corrected = store.inspect(true);
    assert_eq!(corrected.active.len(), 1);
    assert_eq!(corrected.recovery.len(), 1);
    assert_eq!(corrected.active[0].observation, replacement);

    store
        .apply(MemoryOperation::Restore {
            target: original.observation_id.clone(),
            occurred_at_millis: 30,
        })
        .unwrap();
    let restored = store.inspect(true);
    assert_eq!(restored.active.len(), 1);
    assert_eq!(restored.recovery.len(), 1);
    assert_eq!(restored.active[0].observation, original);
    assert_eq!(restored.recovery[0].observation, replacement);
    drop(store);

    let reopened = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    assert_eq!(reopened.inspect(true), restored);
    cleanup(&root);
}

#[test]
fn forget_is_reversible_and_remains_recoverable_after_restart() {
    let root = test_root("forget-restore");
    let original = decision(
        "Keep the privacy flow reversible until purge.",
        10,
        MemoryObservationRelation::Supports,
        PreferenceAdmission::ExplicitRemember,
    )
    .unwrap();
    {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
        store
            .apply(MemoryOperation::Remember {
                observation: original.clone(),
            })
            .unwrap();
        let result = store
            .apply(MemoryOperation::Forget {
                target: original.observation_id.clone(),
                occurred_at_millis: 20,
            })
            .unwrap();
        assert_eq!(result.status, forge_core::MemoryOperationStatus::Forgotten);
        assert_eq!(result.active_count, 0);
        assert_eq!(result.recovery_count, 1);
        let forgotten = store.inspect(true);
        assert!(forgotten.active.is_empty());
        assert_eq!(forgotten.recovery[0].observation, original);
        assert!(forgotten.recovery[0].replacement_observation_id.is_none());
    }

    let mut reopened = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    let restored = reopened
        .apply(MemoryOperation::Restore {
            target: original.observation_id.clone(),
            occurred_at_millis: 30,
        })
        .unwrap();
    assert_eq!(restored.status, forge_core::MemoryOperationStatus::Restored);
    let inspection = reopened.inspect(true);
    assert_eq!(inspection.active[0].observation, original);
    assert!(inspection.recovery.is_empty());
    drop(reopened);
    cleanup(&root);
}

#[test]
fn corrected_lineage_can_be_forgotten_rebuilt_and_restored_from_an_older_version() {
    let root = test_root("correct-forget-restore");
    let original = decision(
        "Original memory version.",
        10,
        MemoryObservationRelation::Supports,
        PreferenceAdmission::ExplicitRemember,
    )
    .unwrap();
    let middle = decision(
        "Middle memory version.",
        20,
        MemoryObservationRelation::Corrects {
            observation_id: original.observation_id.clone(),
        },
        PreferenceAdmission::ReviewedAcceptance,
    )
    .unwrap();
    let current = decision(
        "Current memory version.",
        30,
        MemoryObservationRelation::Corrects {
            observation_id: middle.observation_id.clone(),
        },
        PreferenceAdmission::ReviewedAcceptance,
    )
    .unwrap();
    let unrelated = decision(
        "Unrelated active memory.",
        50,
        MemoryObservationRelation::Supports,
        PreferenceAdmission::ExplicitRemember,
    )
    .unwrap();
    let unrelated_replacement = decision(
        "Unrelated replacement memory.",
        60,
        MemoryObservationRelation::Corrects {
            observation_id: unrelated.observation_id.clone(),
        },
        PreferenceAdmission::ReviewedAcceptance,
    )
    .unwrap();
    {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
        store
            .apply(MemoryOperation::Remember {
                observation: original.clone(),
            })
            .unwrap();
        store
            .apply(MemoryOperation::Correct {
                target: original.observation_id.clone(),
                replacement: middle.clone(),
                disposition: MemoryCorrectionDisposition::KeepBounded,
                occurred_at_millis: 20,
            })
            .unwrap();
        store
            .apply(MemoryOperation::Correct {
                target: middle.observation_id,
                replacement: current.clone(),
                disposition: MemoryCorrectionDisposition::KeepBounded,
                occurred_at_millis: 30,
            })
            .unwrap();
        store
            .apply(MemoryOperation::Forget {
                target: current.observation_id,
                occurred_at_millis: 40,
            })
            .unwrap();
        store
            .apply(MemoryOperation::Remember {
                observation: unrelated.clone(),
            })
            .unwrap();
        let rewrite = store
            .apply(MemoryOperation::Correct {
                target: unrelated.observation_id,
                replacement: unrelated_replacement.clone(),
                disposition: MemoryCorrectionDisposition::ErasePrevious,
                occurred_at_millis: 60,
            })
            .unwrap();
        assert!(rewrite.compacted);
    }
    let mut reopened = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    assert_eq!(reopened.inspect(true).recovery_count, 3);
    reopened
        .apply(MemoryOperation::Restore {
            target: original.observation_id.clone(),
            occurred_at_millis: 50,
        })
        .unwrap();
    let restored = reopened.inspect(true);
    assert!(
        restored
            .active
            .iter()
            .any(|entry| entry.observation == original)
    );
    assert!(
        restored
            .active
            .iter()
            .any(|entry| entry.observation == unrelated_replacement)
    );
    assert_eq!(restored.recovery_count, 2);
    drop(reopened);
    let rebuilt = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    assert_eq!(rebuilt.inspect(true), restored);
    drop(rebuilt);
    cleanup(&root);
}

#[test]
fn golden_lifecycle_ledger_rebuilds_to_one_active_and_one_recovery_record() {
    let root = test_root("lifecycle-golden");
    let golden_scope = MemoryScope::Repository {
        workspace_id: "workspace:fixture".to_owned(),
        repository_id: "repository:fixture".to_owned(),
    };
    {
        let store =
            MemoryStore::open(&root, golden_scope.clone(), MemoryStoreLimits::default()).unwrap();
        drop(store);
    }
    let scopes = root.join("memory").join("v1").join("scopes");
    let directory = std::fs::read_dir(scopes)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    std::fs::write(
        directory.join("ledger.ndjson"),
        include_bytes!("fixtures/cli8/memory-lifecycle-v1.ndjson"),
    )
    .unwrap();
    let reopened = MemoryStore::open(&root, golden_scope, MemoryStoreLimits::default()).unwrap();
    let inspection = reopened.inspect(true);
    assert_eq!(inspection.active.len(), 1);
    assert_eq!(inspection.recovery.len(), 1);
    assert_eq!(
        inspection.active[0].observation.statement,
        "Rust owns memory authority; TypeScript orchestrates."
    );
    assert_eq!(
        inspection.recovery[0].observation.statement,
        "Rust owns memory authority."
    );
    drop(reopened);
    cleanup(&root);
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
