use forge_core::{
    MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES, MAXIMUM_MEMORY_OMISSION_PREVIEW_BYTES,
    MemoryContextOmissionReason, MemoryFreshness, MemoryInspection, MemoryLineageId,
    MemoryObservation, MemoryObservationInput, MemoryObservationRelation, MemoryProvenance,
    MemoryScope, MemoryStatementKind, MemorySubjectKind, PreferenceAdmission, ProjectedMemory,
    RecoveryMemory, compile_memory_context_preview,
};

fn digest(character: char) -> String {
    character.to_string().repeat(64)
}

fn repository_scope() -> MemoryScope {
    MemoryScope::Repository {
        workspace_id: "workspace:fixture".to_owned(),
        repository_id: "repository:fixture".to_owned(),
    }
}

fn developer_scope() -> MemoryScope {
    MemoryScope::Developer {
        actor_id: "developer:fixture".to_owned(),
    }
}

fn reviewed_decision(
    subject: &str,
    statement: &str,
    relation: MemoryObservationRelation,
    freshness: MemoryFreshness,
    observed_at_millis: i64,
) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::RepositoryConvention,
        statement_kind: MemoryStatementKind::ReviewedDecision,
        subject: subject.to_owned(),
        statement: statement.to_owned(),
        scope: repository_scope(),
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: "memory:context:fixture".to_owned(),
            actor_id: "developer:fixture".to_owned(),
            source_id: format!("input:{observed_at_millis}:{subject}"),
            input_sha256: digest('d'),
            admission: Some(PreferenceAdmission::ExplicitRemember),
        },
        relation,
        confidence: 100,
        observed_at_millis,
        freshness,
    })
    .expect("reviewed decision")
}

fn developer_preference(statement: &str, observed_at_millis: i64) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::DeveloperPreference,
        statement_kind: MemoryStatementKind::DeveloperPreference,
        subject: "developer preference".to_owned(),
        statement: statement.to_owned(),
        scope: developer_scope(),
        provenance: MemoryProvenance::DeveloperStatement {
            run_id: "memory:context:fixture".to_owned(),
            actor_id: "developer:fixture".to_owned(),
            source_id: format!("input:{observed_at_millis}:preference"),
            input_sha256: digest('e'),
            admission: Some(PreferenceAdmission::ReviewedAcceptance),
        },
        relation: MemoryObservationRelation::Supports,
        confidence: 100,
        observed_at_millis,
        freshness: MemoryFreshness::PersistentUntilReviewed,
    })
    .expect("developer preference")
}

fn evidence_fact(
    statement: &str,
    provenance: MemoryProvenance,
    freshness: MemoryFreshness,
    observed_at_millis: i64,
) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::DomainFact,
        statement_kind: MemoryStatementKind::QuotedFact,
        subject: statement.to_owned(),
        statement: statement.to_owned(),
        scope: repository_scope(),
        provenance,
        relation: MemoryObservationRelation::Supports,
        confidence: 100,
        observed_at_millis,
        freshness,
    })
    .expect("evidence fact")
}

fn hypothesis(statement: &str, observed_at_millis: i64) -> MemoryObservation {
    MemoryObservation::new(MemoryObservationInput {
        subject_kind: MemorySubjectKind::WorkspaceArchitecture,
        statement_kind: MemoryStatementKind::InferredHypothesis,
        subject: statement.to_owned(),
        statement: statement.to_owned(),
        scope: repository_scope(),
        provenance: MemoryProvenance::ModelOutput {
            run_id: "run:context:fixture".to_owned(),
            request_id: format!("request:{observed_at_millis}"),
            output_sha256: digest('f'),
        },
        relation: MemoryObservationRelation::Supports,
        confidence: 50,
        observed_at_millis,
        freshness: MemoryFreshness::RunBound {
            run_id: "run:context:fixture".to_owned(),
        },
    })
    .expect("hypothesis")
}

fn projected(observation: MemoryObservation, sequence: u64) -> ProjectedMemory {
    ProjectedMemory {
        lineage_id: MemoryLineageId(observation.observation_id.0.clone()),
        observation,
        admitted_sequence: sequence,
        updated_sequence: sequence,
    }
}

fn inspection(
    scope: MemoryScope,
    active: Vec<ProjectedMemory>,
    recovery: Vec<RecoveryMemory>,
) -> MemoryInspection {
    MemoryInspection {
        schema_version: 1,
        scope,
        ledger_head_sha256: Some(digest('a')),
        active_count: active.len().try_into().unwrap(),
        recovery_count: recovery.len().try_into().unwrap(),
        active,
        recovery,
        grants: Vec::new(),
    }
}

fn empty_developer_inspection() -> MemoryInspection {
    inspection(developer_scope(), Vec::new(), Vec::new())
}

#[test]
fn selects_only_active_fresh_exact_scope_memory_in_canonical_order() {
    let repository = projected(
        reviewed_decision(
            "architecture",
            "Rust owns final memory admission.",
            MemoryObservationRelation::Supports,
            MemoryFreshness::PersistentUntilReviewed,
            100,
        ),
        1,
    );
    let developer = projected(
        developer_preference("Prefer concise terminal output.", 200),
        1,
    );
    let preview = compile_memory_context_preview(
        &[
            inspection(developer_scope(), vec![developer], Vec::new()),
            inspection(repository_scope(), vec![repository], Vec::new()),
        ],
        300,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .expect("preview");

    assert_eq!(preview.candidate_count, 2);
    assert_eq!(preview.selected.len(), 2);
    assert!(preview.omitted.is_empty());
    assert_eq!(
        preview.selected[0].entry.observation.scope,
        repository_scope()
    );
    assert_eq!(
        preview.selected[1].entry.observation.scope,
        developer_scope()
    );
    assert_eq!(
        preview.selected_bytes,
        preview
            .selected
            .iter()
            .map(|entry| entry.context_bytes)
            .sum::<u64>()
    );
    assert!(!preview.retrieval_active);
    assert!(!preview.planner_injection);
    assert!(!preview.provider_work_performed);
    assert!(
        preview
            .preview_id
            .starts_with("memory_context_preview:v1:sha256:")
    );
    assert_eq!(
        preview,
        compile_memory_context_preview(
            &[
                inspection(
                    developer_scope(),
                    vec![projected(
                        developer_preference("Prefer concise terminal output.", 200),
                        1,
                    )],
                    Vec::new(),
                ),
                inspection(
                    repository_scope(),
                    vec![projected(
                        reviewed_decision(
                            "architecture",
                            "Rust owns final memory admission.",
                            MemoryObservationRelation::Supports,
                            MemoryFreshness::PersistentUntilReviewed,
                            100,
                        ),
                        1,
                    )],
                    Vec::new(),
                ),
            ],
            300,
            MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
        )
        .unwrap()
    );
}

#[test]
fn omits_declared_conflicts_hypotheses_untrusted_sources_and_unresolved_freshness() {
    let contradiction = projected(
        reviewed_decision(
            "conflict",
            "This relation is explicitly contradictory.",
            MemoryObservationRelation::Contradicts,
            MemoryFreshness::PersistentUntilReviewed,
            100,
        ),
        1,
    );
    let hypothesis = projected(hypothesis("A model hypothesis.", 110), 2);
    let source_digest = digest('b');
    let repository_text = projected(
        evidence_fact(
            "Repository text is not baseline memory context.",
            MemoryProvenance::RepositoryText {
                run_id: "run:context:fixture".to_owned(),
                call_id: "call:repository-text".to_owned(),
                path: "README.md".to_owned(),
                content_sha256: source_digest.clone(),
            },
            MemoryFreshness::EvidenceBound {
                evidence_sha256: source_digest,
            },
            120,
        ),
        3,
    );
    let evidence_digest = digest('c');
    let unresolved_evidence = projected(
        evidence_fact(
            "Current evidence is unavailable to CLI8A.",
            MemoryProvenance::CapabilityEvidence {
                run_id: "run:context:fixture".to_owned(),
                call_id: "call:evidence".to_owned(),
                evidence_sha256: evidence_digest.clone(),
            },
            MemoryFreshness::EvidenceBound {
                evidence_sha256: evidence_digest,
            },
            130,
        ),
        4,
    );
    let expired = projected(
        reviewed_decision(
            "expiry",
            "This decision has expired.",
            MemoryObservationRelation::Supports,
            MemoryFreshness::ExplicitValidity {
                valid_until_millis: 150,
            },
            140,
        ),
        5,
    );
    let preview = compile_memory_context_preview(
        &[
            inspection(
                repository_scope(),
                vec![
                    contradiction,
                    hypothesis,
                    repository_text,
                    unresolved_evidence,
                    expired,
                ],
                Vec::new(),
            ),
            empty_developer_inspection(),
        ],
        151,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .expect("preview");

    assert!(preview.selected.is_empty());
    let reasons = preview
        .omitted
        .iter()
        .map(|entry| entry.reason.clone())
        .collect::<Vec<_>>();
    for expected in [
        MemoryContextOmissionReason::DeclaredContradiction,
        MemoryContextOmissionReason::InferredHypothesis,
        MemoryContextOmissionReason::SourceNotEligible,
        MemoryContextOmissionReason::EvidenceCurrentnessUnavailable,
        MemoryContextOmissionReason::ExplicitValidityExpired,
    ] {
        assert!(reasons.contains(&expected), "missing reason {expected:?}");
    }
}

#[test]
fn validity_boundary_is_inclusive_and_budgeting_uses_canonical_entry_bytes() {
    let first = projected(
        reviewed_decision(
            "alpha",
            "Alpha remains valid at the exact boundary.",
            MemoryObservationRelation::Supports,
            MemoryFreshness::ExplicitValidity {
                valid_until_millis: 200,
            },
            100,
        ),
        1,
    );
    let second = projected(developer_preference("Prefer compact previews.", 100), 1);
    let inspections = [
        inspection(repository_scope(), vec![first], Vec::new()),
        inspection(developer_scope(), vec![second], Vec::new()),
    ];
    let complete =
        compile_memory_context_preview(&inspections, 200, MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES)
            .unwrap();
    let first_bytes = complete.selected[0].context_bytes;
    let bounded = compile_memory_context_preview(&inspections, 200, first_bytes).unwrap();

    assert_eq!(bounded.selected.len(), 1);
    assert_eq!(bounded.selected_bytes, first_bytes);
    assert_eq!(bounded.omitted.len(), 1);
    assert_eq!(
        bounded.omitted[0].reason,
        MemoryContextOmissionReason::BudgetExceeded
    );
    let expired =
        compile_memory_context_preview(&inspections, 201, MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES)
            .unwrap();
    assert!(
        expired
            .omitted
            .iter()
            .any(|entry| { entry.reason == MemoryContextOmissionReason::ExplicitValidityExpired })
    );
}

#[test]
fn first_fit_skips_an_oversized_entry_and_admits_a_later_smaller_entry() {
    let oversized = projected(
        reviewed_decision(
            "a oversized",
            &"x".repeat(1_024),
            MemoryObservationRelation::Supports,
            MemoryFreshness::PersistentUntilReviewed,
            100,
        ),
        1,
    );
    let smaller = projected(
        reviewed_decision(
            "z smaller",
            "A later compact decision remains eligible.",
            MemoryObservationRelation::Supports,
            MemoryFreshness::PersistentUntilReviewed,
            100,
        ),
        2,
    );
    let smaller_id = smaller.observation.observation_id.clone();
    let oversized_id = oversized.observation.observation_id.clone();
    let inspections = [
        inspection(repository_scope(), vec![oversized, smaller], Vec::new()),
        empty_developer_inspection(),
    ];
    let complete =
        compile_memory_context_preview(&inspections, 100, MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES)
            .unwrap();
    let oversized_bytes = complete.selected[0].context_bytes;
    let smaller_bytes = complete.selected[1].context_bytes;
    assert!(oversized_bytes > smaller_bytes);

    let bounded = compile_memory_context_preview(&inspections, 100, smaller_bytes).unwrap();

    assert_eq!(bounded.selected.len(), 1);
    assert_eq!(
        bounded.selected[0].entry.observation.observation_id,
        smaller_id
    );
    assert_eq!(bounded.selected_bytes, smaller_bytes);
    assert_eq!(bounded.omitted.len(), 1);
    assert_eq!(bounded.omitted[0].observation_id, oversized_id);
    assert_eq!(
        bounded.omitted[0].reason,
        MemoryContextOmissionReason::BudgetExceeded
    );
}

#[test]
fn omits_an_observation_whose_time_has_not_arrived() {
    let future = projected(
        reviewed_decision(
            "future",
            "This decision is not effective yet.",
            MemoryObservationRelation::Supports,
            MemoryFreshness::PersistentUntilReviewed,
            301,
        ),
        1,
    );
    let preview = compile_memory_context_preview(
        &[
            inspection(repository_scope(), vec![future], Vec::new()),
            empty_developer_inspection(),
        ],
        300,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .expect("preview");

    assert!(preview.selected.is_empty());
    assert_eq!(preview.omitted.len(), 1);
    assert_eq!(
        preview.omitted[0].reason,
        MemoryContextOmissionReason::ObservationNotYetEffective
    );
}

#[test]
fn recovery_content_is_counted_without_becoming_a_preview_candidate() {
    let active = projected(
        reviewed_decision(
            "active",
            "Only active content can be selected.",
            MemoryObservationRelation::Supports,
            MemoryFreshness::PersistentUntilReviewed,
            300,
        ),
        3,
    );
    let forgotten_observation = reviewed_decision(
        "forgotten",
        "Forgotten secret preview marker.",
        MemoryObservationRelation::Supports,
        MemoryFreshness::PersistentUntilReviewed,
        100,
    );
    let superseded_observation = reviewed_decision(
        "superseded",
        "Superseded secret preview marker.",
        MemoryObservationRelation::Supports,
        MemoryFreshness::PersistentUntilReviewed,
        200,
    );
    let recovery = vec![
        RecoveryMemory {
            lineage_id: MemoryLineageId(forgotten_observation.observation_id.0.clone()),
            observation: forgotten_observation,
            replaced_at_millis: 400,
            replacement_observation_id: None,
            updated_sequence: 4,
        },
        RecoveryMemory {
            lineage_id: active.lineage_id.clone(),
            observation: superseded_observation,
            replaced_at_millis: 300,
            replacement_observation_id: Some(active.observation.observation_id.clone()),
            updated_sequence: 3,
        },
    ];
    let preview = compile_memory_context_preview(
        &[
            inspection(repository_scope(), vec![active], recovery),
            empty_developer_inspection(),
        ],
        400,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .unwrap();
    let encoded = serde_json::to_string(&preview).unwrap();

    assert_eq!(preview.candidate_count, 1);
    assert_eq!(preview.forgotten_excluded_count, 1);
    assert_eq!(preview.superseded_recovery_excluded_count, 1);
    assert!(!encoded.contains("ledgerHeadSha256"));
    assert!(!encoded.contains("Forgotten secret preview marker"));
    assert!(!encoded.contains("Superseded secret preview marker"));
}

#[test]
fn hidden_recovery_content_cannot_change_preview_output_or_identity() {
    let left_observation = reviewed_decision(
        "left hidden recovery",
        "First hidden recovery marker.",
        MemoryObservationRelation::Supports,
        MemoryFreshness::PersistentUntilReviewed,
        100,
    );
    let right_observation = reviewed_decision(
        "right hidden recovery",
        "Second hidden recovery marker.",
        MemoryObservationRelation::Supports,
        MemoryFreshness::PersistentUntilReviewed,
        100,
    );
    let recovery = |observation: MemoryObservation| RecoveryMemory {
        lineage_id: MemoryLineageId(observation.observation_id.0.clone()),
        observation,
        replaced_at_millis: 200,
        replacement_observation_id: None,
        updated_sequence: 2,
    };
    let mut left_repository = inspection(
        repository_scope(),
        Vec::new(),
        vec![recovery(left_observation)],
    );
    left_repository.ledger_head_sha256 = Some(digest('a'));
    let mut right_repository = inspection(
        repository_scope(),
        Vec::new(),
        vec![recovery(right_observation)],
    );
    right_repository.ledger_head_sha256 = Some(digest('b'));

    let left = compile_memory_context_preview(
        &[left_repository, empty_developer_inspection()],
        200,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .unwrap();
    let right = compile_memory_context_preview(
        &[right_repository, empty_developer_inspection()],
        200,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .unwrap();

    assert_eq!(left, right);
    assert_eq!(left.forgotten_excluded_count, 1);
}

#[test]
fn omission_previews_are_utf8_safe_and_bounded() {
    let long_statement = format!("first line\n  second line {}", "é".repeat(100));
    let entry = projected(
        reviewed_decision(
            "bounded preview",
            &long_statement,
            MemoryObservationRelation::Contradicts,
            MemoryFreshness::PersistentUntilReviewed,
            100,
        ),
        1,
    );
    let preview = compile_memory_context_preview(
        &[
            inspection(repository_scope(), vec![entry], Vec::new()),
            empty_developer_inspection(),
        ],
        100,
        MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES,
    )
    .unwrap();
    let statement_preview = &preview.omitted[0].statement_preview;
    assert!(statement_preview.len() <= MAXIMUM_MEMORY_OMISSION_PREVIEW_BYTES);
    assert!(statement_preview.ends_with('…'));
    assert!(statement_preview.starts_with("first line second line "));
    assert!(!statement_preview.contains('\n'));
}

#[test]
fn rejects_invalid_limits_scopes_counts_and_cross_scope_entries() {
    let valid = [
        inspection(repository_scope(), Vec::new(), Vec::new()),
        empty_developer_inspection(),
    ];
    assert_eq!(
        compile_memory_context_preview(&valid, -1, 1)
            .unwrap_err()
            .code(),
        "memory_context_time_invalid"
    );
    assert_eq!(
        compile_memory_context_preview(&valid, 0, 0)
            .unwrap_err()
            .code(),
        "memory_context_budget_invalid"
    );
    assert_eq!(
        compile_memory_context_preview(&valid, 0, MAXIMUM_MEMORY_CONTEXT_PREVIEW_BYTES + 1)
            .unwrap_err()
            .code(),
        "memory_context_budget_invalid"
    );
    assert_eq!(
        compile_memory_context_preview(&[valid[0].clone()], 0, 1)
            .unwrap_err()
            .code(),
        "memory_context_scope_invalid"
    );
    assert_eq!(
        compile_memory_context_preview(&[valid[0].clone(), valid[0].clone()], 0, 1)
            .unwrap_err()
            .code(),
        "memory_context_scope_duplicate"
    );

    let mut wrong_count = valid.clone();
    wrong_count[0].active_count = 1;
    assert_eq!(
        compile_memory_context_preview(&wrong_count, 0, 1)
            .unwrap_err()
            .code(),
        "memory_context_entry_mismatch"
    );

    let developer_entry = projected(developer_preference("Prefer exact scopes.", 100), 1);
    let cross_scope = [
        inspection(repository_scope(), vec![developer_entry], Vec::new()),
        empty_developer_inspection(),
    ];
    assert_eq!(
        compile_memory_context_preview(&cross_scope, 100, 1024)
            .unwrap_err()
            .code(),
        "memory_context_entry_mismatch"
    );
}

#[test]
fn maximum_two_scope_candidate_set_stays_within_the_bridge_output_ceiling() {
    let escaped = "\\\"".repeat(50);
    let repository = (0_u64..4_096)
        .map(|index| {
            projected(
                reviewed_decision(
                    &format!("repository entry {index:04}"),
                    &format!("entry {index:04} {escaped}"),
                    MemoryObservationRelation::Supports,
                    MemoryFreshness::PersistentUntilReviewed,
                    index.try_into().unwrap(),
                ),
                index + 1,
            )
        })
        .collect();
    let developer = (0_u64..4_096)
        .map(|index| {
            projected(
                developer_preference(
                    &format!("preference {index:04} {escaped}"),
                    index.try_into().unwrap(),
                ),
                index + 1,
            )
        })
        .collect();
    let preview = compile_memory_context_preview(
        &[
            inspection(repository_scope(), repository, Vec::new()),
            inspection(developer_scope(), developer, Vec::new()),
        ],
        4_096,
        1,
    )
    .expect("bounded maximum preview");
    let encoded = serde_json::to_vec(&preview).unwrap();

    assert_eq!(preview.candidate_count, 8_192);
    assert!(preview.selected.is_empty());
    assert_eq!(preview.omitted.len(), 8_192);
    assert!(encoded.len() < 4 * 1_048_576);
}
