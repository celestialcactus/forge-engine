use forge_core::{
    MemoryCorrectionDisposition, MemoryFreshness, MemoryObservation, MemoryObservationInput,
    MemoryObservationRelation, MemoryOperation, MemoryProvenance, MemoryScope, MemoryStatementKind,
    MemoryStore, MemoryStoreLimits, MemorySubjectKind, PreferenceAdmission,
};
use std::sync::atomic::{AtomicU64, Ordering};

static TEST_ROOT_NONCE: AtomicU64 = AtomicU64::new(0);

fn scope() -> MemoryScope {
    MemoryScope::Repository {
        workspace_id: "workspace:retention".to_owned(),
        repository_id: "repository:retention".to_owned(),
    }
}

fn version(
    number: u8,
    time: i64,
    target: Option<forge_core::MemoryObservationId>,
) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::RepositoryConvention,
        statement_kind: MemoryStatementKind::ReviewedDecision,
        subject: "versioned convention".to_owned(),
        statement: format!("Version {number}."),
        scope: scope(),
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: format!("run:{number}"),
            actor_id: "developer:fixture".to_owned(),
            source_id: format!("input:{number}"),
            input_sha256: "b".repeat(64),
            admission: Some(PreferenceAdmission::ReviewedAcceptance),
        },
        relation: target.map_or(MemoryObservationRelation::Supports, |observation_id| {
            MemoryObservationRelation::Corrects { observation_id }
        }),
        confidence: 100,
        observed_at_millis: time,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    })
    .unwrap()
}

#[test]
fn recovery_is_bounded_by_version_and_age_without_evicting_active_memory() {
    let root = test_root();
    let limits = MemoryStoreLimits {
        recovery_versions_per_lineage: 2,
        recovery_retention_millis: 100,
        ..MemoryStoreLimits::default()
    };
    let mut store = MemoryStore::open(&root, scope(), limits).unwrap();
    let mut current = version(0, 0, None);
    store
        .apply(MemoryOperation::Remember {
            observation: current.clone(),
        })
        .unwrap();
    for number in 1..=4 {
        let replacement = version(
            number,
            i64::from(number) * 10,
            Some(current.observation_id.clone()),
        );
        store
            .apply(MemoryOperation::Correct {
                target: current.observation_id,
                replacement: replacement.clone(),
                disposition: MemoryCorrectionDisposition::KeepBounded,
                occurred_at_millis: i64::from(number) * 10,
            })
            .unwrap();
        current = replacement;
    }
    let bounded = store.inspect(true);
    assert_eq!(bounded.active.len(), 1);
    assert_eq!(bounded.active[0].observation, current);
    assert_eq!(bounded.recovery.len(), 2);
    assert_eq!(bounded.recovery[0].observation.statement, "Version 2.");
    assert_eq!(bounded.recovery[1].observation.statement, "Version 3.");

    let replacement = version(5, 200, Some(current.observation_id.clone()));
    store
        .apply(MemoryOperation::Correct {
            target: current.observation_id,
            replacement: replacement.clone(),
            disposition: MemoryCorrectionDisposition::KeepBounded,
            occurred_at_millis: 200,
        })
        .unwrap();
    let aged = store.inspect(true);
    assert_eq!(aged.active[0].observation, replacement);
    assert_eq!(aged.recovery.len(), 1);
    assert_eq!(aged.recovery[0].observation.statement, "Version 4.");
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn explicit_compaction_expires_recovery_without_another_correction() {
    let root = test_root();
    let limits = MemoryStoreLimits {
        recovery_retention_millis: 100,
        ..MemoryStoreLimits::default()
    };
    let mut store = MemoryStore::open(&root, scope(), limits).unwrap();
    let original = version(0, 0, None);
    let replacement = version(1, 10, Some(original.observation_id.clone()));
    store
        .apply(MemoryOperation::Remember {
            observation: original.clone(),
        })
        .unwrap();
    store
        .apply(MemoryOperation::Correct {
            target: original.observation_id,
            replacement: replacement.clone(),
            disposition: MemoryCorrectionDisposition::KeepBounded,
            occurred_at_millis: 10,
        })
        .unwrap();
    let result = store.compact(200).unwrap();
    assert!(result.compacted);
    assert_eq!(result.removed_recovery_records, 1);
    let inspection = store.inspect(true);
    assert!(inspection.recovery.is_empty());
    assert_eq!(inspection.active[0].observation, replacement);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

fn test_root() -> std::path::PathBuf {
    let nonce = TEST_ROOT_NONCE.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "forge-memory-retention-{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        nonce
    ));
    std::fs::create_dir_all(&root).unwrap();
    root
}
