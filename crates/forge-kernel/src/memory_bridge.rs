use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use forge_core::{
    MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES, MemoryCaptureMode, MemoryContextPreview,
    MemoryCorrectionDisposition, MemoryFreshness, MemoryGrantId, MemoryGrantScope,
    MemoryObservation, MemoryObservationId, MemoryObservationInput, MemoryObservationRelation,
    MemoryOperation, MemoryProvenance, MemoryScope, MemoryStandingGrant, MemoryStatementKind,
    MemoryStore, MemoryStoreLimits, MemorySubjectKind, PreferenceAdmission,
    compile_memory_context_preview,
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
    Preview {
        actor_id: String,
        as_of_millis: i64,
        budget_bytes: u64,
    },
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
    Forget {
        target_observation_id: MemoryObservationId,
        occurred_at_millis: i64,
    },
    Purge {
        target_observation_id: MemoryObservationId,
        actor_id: String,
        purged_at_millis: i64,
    },
    ClearRecoveryHistory {
        actor_id: String,
        cleared_at_millis: i64,
    },
    SetCaptureMode {
        mode: MemoryCaptureMode,
        actor_id: String,
        grant_scope: MemoryGrantScope,
        occurred_at_millis: i64,
    },
    RevokeGrant {
        grant_id: MemoryGrantId,
        actor_id: String,
        occurred_at_millis: i64,
    },
    AutoCapture {
        statement: String,
        actor_id: String,
        grant_id: MemoryGrantId,
        grant_scope: MemoryGrantScope,
        observed_at_millis: i64,
    },
    RememberPreference {
        statement: String,
        actor_id: String,
        observed_at_millis: i64,
    },
    UndoAutoCapture {
        target_observation_id: MemoryObservationId,
        grant_id: MemoryGrantId,
        actor_id: String,
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
    ContextPreview {
        preview: Box<MemoryContextPreview>,
    },
}

#[derive(Debug)]
pub struct MemoryBridgeFailure {
    pub request_id: Option<String>,
    pub code: String,
    pub message: String,
}

pub fn execute<W: Write>(frame: &[u8], writer: &mut W) -> Result<(), MemoryBridgeFailure> {
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
    if let MemoryAction::Preview {
        actor_id,
        as_of_millis,
        budget_bytes,
    } = &start.action
    {
        if !bounded_identifier(actor_id) {
            return Err(MemoryBridgeFailure {
                request_id: Some(start.request_id.clone()),
                code: "memory_admission_actor_invalid".to_owned(),
                message: "Memory actor identity is invalid.".to_owned(),
            });
        }
        if !matches!(start.scope, MemoryScope::Repository { .. }) {
            return Err(MemoryBridgeFailure {
                request_id: Some(start.request_id.clone()),
                code: "memory_context_scope_invalid".to_owned(),
                message: "Memory context preview requires the exact current repository scope."
                    .to_owned(),
            });
        }
        if *as_of_millis < 0 {
            return Err(MemoryBridgeFailure {
                request_id: Some(start.request_id.clone()),
                code: "memory_context_time_invalid".to_owned(),
                message: "Memory context preview time must be non-negative.".to_owned(),
            });
        }
        if !(1..=MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES).contains(budget_bytes) {
            return Err(MemoryBridgeFailure {
                request_id: Some(start.request_id.clone()),
                code: "memory_context_budget_invalid".to_owned(),
                message: format!(
                    "Memory context preview budget must be from 1 to {MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES} bytes."
                ),
            });
        }
    }

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
        MemoryAction::Preview {
            actor_id,
            as_of_millis,
            budget_bytes,
        } => {
            let repository_inspection = store.inspect(true);
            let developer_scope = MemoryScope::Developer { actor_id };
            let developer_store = MemoryStore::open(
                &start.engine_root,
                developer_scope,
                MemoryStoreLimits::default(),
            )
            .map_err(|error| store_failure(&start.request_id, error))?;
            let developer_inspection = developer_store.inspect(true);
            let preview = compile_memory_context_preview(
                &[repository_inspection, developer_inspection],
                as_of_millis,
                budget_bytes,
            )
            .map_err(|error| MemoryBridgeFailure {
                request_id: Some(start.request_id.clone()),
                code: error.code().to_owned(),
                message: error.to_string(),
            })?;
            MemoryOutcome::ContextPreview {
                preview: Box::new(preview),
            }
        }
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
            let relation = MemoryObservationRelation::Corrects {
                observation_id: target_observation_id.clone(),
            };
            let replacement =
                if target.observation.statement_kind == MemoryStatementKind::DeveloperPreference {
                    developer_preference(
                        &start.request_id,
                        actor_id,
                        replacement_statement,
                        start.scope,
                        relation,
                        PreferenceAdmission::ReviewedAcceptance,
                        occurred_at_millis,
                    )?
                } else {
                    reviewed_decision(
                        &start.request_id,
                        actor_id,
                        replacement_statement,
                        start.scope,
                        relation,
                        occurred_at_millis,
                        PreferenceAdmission::ReviewedAcceptance,
                    )?
                };
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
        MemoryAction::Forget {
            target_observation_id,
            occurred_at_millis,
        } => {
            let result = store
                .apply(MemoryOperation::Forget {
                    target: target_observation_id,
                    occurred_at_millis,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::Purge {
            target_observation_id,
            actor_id,
            purged_at_millis,
        } => {
            let result = store
                .apply(MemoryOperation::Purge {
                    target: target_observation_id,
                    actor_id,
                    purged_at_millis,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::ClearRecoveryHistory {
            actor_id,
            cleared_at_millis,
        } => {
            let result = store
                .apply(MemoryOperation::ClearRecoveryHistory {
                    actor_id,
                    cleared_at_millis,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::SetCaptureMode {
            mode,
            actor_id,
            grant_scope,
            occurred_at_millis,
        } => {
            let grant = MemoryStandingGrant::new(actor_id, grant_scope, mode, occurred_at_millis)
                .map_err(|error| MemoryBridgeFailure {
                request_id: Some(start.request_id.clone()),
                code: error.code().to_owned(),
                message: error.to_string(),
            })?;
            let result = store
                .apply(MemoryOperation::SetCaptureMode { grant })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::RevokeGrant {
            grant_id,
            actor_id,
            occurred_at_millis,
        } => {
            let result = store
                .apply(MemoryOperation::RevokeGrant {
                    grant_id,
                    actor_id,
                    revoked_at_millis: occurred_at_millis,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::AutoCapture {
            statement,
            actor_id,
            grant_id,
            grant_scope,
            observed_at_millis,
        } => {
            let observation = auto_preference(
                &start.request_id,
                actor_id,
                statement,
                start.scope,
                grant_id.clone(),
                observed_at_millis,
            )?;
            let result = store
                .apply(MemoryOperation::AutoCapture {
                    observation,
                    grant_id,
                    grant_scope,
                })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::RememberPreference {
            statement,
            actor_id,
            observed_at_millis,
        } => {
            let observation = developer_preference(
                &start.request_id,
                actor_id,
                statement,
                start.scope,
                MemoryObservationRelation::Supports,
                PreferenceAdmission::ReviewedAcceptance,
                observed_at_millis,
            )?;
            let result = store
                .apply(MemoryOperation::Remember { observation })
                .map_err(|error| store_failure(&start.request_id, error))?;
            MemoryOutcome::Operation {
                result: Box::new(result),
            }
        }
        MemoryAction::UndoAutoCapture {
            target_observation_id,
            grant_id,
            actor_id,
            occurred_at_millis,
        } => {
            let result = store
                .apply(MemoryOperation::UndoAutoCapture {
                    target: target_observation_id,
                    grant_id,
                    actor_id,
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

fn auto_preference(
    request_id: &str,
    actor_id: String,
    statement: String,
    scope: MemoryScope,
    grant_id: MemoryGrantId,
    observed_at_millis: i64,
) -> Result<MemoryObservation, MemoryBridgeFailure> {
    developer_preference(
        request_id,
        actor_id,
        statement,
        scope,
        MemoryObservationRelation::Supports,
        PreferenceAdmission::StandingGrant { grant_id },
        observed_at_millis,
    )
}

fn developer_preference(
    request_id: &str,
    actor_id: String,
    statement: String,
    scope: MemoryScope,
    relation: MemoryObservationRelation,
    admission: PreferenceAdmission,
    observed_at_millis: i64,
) -> Result<MemoryObservation, MemoryBridgeFailure> {
    if !bounded_identifier(&actor_id) {
        return Err(MemoryBridgeFailure {
            request_id: Some(request_id.to_owned()),
            code: "memory_admission_actor_invalid".to_owned(),
            message: "Memory actor identity is invalid.".to_owned(),
        });
    }
    if !matches!(&scope, MemoryScope::Developer { actor_id: scope_actor } if scope_actor == &actor_id)
    {
        return Err(MemoryBridgeFailure {
            request_id: Some(request_id.to_owned()),
            code: "memory_scope_mismatch".to_owned(),
            message: "Automatic preferences require the exact developer scope.".to_owned(),
        });
    }
    let input_sha256 = Sha256::digest(statement.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::DeveloperPreference,
        statement_kind: MemoryStatementKind::DeveloperPreference,
        subject: "developer preference".to_owned(),
        statement,
        scope,
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: "memory:cli8a:auto".to_owned(),
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

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::{Value, json};

    use super::execute;

    struct Fixture {
        root: std::path::PathBuf,
        workspace: std::path::PathBuf,
        engine: std::path::PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock")
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "forge-memory-context-bridge-{}-{nonce}",
                std::process::id()
            ));
            let workspace = root.join("workspace");
            let engine = root.join("engine");
            std::fs::create_dir_all(&workspace).expect("workspace");
            std::fs::create_dir_all(&engine).expect("engine");
            Self {
                root,
                workspace,
                engine,
            }
        }

        fn request(&self, request_id: &str, scope: Value, action: Value) -> Value {
            json!({
                "type": "memory.execute",
                "protocolVersion": "forge.kernel.memory.v1",
                "requestId": request_id,
                "engineRoot": self.engine,
                "workspaceRoot": self.workspace,
                "scope": scope,
                "action": action,
            })
        }

        fn execute(&self, request: Value) -> Result<Value, super::MemoryBridgeFailure> {
            let frame = serde_json::to_vec(&request).expect("request");
            let mut output = Vec::new();
            execute(&frame, &mut output)?;
            serde_json::from_slice(&output).map_err(|error| super::MemoryBridgeFailure {
                request_id: None,
                code: "test_output_invalid".to_owned(),
                message: error.to_string(),
            })
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn repository_scope() -> Value {
        json!({
            "kind": "repository",
            "workspaceId": "workspace:fixture",
            "repositoryId": "repository:fixture",
        })
    }

    fn developer_scope() -> Value {
        json!({
            "kind": "developer",
            "actorId": "developer:fixture",
        })
    }

    fn state_snapshot(root: &std::path::Path) -> Vec<(String, Vec<u8>)> {
        fn visit(
            root: &std::path::Path,
            directory: &std::path::Path,
            entries: &mut Vec<(String, Vec<u8>)>,
        ) {
            let mut children = std::fs::read_dir(directory)
                .expect("read state directory")
                .map(|entry| entry.expect("state entry").path())
                .collect::<Vec<_>>();
            children.sort();
            for path in children {
                if path.is_dir() {
                    visit(root, &path, entries);
                } else {
                    entries.push((
                        path.strip_prefix(root)
                            .expect("relative state path")
                            .to_string_lossy()
                            .replace('\\', "/"),
                        std::fs::read(path).expect("read state file"),
                    ));
                }
            }
        }

        let mut entries = Vec::new();
        visit(root, root, &mut entries);
        entries
    }

    #[test]
    fn preview_opens_the_exact_repository_and_derived_developer_scopes() {
        let fixture = Fixture::new();
        fixture
            .execute(fixture.request(
                "memory:bridge:repository",
                repository_scope(),
                json!({
                    "operation": "remember",
                    "statement": "Rust owns context admission.",
                    "actorId": "developer:fixture",
                    "observedAtMillis": 100,
                }),
            ))
            .expect("remember repository");
        fixture
            .execute(fixture.request(
                "memory:bridge:developer",
                developer_scope(),
                json!({
                    "operation": "remember_preference",
                    "statement": "Prefer concise context previews.",
                    "actorId": "developer:fixture",
                    "observedAtMillis": 101,
                }),
            ))
            .expect("remember preference");
        let state_before_preview = state_snapshot(&fixture.engine);

        let result = fixture
            .execute(fixture.request(
                "memory:bridge:preview",
                repository_scope(),
                json!({
                    "operation": "preview",
                    "actorId": "developer:fixture",
                    "asOfMillis": 200,
                    "budgetBytes": 65536,
                }),
            ))
            .expect("preview");
        let preview = &result["outcome"]["preview"];
        assert_eq!(result["outcome"]["kind"], "context_preview");
        assert_eq!(preview["candidateCount"], 2);
        assert_eq!(preview["selected"].as_array().unwrap().len(), 2);
        assert_eq!(preview["scopeHeads"].as_array().unwrap().len(), 2);
        assert_eq!(preview["scopeHeads"][0]["scope"], repository_scope());
        assert_eq!(preview["scopeHeads"][1]["scope"], developer_scope());
        assert_eq!(preview["retrievalActive"], false);
        assert_eq!(preview["plannerInjection"], false);
        assert_eq!(preview["providerWorkPerformed"], false);
        assert_eq!(state_snapshot(&fixture.engine), state_before_preview);
    }

    #[test]
    fn preview_rejects_non_repository_scope_and_invalid_budget_before_opening_a_store() {
        let fixture = Fixture::new();
        let invalid_scope = fixture
            .execute(fixture.request(
                "memory:bridge:invalid-scope",
                developer_scope(),
                json!({
                    "operation": "preview",
                    "actorId": "developer:fixture",
                    "asOfMillis": 200,
                    "budgetBytes": 65536,
                }),
            ))
            .unwrap_err();
        assert_eq!(invalid_scope.code, "memory_context_scope_invalid");

        let invalid_budget = fixture
            .execute(fixture.request(
                "memory:bridge:invalid-budget",
                repository_scope(),
                json!({
                    "operation": "preview",
                    "actorId": "developer:fixture",
                    "asOfMillis": 200,
                    "budgetBytes": 0,
                }),
            ))
            .unwrap_err();
        assert_eq!(invalid_budget.code, "memory_context_budget_invalid");
        assert!(
            std::fs::read_dir(&fixture.engine)
                .expect("engine directory")
                .next()
                .is_none()
        );
    }
}
