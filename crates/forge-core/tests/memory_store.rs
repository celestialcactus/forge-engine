use std::fs::{self, OpenOptions};
use std::io::Write;

use forge_core::{
    MemoryCorrectionDisposition, MemoryFreshness, MemoryObservation, MemoryObservationInput,
    MemoryObservationRelation, MemoryOperation, MemoryProvenance, MemoryScope, MemoryStatementKind,
    MemoryStore, MemoryStoreLimits, MemorySubjectKind, PreferenceAdmission,
};

fn scope() -> MemoryScope {
    MemoryScope::Repository {
        workspace_id: "workspace:fixture".to_owned(),
        repository_id: "repository:forge".to_owned(),
    }
}

fn decision(
    statement: String,
    time: i64,
    relation: MemoryObservationRelation,
) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::RepositoryConvention,
        statement_kind: MemoryStatementKind::ReviewedDecision,
        subject: "test boundary".to_owned(),
        statement,
        scope: scope(),
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: format!("run:{time}"),
            actor_id: "developer:fixture".to_owned(),
            source_id: format!("input:{time}"),
            input_sha256: "a".repeat(64),
            admission: Some(PreferenceAdmission::ExplicitRemember),
        },
        relation,
        confidence: 100,
        observed_at_millis: time,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    })
    .unwrap()
}

#[test]
fn remember_survives_restart_and_tamper_fails_closed() {
    let root = test_root("restart-tamper");
    let observation = decision(
        "Use the Rust memory authority.".to_owned(),
        10,
        MemoryObservationRelation::Supports,
    );
    let head = {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
        store
            .apply(MemoryOperation::Remember {
                observation: observation.clone(),
            })
            .unwrap()
            .ledger_head_sha256
    };
    let reopened = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    let inspection = reopened.inspect(false);
    assert_eq!(
        inspection.ledger_head_sha256.as_deref(),
        Some(head.as_str())
    );
    assert_eq!(inspection.active[0].observation, observation);
    drop(reopened);

    let ledger = ledger_path(&root);
    let mut bytes = fs::read(&ledger).unwrap();
    let needle = b"Rust memory authority";
    let position = bytes
        .windows(needle.len())
        .position(|window| window == needle)
        .unwrap();
    bytes[position] = b'r';
    fs::write(&ledger, bytes).unwrap();
    assert_eq!(
        MemoryStore::open(&root, scope(), MemoryStoreLimits::default())
            .err()
            .unwrap()
            .code(),
        "memory_integrity_frame_hash"
    );
    cleanup(&root);
}

#[test]
fn partial_ledger_frame_fails_closed() {
    let root = test_root("partial");
    let observation = decision(
        "Use compact NDJSON transactions.".to_owned(),
        10,
        MemoryObservationRelation::Supports,
    );
    {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
        store
            .apply(MemoryOperation::Remember { observation })
            .unwrap();
    }
    OpenOptions::new()
        .append(true)
        .open(ledger_path(&root))
        .unwrap()
        .write_all(b"{\"partial\":true}")
        .unwrap();
    assert_eq!(
        MemoryStore::open(&root, scope(), MemoryStoreLimits::default())
            .err()
            .unwrap()
            .code(),
        "memory_integrity_partial_frame"
    );
    cleanup(&root);
}

#[test]
fn erase_previous_rewrites_all_prior_lineage_content() {
    let root = test_root("erase");
    let original_text = "Original secret-like preference alpha.";
    let original = decision(
        original_text.to_owned(),
        10,
        MemoryObservationRelation::Supports,
    );
    let replacement = decision(
        "Replacement preference beta.".to_owned(),
        20,
        MemoryObservationRelation::Corrects {
            observation_id: original.observation_id.clone(),
        },
    );
    {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
        store
            .apply(MemoryOperation::Remember {
                observation: original.clone(),
            })
            .unwrap();
        let result = store
            .apply(MemoryOperation::Correct {
                target: original.observation_id,
                replacement: replacement.clone(),
                disposition: MemoryCorrectionDisposition::ErasePrevious,
                occurred_at_millis: 20,
            })
            .unwrap();
        assert!(result.compacted);
        let inspection = store.inspect(true);
        assert!(inspection.recovery.is_empty());
        assert_eq!(inspection.active[0].observation, replacement);
    }
    for entry in fs::read_dir(scope_directory(&root)).unwrap() {
        let path = entry.unwrap().path();
        if path.is_file() {
            assert!(
                !String::from_utf8_lossy(&fs::read(path).unwrap()).contains(original_text),
                "erased content remained in a memory state file"
            );
        }
    }
    cleanup(&root);
}

#[test]
fn purge_rewrites_the_entire_lineage_and_retains_only_a_non_content_receipt() {
    let root = test_root("purge-lineage");
    let original_text = "Sensitive preference alpha must disappear.";
    let replacement_text = "Sensitive preference beta must disappear too.";
    let original = decision(
        original_text.to_owned(),
        10,
        MemoryObservationRelation::Supports,
    );
    let replacement = decision(
        replacement_text.to_owned(),
        20,
        MemoryObservationRelation::Corrects {
            observation_id: original.observation_id.clone(),
        },
    );
    let original_id = original.observation_id.0.clone();
    let replacement_id = replacement.observation_id.0.clone();
    let result = {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
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
                occurred_at_millis: 20,
            })
            .unwrap();
        let result = store
            .apply(MemoryOperation::Purge {
                target: replacement.observation_id,
                actor_id: "developer:fixture".to_owned(),
                purged_at_millis: 30,
            })
            .unwrap();
        assert!(store.inspect(true).active.is_empty());
        assert!(store.inspect(true).recovery.is_empty());
        result
    };
    assert_eq!(result.status, forge_core::MemoryOperationStatus::Purged);
    assert!(result.compacted);
    let receipt = result.receipt.unwrap();
    assert_eq!(receipt.actor_id.as_deref(), Some("developer:fixture"));
    assert_eq!(receipt.purged_at_millis, Some(30));
    assert_eq!(receipt.removed_record_count, 2);
    let receipt_json = serde_json::to_value(receipt).unwrap();
    for forbidden in [
        "claimId",
        "observationId",
        "targetId",
        "contentSha256",
        "statement",
        "subject",
    ] {
        assert!(receipt_json.get(forbidden).is_none());
    }
    for path in state_files(&root) {
        let state = String::from_utf8_lossy(&fs::read(path).unwrap()).into_owned();
        assert!(!state.contains(original_text));
        assert!(!state.contains(replacement_text));
        assert!(!state.contains(&original_id));
        assert!(!state.contains(&replacement_id));
    }
    cleanup(&root);
}

#[test]
fn clearing_recovery_preserves_active_memory_and_rewrites_old_content() {
    let root = test_root("clear-recovery");
    let old_text = "Old recoverable preference must be cleared.";
    let original = decision(old_text.to_owned(), 10, MemoryObservationRelation::Supports);
    let replacement = decision(
        "Current active preference remains.".to_owned(),
        20,
        MemoryObservationRelation::Corrects {
            observation_id: original.observation_id.clone(),
        },
    );
    {
        let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
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
                occurred_at_millis: 20,
            })
            .unwrap();
        let result = store
            .apply(MemoryOperation::ClearRecoveryHistory {
                actor_id: "developer:fixture".to_owned(),
                cleared_at_millis: 30,
            })
            .unwrap();
        assert_eq!(result.recovery_count, 0);
        assert_eq!(result.receipt.unwrap().removed_record_count, 1);
        let inspection = store.inspect(true);
        assert_eq!(inspection.active[0].observation, replacement);
        assert!(inspection.recovery.is_empty());
    }
    for path in state_files(&root) {
        assert!(!String::from_utf8_lossy(&fs::read(path).unwrap()).contains(old_text));
    }
    cleanup(&root);
}

#[test]
fn failed_purge_is_atomic_and_does_not_change_memory_state() {
    let root = test_root("purge-failure");
    let observation = decision(
        "Keep state unchanged on an invalid purge.".to_owned(),
        10,
        MemoryObservationRelation::Supports,
    );
    let mut store = MemoryStore::open(&root, scope(), MemoryStoreLimits::default()).unwrap();
    store
        .apply(MemoryOperation::Remember { observation })
        .unwrap();
    let before = state_files(&root)
        .into_iter()
        .map(|path| (path.clone(), fs::read(path).unwrap()))
        .collect::<Vec<_>>();
    let error = store
        .apply(MemoryOperation::Purge {
            target: forge_core::MemoryObservationId(format!(
                "memory_observation:v1:sha256:{}",
                "f".repeat(64)
            )),
            actor_id: "developer:fixture".to_owned(),
            purged_at_millis: 20,
        })
        .unwrap_err();
    assert_eq!(error.code(), "memory_transition_target_missing");
    for (path, bytes) in before {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    drop(store);
    cleanup(&root);
}

fn state_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    fs::read_dir(scope_directory(root))
        .unwrap()
        .filter_map(|entry| {
            let path = entry.unwrap().path();
            (path.is_file() && path.file_name().is_some_and(|name| name != "lock")).then_some(path)
        })
        .collect()
}

fn scope_directory(root: &std::path::Path) -> std::path::PathBuf {
    let scopes = root.join("memory").join("v1").join("scopes");
    fs::read_dir(scopes)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
}

fn ledger_path(root: &std::path::Path) -> std::path::PathBuf {
    scope_directory(root).join("ledger.ndjson")
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
    fs::create_dir_all(&root).unwrap();
    root
}

fn cleanup(root: &std::path::Path) {
    fs::remove_dir_all(root).unwrap();
}
