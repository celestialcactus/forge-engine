use std::{env, path::PathBuf, time::Duration};

use forge_core::{
    BaselineIsolationProvider, IsolatedProcessSpec, IsolationControl, IsolationEnforcement,
    IsolationEvidence, IsolationPolicy, IsolationProfile, IsolationProvider,
    IsolationProviderAvailability, IsolationProviderCapabilities, IsolationProviderClass,
    IsolationProviderStatus, IsolationRequest, SandboxCredentialPlan, SandboxNetworkPlan,
    compile_effective_sandbox_plan, isolation_provider_restricted_ready,
    validate_effective_sandbox_plan, validate_isolation_evidence,
    validate_isolation_provider_capabilities, validate_isolation_provider_request,
    validate_isolation_provider_status, validate_restricted_plan_evidence,
};
use sha2::{Digest, Sha256};

fn rehash_plan(plan: &mut forge_core::EffectiveSandboxPlan) {
    plan.plan_digest.clear();
    let bytes = serde_json::to_vec(plan).expect("serialize plan");
    plan.plan_digest = Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
}

fn restricted_capabilities(controls: Vec<IsolationControl>) -> IsolationProviderCapabilities {
    IsolationProviderCapabilities {
        provider_id: "forge.fixture.restricted".to_owned(),
        supported_profiles: vec![IsolationProfile::Restricted],
        authenticates_host_attestations: false,
        restricted_controls: controls,
    }
}

fn restricted_status(
    provider_class: IsolationProviderClass,
    availability: IsolationProviderAvailability,
    controls: Vec<IsolationControl>,
) -> IsolationProviderStatus {
    IsolationProviderStatus {
        capabilities: restricted_capabilities(controls),
        provider_class,
        availability,
        limitations: vec!["Fixture provider limitation.".to_owned()],
    }
}

fn restricted_process() -> IsolatedProcessSpec {
    IsolatedProcessSpec {
        executable: env::current_exe().expect("test executable"),
        arguments: vec!["fixture".to_owned()],
        environment: vec![("FORGE_FIXTURE".to_owned(), "1".to_owned())],
        inherited_environment: Vec::new(),
        working_directory: env::current_dir().expect("current directory"),
        readable_roots: Vec::new(),
        denied_read_roots: Vec::new(),
        denied_write_roots: Vec::new(),
        timeout: Duration::from_secs(2),
        max_output_bytes: 4_096,
    }
}

fn restricted_evidence(controls: Vec<IsolationControl>) -> IsolationEvidence {
    IsolationEvidence {
        requested_profile: IsolationProfile::Restricted,
        effective_profile: IsolationProfile::Restricted,
        enforcement: IsolationEnforcement::ForgeEnforced,
        provider_id: "forge.fixture.restricted".to_owned(),
        boundary_id: Some("boundary:fixture".to_owned()),
        plan_digest: Some("0".repeat(64)),
        forge_enforced: true,
        controls,
        host_authority: None,
        limitations: vec!["Fixture provider limitation.".to_owned()],
    }
}

#[test]
fn baseline_provider_advertises_only_trusted_execution() {
    let provider = BaselineIsolationProvider::default();
    let status = provider.status();
    let capabilities = provider.capabilities();

    validate_isolation_provider_capabilities(&capabilities).expect("valid baseline capabilities");
    validate_isolation_provider_status(&status).expect("valid baseline status");
    assert_eq!(
        status.provider_class,
        IsolationProviderClass::TrustedBaseline
    );
    assert_eq!(
        status.availability,
        IsolationProviderAvailability::Available
    );
    assert!(!isolation_provider_restricted_ready(&status));
    assert_eq!(capabilities.provider_id, "forge.baseline");
    assert_eq!(
        capabilities.supported_profiles,
        vec![IsolationProfile::Trusted]
    );
    assert!(!capabilities.authenticates_host_attestations);
    assert!(capabilities.restricted_controls.is_empty());
}

#[test]
fn provider_status_rejects_a_native_class_without_restricted_support() {
    let status = IsolationProviderStatus {
        capabilities: BaselineIsolationProvider::default().capabilities(),
        provider_class: IsolationProviderClass::NativeStrong,
        availability: IsolationProviderAvailability::Available,
        limitations: vec!["Invalid fixture.".to_owned()],
    };

    assert!(
        validate_isolation_provider_status(&status)
            .unwrap_err()
            .contains("class is inconsistent")
    );
}

#[test]
fn restricted_readiness_requires_available_native_strong_all_control_support() {
    let all_controls = vec![
        IsolationControl::Filesystem,
        IsolationControl::Process,
        IsolationControl::Network,
        IsolationControl::Credentials,
        IsolationControl::Resources,
    ];
    assert!(isolation_provider_restricted_ready(&restricted_status(
        IsolationProviderClass::NativeStrong,
        IsolationProviderAvailability::Available,
        all_controls.clone(),
    )));
    assert!(!isolation_provider_restricted_ready(&restricted_status(
        IsolationProviderClass::NativeFallback,
        IsolationProviderAvailability::Available,
        all_controls.clone(),
    )));
    assert!(!isolation_provider_restricted_ready(&restricted_status(
        IsolationProviderClass::NativeStrong,
        IsolationProviderAvailability::SetupRequired,
        all_controls,
    )));
}

#[test]
fn compiled_plan_is_canonical_and_bound_to_the_exact_launch() {
    let status = restricted_status(
        IsolationProviderClass::NativeStrong,
        IsolationProviderAvailability::Available,
        vec![
            IsolationControl::Resources,
            IsolationControl::Credentials,
            IsolationControl::Network,
            IsolationControl::Process,
            IsolationControl::Filesystem,
        ],
    );
    let policy = IsolationPolicy::restricted(vec![
        IsolationControl::Network,
        IsolationControl::Filesystem,
        IsolationControl::Resources,
        IsolationControl::Process,
        IsolationControl::Credentials,
    ]);
    let request = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_provider_id: None,
    };
    let process = restricted_process();
    let plan = compile_effective_sandbox_plan(&status, &policy, &request, &process)
        .expect("compiled sandbox plan");

    assert_eq!(plan.schema_version, 4);
    assert_eq!(plan.readable_roots, vec![plan.working_directory.clone()]);
    assert!(plan.denied_read_roots.is_empty());
    assert!(plan.denied_write_roots.is_empty());
    assert_eq!(
        plan.required_controls,
        vec![
            IsolationControl::Filesystem,
            IsolationControl::Process,
            IsolationControl::Network,
            IsolationControl::Credentials,
            IsolationControl::Resources,
        ]
    );
    assert_eq!(plan.network, SandboxNetworkPlan::DenyDirect);
    assert_eq!(plan.credentials, SandboxCredentialPlan::DenyAmbient);
    assert_eq!(plan.writable_roots, vec![plan.working_directory.clone()]);
    assert_eq!(plan.plan_digest.len(), 64);
    validate_effective_sandbox_plan(&plan, &status, &process).expect("valid plan");

    let mut evidence = restricted_evidence(plan.required_controls.clone());
    evidence.plan_digest = Some(plan.plan_digest.clone());
    validate_restricted_plan_evidence(&plan, &evidence).expect("bound evidence");

    let mut changed_process = process.clone();
    changed_process.arguments.push("changed".to_owned());
    assert!(
        validate_effective_sandbox_plan(&plan, &status, &changed_process)
            .unwrap_err()
            .contains("does not match the requested process launch")
    );

    let mut changed_read_boundary = process.clone();
    changed_read_boundary.denied_read_roots.push(
        process
            .working_directory
            .parent()
            .expect("working-directory parent")
            .to_owned(),
    );
    assert!(
        validate_effective_sandbox_plan(&plan, &status, &changed_read_boundary)
            .unwrap_err()
            .contains("does not match the requested process launch")
    );

    let mut changed_plan = plan.clone();
    changed_plan
        .protected_relative_paths
        .push(PathBuf::from("extra"));
    assert!(
        validate_effective_sandbox_plan(&changed_plan, &status, &process)
            .unwrap_err()
            .contains("digest does not match")
    );

    let mut escaped_root = plan.clone();
    escaped_root.writable_roots = vec![
        plan.working_directory
            .parent()
            .expect("working-directory parent")
            .to_owned(),
    ];
    rehash_plan(&mut escaped_root);
    assert!(
        validate_effective_sandbox_plan(&escaped_root, &status, &process)
            .unwrap_err()
            .contains("does not exactly represent")
    );

    let mut raised_limits = plan.clone();
    raised_limits.max_active_processes = Some(1_000);
    rehash_plan(&mut raised_limits);
    assert!(
        validate_effective_sandbox_plan(&raised_limits, &status, &process)
            .unwrap_err()
            .contains("does not exactly represent")
    );

    let mut changed_executable = plan.clone();
    changed_executable.executable = plan
        .working_directory
        .join("Cargo.toml")
        .canonicalize()
        .expect("alternate executable fixture");
    rehash_plan(&mut changed_executable);
    assert!(
        validate_effective_sandbox_plan(&changed_executable, &status, &process)
            .unwrap_err()
            .contains("identity is invalid")
    );
}

#[test]
fn equivalent_provider_inputs_compile_equivalent_enforced_restrictions() {
    let controls = vec![
        IsolationControl::Filesystem,
        IsolationControl::Process,
        IsolationControl::Network,
        IsolationControl::Credentials,
    ];
    let mut managed_status = restricted_status(
        IsolationProviderClass::NativeStrong,
        IsolationProviderAvailability::Available,
        controls.clone(),
    );
    managed_status.capabilities.provider_id = "anthropic.srt.windows.preview".to_owned();
    let mut appcontainer_status = managed_status.clone();
    appcontainer_status.capabilities.provider_id = "forge.windows.appcontainer.preview".to_owned();
    let policy = IsolationPolicy::restricted(controls);
    let request = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_provider_id: None,
    };
    let process = restricted_process();

    let managed = compile_effective_sandbox_plan(&managed_status, &policy, &request, &process)
        .expect("managed plan");
    let appcontainer =
        compile_effective_sandbox_plan(&appcontainer_status, &policy, &request, &process)
            .expect("AppContainer plan");

    assert_eq!(managed.launch_digest, appcontainer.launch_digest);
    assert_ne!(managed.plan_digest, appcontainer.plan_digest);
    let mut normalized_managed = managed;
    normalized_managed.provider_id.clear();
    normalized_managed.plan_digest.clear();
    let mut normalized_appcontainer = appcontainer;
    normalized_appcontainer.provider_id.clear();
    normalized_appcontainer.plan_digest.clear();
    assert_eq!(normalized_managed, normalized_appcontainer);
}

#[test]
fn compiled_plan_fails_closed_for_unavailable_provider_and_relative_executable() {
    let controls = vec![IsolationControl::Process];
    let policy = IsolationPolicy::restricted(controls.clone());
    let request = IsolationRequest {
        profile: IsolationProfile::Restricted,
        host_provider_id: None,
    };
    let process = restricted_process();
    let setup_required = restricted_status(
        IsolationProviderClass::NativeStrong,
        IsolationProviderAvailability::SetupRequired,
        controls.clone(),
    );
    assert!(
        compile_effective_sandbox_plan(&setup_required, &policy, &request, &process)
            .unwrap_err()
            .contains("SetupRequired")
    );

    let available = restricted_status(
        IsolationProviderClass::NativeStrong,
        IsolationProviderAvailability::Available,
        controls,
    );
    let mut relative = process;
    relative.executable = PathBuf::from("fixture");
    assert!(
        compile_effective_sandbox_plan(&available, &policy, &request, &relative)
            .unwrap_err()
            .contains("absolute policy-owned executable")
    );
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
        plan_digest: None,
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
