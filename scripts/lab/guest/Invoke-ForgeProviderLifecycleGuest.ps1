#Requires -Version 5.1

# Disposable-guest driver for the managed-Windows/AppContainer evaluation modules.
# It uses an immutable, separately attributed provider payload and the Rust-owned
# same-plan corpus. It is not a production installer or provider selector.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet(
        'VerifyPayload',
        'InstallEvaluationProvider',
        'VerifyPostInstallReboot',
        'RunProviderCorpus',
        'UninstallEvaluationProvider',
        'VerifyPostUninstallReboot',
        'FinalizeGuestEvidence'
    )][string]$Mode,
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
$requiredControls = @('filesystem', 'process', 'network', 'credentials', 'resources')
$runRoot = Join-Path ([IO.Path]::GetFullPath($GuestRunRoot)) $RunId
$repoRoot = Join-Path $runRoot 'repo'
$localInputs = Join-Path $runRoot 'inputs'
$payloadInput = Join-Path $localInputs 'managed-provider-evaluation'
$providerInstallRoot = Join-Path $runRoot 'managed-provider-evaluation'
$conformanceRoot = Join-Path $runRoot 'conformance'
$artifactRoot = Join-Path ([IO.Path]::GetFullPath($OutputRoot)) $RunId
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

function Write-JsonFile {
    param([Parameter(Mandatory)]$Value, [Parameter(Mandatory)][string]$Path)
    if (Test-Path -LiteralPath $Path) {
        throw "Refusing to overwrite lifecycle evidence: $Path"
    }
    $Value | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath $Path -Encoding UTF8
}

function Read-JsonFile {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required lifecycle artifact is missing: $Path"
    }
    return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-BootTimeUtc {
    $operatingSystem = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    return ([DateTime]$operatingSystem.LastBootUpTime).ToUniversalTime().ToString('o')
}

function Invoke-CapturedCommand {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$WorkingDirectory,
        [hashtable]$Environment = @{}
    )

    $safeName = $Name -replace '[^A-Za-z0-9._-]', '-'
    $stdoutPath = Join-Path $artifactRoot "$safeName.stdout.txt"
    $stderrPath = Join-Path $artifactRoot "$safeName.stderr.txt"
    if ((Test-Path -LiteralPath $stdoutPath) -or (Test-Path -LiteralPath $stderrPath)) {
        throw "Refusing to overwrite captured command evidence: $safeName"
    }
    $saved = @{}
    foreach ($name in $Environment.Keys) {
        $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, [string]$Environment[$name], 'Process')
    }
    $startedAt = [DateTime]::UtcNow
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
        foreach ($name in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process')
        }
    }
    return [pscustomobject]@{
        Name = $Name
        Executable = $Executable
        Arguments = $Arguments
        ExitCode = $exitCode
        StartedAtUtc = $startedAt.ToString('o')
        CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
        DurationMilliseconds = $stopwatch.Elapsed.TotalMilliseconds
        Stdout = [IO.Path]::GetFileName($stdoutPath)
        Stderr = [IO.Path]::GetFileName($stderrPath)
    }
}

function Remove-AmbientSecrets {
    $sensitive = '(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|ACCESS_KEY|SESSION|CREDENTIAL)($|_)|^(AWS|AZURE|GCP|GOOGLE|GITHUB|GH|NPM|OPENAI|ANTHROPIC|SLACK|STRIPE)_'
    $removed = [System.Collections.Generic.List[string]]::new()
    foreach ($entry in @(Get-ChildItem Env:)) {
        if ($entry.Name -match $sensitive) {
            $removed.Add($entry.Name)
            Remove-Item -LiteralPath "Env:$($entry.Name)"
        }
    }
    foreach ($proxy in @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY')) {
        if (Test-Path -LiteralPath "Env:$proxy") {
            $removed.Add($proxy)
            Remove-Item -LiteralPath "Env:$proxy"
        }
    }
    $env:FORGE_LAB_RUN_ID = $RunId
    return @($removed | Sort-Object -Unique)
}

function Test-ManifestFiles {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][object[]]$Files,
        [int]$MaximumFiles = 2000,
        [UInt64]$MaximumBytes = 67108864
    )
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    if ($Files.Count -eq 0 -or $Files.Count -gt $MaximumFiles) {
        throw "Manifest file count is outside 1..$MaximumFiles."
    }
    $bytes = [UInt64]0
    foreach ($file in $Files) {
        $pathProperty = $file.PSObject.Properties['path']
        $bytesProperty = $file.PSObject.Properties['bytes']
        if ($null -eq $bytesProperty) { $bytesProperty = $file.PSObject.Properties['length'] }
        $hashProperty = $file.PSObject.Properties['sha256']
        if ($null -eq $pathProperty -or $null -eq $bytesProperty -or $null -eq $hashProperty) {
            throw 'Manifest file entry is missing path, length, or SHA-256.'
        }
        $relative = [string]$pathProperty.Value
        if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
            throw "Manifest contains an invalid path: $relative"
        }
        $path = [IO.Path]::GetFullPath((Join-Path $rootPath $relative.Replace('/', '\')))
        if (-not $path.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Manifest file is missing or escaped: $relative"
        }
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Manifest file is a reparse point: $relative"
        }
        if ($item.Length -ne [Int64]$bytesProperty.Value -or
            (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() -ne ([string]$hashProperty.Value).ToLowerInvariant()) {
            throw "Manifest hash/length mismatch: $relative"
        }
        $bytes += [UInt64]$item.Length
    }
    if ($bytes -gt $MaximumBytes) {
        throw "Manifest contents exceed $MaximumBytes bytes."
    }
    return $bytes
}

function Test-ExactManifestInventory {
    param(
        [Parameter(Mandatory)][string]$Root,
        [Parameter(Mandatory)][object[]]$Files,
        [string[]]$AdditionalFiles = @()
    )

    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $expected = @(
        @($Files | ForEach-Object { ([string]$_.PSObject.Properties['path'].Value).Replace('\', '/') }) +
        @($AdditionalFiles | ForEach-Object { $_.Replace('\', '/') })
    )
    $entries = @(Get-ChildItem -LiteralPath $rootPath -Recurse -Force)
    if (@($entries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count -ne 0) {
        throw 'Manifest inventory contains a reparse point.'
    }
    $actual = @($entries | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        $_.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
    })
    $difference = @(Compare-Object -ReferenceObject ($expected | Sort-Object) -DifferenceObject ($actual | Sort-Object))
    if ($difference.Count -ne 0 -or $actual.Count -ne $expected.Count) {
        throw 'Manifest inventory contains missing, duplicate, or unmanifested files.'
    }
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

    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $sourceManifest).Hash -ne
        (Get-FileHash -Algorithm SHA256 -LiteralPath $localManifest).Hash) {
        throw 'Guest-local bundle manifest differs from the immutable input manifest.'
    }

    $manifest = Read-JsonFile -Path $localManifest
    if ($manifest.SchemaVersion -ne 2 -or $manifest.RunId -ne $RunId) {
        throw 'Bundle manifest schema 2 or run identity does not match.'
    }
    Test-ManifestFiles -Root $repoRoot -Files @($manifest.Files) -MaximumFiles 20000 -MaximumBytes 536870912 | Out-Null

    $payloadManifestPath = Join-Path $payloadInput 'evaluation-payload.manifest.json'
    $payloadManifest = Read-JsonFile -Path $payloadManifestPath
    if ($payloadManifest.schemaVersion -ne 1 -or
        $payloadManifest.kind -ne 'forge.managed-windows-provider.evaluation-payload' -or
        $payloadManifest.status -ne 'evaluation_only' -or
        $payloadManifest.providerId -ne 'forge.windows.managed.preview' -or
        $payloadManifest.sourcePackage -ne '@anthropic-ai/sandbox-runtime' -or
        $payloadManifest.sourcePackageVersion -ne '0.0.71') {
        throw 'Managed-provider evaluation payload identity/status is invalid.'
    }
    $payloadManifestHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $payloadManifestPath).Hash.ToLowerInvariant()
    if ($payloadManifestHash -ne [string]$manifest.EvaluationPayload.ManifestSha256) {
        throw 'Managed-provider payload manifest hash differs from the bundle binding.'
    }
    Test-ManifestFiles -Root $payloadInput -Files @($payloadManifest.files) | Out-Null
    Test-ExactManifestInventory -Root $payloadInput -Files @($payloadManifest.files) -AdditionalFiles @('evaluation-payload.manifest.json')
    return [pscustomobject]@{ Bundle = $manifest; Payload = $payloadManifest; PayloadManifestHash = $payloadManifestHash }
}

function Initialize-ApplicationDependencies {
    if (-not (Test-Path -LiteralPath $NpmCache -PathType Container)) {
        throw "Offline npm cache is unavailable: $NpmCache"
    }
    $command = Invoke-CapturedCommand -Name "forge-npm-ci-offline-$($Mode.ToLowerInvariant())" -Executable 'npm.cmd' -Arguments @(
        'ci', '--offline', '--ignore-scripts', '--cache', $NpmCache, '--no-audit', '--no-fund'
    ) -WorkingDirectory $repoRoot
    if ($command.ExitCode -ne 0) {
        throw 'Forge offline npm ci failed; no network fallback is permitted.'
    }
    $rootPackage = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json
    $rootLock = Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package-lock.json')
    if ($null -ne $rootPackage.dependencies.PSObject.Properties['@anthropic-ai/sandbox-runtime'] -or
        $rootLock -match '"node_modules/@anthropic-ai/sandbox-runtime"\s*:') {
        throw 'The provider entered the Forge application dependency graph.'
    }
    return $command
}

function Initialize-EvaluationPayloadInstall {
    if (-not (Test-Path -LiteralPath (Join-Path $providerInstallRoot 'evaluation-payload.manifest.json') -PathType Leaf)) {
        New-Item -ItemType Directory -Path $providerInstallRoot -Force | Out-Null
        Copy-Item -Path (Join-Path $payloadInput '*') -Destination $providerInstallRoot -Recurse
    }
    $payloadManifest = Read-JsonFile -Path (Join-Path $providerInstallRoot 'evaluation-payload.manifest.json')
    Test-ManifestFiles -Root $providerInstallRoot -Files @($payloadManifest.files) | Out-Null
    $install = Invoke-CapturedCommand -Name "evaluation-payload-npm-ci-$($Mode.ToLowerInvariant())" -Executable 'npm.cmd' -Arguments @(
        'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', $NpmCache
    ) -WorkingDirectory $providerInstallRoot
    if ($install.ExitCode -ne 0) {
        throw 'Offline evaluation-payload installation failed; no network fallback is permitted.'
    }
    $packageInventory = @()
    foreach ($expected in @($payloadManifest.packages)) {
        $installedRoot = Join-Path $providerInstallRoot ('node_modules\' + ([string]$expected.name).Replace('/', '\'))
        $installedPackage = Get-Content -Raw -LiteralPath (Join-Path $installedRoot 'package.json') | ConvertFrom-Json
        if ($installedPackage.name -ne $expected.name -or $installedPackage.version -ne $expected.version -or
            $installedPackage.license -ne $expected.license) {
            throw "Installed evaluation package identity/license drifted: $($expected.name)"
        }
        $packageInventory += [ordered]@{
            Name = [string]$installedPackage.name
            Version = [string]$installedPackage.version
            License = [string]$installedPackage.license
        }
    }
    $packageRoot = Join-Path $providerInstallRoot 'node_modules\@anthropic-ai\sandbox-runtime'
    $adapter = Join-Path $providerInstallRoot ([string]$payloadManifest.adapter.path).Replace('/', '\')
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $adapter).Hash.ToLowerInvariant() -ne [string]$payloadManifest.adapter.sha256) {
        throw 'Installed evaluation adapter hash is invalid.'
    }
    return [pscustomobject]@{
        Install = $install
        PackageRoot = $packageRoot
        Adapter = $adapter
        Manifest = $payloadManifest
        Packages = $packageInventory
    }
}

function Resolve-ProviderCli {
    param([Parameter(Mandatory)][string]$PackageRoot)
    $cli = Join-Path $PackageRoot 'dist\cli.js'
    if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
        throw 'Published provider CLI is missing from the evaluation payload.'
    }
    return $cli
}

function Invoke-ProviderStatus {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$Adapter,
        [Parameter(Mandatory)][string]$PackageRoot
    )
    $command = Invoke-CapturedCommand -Name $Name -Executable 'node.exe' -Arguments @(
        $Adapter, 'status', $PackageRoot
    ) -WorkingDirectory $providerInstallRoot
    if ($command.ExitCode -ne 0) {
        throw "Provider status command failed: $Name"
    }
    $status = Get-Content -Raw -LiteralPath (Join-Path $artifactRoot $command.Stdout) | ConvertFrom-Json
    if ($status.type -ne 'status' -or $status.protocolVersion -ne 1 -or $status.packageVersion -ne '0.0.71') {
        throw "Provider status response is invalid: $Name"
    }
    return [pscustomobject]@{ Command = $command; Status = $status }
}

function Test-CorpusReport {
    param(
        [Parameter(Mandatory)]$Report,
        [Parameter(Mandatory)][string]$ExpectedTarget,
        [Parameter(Mandatory)][ValidateSet('normalizedPlanEquivalent', 'planEquivalent')][string]$PlanField
    )
    $problems = [System.Collections.Generic.List[string]]::new()
    if ($Report.corpusSchemaVersion -ne 2 -or $Report.targetProviderId -ne $ExpectedTarget -or
        $Report.caseCount -ne 17 -or $Report.passedCount -ne 17 -or $Report.allCasesPassed -ne $true -or
        $Report.retries -ne 0 -or $null -ne $Report.tokens) {
        $problems.Add("$ExpectedTarget report summary is invalid.")
    }
    if ((@($Report.requiredControls) -join ',') -ne ($requiredControls -join ',')) {
        $problems.Add("$ExpectedTarget did not report all five ordered controls.")
    }
    $results = @($Report.results)
    $ids = @($results | ForEach-Object { [string]$_.id })
    if ($results.Count -ne 17 -or (@($ids | Sort-Object -Unique)).Count -ne 17 -or
        @($requiredCaseIds | Where-Object { $_ -notin $ids }).Count -ne 0) {
        $problems.Add("$ExpectedTarget case identities are incomplete or duplicated.")
    }
    foreach ($result in $results) {
        if ($result.passed -ne $true -or $result.$PlanField -ne $true -or
            $result.residueClean -ne $true -or $result.descendantClean -ne $true -or
            $result.aclClean -ne $true -or $result.elapsedMilliseconds -le 0 -or
            $result.stdoutBytes -lt 0 -or $result.stderrBytes -lt 0 -or $null -ne $result.error) {
            $problems.Add("$ExpectedTarget case $($result.id) lacks pass/plan/residue evidence.")
        }
    }
    $timeout = $results | Where-Object { $_.id -eq 'timeout_contained' } | Select-Object -First 1
    $cancellation = $results | Where-Object { $_.id -eq 'cancellation_contained' } | Select-Object -First 1
    $owner = $results | Where-Object { $_.id -eq 'owner_death_contained' } | Select-Object -First 1
    if ($null -eq $timeout -or $timeout.timedOut -ne $true -or
        $null -eq $cancellation -or $cancellation.cancelled -ne $true -or
        $null -eq $owner -or $owner.residueClean -ne $true) {
        $problems.Add("$ExpectedTarget lifecycle evidence is incomplete.")
    }
    return @($problems)
}

function Get-CorpusMeasurements {
    param([Parameter(Mandatory)]$Report)

    $elapsed = @($Report.results | ForEach-Object { [double]$_.elapsedMilliseconds } | Sort-Object)
    $p95Index = [Math]::Max(0, [Math]::Ceiling($elapsed.Count * 0.95) - 1)
    $compatibilityIds = @('shell_compatibility', 'node_compatibility', 'npm_compatibility', 'git_compatibility', 'cargo_compatibility', 'rustc_compatibility')
    $compatibilityFailures = @($Report.results | Where-Object { $_.id -in $compatibilityIds -and $_.passed -ne $true } | ForEach-Object { $_.id })
    return [ordered]@{
        Metric = 'whole-case latency; includes provider prepare, process launch/execution, and provider cleanup'
        CaseCount = $elapsed.Count
        MeanMilliseconds = ($elapsed | Measure-Object -Average).Average
        P95Milliseconds = $elapsed[$p95Index]
        MinimumMilliseconds = $elapsed[0]
        MaximumMilliseconds = $elapsed[-1]
        SumMilliseconds = ($elapsed | Measure-Object -Sum).Sum
        StdoutBytes = ($Report.results | Measure-Object -Property stdoutBytes -Sum).Sum
        StderrBytes = ($Report.results | Measure-Object -Property stderrBytes -Sum).Sum
        CompatibilityFailures = $compatibilityFailures
        Retries = $Report.retries
        Tokens = $Report.tokens
    }
}

function Get-ProviderMachineResidue {
    $user = @(Get-CimInstance Win32_UserAccount -Filter "LocalAccount=True AND Name='srt-sandbox'" -ErrorAction Stop |
        Select-Object Name, SID, Disabled)
    $group = @(Get-CimInstance Win32_Group -Filter "LocalAccount=True AND Name='sandbox-runtime-users'" -ErrorAction Stop |
        Select-Object Name, SID)
    $profilePath = Join-Path $env:SystemDrive 'Users\srt-sandbox'
    $stateRoot = Join-Path $env:LOCALAPPDATA 'sandbox-runtime'
    $stateFiles = if (Test-Path -LiteralPath $stateRoot -PathType Container) {
        @(Get-ChildItem -LiteralPath $stateRoot -File -Force -ErrorAction Stop | Select-Object Name, Length)
    }
    else { @() }
    return [ordered]@{
        SandboxUsers = $user
        SandboxGroups = $group
        ProfilePath = $profilePath
        ProfileExists = Test-Path -LiteralPath $profilePath
        StateRoot = $stateRoot
        StateFiles = $stateFiles
        StateDatabaseIsPublishedExpectedResidue = @($stateFiles | Where-Object { $_.Name -eq 'state.db' }).Count -gt 0
    }
}

$phaseArtifactName = switch ($Mode) {
    'VerifyPayload' { 'payload-verification.json' }
    'InstallEvaluationProvider' { 'provider-install-result.json' }
    'VerifyPostInstallReboot' { 'post-install-reboot-result.json' }
    'RunProviderCorpus' { 'provider-corpus-result.json' }
    'UninstallEvaluationProvider' { 'provider-uninstall-result.json' }
    'VerifyPostUninstallReboot' { 'post-uninstall-reboot-result.json' }
    'FinalizeGuestEvidence' { 'guest-acceptance-gate.json' }
}
$modeMarkerPath = Join-Path $artifactRoot "guest-$($Mode.ToLowerInvariant()).json"
if ((Test-Path -LiteralPath (Join-Path $artifactRoot $phaseArtifactName)) -or (Test-Path -LiteralPath $modeMarkerPath)) {
    throw "Lifecycle phase has already been attempted for this run: $Mode"
}

$initialization = Initialize-Bundle
$verification = [ordered]@{
    SchemaVersion = 2
    RunId = $RunId
    Mode = $Mode
    TimestampUtc = [DateTime]::UtcNow.ToString('o')
    BootTimeUtc = Get-BootTimeUtc
    ComputerName = $env:COMPUTERNAME
    UserName = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    IsAdministrator = Test-IsAdministrator
    BundleCommit = [string]$initialization.Bundle.Source.Commit
    BundleDirty = [bool]$initialization.Bundle.Source.Dirty
    EvaluationPayloadManifestSha256 = $initialization.PayloadManifestHash
    EvaluationPayloadStatus = [string]$initialization.Payload.status
}
Write-JsonFile -Value $verification -Path $modeMarkerPath

switch ($Mode) {
    'VerifyPayload' {
        $applicationInstall = Initialize-ApplicationDependencies
        $provider = Initialize-EvaluationPayloadInstall
        $result = [ordered]@{
            SchemaVersion = 1
            RunId = $RunId
            Passed = $applicationInstall.ExitCode -eq 0 -and $provider.Install.ExitCode -eq 0
            RootApplicationDependencyAbsent = $true
            PayloadStatus = [string]$provider.Manifest.status
            PayloadManifestSha256 = $initialization.PayloadManifestHash
            Packages = $provider.Packages
            ApplicationInstall = $applicationInstall
            PayloadInstall = $provider.Install
        }
        Write-JsonFile -Value $result -Path (Join-Path $artifactRoot 'payload-verification.json')
        $result
    }
    'InstallEvaluationProvider' {
        if (-not (Test-IsAdministrator)) {
            throw 'InstallEvaluationProvider requires an elevated disposable guest session.'
        }
        $provider = Initialize-EvaluationPayloadInstall
        $before = Invoke-ProviderStatus -Name 'provider-status-before-install' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        $install = Invoke-CapturedCommand -Name 'provider-windows-install' -Executable 'node.exe' -Arguments @(
            (Resolve-ProviderCli -PackageRoot $provider.PackageRoot), 'windows-install'
        ) -WorkingDirectory $providerInstallRoot
        $after = Invoke-ProviderStatus -Name 'provider-status-after-install' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        $result = [ordered]@{
            SchemaVersion = 1
            RunId = $RunId
            EvaluationModule = 'managed_windows_provider'
            StartedBootTimeUtc = $verification.BootTimeUtc
            CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
            PayloadManifestSha256 = $initialization.PayloadManifestHash
            StatusBefore = $before.Status
            Install = $install
            StatusAfter = $after.Status
            Passed = $install.ExitCode -eq 0 -and $after.Status.state -eq 'ready'
        }
        Write-JsonFile -Value $result -Path (Join-Path $artifactRoot 'provider-install-result.json')
        if (-not $result.Passed) { throw 'Provider install/setup did not reach ready state.' }
        $result
    }
    'VerifyPostInstallReboot' {
        $installResult = Read-JsonFile -Path (Join-Path $artifactRoot 'provider-install-result.json')
        if ($installResult.Passed -ne $true) { throw 'Install result did not pass.' }
        $provider = Initialize-EvaluationPayloadInstall
        $status = Invoke-ProviderStatus -Name 'provider-status-post-install-reboot' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        $currentBoot = [DateTime]::Parse([string]$verification.BootTimeUtc).ToUniversalTime()
        $installCompleted = [DateTime]::Parse([string]$installResult.CompletedAtUtc).ToUniversalTime()
        $result = [ordered]@{
            SchemaVersion = 1
            RunId = $RunId
            PreviousInstallCompletedAtUtc = $installCompleted.ToString('o')
            CurrentBootTimeUtc = $currentBoot.ToString('o')
            RebootProven = $currentBoot -gt $installCompleted
            Status = $status.Status
            Passed = $currentBoot -gt $installCompleted -and $status.Status.state -eq 'ready'
        }
        Write-JsonFile -Value $result -Path (Join-Path $artifactRoot 'post-install-reboot-result.json')
        if (-not $result.Passed) { throw 'Post-install reboot/readiness gate did not pass.' }
        $result
    }
    'RunProviderCorpus' {
        $postReboot = Read-JsonFile -Path (Join-Path $artifactRoot 'post-install-reboot-result.json')
        if ($postReboot.Passed -ne $true) { throw 'RunProviderCorpus requires a proven post-install reboot.' }
        $applicationInstall = Initialize-ApplicationDependencies
        $provider = Initialize-EvaluationPayloadInstall
        $statusBefore = Invoke-ProviderStatus -Name 'provider-status-before-corpus' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        if ($statusBefore.Status.state -ne 'ready') { throw 'Managed provider is not ready before corpus execution.' }
        $removedEnvironmentNames = Remove-AmbientSecrets
        Write-JsonFile -Value ([ordered]@{ RemovedNames = $removedEnvironmentNames; ValuesRecorded = $false }) -Path (Join-Path $artifactRoot 'environment-scrub.json')

        New-Item -ItemType Directory -Path $conformanceRoot -Force | Out-Null
        $corpusPath = if ($PlanCasesPath) { (Resolve-Path -LiteralPath $PlanCasesPath).Path } else { Join-Path $conformanceRoot 'corpus.json' }
        if ($PlanCasesPath) {
            if (-not $corpusPath.StartsWith($runRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'PlanCasesPath must remain inside the disposable guest run root.'
            }
            $corpusGeneration = $null
        }
        else {
            $corpusGeneration = Invoke-CapturedCommand -Name 'rust-five-control-corpus-export' -Executable 'cargo.exe' -Arguments @(
                'run', '-p', 'forge-core', '--bin', 'forge-sandbox-conformance', '--locked', '--offline', '--',
                'export', $corpusPath, '--provider-id=forge.windows.managed.preview', '--include-resources'
            ) -WorkingDirectory $repoRoot
            if ($corpusGeneration.ExitCode -ne 0) { throw 'Rust five-control corpus export failed.' }
        }
        $corpus = Get-Content -Raw -LiteralPath $corpusPath | ConvertFrom-Json
        if ($corpus.schemaVersion -ne 2 -or $corpus.sourceProviderId -ne 'forge.windows.managed.preview' -or
            (@($corpus.requiredControls) -join ',') -ne ($requiredControls -join ',') -or @($corpus.cases).Count -ne 17) {
            throw 'Exported corpus identity, schema, controls, or case count is invalid.'
        }

        $canaryReachable = $false
        $canaryError = $null
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $CanaryUri -TimeoutSec 5
            $canaryReachable = $response.StatusCode -eq 200 -and [string]$response.Content -eq "forge-lab-canary:$RunId"
        }
        catch { $canaryError = $_.Exception.Message }
        Write-JsonFile -Value ([ordered]@{ Uri = $CanaryUri; ReachableOutsideSandbox = $canaryReachable; Error = $canaryError }) -Path (Join-Path $artifactRoot 'canary-control.json')
        if (-not $canaryReachable) { throw 'Host-only canary control is not reachable.' }

        $appReportPath = Join-Path $artifactRoot 'appcontainer-corpus-report.json'
        $appEnvironment = @{
            FORGE_APPCONTAINER_CONFORMANCE_CORPUS = $corpusPath
            FORGE_APPCONTAINER_CONFORMANCE_REPORT = $appReportPath
        }
        $appTest = Invoke-CapturedCommand -Name 'rust-appcontainer-five-control-corpus' -Executable 'cargo.exe' -Arguments @(
            'test', '-p', 'forge-core', '--lib', '--locked', '--offline',
            'isolation::windows_appcontainer::tests::appcontainer_executes_the_exported_provider_neutral_corpus',
            '--', '--ignored', '--exact', '--nocapture'
        ) -WorkingDirectory $repoRoot -Environment $appEnvironment

        $managedReportPath = Join-Path $artifactRoot 'managed-provider-corpus-report.json'
        $managedEnvironment = @{
            FORGE_MANAGED_WINDOWS_NODE = (Get-Command node.exe -ErrorAction Stop).Source
            FORGE_MANAGED_WINDOWS_ADAPTER = $provider.Adapter
            FORGE_MANAGED_WINDOWS_PACKAGE_ROOT = $provider.PackageRoot
            FORGE_MANAGED_WINDOWS_CONFORMANCE_CORPUS = $corpusPath
            FORGE_MANAGED_WINDOWS_CONFORMANCE_REPORT = $managedReportPath
        }
        $managedTest = Invoke-CapturedCommand -Name 'rust-managed-five-control-corpus' -Executable 'cargo.exe' -Arguments @(
            'test', '-p', 'forge-core', '--lib', '--locked', '--offline',
            'isolation::windows_managed::tests::managed_provider_executes_the_exact_five_control_corpus',
            '--', '--ignored', '--exact', '--nocapture'
        ) -WorkingDirectory $repoRoot -Environment $managedEnvironment

        $baselines = @(
            $applicationInstall,
            (Invoke-CapturedCommand -Name 'npm-typecheck' -Executable 'npm.cmd' -Arguments @('run', 'typecheck') -WorkingDirectory $repoRoot),
            (Invoke-CapturedCommand -Name 'npm-test' -Executable 'npm.cmd' -Arguments @('test') -WorkingDirectory $repoRoot),
            (Invoke-CapturedCommand -Name 'npm-build' -Executable 'npm.cmd' -Arguments @('run', 'build') -WorkingDirectory $repoRoot),
            (Invoke-CapturedCommand -Name 'cargo-fmt' -Executable 'cargo.exe' -Arguments @('fmt', '--all', '--', '--check') -WorkingDirectory $repoRoot),
            (Invoke-CapturedCommand -Name 'cargo-isolation-authority' -Executable 'cargo.exe' -Arguments @('test', '-p', 'forge-core', '--locked', '--offline', '--test', 'isolation_authority') -WorkingDirectory $repoRoot)
        )
        $appReport = if (Test-Path -LiteralPath $appReportPath) { Read-JsonFile -Path $appReportPath } else { $null }
        $managedReport = if (Test-Path -LiteralPath $managedReportPath) { Read-JsonFile -Path $managedReportPath } else { $null }
        $failures = [System.Collections.Generic.List[string]]::new()
        if ($appTest.ExitCode -ne 0 -or $null -eq $appReport) { $failures.Add('AppContainer exact corpus command/report failed.') }
        else { foreach ($problem in @(Test-CorpusReport -Report $appReport -ExpectedTarget 'forge.windows.appcontainer.preview' -PlanField 'normalizedPlanEquivalent')) { $failures.Add($problem) } }
        if ($managedTest.ExitCode -ne 0 -or $null -eq $managedReport) { $failures.Add('Managed exact corpus command/report failed.') }
        else {
            foreach ($problem in @(Test-CorpusReport -Report $managedReport -ExpectedTarget 'forge.windows.managed.preview' -PlanField 'planEquivalent')) { $failures.Add($problem) }
            if ($managedReport.providerStateClean -ne $true) { $failures.Add('Managed provider state was not clean after the corpus.') }
        }
        foreach ($baseline in $baselines) {
            if ($baseline.ExitCode -ne 0) { $failures.Add("Baseline failed: $($baseline.Name).") }
        }
        $statusAfter = Invoke-ProviderStatus -Name 'provider-status-after-corpus' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        if ($statusAfter.Status.state -ne 'ready') { $failures.Add('Managed provider state is not ready after corpus cleanup.') }
        $result = [ordered]@{
            SchemaVersion = 2
            RunId = $RunId
            Passed = $failures.Count -eq 0
            Failures = @($failures)
            CorpusPath = $corpusPath
            CorpusSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $corpusPath).Hash.ToLowerInvariant()
            CanaryControlPassed = $canaryReachable
            DirectNetworkDenialEvidence = 'provider corpus direct_network_denied case; host-only request is reachability control only'
            AppContainer = [ordered]@{ Command = $appTest; Report = [IO.Path]::GetFileName($appReportPath); Sha256 = if ($null -ne $appReport) { (Get-FileHash -Algorithm SHA256 -LiteralPath $appReportPath).Hash.ToLowerInvariant() } else { $null } }
            Managed = [ordered]@{ Command = $managedTest; Report = [IO.Path]::GetFileName($managedReportPath); Sha256 = if ($null -ne $managedReport) { (Get-FileHash -Algorithm SHA256 -LiteralPath $managedReportPath).Hash.ToLowerInvariant() } else { $null } }
            Measurements = [ordered]@{
                AppContainer = if ($null -ne $appReport) { Get-CorpusMeasurements -Report $appReport } else { $null }
                Managed = if ($null -ne $managedReport) { Get-CorpusMeasurements -Report $managedReport } else { $null }
                SetupCost = 'provider-install-result.json Install.DurationMilliseconds'
                InferenceParticipated = $false
            }
            Baselines = $baselines
            StatusBefore = $statusBefore.Status
            StatusAfter = $statusAfter.Status
            Tokens = $null
            Retries = 0
        }
        Write-JsonFile -Value $result -Path (Join-Path $artifactRoot 'provider-corpus-result.json')
        if (-not $result.Passed) { throw "Provider corpus gate failed: $($result.Failures -join ' ')" }
        $result
    }
    'UninstallEvaluationProvider' {
        if (-not (Test-IsAdministrator)) {
            throw 'UninstallEvaluationProvider requires an elevated disposable guest session.'
        }
        $matrix = Read-JsonFile -Path (Join-Path $artifactRoot 'provider-corpus-result.json')
        if ($matrix.Passed -ne $true) { throw 'Uninstall requires a passing same-corpus result.' }
        $provider = Initialize-EvaluationPayloadInstall
        $before = Invoke-ProviderStatus -Name 'provider-status-before-uninstall' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        $uninstall = Invoke-CapturedCommand -Name 'provider-windows-uninstall' -Executable 'node.exe' -Arguments @(
            (Resolve-ProviderCli -PackageRoot $provider.PackageRoot), 'windows-uninstall'
        ) -WorkingDirectory $providerInstallRoot
        $after = Invoke-ProviderStatus -Name 'provider-status-after-uninstall' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        $result = [ordered]@{
            SchemaVersion = 1
            RunId = $RunId
            StartedBootTimeUtc = $verification.BootTimeUtc
            CompletedAtUtc = [DateTime]::UtcNow.ToString('o')
            StatusBefore = $before.Status
            Uninstall = $uninstall
            StatusAfter = $after.Status
            Passed = $before.Status.state -eq 'ready' -and $uninstall.ExitCode -eq 0 -and $after.Status.state -ne 'ready'
        }
        Write-JsonFile -Value $result -Path (Join-Path $artifactRoot 'provider-uninstall-result.json')
        if (-not $result.Passed) { throw 'Provider uninstall did not remove readiness.' }
        $result
    }
    'VerifyPostUninstallReboot' {
        $uninstallResult = Read-JsonFile -Path (Join-Path $artifactRoot 'provider-uninstall-result.json')
        if ($uninstallResult.Passed -ne $true) { throw 'Uninstall result did not pass.' }
        $provider = Initialize-EvaluationPayloadInstall
        $status = Invoke-ProviderStatus -Name 'provider-status-post-uninstall-reboot' -Adapter $provider.Adapter -PackageRoot $provider.PackageRoot
        $currentBoot = [DateTime]::Parse([string]$verification.BootTimeUtc).ToUniversalTime()
        $uninstallCompleted = [DateTime]::Parse([string]$uninstallResult.CompletedAtUtc).ToUniversalTime()
        $processes = @(Get-Process -Name 'srt-win', 'forge-sandbox-conformance' -ErrorAction SilentlyContinue | Select-Object ProcessName, Id)
        $residue = Get-ProviderMachineResidue
        $wfpVerification = $status.Status.diagnostics.wfpVerification
        $wfpStderr = $wfpVerification.PSObject.Properties['stderr']
        $wfpStillBlocks = $null -ne $wfpStderr -and [string]$wfpStderr.Value -match 'BLOCKED'
        $userProvisioned = $status.Status.diagnostics.user.PSObject.Properties['provisioned']
        $userStillProvisioned = $null -ne $userProvisioned -and $userProvisioned.Value -eq $true
        $result = [ordered]@{
            SchemaVersion = 1
            RunId = $RunId
            PreviousUninstallCompletedAtUtc = $uninstallCompleted.ToString('o')
            CurrentBootTimeUtc = $currentBoot.ToString('o')
            RebootProven = $currentBoot -gt $uninstallCompleted
            Status = $status.Status
            MatchingProcesses = $processes
            MachineResidue = $residue
            WfpBehaviorStillBlocks = $wfpStillBlocks
            Passed = $currentBoot -gt $uninstallCompleted -and
                $status.Status.state -ne 'ready' -and
                -not $userStillProvisioned -and
                -not $wfpStillBlocks -and
                $processes.Count -eq 0 -and
                @($residue.SandboxUsers).Count -eq 0 -and
                @($residue.SandboxGroups).Count -eq 0 -and
                $residue.ProfileExists -ne $true
        }
        Write-JsonFile -Value $result -Path (Join-Path $artifactRoot 'post-uninstall-reboot-result.json')
        if (-not $result.Passed) { throw 'Post-uninstall reboot/residue gate did not pass.' }
        $result
    }
    'FinalizeGuestEvidence' {
        $payload = Read-JsonFile -Path (Join-Path $artifactRoot 'payload-verification.json')
        $install = Read-JsonFile -Path (Join-Path $artifactRoot 'provider-install-result.json')
        $postInstall = Read-JsonFile -Path (Join-Path $artifactRoot 'post-install-reboot-result.json')
        $matrix = Read-JsonFile -Path (Join-Path $artifactRoot 'provider-corpus-result.json')
        $uninstall = Read-JsonFile -Path (Join-Path $artifactRoot 'provider-uninstall-result.json')
        $postUninstall = Read-JsonFile -Path (Join-Path $artifactRoot 'post-uninstall-reboot-result.json')
        $upgrade = if (Test-Path -LiteralPath (Join-Path $artifactRoot 'provider-upgrade-result.json')) {
            Read-JsonFile -Path (Join-Path $artifactRoot 'provider-upgrade-result.json')
        }
        else { $null }
        $failures = [System.Collections.Generic.List[string]]::new()
        foreach ($phase in @(
            @('payload verification', $payload),
            @('provider install', $install),
            @('post-install reboot', $postInstall),
            @('same-corpus execution', $matrix),
            @('provider uninstall', $uninstall),
            @('post-uninstall reboot', $postUninstall)
        )) {
            if ($phase[1].Passed -ne $true) { $failures.Add("Required phase did not pass: $($phase[0]).") }
        }
        if ($null -eq $upgrade) {
            $failures.Add('Upgrade evidence is absent; a second approved package pin is required for a real upgrade gate.')
        }
        elseif ($upgrade.Passed -ne $true) { $failures.Add('Provider upgrade evidence did not pass.') }
        $gate = [ordered]@{
            SchemaVersion = 2
            RunId = $RunId
            Passed = $failures.Count -eq 0
            Failures = @($failures)
            EvaluationOnly = $true
            ProductionPromotion = $false
            EvaluationModules = @('managed_windows_provider', 'appcontainer', 'provider_conformance')
            ExternalImplementationSourceCopiedIntoForge = $false
            RootApplicationDependencyAbsent = $payload.RootApplicationDependencyAbsent
            InstallPassed = $install.Passed
            PostInstallRebootPassed = $postInstall.Passed
            SameCorpusPassed = $matrix.Passed
            UpgradePassed = $null -ne $upgrade -and $upgrade.Passed -eq $true
            UninstallPassed = $uninstall.Passed
            PostUninstallRebootPassed = $postUninstall.Passed
            RequiresHostLifecycleFinalization = $true
            RequiresHostedWindows = $true
        }
        Write-JsonFile -Value $gate -Path (Join-Path $artifactRoot 'guest-acceptance-gate.json')
        $artifactFiles = @(Get-ChildItem -LiteralPath $artifactRoot -File | Where-Object { $_.Name -ne 'artifact-manifest.json' } | ForEach-Object {
            [ordered]@{ Name = $_.Name; Length = $_.Length; Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant() }
        })
        Write-JsonFile -Value ([ordered]@{
            SchemaVersion = 2
            RunId = $RunId
            CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
            Files = $artifactFiles
        }) -Path (Join-Path $artifactRoot 'artifact-manifest.json')
        $gate
        if (-not $gate.Passed) { throw "Guest lifecycle remains incomplete: $($gate.Failures -join ' ')" }
    }
}
