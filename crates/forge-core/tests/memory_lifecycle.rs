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
