// Provider-conformance evaluation module owned by Forge. It exports and exercises
// the same Rust-compiled plans without importing provider policy or implementation.
use std::{
    env, fs,
    io::ErrorKind,
    net::TcpStream,
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::Duration,
};

use forge_core::{
    EffectiveSandboxPlan, IsolatedProcessSpec, IsolationControl, IsolationPolicy, IsolationProfile,
    IsolationProviderAvailability, IsolationProviderCapabilities, IsolationProviderClass,
    IsolationProviderStatus, IsolationRequest, compile_effective_sandbox_plan,
};
use serde::{Deserialize, Serialize};

const CASE_IDS: [&str; 17] = [
    "allowed_candidate_write",
    "workspace_outside_write_denied",
    "protected_path_write_denied",
    "sensitive_read_denied",
    "direct_network_denied",
    "credential_environment_scrubbed",
    "child_grandchild_contained",
    "timeout_contained",
    "cancellation_contained",
    "owner_death_contained",
    "residue_orphan_check",
    "shell_compatibility",
    "node_compatibility",
    "npm_compatibility",
    "git_compatibility",
    "cargo_compatibility",
    "rustc_compatibility",
];

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConformanceCorpus {
    schema_version: u32,
    source_provider_id: String,
    required_controls: Vec<IsolationControl>,
    fixture_root: PathBuf,
    cases: Vec<ConformanceCase>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ConformanceCase {
    id: String,
    executable: PathBuf,
    arguments: Vec<String>,
    environment: Vec<(String, String)>,
    inherited_environment: Vec<String>,
    working_directory: PathBuf,
    expected: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cancel_after_milliseconds: Option<u64>,
    effective_sandbox_plan: EffectiveSandboxPlan,
}

fn main() -> Result<(), String> {
    let mut arguments = env::args_os().skip(1);
    if let Some(mode) = arguments.next().and_then(|value| value.into_string().ok()) {
        if mode.starts_with("probe-") {
            return run_probe(&mode, arguments.map(PathBuf::from).collect());
        }
        if mode == "export" {
            let output = arguments.next().ok_or_else(usage).map(PathBuf::from)?;
            return emit_corpus(output, arguments);
        }
        return emit_corpus(PathBuf::from(mode), arguments);
    }
    Err(usage())
}

fn usage() -> String {
    "Usage: forge-sandbox-conformance [export] <output.json> [--provider-id=<id>] [--include-resources]".to_owned()
}

fn emit_corpus(
    output: PathBuf,
    arguments: impl Iterator<Item = std::ffi::OsString>,
) -> Result<(), String> {
    let mut provider_id = "anthropic.srt.windows.preview".to_owned();
    let mut include_resources = false;
    for argument in arguments {
        let argument = argument.into_string().map_err(|_| usage())?;
        if argument == "--include-resources" {
            include_resources = true;
        } else if let Some(value) = argument.strip_prefix("--provider-id=") {
            if value.trim().is_empty() {
                return Err("Conformance provider id must not be empty.".to_owned());
            }
            provider_id = value.to_owned();
        } else {
            return Err(usage());
        }
    }
    let output = absolute_path(&output)?;
    if output.exists() {
        return Err(format!("Refusing to overwrite {}.", output.display()));
    }
    let fixture_root = output
        .parent()
        .ok_or_else(|| "Corpus output has no parent directory.".to_owned())?
        .join("forge-sandbox-conformance-fixture");
    if fixture_root.exists() {
        return Err(format!(
            "Refusing to reuse existing fixture {}.",
            fixture_root.display()
        ));
    }
    let candidate = fixture_root.join("candidate");
    let outside = fixture_root.join("outside");
    let sensitive = fixture_root.join("sensitive");
    let toolchain = candidate.join(".forge-toolchain");
    fs::create_dir_all(candidate.join(".git"))
        .map_err(|error| format!("Could not create candidate fixture: {error}"))?;
    fs::create_dir_all(&outside)
        .map_err(|error| format!("Could not create outside fixture: {error}"))?;
    fs::create_dir_all(&sensitive)
        .map_err(|error| format!("Could not create sensitive fixture: {error}"))?;
    fs::create_dir_all(&toolchain)
        .map_err(|error| format!("Could not create toolchain fixture: {error}"))?;
    fs::write(candidate.join(".git").join("config"), "protected\n")
        .map_err(|error| format!("Could not create protected fixture: {error}"))?;
    fs::write(sensitive.join("secret.txt"), "FORGE_SENSITIVE_SENTINEL\n")
        .map_err(|error| format!("Could not create sensitive fixture: {error}"))?;

    let node = required_program("node.exe")?;
    let npm = required_program("npm.cmd")?;
    if npm.parent() != node.parent() {
        return Err("Node and npm must resolve from one projected installation root.".to_owned());
    }
    let git = required_program("git.exe")?;
    let cargo = required_rust_program("cargo")?;
    let rustc = required_rust_program("rustc")?;
    let command_source =
        PathBuf::from(env::var_os("ComSpec").ok_or_else(|| "ComSpec is unavailable.".to_owned())?)
            .canonicalize()
            .map_err(|error| format!("Could not resolve ComSpec: {error}"))?;
    let shell_root = toolchain.join("shell");
    fs::create_dir_all(&shell_root)
        .map_err(|error| format!("Could not create shell projection: {error}"))?;
    let command = shell_root.join("forge-sandbox-cmd.exe");
    fs::copy(&command_source, &command)
        .map_err(|error| format!("Could not project command shell: {error}"))?;
    let command = command
        .canonicalize()
        .map_err(|error| format!("Could not resolve projected command shell: {error}"))?;
    let node_root = toolchain.join("node");
    copy_directory_tree(
        node.parent()
            .ok_or_else(|| "Node has no parent directory.".to_owned())?,
        &node_root,
    )?;
    let git_root = toolchain.join("git");
    let git_install_root = git
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "Git has no installation root.".to_owned())?;
    copy_directory_files(&git_install_root.join("cmd"), &git_root.join("cmd"))?;
    copy_directory_files(
        &git_install_root.join("mingw64").join("bin"),
        &git_root.join("mingw64").join("bin"),
    )?;
    let rust_root = toolchain.join("rust");
    copy_directory_files(
        cargo
            .parent()
            .ok_or_else(|| "Cargo has no parent directory.".to_owned())?,
        &rust_root,
    )?;
    if rustc.parent() != cargo.parent() {
        copy_directory_files(
            rustc
                .parent()
                .ok_or_else(|| "rustc has no parent directory.".to_owned())?,
            &rust_root,
        )?;
    }
    let node = node_root.join(
        node.file_name()
            .ok_or_else(|| "Node has no filename.".to_owned())?,
    );
    let npm_cli = node_root
        .join("node_modules")
        .join("npm")
        .join("bin")
        .join("npm-cli.js");
    if !npm_cli.is_file() {
        return Err("Projected npm CLI entrypoint is unavailable.".to_owned());
    }
    let git = git_root.join("cmd").join(
        git.file_name()
            .ok_or_else(|| "Git has no filename.".to_owned())?,
    );
    let cargo = rust_root.join(
        cargo
            .file_name()
            .ok_or_else(|| "Cargo has no filename.".to_owned())?,
    );
    let rustc = rust_root.join(
        rustc
            .file_name()
            .ok_or_else(|| "rustc has no filename.".to_owned())?,
    );
    let helper_source =
        env::current_exe().map_err(|error| format!("Could not locate helper: {error}"))?;
    let helper = toolchain.join("forge-sandbox-conformance.exe");
    fs::copy(&helper_source, &helper)
        .map_err(|error| format!("Could not project conformance helper: {error}"))?;
    let mut cases = Vec::new();
    for id in CASE_IDS {
        let (executable, arguments, expected, timeout_ms, cancel_after, tool_root) = match id {
            "allowed_candidate_write" => (
                command.clone(),
                shell_arguments("echo ALLOWED>allowed.txt"),
                "success",
                5_000,
                None,
                None,
            ),
            "workspace_outside_write_denied" => (
                command.clone(),
                shell_arguments(format!(
                    "echo BREACH>{}",
                    quote(&outside.join("breach.txt"))
                )),
                "denied",
                5_000,
                None,
                None,
            ),
            "protected_path_write_denied" => (
                command.clone(),
                shell_arguments("echo BREACH>.git\\config"),
                "denied",
                5_000,
                None,
                None,
            ),
            "sensitive_read_denied" => (
                command.clone(),
                shell_arguments(format!("type {}", quote(&sensitive.join("secret.txt")))),
                "denied",
                5_000,
                None,
                None,
            ),
            "direct_network_denied" => (
                helper.clone(),
                vec!["probe-network".to_owned()],
                "success",
                5_000,
                None,
                Some(toolchain.clone()),
            ),
            "credential_environment_scrubbed" => (
                helper.clone(),
                vec!["probe-environment".to_owned()],
                "success",
                5_000,
                None,
                Some(toolchain.clone()),
            ),
            "child_grandchild_contained" => (
                helper.clone(),
                vec!["probe-descendant".to_owned()],
                "success",
                5_000,
                None,
                Some(toolchain.clone()),
            ),
            "timeout_contained" => (
                helper.clone(),
                vec![
                    "probe-sleep".to_owned(),
                    candidate.join("timeout-survivor.txt").display().to_string(),
                ],
                "terminated",
                250,
                None,
                Some(toolchain.clone()),
            ),
            "cancellation_contained" => (
                helper.clone(),
                vec![
                    "probe-sleep".to_owned(),
                    candidate
                        .join("cancellation-survivor.txt")
                        .display()
                        .to_string(),
                ],
                "terminated",
                5_000,
                Some(250),
                Some(toolchain.clone()),
            ),
            "owner_death_contained" => (
                helper.clone(),
                vec!["probe-owner-death".to_owned()],
                "terminated",
                10_000,
                None,
                Some(toolchain.clone()),
            ),
            "residue_orphan_check" => (
                helper.clone(),
                vec!["probe-residue".to_owned()],
                "success",
                5_000,
                None,
                Some(toolchain.clone()),
            ),
            "shell_compatibility" => (
                command.clone(),
                shell_arguments("echo SHELL_OK"),
                "success",
                5_000,
                None,
                None,
            ),
            "node_compatibility" => (
                node.clone(),
                vec!["--version".to_owned()],
                "success",
                10_000,
                None,
                Some(node_root.clone()),
            ),
            "npm_compatibility" => (
                node.clone(),
                vec![
                    "--preserve-symlinks".to_owned(),
                    "--preserve-symlinks-main".to_owned(),
                    PathBuf::from(".forge-toolchain")
                        .join("node")
                        .join("node_modules")
                        .join("npm")
                        .join("bin")
                        .join("npm-cli.js")
                        .display()
                        .to_string(),
                    "--version".to_owned(),
                ],
                "success",
                10_000,
                None,
                Some(node_root.clone()),
            ),
            "git_compatibility" => (
                git.clone(),
                vec!["--version".to_owned()],
                "success",
                10_000,
                None,
                Some(git_root.clone()),
            ),
            "cargo_compatibility" => (
                cargo.clone(),
                vec!["--version".to_owned()],
                "success",
                10_000,
                None,
                Some(rust_root.clone()),
            ),
            "rustc_compatibility" => (
                rustc.clone(),
                vec!["--version".to_owned()],
                "success",
                10_000,
                None,
                Some(rust_root.clone()),
            ),
            _ => unreachable!(),
        };
        let mut readable_roots = vec![shell_root.clone()];
        if let Some(root) = tool_root {
            readable_roots.push(root);
        }
        let environment = if id == "credential_environment_scrubbed" {
            vec![("FORGE_VISIBLE".to_owned(), "allowed".to_owned())]
        } else {
            Vec::new()
        };
        let process = IsolatedProcessSpec {
            executable,
            arguments,
            environment,
            inherited_environment: Vec::new(),
            working_directory: candidate
                .canonicalize()
                .map_err(|error| format!("Could not resolve candidate: {error}"))?,
            readable_roots,
            denied_read_roots: vec![sensitive.clone()],
            denied_write_roots: vec![fixture_root.clone()],
            timeout: Duration::from_millis(timeout_ms),
            max_output_bytes: 65_536,
        };
        let required_controls = all_controls(include_resources);
        let status = provider_status(&provider_id, required_controls.clone());
        let plan = compile_effective_sandbox_plan(
            &status,
            &IsolationPolicy::restricted(required_controls),
            &IsolationRequest {
                profile: IsolationProfile::Restricted,
                host_provider_id: None,
            },
            &process,
        )?;
        cases.push(ConformanceCase {
            id: id.to_owned(),
            executable: process.executable,
            arguments: process.arguments,
            environment: process.environment,
            inherited_environment: process.inherited_environment,
            working_directory: process.working_directory,
            expected: expected.to_owned(),
            cancel_after_milliseconds: cancel_after,
            effective_sandbox_plan: plan,
        });
    }
    let corpus = ConformanceCorpus {
        schema_version: 2,
        source_provider_id: provider_id,
        required_controls: all_controls(include_resources),
        fixture_root: fixture_root
            .canonicalize()
            .map_err(|error| format!("Could not resolve fixture root: {error}"))?,
        cases,
    };
    let encoded = serde_json::to_vec_pretty(&corpus)
        .map_err(|error| format!("Could not encode corpus: {error}"))?;
    fs::write(&output, encoded).map_err(|error| format!("Could not write corpus: {error}"))?;
    println!("{}", output.display());
    Ok(())
}

fn provider_status(
    provider_id: &str,
    restricted_controls: Vec<IsolationControl>,
) -> IsolationProviderStatus {
    IsolationProviderStatus {
        capabilities: IsolationProviderCapabilities {
            provider_id: provider_id.to_owned(),
            supported_profiles: vec![IsolationProfile::Restricted],
            authenticates_host_attestations: false,
            restricted_controls,
        },
        provider_class: IsolationProviderClass::NativeStrong,
        availability: IsolationProviderAvailability::Available,
        limitations: vec!["Conformance-only commodity provider adapter.".to_owned()],
    }
}

fn all_controls(include_resources: bool) -> Vec<IsolationControl> {
    let mut controls = vec![
        IsolationControl::Filesystem,
        IsolationControl::Process,
        IsolationControl::Network,
        IsolationControl::Credentials,
    ];
    if include_resources {
        controls.push(IsolationControl::Resources);
    }
    controls
}

fn required_program(name: &str) -> Result<PathBuf, String> {
    let path = env::var_os("PATH").ok_or_else(|| "PATH is unavailable.".to_owned())?;
    for directory in env::split_paths(&path) {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return candidate
                .canonicalize()
                .map_err(|error| format!("Could not resolve {}: {error}", candidate.display()));
        }
    }
    Err(format!(
        "Required compatibility program {name} was not found."
    ))
}

fn required_rust_program(name: &str) -> Result<PathBuf, String> {
    let toolchain = env::var("FORGE_CONFORMANCE_RUST_TOOLCHAIN")
        .unwrap_or_else(|_| "1.97.1-x86_64-pc-windows-gnullvm".to_owned());
    let output = Command::new("rustup")
        .args(["which", name, "--toolchain", &toolchain])
        .output()
        .map_err(|error| format!("Could not ask rustup for {name}: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "rustup could not resolve {name} for {toolchain}: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let path = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim());
    path.canonicalize()
        .map_err(|error| format!("Could not resolve {}: {error}", path.display()))
}

fn copy_directory_files(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Could not enumerate {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not inspect toolchain entry: {error}"))?;
        if entry
            .file_type()
            .map_err(|error| format!("Could not inspect toolchain entry: {error}"))?
            .is_file()
        {
            let target = destination.join(entry.file_name());
            if !target.exists() {
                fs::copy(entry.path(), target)
                    .map_err(|error| format!("Could not project toolchain file: {error}"))?;
            }
        }
    }
    Ok(())
}

fn copy_directory_tree(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Could not enumerate {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect projection entry: {error}"))?;
        let target = destination.join(entry.file_name());
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect projection entry: {error}"))?;
        if file_type.is_dir() {
            copy_directory_tree(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target)
                .map_err(|error| format!("Could not project toolchain file: {error}"))?;
        } else {
            return Err(format!(
                "Toolchain projection rejects non-file entry {}.",
                entry.path().display()
            ));
        }
    }
    Ok(())
}

fn quote(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

fn shell_arguments(command: impl Into<String>) -> Vec<String> {
    vec!["/d".into(), "/s".into(), "/c".into(), command.into()]
}

fn run_probe(mode: &str, arguments: Vec<PathBuf>) -> Result<(), String> {
    match mode {
        "probe-network" => match TcpStream::connect_timeout(
            &"127.0.0.1:9".parse().expect("static socket address"),
            Duration::from_millis(500),
        ) {
            Err(error)
                if matches!(
                    error.kind(),
                    ErrorKind::PermissionDenied | ErrorKind::TimedOut
                ) =>
            {
                Ok(())
            }
            Err(error) => Err(format!("Direct network was not policy-denied: {error}")),
            Ok(_) => Err("Direct network unexpectedly connected.".to_owned()),
        },
        "probe-environment" => {
            if env::var("FORGE_VISIBLE").as_deref() != Ok("allowed") {
                return Err("Explicit environment value is unavailable.".to_owned());
            }
            for name in [
                "FORGE_AMBIENT_SECRET",
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
            ] {
                if env::var_os(name).is_some() {
                    return Err(format!("Ambient credential variable {name} was inherited."));
                }
            }
            Ok(())
        }
        "probe-descendant" | "probe-owner-death" => {
            let marker = env::current_dir()
                .map_err(|error| format!("Could not resolve probe directory: {error}"))?
                .join(if mode == "probe-owner-death" {
                    "owner-death-survivor.txt"
                } else {
                    "descendant-survivor.txt"
                });
            Command::new(
                env::current_exe().map_err(|error| format!("Could not locate helper: {error}"))?,
            )
            .arg("probe-grandchild")
            .arg(&marker)
            .spawn()
            .map_err(|error| format!("Could not spawn probe descendant: {error}"))?;
            if mode == "probe-owner-death" {
                fs::write("owner-ready.txt", "READY\n")
                    .map_err(|error| format!("Could not write owner-ready marker: {error}"))?;
                thread::sleep(Duration::from_secs(4));
            }
            Ok(())
        }
        "probe-grandchild" => {
            let marker = arguments
                .first()
                .ok_or_else(|| "Grandchild marker is missing.".to_owned())?;
            thread::sleep(Duration::from_secs(2));
            fs::write(marker, "SURVIVED\n")
                .map_err(|error| format!("Could not write survivor marker: {error}"))
        }
        "probe-sleep" => {
            let marker = arguments
                .first()
                .ok_or_else(|| "Sleep descendant marker is missing.".to_owned())?;
            Command::new(
                env::current_exe().map_err(|error| format!("Could not locate helper: {error}"))?,
            )
            .arg("probe-grandchild")
            .arg(marker)
            .spawn()
            .map_err(|error| format!("Could not spawn sleep descendant: {error}"))?;
            thread::sleep(Duration::from_secs(30));
            Ok(())
        }
        "probe-residue" => Ok(()),
        _ => Err(format!("Unknown conformance probe {mode}.")),
    }
}

fn absolute_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_owned())
    } else {
        env::current_dir()
            .map_err(|error| format!("Could not resolve current directory: {error}"))
            .map(|directory| directory.join(path))
    }
}
