#Requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Verify', 'Prepare', 'InstallSrt', 'RunMatrix', 'UninstallSrt')][string]$Mode,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$RunId,
    [Parameter(Mandatory)][string]$InputRoot,
    [Parameter(Mandatory)][string]$OutputRoot,
    [Parameter(Mandatory)][string]$GuestRunRoot,
    [Parameter(Mandatory)][string]$NpmCache,
    [Parameter(Mandatory)][string]$CanaryUri,
    [string]$PlanCasesPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$requiredCaseIds = @(
    'allowed_candidate_write',
    'workspace_outside_write_denied',
    'protected_path_write_denied',
    'sensitive_read_denied',
    'direct_network_denied',
    'credential_environment_scrubbed',
    'child_grandchild_contained',
    'timeout_contained',
    'cancellation_contained',
    'owner_death_contained',
    'residue_orphan_check',
    'shell_compatibility',
    'node_compatibility',
    'npm_compatibility',
    'git_compatibility',
    'cargo_compatibility',
    'rustc_compatibility'
)

$runRoot = Join-Path ([IO.Path]::GetFullPath($GuestRunRoot)) $RunId
$repoRoot = Join-Path $runRoot 'repo'
$localInputs = Join-Path $runRoot 'inputs'
$artifactRoot = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $RunId
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

function Write-JsonFile {
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Path
    )

    $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Initialize-Bundle {
    $sourceManifest = Join-Path $InputRoot 'bundle.manifest.json'
    if (-not (Test-Path -LiteralPath $sourceManifest -PathType Leaf)) {
        throw "Input share does not contain bundle.manifest.json: $InputRoot"
    }

    $localManifest = Join-Path $runRoot 'bundle.manifest.json'
    if (-not (Test-Path -LiteralPath $localManifest -PathType Leaf)) {
        if (Test-Path -LiteralPath $runRoot) {
            throw "Run root exists without a manifest; refusing to reuse it: $runRoot"
        }
        New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $InputRoot 'repo') -Destination $repoRoot -Recurse
        Copy-Item -LiteralPath (Join-Path $InputRoot 'inputs') -Destination $localInputs -Recurse
        Copy-Item -LiteralPath $sourceManifest -Destination $localManifest
    }

    $manifest = Get-Content -Raw -LiteralPath $localManifest | ConvertFrom-Json
    if ($manifest.SchemaVersion -ne 1 -or $manifest.RunId -ne $RunId) {
        throw 'Bundle manifest schema or run identity does not match this invocation.'
    }
    foreach ($file in @($manifest.Files)) {
        $relative = ([string]$file.Path).Replace('/', '\')
        $path = Join-Path $repoRoot $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Bundle file is missing: $relative"
        }
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
        if ($hash -ne [string]$file.Sha256) {
            throw "Bundle hash mismatch: $relative"
        }
    }
    return $manifest
}

function Get-ToolEvidence {
    $queries = [ordered]@{
        PowerShell = { $PSVersionTable.PSVersion.ToString() }
        Node = { node.exe --version }
        Npm = { npm.cmd --version }
        Git = { git.exe --version }
        Rustc = { rustc.exe --version }
        Cargo = { cargo.exe --version }
        MsvcLinker = { (Get-Command link.exe -ErrorAction Stop).Source }
    }
    $evidence = [ordered]@{}
    foreach ($name in $queries.Keys) {
        try {
            $value = & $queries[$name] 2>&1
            $evidence[$name] = [ordered]@{ Available = $true; Value = ($value -join ' ') }
        }
        catch {
            $evidence[$name] = [ordered]@{ Available = $false; Value = $_.Exception.Message }
        }
    }
    return $evidence
}

function Invoke-CapturedCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory
    )

    $safeName = $Name -replace '[^A-Za-z0-9._-]', '-'
    $stdoutPath = Join-Path $artifactRoot "$safeName.stdout.txt"
    $stderrPath = Join-Path $artifactRoot "$safeName.stderr.txt"
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $exitCode = -1
    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments 1> $stdoutPath 2> $stderrPath
        $exitCode = $LASTEXITCODE
    }
    catch {
        $_ | Out-String | Set-Content -LiteralPath $stderrPath -Encoding UTF8
    }
    finally {
        Pop-Location
        $stopwatch.Stop()
    }
    return [pscustomobject]@{
        Name = $Name
        Executable = $Executable
        Arguments = $Arguments
        ExitCode = $exitCode
        DurationMilliseconds = $stopwatch.Elapsed.TotalMilliseconds
        Stdout = $stdoutPath
        Stderr = $stderrPath
    }
}

function Remove-AmbientSecrets {
    $sensitive = '(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|SESSION|CREDENTIAL)($|_)|^(AWS|AZURE|GCP|GOOGLE|GITHUB|GH|NPM|OPENAI|ANTHROPIC|SLACK|STRIPE)_'
    $removed = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in Get-ChildItem Env:) {
        if ($entry.Name -match $sensitive) {
            $removed.Add($entry.Name)
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
    }
    foreach ($proxy in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')) {
        if (Test-Path "Env:$proxy") {
            $removed.Add($proxy)
            Remove-Item -LiteralPath "Env:$proxy"
        }
    }
    $env:FORGE_LAB_RUN_ID = $RunId
    return @($removed | Sort-Object -Unique)
}

function Invoke-Prepare {
    if ($manifest.DependencyPins.SandboxRuntime -ne '0.0.71') {
        throw 'The immutable bundle does not pin the expected SRT probe version 0.0.71.'
    }
    if (-not (Test-Path -LiteralPath $NpmCache -PathType Container)) {
        throw "The immutable template is missing its offline npm cache: $NpmCache"
    }
    $npm = Invoke-CapturedCommand -Name 'npm-ci-offline' -Executable 'npm.cmd' -Arguments @('ci', '--offline', '--ignore-scripts', '--cache', $NpmCache) -WorkingDirectory $repoRoot
    if ($npm.ExitCode -ne 0) {
        throw "Offline npm ci failed; no network fallback is permitted. See $($npm.Stderr)"
    }
    $srtInstall = Invoke-CapturedCommand -Name 'srt-probe-install-offline' -Executable 'npm.cmd' -Arguments @(
        'install', '--offline', '--ignore-scripts', '--no-save', '--package-lock=false',
        '--cache', $NpmCache, '@anthropic-ai/sandbox-runtime@0.0.71'
    ) -WorkingDirectory $repoRoot
    if ($srtInstall.ExitCode -ne 0) {
        throw "Offline temporary SRT probe install failed; no network fallback is permitted. See $($srtInstall.Stderr)"
    }
    $srtPackage = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'node_modules\@anthropic-ai\sandbox-runtime\package.json') | ConvertFrom-Json
    if ($srtPackage.version -ne '0.0.71') {
        throw "Expected SRT 0.0.71, found $($srtPackage.version)."
    }
    return [pscustomobject]@{
        ExitCode = 0
        ApplicationInstall = $npm
        TemporaryProbeInstall = $srtInstall
    }
}

function Resolve-SrtCli {
    $cli = Join-Path $repoRoot 'node_modules\@anthropic-ai\sandbox-runtime\dist\cli.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
        throw 'The published SRT CLI is missing after offline npm installation.'
    }
    return $cli
}

function Resolve-PlanCases {
    $generation = $null
    $candidatePath = $PlanCasesPath
    if (-not $candidatePath) {
        $candidatePath = Join-Path $localInputs 'plan-cases.json'
        $generation = Invoke-CapturedCommand -Name 'rust-plan-corpus' -Executable 'cargo.exe' -Arguments @(
            'run', '-p', 'forge-core', '--bin', 'forge-sandbox-conformance', '--locked', '--offline', '--', $candidatePath
        ) -WorkingDirectory $repoRoot
        Write-JsonFile -Value $generation -Path (Join-Path $artifactRoot 'plan-corpus-result.json')
        if ($generation.ExitCode -ne 0) {
            throw "Rust plan corpus generation failed. See $($generation.Stderr)"
        }
    }
    $resolved = (Resolve-Path -LiteralPath $candidatePath).Path
    $runPrefix = $runRoot.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($runPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'PlanCasesPath must be generated inside this disposable run root.'
    }
    $corpus = Get-Content -Raw -LiteralPath $resolved | ConvertFrom-Json
    if ($corpus.SchemaVersion -ne 1 -or -not $corpus.ProviderId) {
        throw 'Rust plan corpus schema or provider identity is missing.'
    }
    $cases = @($corpus.Cases)
    $ids = @($cases | ForEach-Object { [string]$_.id })
    $missing = @($requiredCaseIds | Where-Object { $_ -notin $ids })
    $unexpected = @($ids | Where-Object { $_ -notin $requiredCaseIds })
    if ($cases.Count -ne 17 -or $missing.Count -gt 0 -or $unexpected.Count -gt 0 -or (@($ids | Sort-Object -Unique)).Count -ne 17) {
        throw "Plan corpus must contain exactly the 17 required unique IDs. Missing: $($missing -join ', '); unexpected: $($unexpected -join ', ')"
    }
    foreach ($case in $cases) {
        $plan = $case.effectiveSandboxPlan
        if ($null -eq $plan -or -not [IO.Path]::IsPathRooted([string]$plan.executable) -or -not [IO.Path]::IsPathRooted([string]$plan.workingDirectory)) {
            throw "$($case.id) does not contain guest-absolute plan paths."
        }
        $working = [IO.Path]::GetFullPath([string]$plan.workingDirectory)
        if (-not $working.StartsWith($runPrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw "$($case.id) working directory is outside the disposable run root."
        }
    }
    $fixtureRoot = [IO.Path]::GetFullPath([string]$corpus.FixtureRoot)
    if (-not $fixtureRoot.StartsWith($runPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Rust corpus fixture root is outside the disposable run root.'
    }
    return [pscustomobject]@{ Path = $resolved; Cases = $cases; FixtureRoot = $fixtureRoot; Generation = $generation }
}

$manifest = Initialize-Bundle
$tools = Get-ToolEvidence
$verification = [ordered]@{
    RunId = $RunId
    TimestampUtc = [DateTime]::UtcNow.ToString('o')
    ComputerName = $env:COMPUTERNAME
    UserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    IsAdministrator = Test-IsAdministrator
    Bundle = $manifest
    Tools = $tools
}
Write-JsonFile -Value $verification -Path (Join-Path $artifactRoot 'guest-verification.json')

switch ($Mode) {
    'Verify' {
        $verification
    }
    'Prepare' {
        $prepare = Invoke-Prepare
        Write-JsonFile -Value $prepare -Path (Join-Path $artifactRoot 'prepare-result.json')
        $prepare
    }
    'InstallSrt' {
        if (-not (Test-IsAdministrator)) {
            throw 'InstallSrt must run in an elevated guest session. No UAC bypass is attempted.'
        }
        Invoke-Prepare | Out-Null
        $install = Invoke-CapturedCommand -Name 'srt-windows-install' -Executable 'node.exe' -Arguments @((Resolve-SrtCli), 'windows-install') -WorkingDirectory $repoRoot
        Write-JsonFile -Value $install -Path (Join-Path $artifactRoot 'srt-install-result.json')
        if ($install.ExitCode -ne 0) {
            throw "SRT Windows setup failed. See $($install.Stderr)"
        }
        $install
    }
    'UninstallSrt' {
        if (-not (Test-IsAdministrator)) {
            throw 'UninstallSrt must run in an elevated guest session. No UAC bypass is attempted.'
        }
        Invoke-Prepare | Out-Null
        $uninstall = Invoke-CapturedCommand -Name 'srt-windows-uninstall' -Executable 'node.exe' -Arguments @((Resolve-SrtCli), 'windows-uninstall') -WorkingDirectory $repoRoot
        Write-JsonFile -Value $uninstall -Path (Join-Path $artifactRoot 'srt-uninstall-result.json')
        if ($uninstall.ExitCode -ne 0) {
            throw "SRT Windows uninstall failed. See $($uninstall.Stderr)"
        }
        $uninstall
    }
    'RunMatrix' {
        Invoke-Prepare | Out-Null
        $removedEnvironmentNames = Remove-AmbientSecrets
        Write-JsonFile -Value ([ordered]@{ RemovedNames = $removedEnvironmentNames; ValuesRecorded = $false }) -Path (Join-Path $artifactRoot 'environment-scrub.json')
        $planCases = Resolve-PlanCases

        $canaryReachable = $false
        $canaryError = $null
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $CanaryUri -TimeoutSec 5
            $canaryReachable = $response.StatusCode -eq 200 -and [string]$response.Content -eq "forge-lab-canary:$RunId"
        }
        catch {
            $canaryError = $_.Exception.Message
        }
        Write-JsonFile -Value ([ordered]@{ Uri = $CanaryUri; ReachableOutsideSandbox = $canaryReachable; Error = $canaryError }) -Path (Join-Path $artifactRoot 'canary-control.json')
        if (-not $canaryReachable) {
            throw 'The host-only canary is not reachable outside the sandbox; direct-network denial would be an invalid test.'
        }

        $networkProbe = Join-Path $planCases.FixtureRoot 'toolchain\forge-sandbox-conformance.exe'
        $networkControl = Invoke-CapturedCommand -Name 'network-unsandboxed-control' -Executable $networkProbe -Arguments @('probe-network') -WorkingDirectory $repoRoot
        $networkControlError = if (Test-Path -LiteralPath $networkControl.Stderr) { Get-Content -Raw -LiteralPath $networkControl.Stderr } else { '' }
        if ($networkControl.ExitCode -eq 0 -or $networkControlError -notmatch 'Direct network was not policy-denied') {
            throw 'The unsandboxed loopback control did not prove that the OS permits a non-policy-denial outcome.'
        }

        $baselines = @(
            Invoke-CapturedCommand -Name 'npm-typecheck' -Executable 'npm.cmd' -Arguments @('run', 'typecheck') -WorkingDirectory $repoRoot
            Invoke-CapturedCommand -Name 'npm-test' -Executable 'npm.cmd' -Arguments @('test') -WorkingDirectory $repoRoot
            Invoke-CapturedCommand -Name 'npm-build' -Executable 'npm.cmd' -Arguments @('run', 'build') -WorkingDirectory $repoRoot
            Invoke-CapturedCommand -Name 'cargo-fmt' -Executable 'cargo.exe' -Arguments @('fmt', '--all', '--', '--check') -WorkingDirectory $repoRoot
            Invoke-CapturedCommand -Name 'cargo-appcontainer' -Executable 'cargo.exe' -Arguments @('test', '-p', 'forge-core', '--locked', '--offline', 'isolation::windows_appcontainer::tests', '--', '--nocapture') -WorkingDirectory $repoRoot
            Invoke-CapturedCommand -Name 'cargo-isolation-authority' -Executable 'cargo.exe' -Arguments @('test', '-p', 'forge-core', '--locked', '--offline', '--test', 'isolation_authority', '--', '--nocapture') -WorkingDirectory $repoRoot
        )
        Write-JsonFile -Value $baselines -Path (Join-Path $artifactRoot 'baseline-results.json')

        $status = Invoke-CapturedCommand -Name 'srt-status' -Executable 'node.exe' -Arguments @('scripts\sandbox-conformance.mjs', '--provider=srt', '--status-only') -WorkingDirectory $repoRoot
        if ($status.ExitCode -ne 0) {
            throw "SRT status probe failed. See $($status.Stderr)"
        }
        $statusJson = Get-Content -Raw -LiteralPath $status.Stdout | ConvertFrom-Json
        if ($statusJson.adapterState -ne 'ready') {
            throw "SRT is not ready; adapter state is $($statusJson.adapterState)."
        }

        $matrix = Invoke-CapturedCommand -Name 'srt-17-case-matrix' -Executable 'node.exe' -Arguments @('scripts\sandbox-conformance.mjs', "--plan-cases=$($planCases.Path)", '--provider=srt') -WorkingDirectory $repoRoot
        $gateFailures = [System.Collections.Generic.List[string]]::new()
        $matrixJson = $null
        if ($matrix.ExitCode -ne 0) {
            $gateFailures.Add("Harness exited $($matrix.ExitCode).")
        }
        else {
            try {
                $matrixJson = Get-Content -Raw -LiteralPath $matrix.Stdout | ConvertFrom-Json
            }
            catch {
                $gateFailures.Add("Harness output is not valid JSON: $($_.Exception.Message)")
            }
        }
        if ($null -ne $matrixJson) {
            if ($matrixJson.adapterState -ne 'ready') { $gateFailures.Add("Adapter state is $($matrixJson.adapterState).") }
            if ($matrixJson.caseCount -ne 17) { $gateFailures.Add("Harness reported $($matrixJson.caseCount) cases, expected 17.") }
            if (@($matrixJson.missingCaseIds).Count -ne 0) { $gateFailures.Add('Harness reported missing case IDs.') }
            if (@($matrixJson.results).Count -ne 17 -or @($matrixJson.results | Where-Object { $_.state -ne 'executed' }).Count -ne 0) {
                $gateFailures.Add('The harness did not execute exactly 17 cases.')
            }
            if ($matrixJson.allExecutedCasesPassed -ne $true) { $gateFailures.Add('Not every executed case passed with clean residue.') }
            $descendant = @($matrixJson.results | Where-Object { $_.id -eq 'child_grandchild_contained' }) | Select-Object -First 1
            $timeout = @($matrixJson.results | Where-Object { $_.id -eq 'timeout_contained' }) | Select-Object -First 1
            $cancellation = @($matrixJson.results | Where-Object { $_.id -eq 'cancellation_contained' }) | Select-Object -First 1
            $ownerDeath = @($matrixJson.results | Where-Object { $_.id -eq 'owner_death_contained' }) | Select-Object -First 1
            $residue = @($matrixJson.results | Where-Object { $_.id -eq 'residue_orphan_check' }) | Select-Object -First 1
            if ($null -eq $descendant -or $descendant.passed -ne $true -or $descendant.descendantClean -ne $true) {
                $gateFailures.Add('Child/grandchild evidence is absent or incomplete.')
            }
            if ($null -eq $timeout -or $timeout.passed -ne $true -or $timeout.timedOut -ne $true -or $timeout.descendantClean -ne $true) {
                $gateFailures.Add('Timeout descendant cleanup evidence is absent or incomplete.')
            }
            if ($null -eq $cancellation -or $cancellation.passed -ne $true -or $cancellation.cancelled -ne $true -or $cancellation.descendantClean -ne $true) {
                $gateFailures.Add('Explicit cancellation evidence is absent or incomplete.')
            }
            if ($null -eq $ownerDeath -or $ownerDeath.passed -ne $true -or $ownerDeath.descendantClean -ne $true) {
                $gateFailures.Add('Owner-death cleanup evidence is absent or incomplete.')
            }
            if ($null -eq $residue -or $residue.passed -ne $true -or $residue.residueClean -ne $true -or $residue.aclClean -ne $true -or $residue.recoveryClean -ne $true) {
                $gateFailures.Add('Process/ACL/profile/provider residue evidence is absent or incomplete.')
            }
        }
        foreach ($baseline in $baselines) {
            if ($baseline.ExitCode -ne 0) {
                $gateFailures.Add("Baseline failed: $($baseline.Name) exited $($baseline.ExitCode).")
            }
        }

        $gate = [ordered]@{
            SchemaVersion = 1
            RunId = $RunId
            Passed = $gateFailures.Count -eq 0
            Failures = @($gateFailures)
            RequiresHostCanaryLogAudit = $true
            CanaryControlPassed = $canaryReachable
            UnsandboxedNetworkControl = $networkControl
            Matrix = $matrix
            Baselines = $baselines
        }
        Write-JsonFile -Value $gate -Path (Join-Path $artifactRoot 'acceptance-gate.json')

        $artifactFiles = @(Get-ChildItem -LiteralPath $artifactRoot -File | ForEach-Object {
            [ordered]@{ Name = $_.Name; Length = $_.Length; Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
        })
        Write-JsonFile -Value ([ordered]@{ RunId = $RunId; CreatedAtUtc = [DateTime]::UtcNow.ToString('o'); Files = $artifactFiles }) -Path (Join-Path $artifactRoot 'artifact-manifest.json')
        $gate
        if (-not $gate.Passed) {
            throw "The acceptance gate did not pass: $($gate.Failures -join ' ')"
        }
    }
}
