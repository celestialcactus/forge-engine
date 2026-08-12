#Requires -Version 5.1

# Read-only host finalizer for schema-2 provider lifecycle evidence. A failure is
# evidence that the evaluation gate remains open, never permission to degrade.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ArtifactPath,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$RunId,
    [switch]$AsJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$artifactRoot = (Resolve-Path -LiteralPath $ArtifactPath).Path
$problems = [System.Collections.Generic.List[string]]::new()
$requiredGuestFiles = @(
    'payload-verification.json',
    'provider-install-result.json',
    'post-install-reboot-result.json',
    'provider-corpus-result.json',
    'appcontainer-corpus-report.json',
    'managed-provider-corpus-report.json',
    'environment-scrub.json',
    'canary-control.json',
    'provider-upgrade-result.json',
    'provider-uninstall-result.json',
    'post-uninstall-reboot-result.json',
    'guest-acceptance-gate.json'
)
$manifestPath = Join-Path $artifactRoot 'artifact-manifest.json'
$canaryPath = Join-Path $artifactRoot 'canary.jsonl'
$hostLifecyclePath = Join-Path $artifactRoot 'host-lifecycle.jsonl'

function Add-Problem {
    param([Parameter(Mandatory)][string]$Message)
    $problems.Add($Message)
}

function Read-JsonArtifact {
    param([Parameter(Mandatory)][string]$Name)

    $path = Join-Path $artifactRoot $Name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        Add-Problem -Message "Required artifact is missing: $Name"
        return $null
    }
    try {
        return Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    }
    catch {
        Add-Problem -Message "Artifact is not valid JSON: $Name"
        return $null
    }
}

function Get-TextSha256 {
    param([Parameter(Mandatory)][string]$Value)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Test-Phase {
    param([string]$Name, $Value)

    if ($null -ne $Value -and ($Value.RunId -ne $RunId -or $Value.Passed -ne $true)) {
        Add-Problem -Message "$Name did not pass for this run identity."
    }
}

function Test-CorpusReport {
    param($Report, [string]$ProviderId, [string]$PlanField)

    if ($null -eq $Report) { return }
    if ($Report.corpusSchemaVersion -ne 2 -or $Report.targetProviderId -ne $ProviderId -or
        $Report.caseCount -ne 17 -or $Report.passedCount -ne 17 -or
        $Report.allCasesPassed -ne $true -or $Report.retries -ne 0 -or $null -ne $Report.tokens) {
        Add-Problem -Message "$ProviderId corpus summary is invalid."
    }
    $results = @($Report.results)
    $ids = @($results | ForEach-Object { [string]$_.id })
    if ($results.Count -ne 17 -or @($ids | Sort-Object -Unique).Count -ne 17) {
        Add-Problem -Message "$ProviderId corpus identities are incomplete or duplicated."
    }
    foreach ($case in $results) {
        $planProperty = $case.PSObject.Properties[$PlanField]
        if ($case.passed -ne $true -or $null -eq $planProperty -or $planProperty.Value -ne $true -or
            $case.residueClean -ne $true -or $case.descendantClean -ne $true -or
            $case.aclClean -ne $true -or $case.elapsedMilliseconds -le 0 -or $null -ne $case.error) {
            Add-Problem -Message "$ProviderId case $($case.id) lacks pass/plan/lifecycle evidence."
        }
    }
}

$manifest = Read-JsonArtifact -Name 'artifact-manifest.json'
$manifestNames = @()
if ($null -ne $manifest) {
    if ($manifest.SchemaVersion -ne 2 -or $manifest.RunId -ne $RunId) {
        Add-Problem -Message 'Artifact manifest schema or run identity is invalid.'
    }
    $manifestNames = @($manifest.Files | ForEach-Object { [string]$_.Name })
    if ($manifestNames.Count -ne @($manifestNames | Sort-Object -Unique).Count) {
        Add-Problem -Message 'Artifact manifest contains duplicate names.'
    }
    foreach ($file in @($manifest.Files)) {
        $name = [string]$file.Name
        if ([IO.Path]::GetFileName($name) -ne $name -or [string]::IsNullOrWhiteSpace($name)) {
            Add-Problem -Message "Artifact manifest contains an invalid name: $name"
            continue
        }
        $path = Join-Path $artifactRoot $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            Add-Problem -Message "Manifested artifact is missing: $name"
            continue
        }
        $item = Get-Item -LiteralPath $path
        $hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant()
        if ($item.Length -ne [Int64]$file.Length -or $hash -ne ([string]$file.Sha256).ToLowerInvariant()) {
            Add-Problem -Message "Artifact length/hash mismatch: $name"
        }
    }
    foreach ($name in $requiredGuestFiles) {
        if ($name -notin $manifestNames) {
            Add-Problem -Message "Required guest evidence is not bound by the artifact manifest: $name"
        }
    }
}

$payload = Read-JsonArtifact -Name 'payload-verification.json'
$install = Read-JsonArtifact -Name 'provider-install-result.json'
$postInstall = Read-JsonArtifact -Name 'post-install-reboot-result.json'
$corpus = Read-JsonArtifact -Name 'provider-corpus-result.json'
$appReport = Read-JsonArtifact -Name 'appcontainer-corpus-report.json'
$managedReport = Read-JsonArtifact -Name 'managed-provider-corpus-report.json'
$upgrade = Read-JsonArtifact -Name 'provider-upgrade-result.json'
$uninstall = Read-JsonArtifact -Name 'provider-uninstall-result.json'
$postUninstall = Read-JsonArtifact -Name 'post-uninstall-reboot-result.json'
$guestGate = Read-JsonArtifact -Name 'guest-acceptance-gate.json'

Test-Phase -Name 'Payload verification' -Value $payload
Test-Phase -Name 'Provider install' -Value $install
Test-Phase -Name 'Post-install reboot' -Value $postInstall
Test-Phase -Name 'Same-corpus execution' -Value $corpus
Test-Phase -Name 'Provider upgrade' -Value $upgrade
Test-Phase -Name 'Provider uninstall' -Value $uninstall
Test-Phase -Name 'Post-uninstall reboot' -Value $postUninstall
Test-Phase -Name 'Guest acceptance gate' -Value $guestGate

if ($null -ne $payload -and ($payload.RootApplicationDependencyAbsent -ne $true -or $payload.PayloadStatus -ne 'evaluation_only')) {
    Add-Problem -Message 'Provider payload was not kept evaluation-only and separate from the Forge application dependency graph.'
}
if ($null -ne $install -and ($install.Install.ExitCode -ne 0 -or $install.Install.DurationMilliseconds -le 0 -or
    $install.StatusAfter.state -ne 'ready')) {
    Add-Problem -Message 'Provider installation lacks a successful duration/readiness measurement.'
}
if ($null -ne $postInstall -and ($postInstall.RebootProven -ne $true -or $postInstall.Status.state -ne 'ready')) {
    Add-Problem -Message 'Provider readiness did not survive the post-install hard reboot.'
}
if ($null -ne $corpus) {
    if ($corpus.SchemaVersion -ne 2 -or $corpus.CanaryControlPassed -ne $true -or
        $corpus.Retries -ne 0 -or $null -ne $corpus.Tokens -or
        $corpus.Measurements.InferenceParticipated -ne $false) {
        Add-Problem -Message 'Same-corpus result schema, canary, retry, token, or inference evidence is invalid.'
    }
    foreach ($baseline in @($corpus.Baselines)) {
        if ($baseline.ExitCode -ne 0 -or $baseline.DurationMilliseconds -le 0) {
            Add-Problem -Message "Baseline command failed or lacks duration: $($baseline.Name)"
        }
    }
}
Test-CorpusReport -Report $appReport -ProviderId 'forge.windows.appcontainer.preview' -PlanField 'normalizedPlanEquivalent'
Test-CorpusReport -Report $managedReport -ProviderId 'forge.windows.managed.preview' -PlanField 'planEquivalent'
if ($null -ne $managedReport -and $managedReport.providerStateClean -ne $true) {
    Add-Problem -Message 'Managed provider state was not clean after same-corpus execution.'
}
if ($null -ne $uninstall -and ($uninstall.Uninstall.ExitCode -ne 0 -or $uninstall.Uninstall.DurationMilliseconds -le 0 -or
    $uninstall.StatusAfter.state -eq 'ready')) {
    Add-Problem -Message 'Provider uninstall lacks a successful duration/non-ready measurement.'
}
if ($null -ne $postUninstall -and ($postUninstall.RebootProven -ne $true -or
    $postUninstall.Status.state -eq 'ready' -or $postUninstall.WfpBehaviorStillBlocks -eq $true -or
    @($postUninstall.MatchingProcesses).Count -ne 0 -or @($postUninstall.MachineResidue.SandboxUsers).Count -ne 0 -or
    @($postUninstall.MachineResidue.SandboxGroups).Count -ne 0 -or $postUninstall.MachineResidue.ProfileExists -eq $true)) {
    Add-Problem -Message 'Post-uninstall reboot left readiness, WFP behavior, account/group/profile, or process residue.'
}
if ($null -ne $guestGate -and ($guestGate.SchemaVersion -ne 2 -or $guestGate.EvaluationOnly -ne $true -or
    $guestGate.ProductionPromotion -ne $false -or $guestGate.ExternalImplementationSourceCopiedIntoForge -ne $false -or
    $guestGate.RequiresHostLifecycleFinalization -ne $true)) {
    Add-Problem -Message 'Guest gate authority/provenance/promotion fields are invalid.'
}

$canaryRequests = @()
if (-not (Test-Path -LiteralPath $canaryPath -PathType Leaf)) {
    Add-Problem -Message 'Required host artifact is missing: canary.jsonl'
}
else {
    foreach ($line in @(Get-Content -LiteralPath $canaryPath)) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $record = $line | ConvertFrom-Json
            if ($record.RunId -eq $RunId) { $canaryRequests += $record }
        }
        catch { Add-Problem -Message 'Canary log contains invalid JSON.' }
    }
    if ($canaryRequests.Count -ne 1) {
        Add-Problem -Message "Expected exactly one unsandboxed canary control request; observed $($canaryRequests.Count)."
    }
    elseif ([string]$canaryRequests[0].RequestLine -notmatch '^GET /forge-network-canary(?:\?| )') {
        Add-Problem -Message 'The only canary request was not the expected host-only control path.'
    }
}

$hostEvents = @()
if (-not (Test-Path -LiteralPath $hostLifecyclePath -PathType Leaf)) {
    Add-Problem -Message 'Required host artifact is missing: host-lifecycle.jsonl'
}
else {
    $previousLine = $null
    foreach ($line in @(Get-Content -LiteralPath $hostLifecyclePath | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        try { $event = $line | ConvertFrom-Json }
        catch {
            Add-Problem -Message 'Host lifecycle log contains invalid JSON.'
            continue
        }
        $expectedPreviousHash = if ($null -eq $previousLine) { $null } else { Get-TextSha256 -Value $previousLine }
        if ($event.SchemaVersion -ne 2 -or $event.RunId -ne $RunId -or
            $event.Sequence -ne ($hostEvents.Count + 1) -or
            [string]$event.PreviousRecordSha256 -ne [string]$expectedPreviousHash) {
            Add-Problem -Message "Host lifecycle event $($hostEvents.Count + 1) has invalid identity, sequence, or hash chain."
        }
        $hostEvents += $event
        $previousLine = [string]$line
    }
    $requiredHostStates = @(
        @{ Name = 'created'; Predicate = { param($e) $e.State -eq 'created' } },
        @{ Name = 'started'; Predicate = { param($e) $e.State -eq 'started' } },
        @{ Name = 'post-install hard reset'; Predicate = { param($e) $e.State -eq 'hard-reset-requested' -and $e.Details.Reason -eq 'PostInstall' } },
        @{ Name = 'post-uninstall hard reset'; Predicate = { param($e) $e.State -eq 'hard-reset-requested' -and $e.Details.Reason -eq 'PostUninstall' } },
        @{ Name = 'artifacts exported'; Predicate = { param($e) $e.State -eq 'artifacts-exported' } },
        @{ Name = 'shutdown requested'; Predicate = { param($e) $e.State -eq 'shutdown-requested' } },
        @{ Name = 'destroyed'; Predicate = { param($e) $e.State -eq 'destroyed' } }
    )
    $lastSequence = 0
    foreach ($required in $requiredHostStates) {
        $predicate = $required.Predicate
        $event = @($hostEvents | Where-Object { & $predicate $_ } | Where-Object { $_.Sequence -gt $lastSequence } | Select-Object -First 1)
        if ($event.Count -ne 1) {
            Add-Problem -Message "Host lifecycle is missing or misordered: $($required.Name)."
        }
        else { $lastSequence = [int]$event[0].Sequence }
    }
}

$result = [pscustomobject]@{
    SchemaVersion = 2
    RunId = $RunId
    CheckedAtUtc = [DateTime]::UtcNow.ToString('o')
    Passed = $problems.Count -eq 0
    Problems = @($problems)
    CanaryRequestCount = $canaryRequests.Count
    HostLifecycleEventCount = $hostEvents.Count
    GuestGate = $guestGate
    EvaluationOnly = $true
    ProductionPromotion = $false
}

if ($AsJson) { $result | ConvertTo-Json -Depth 16 } else { $result }
if (-not $result.Passed) { exit 1 }
