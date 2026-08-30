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
