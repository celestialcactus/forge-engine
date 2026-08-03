use forge_core::{
    BaselineIsolationProvider, IsolationControl, IsolationEnforcement, IsolationEvidence,
    IsolationPolicy, IsolationProfile, IsolationProvider, IsolationProviderCapabilities,
    IsolationRequest, validate_isolation_evidence, validate_isolation_provider_capabilities,
    validate_isolation_provider_request,
};

fn restricted_capabilities(controls: Vec<IsolationControl>) -> IsolationProviderCapabilities {
    IsolationProviderCapabilities {
        provider_id: "forge.fixture.restricted".to_owned(),
        supported_profiles: vec![IsolationProfile::Restricted],
        authenticates_host_attestations: false,
        restricted_controls: controls,
    }
}

fn restricted_evidence(controls: Vec<IsolationControl>) -> IsolationEvidence {
    IsolationEvidence {
        requested_profile: IsolationProfile::Restricted,
        effective_profile: IsolationProfile::Restricted,
        enforcement: IsolationEnforcement::ForgeEnforced,
        provider_id: "forge.fixture.restricted".to_owned(),
        boundary_id: Some("boundary:fixture".to_owned()),
        forge_enforced: true,
        controls,
        host_authority: None,
        limitations: vec!["Fixture provider limitation.".to_owned()],
    }
}

#[test]
fn baseline_provider_advertises_only_trusted_execution() {
    let capabilities = BaselineIsolationProvider::default().capabilities();

    validate_isolation_provider_capabilities(&capabilities).expect("valid baseline capabilities");
    assert_eq!(capabilities.provider_id, "forge.baseline");
    assert_eq!(
        capabilities.supported_profiles,
        vec![IsolationProfile::Trusted]
    );
    assert!(!capabilities.authenticates_host_attestations);
    assert!(capabilities.restricted_controls.is_empty());
}

#[test]
fn provider_capabilities_reject_unauthenticated_host_support() {
    let capabilities = IsolationProviderCapabilities {
        provider_id: "fixture.host".to_owned(),
        supported_profiles: vec![IsolationProfile::HostManaged],
        authenticates_host_attestations: false,
        restricted_controls: Vec::new(),
    };

    assert!(
        validate_isolation_provider_capabilities(&capabilities)
            .unwrap_err()
            .contains("must authenticate host attestations")
    );
}

#[test]
fn restricted_preflight_requires_every_policy_control() {
    let capabilities = restricted_capabilities(vec![IsolationControl::Process]);
    let policy = IsolationPolicy::restricted(vec![
        IsolationControl::Process,
        IsolationControl::Filesystem,
    ]);
    let request = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_provider_id: None,
    };

    assert!(
        validate_isolation_provider_request(&capabilities, &policy, &request)
            .unwrap_err()
            .contains("does not advertise every policy-required restricted control")
    );
}

#[test]
fn restricted_evidence_is_bound_to_provider_and_advertised_controls() {
    let capabilities = restricted_capabilities(vec![
        IsolationControl::Process,
        IsolationControl::Filesystem,
    ]);
    let policy = IsolationPolicy::restricted(vec![IsolationControl::Process]);
    let request = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_provider_id: None,
    };

    validate_isolation_evidence(
        &capabilities,
        &policy,
        &request,
        &restricted_evidence(vec![IsolationControl::Process]),
    )
    .expect("consistent restricted evidence");

    let mut spoofed = restricted_evidence(vec![IsolationControl::Process]);
    spoofed.provider_id = "spoofed.provider".to_owned();
    assert!(
        validate_isolation_evidence(&capabilities, &policy, &request, &spoofed)
            .unwrap_err()
            .contains("does not match executing provider")
    );

    let unadvertised =
        restricted_evidence(vec![IsolationControl::Process, IsolationControl::Network]);
    assert!(
        validate_isolation_evidence(&capabilities, &policy, &request, &unadvertised)
            .unwrap_err()
            .contains("provider did not advertise")
    );
}

#[test]
fn restricted_evidence_cannot_omit_a_policy_required_control() {
    let capabilities = restricted_capabilities(vec![
        IsolationControl::Process,
        IsolationControl::Filesystem,
    ]);
    let policy = IsolationPolicy::restricted(vec![
        IsolationControl::Process,
        IsolationControl::Filesystem,
    ]);
    let request = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_provider_id: None,
    };
    let evidence = restricted_evidence(vec![IsolationControl::Process]);

    assert!(
        validate_isolation_evidence(&capabilities, &policy, &request, &evidence)
            .unwrap_err()
            .contains("omits a policy-required control")
    );
}

#[test]
fn authenticated_host_capability_rejects_evidence_without_verified_authority() {
    let capabilities = IsolationProviderCapabilities {
        provider_id: "fixture.host".to_owned(),
        supported_profiles: vec![IsolationProfile::HostManaged],
        authenticates_host_attestations: true,
        restricted_controls: Vec::new(),
    };
    let controls = vec![IsolationControl::Process, IsolationControl::Filesystem];
    let policy = IsolationPolicy::host_managed(
        vec!["fixture.host".to_owned()],
        vec![IsolationControl::Process],
    );
    let request = IsolationRequest::host_managed("fixture.host");
    let evidence = IsolationEvidence {
        requested_profile: IsolationProfile::HostManaged,
        effective_profile: IsolationProfile::HostManaged,
        enforcement: IsolationEnforcement::HostAttested,
        provider_id: "fixture.host".to_owned(),
        boundary_id: Some("boundary:host".to_owned()),
        forge_enforced: false,
        controls,
        host_authority: None,
        limitations: vec!["The authenticated host, not Forge, enforces this boundary.".to_owned()],
    };

    assert!(
        validate_isolation_evidence(&capabilities, &policy, &request, &evidence)
            .unwrap_err()
            .contains("inconsistent")
    );
}
