use forge_core::{
    ApprovalFacts, ApprovalOutcome, HostPolicyFact, HostPolicyPosture, UserConsentFact,
    UserConsentStatus, resolve_approval,
};

fn facts(posture: HostPolicyPosture, status: UserConsentStatus) -> ApprovalFacts {
    ApprovalFacts {
        schema_version: 1,
        call_id: "call-1".to_owned(),
        capability_id: "workspace.inventory".to_owned(),
        host_policy: HostPolicyFact {
            posture,
            source: "fixture.host-policy".to_owned(),
            reason: "Host policy reason.".to_owned(),
        },
        user_consent: UserConsentFact {
            status,
            source: "fixture.host-ui".to_owned(),
            reason: "User consent reason.".to_owned(),
        },
    }
}

#[test]
fn host_deny_has_precedence_over_granted_consent() {
    let decision = resolve_approval(&facts(HostPolicyPosture::Deny, UserConsentStatus::Granted))
        .expect("valid facts");
    assert_eq!(decision.outcome, ApprovalOutcome::Deny);
    assert_eq!(decision.reason, "Host policy reason.");
}

#[test]
fn explicit_user_decline_cannot_be_weakened_by_host_allow() {
    let decision = resolve_approval(&facts(
        HostPolicyPosture::Allow,
        UserConsentStatus::Declined,
    ))
    .expect("valid facts");
    assert_eq!(decision.outcome, ApprovalOutcome::Deny);
    assert_eq!(decision.reason, "User consent reason.");
}

#[test]
fn granted_consent_resolves_host_ask_to_allow() {
    let input = facts(HostPolicyPosture::Ask, UserConsentStatus::Granted);
    let decision = resolve_approval(&input).expect("valid facts");
    assert_eq!(decision.outcome, ApprovalOutcome::Allow);
    assert_eq!(decision.reason, "User consent reason.");
    assert_eq!(decision.facts, Some(input));
}

#[test]
fn unresolved_host_ask_remains_ask() {
    for status in [
        UserConsentStatus::NotRequired,
        UserConsentStatus::Unavailable,
    ] {
        let decision =
            resolve_approval(&facts(HostPolicyPosture::Ask, status)).expect("valid facts");
        assert_eq!(decision.outcome, ApprovalOutcome::Ask);
        assert_eq!(decision.reason, "Host policy reason.");
    }
}

#[test]
fn malformed_or_unsupported_facts_fail_closed() {
    let mut unsupported = facts(HostPolicyPosture::Allow, UserConsentStatus::NotRequired);
    unsupported.schema_version = 2;
    assert!(resolve_approval(&unsupported).is_err());

    let mut missing_provenance = facts(HostPolicyPosture::Allow, UserConsentStatus::NotRequired);
    missing_provenance.host_policy.source.clear();
    assert!(resolve_approval(&missing_provenance).is_err());

    let missing_field = serde_json::json!({
        "schemaVersion": 1,
        "hostPolicy": {
            "posture": "allow",
            "source": "fixture.host-policy",
            "reason": "Host policy reason."
        }
    });
    assert!(serde_json::from_value::<ApprovalFacts>(missing_field).is_err());
}
