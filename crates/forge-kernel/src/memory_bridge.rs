use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use forge_core::{
    MemoryCorrectionDisposition, MemoryFreshness, MemoryObservation, MemoryObservationId,
    MemoryObservationInput, MemoryObservationRelation, MemoryOperation, MemoryProvenance,
    MemoryScope, MemoryStatementKind, MemoryStore, MemoryStoreLimits, MemorySubjectKind,
    PreferenceAdmission,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::protocol::{MEMORY_PROTOCOL_VERSION, send_json};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MemoryStart {
    #[serde(rename = "type")]
    message_type: String,
    protocol_version: String,
    request_id: String,
    engine_root: PathBuf,
    workspace_root: PathBuf,
    scope: MemoryScope,
    action: MemoryAction,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum MemoryAction {
    Remember {
        statement: String,
        actor_id: String,
        observed_at_millis: i64,
    },
    Inspect {
        #[serde(default)]
        include_recovery: bool,
        as_of_millis: i64,
    },
    Correct {
        target_observation_id: MemoryObservationId,
        replacement_statement: String,
        actor_id: String,
        disposition: MemoryCorrectionDisposition,
        occurred_at_millis: i64,
    },
    Restore {
        target_observation_id: MemoryObservationId,
        occurred_at_millis: i64,
    },
}

#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum MemoryOutcome {
    Operation {
        result: Box<forge_core::MemoryOperationResult>,
    },
    Inspection {
        inspection: forge_core::MemoryInspection,
    },
}

#[derive(Debug)]
pub struct MemoryBridgeFailure {
    pub request_id: Option<String>,
    pub code: String,
    pub message: String,
}

pub fn execute(
    frame: &[u8],
    writer: &mut BufWriter<std::io::Stdout>,
) -> Result<(), MemoryBridgeFailure> {
    let start: MemoryStart = serde_json::from_slice(frame).map_err(|_| MemoryBridgeFailure {
        request_id: None,
        code: "invalid_memory_request".to_owned(),
        message: "Invalid memory request JSON.".to_owned(),
    })?;
    let request_id = Some(start.request_id.clone());
    if start.message_type != "memory.execute"
        || start.protocol_version != MEMORY_PROTOCOL_VERSION
        || !bounded_identifier(&start.request_id)
    {
        return Err(MemoryBridgeFailure {
            request_id,
            code: "invalid_memory_request".to_owned(),
            message: "Memory request identity is invalid.".to_owned(),
        });
    }
    validate_state_separation(&start.workspace_root, &start.engine_root).map_err(|message| {
        MemoryBridgeFailure {
            request_id: Some(start.request_id.clone()),
            code: "memory_store_state_separation".to_owned(),
            message,
        }
    })?;
    let mut store = MemoryStore::open(
        &start.engine_root,
        start.scope.clone(),
        MemoryStoreLimits::default(),
    )
    .map_err(|error| MemoryBridgeFailure {
        request_id: Some(start.request_id.clone()),
        code: error.code().to_owned(),
        message: error.to_string(),
    })?;

    let outcome = match start.action {
        MemoryAction::Remember {
            statement,
            actor_id,
            observed_at_millis,
        } => {
            let observation = reviewed_decision(
                &start.request_id,
                actor_id,
                statement,
                start.scope,
                MemoryObservationRelation::Supports,
                observed_at_millis,
                PreferenceAdmission::ExplicitRemember,
            )?;
            let result = store
                .apply(MemoryOperation::Remember { observation })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::Inspect {
            include_recovery,
            as_of_millis,
        } => {
            store
                .compact(as_of_millis)
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Inspection {
                inspection: store.inspect(include_recovery),
            }
        }
        MemoryAction::Correct {
            target_observation_id,
            replacement_statement,
            actor_id,
            disposition,
            occurred_at_millis,
        } => {
            let target = store
                .inspect(false)
                .active
                .into_iter()
                .find(|entry| entry.observation.observation_id == target_observation_id)
                .ok_or_else(|| MemoryBridgeFailure {
                    request_id: Some(start.request_id.clone()),
                    code: "memory_transition_target_not_active".to_owned(),
                    message: "Correction target is not an active memory.".to_owned(),
                })?;
            let replacement = reviewed_decision(
                &start.request_id,
                actor_id,
                replacement_statement,
                start.scope,
                MemoryObservationRelation::Corrects {
                    observation_id: target_observation_id.clone(),
                },
                occurred_at_millis,
                PreferenceAdmission::ReviewedAcceptance,
            )?;
            if replacement.subject != target.observation.subject {
                return Err(MemoryBridgeFailure {
                    request_id: Some(start.request_id),
                    code: "memory_transition_correction_mismatch".to_owned(),
                    message: "Correction subject does not match its target.".to_owned(),
                });
            }
            let result = store
                .apply(MemoryOperation::Correct {
                    target: target_observation_id,
                    replacement,
                    disposition,
                    occurred_at_millis,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::Restore {
            target_observation_id,
            occurred_at_millis,
        } => {
            let result = store
                .apply(MemoryOperation::Restore {
                    target: target_observation_id,
                    occurred_at_millis,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
    };

    send_json(
        writer,
        &json!({
            "type": "memory.result",
            "protocolVersion": MEMORY_PROTOCOL_VERSION,
            "requestId": start.request_id,
            "outcome": outcome,
        }),
    )
    .map_err(|message| MemoryBridgeFailure {
        request_id: None,
        code: "memory_output_failed".to_owned(),
        message,
    })
}

fn reviewed_decision(
    request_id: &str,
    actor_id: String,
    statement: String,
    scope: MemoryScope,
    relation: MemoryObservationRelation,
    observed_at_millis: i64,
    admission: PreferenceAdmission,
) -> Result<MemoryObservation, MemoryBridgeFailure> {
    if !bounded_identifier(&actor_id) {
        return Err(MemoryBridgeFailure {
            request_id: Some(request_id.to_owned()),
            code: "memory_admission_actor_invalid".to_owned(),
            message: "Memory actor identity is invalid.".to_owned(),
        });
    }
    let input_sha256 = Sha256::digest(statement.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::RepositoryConvention,
        statement_kind: MemoryStatementKind::ReviewedDecision,
        subject: "repository decision".to_owned(),
        statement,
        scope,
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: "memory:cli8a".to_owned(),
            actor_id,
            source_id: format!("memory_input:{request_id}"),
            input_sha256,
            admission: Some(admission),
        },
        relation,
        confidence: 100,
        observed_at_millis,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    })
    .map_err(|error| MemoryBridgeFailure {
        request_id: Some(request_id.to_owned()),
        code: error.code().to_owned(),
        message: error.to_string(),
    })
}

fn store_failure(request_id: &str, error: forge_core::MemoryStoreError) -> MemoryBridgeFailure {
    MemoryBridgeFailure {
        request_id: Some(request_id.to_owned()),
        code: error.code().to_owned(),
        message: error.to_string(),
    }
}

fn validate_state_separation(workspace_root: &Path, engine_root: &Path) -> Result<(), String> {
    if !workspace_root.is_absolute() || !engine_root.is_absolute() {
        return Err("Memory workspace and engine roots must be absolute.".to_owned());
    }
    let workspace = fs::canonicalize(workspace_root)
        .map_err(|_| "Cannot resolve the memory workspace root.".to_owned())?;
    fs::create_dir_all(engine_root)
        .map_err(|_| "Cannot create the configured memory engine root.".to_owned())?;
    let engine = fs::canonicalize(engine_root)
        .map_err(|_| "Cannot resolve the configured memory engine root.".to_owned())?;
    if path_is_within(&workspace, &engine) || path_is_within(&engine, &workspace) {
        return Err(
            "Memory engine root must be outside and must not contain the workspace.".to_owned(),
        );
    }
    Ok(())
}

fn bounded_identifier(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 512 && !value.chars().any(char::is_control)
}

fn path_is_within(candidate: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let candidate = candidate.to_string_lossy().to_lowercase();
        let root = root.to_string_lossy().to_lowercase();
        candidate == root
            || candidate
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'))
    }
    #[cfg(not(windows))]
    {
        candidate == root || candidate.starts_with(root)
    }
}
