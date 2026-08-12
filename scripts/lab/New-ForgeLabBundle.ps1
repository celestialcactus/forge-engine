#Requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory)][string]$RepositoryRoot,
    [Parameter(Mandatory)][string]$ProviderPayloadPath,
    [Parameter(Mandatory)][string]$OutputRoot,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$RunId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repository = (Resolve-Path -LiteralPath $RepositoryRoot).Path.TrimEnd('\')
$gitRootOutput = @(& git -C $repository rev-parse --show-toplevel 2>&1)
$gitRootExitCode = $LASTEXITCODE
$gitRoot = ([string]($gitRootOutput | Select-Object -First 1)).Trim().Replace('/', '\')
if ($gitRootExitCode -ne 0 -or $gitRoot -ne $repository) {
    throw "RepositoryRoot must be the active Git checkout root. Resolved Git root: $gitRoot"
}

$outputBase = [IO.Path]::GetFullPath($OutputRoot).TrimEnd('\')
$bundleRoot = Join-Path $outputBase $RunId
if (Test-Path -LiteralPath $bundleRoot) {
    throw "Bundle already exists: $bundleRoot. Use a new RunId; bundles are immutable."
}

$pathSpecs = @(
    'Cargo.toml',
    'Cargo.lock',
    'package.json',
    'package-lock.json',
    'tsconfig*.json',
    'crates/**',
    'packages/**',
    'src/**',
    'tests/**',
    'scripts/sandbox-conformance.mjs',
    'scripts/sandbox-provider-srt.mjs',
    'scripts/stage-managed-provider-evaluation.mjs',
    'scripts/lab/**'
)
$relativeFiles = @(& git -C $repository ls-files --cached --others --exclude-standard -- @pathSpecs)
$fileListExitCode = $LASTEXITCODE
if ($fileListExitCode -ne 0 -or $relativeFiles.Count -eq 0) {
    throw 'Could not enumerate the allowlisted checkout files.'
}

$secretPathPattern = '(^|/)(\.env($|\.)|\.npmrc$|\.pypirc$|credentials($|\.)|id_[^/]+$)|\.(pfx|p12|pem|key|kdbx)$'
$blocked = @($relativeFiles | Where-Object { $_ -match $secretPathPattern })
if ($blocked.Count -gt 0) {
    throw "The allowlisted bundle contains secret-prone paths: $($blocked -join ', ')"
}

$package = Get-Content -Raw -LiteralPath (Join-Path $repository 'package.json') | ConvertFrom-Json
$lockText = Get-Content -Raw -LiteralPath (Join-Path $repository 'package-lock.json')
if ($null -ne $package.dependencies.PSObject.Properties['@anthropic-ai/sandbox-runtime'] -or
    $lockText -match '"node_modules/@anthropic-ai/sandbox-runtime"\s*:') {
    throw '@anthropic-ai/sandbox-runtime must remain a temporary lab probe, not a Forge application dependency.'
}

$branch = (& git -C $repository branch --show-current).Trim()
$commit = (& git -C $repository rev-parse HEAD).Trim()
$status = @(& git -C $repository status --short)

$providerPayload = (Resolve-Path -LiteralPath $ProviderPayloadPath).Path.TrimEnd('\')
$providerManifestPath = Join-Path $providerPayload 'evaluation-payload.manifest.json'
if (-not (Test-Path -LiteralPath $providerManifestPath -PathType Leaf)) {
    throw 'ProviderPayloadPath does not contain evaluation-payload.manifest.json.'
}
$providerManifest = Get-Content -Raw -LiteralPath $providerManifestPath | ConvertFrom-Json
if ($providerManifest.schemaVersion -ne 1 -or
    $providerManifest.kind -ne 'forge.managed-windows-provider.evaluation-payload' -or
    $providerManifest.status -ne 'evaluation_only' -or
    $providerManifest.providerId -ne 'forge.windows.managed.preview' -or
    $providerManifest.sourcePackage -ne '@anthropic-ai/sandbox-runtime' -or
    $providerManifest.sourcePackageVersion -ne '0.0.71') {
    throw 'Provider evaluation payload identity, status, or exact package pin is invalid.'
}
$payloadFiles = @($providerManifest.files)
if ($payloadFiles.Count -eq 0 -or $payloadFiles.Count -gt 2000) {
    throw 'Provider evaluation payload file count is invalid.'
}
$expectedPayloadPaths = @(
    @($payloadFiles | ForEach-Object { ([string]$_.path).Replace('\', '/') }) +
    'evaluation-payload.manifest.json'
)
$payloadEntries = @(Get-ChildItem -LiteralPath $providerPayload -Recurse -Force)
$payloadReparsePoints = @($payloadEntries | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })
if ($payloadReparsePoints.Count -ne 0) {
    throw 'Provider evaluation payload contains a reparse point.'
}
$actualPayloadPaths = @($payloadEntries | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    $_.FullName.Substring($providerPayload.Length + 1).Replace('\', '/')
})
$payloadInventoryDifference = @(Compare-Object -ReferenceObject ($expectedPayloadPaths | Sort-Object) -DifferenceObject ($actualPayloadPaths | Sort-Object))
if ($payloadInventoryDifference.Count -ne 0 -or $actualPayloadPaths.Count -ne $expectedPayloadPaths.Count) {
    throw 'Provider evaluation payload contains missing, duplicate, or unmanifested files.'
}
$payloadBytes = [UInt64]0
foreach ($file in $payloadFiles) {
    $relative = [string]$file.path
    if ([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Provider evaluation payload contains an invalid path: $relative"
    }
    $path = [IO.Path]::GetFullPath((Join-Path $providerPayload $relative.Replace('/', '\')))
    if (-not $path.StartsWith($providerPayload + '\', [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Provider evaluation payload file is missing or escaped: $relative"
    }
    $item = Get-Item -LiteralPath $path -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Provider evaluation payload contains a reparse point: $relative"
    }
    if ($item.Length -ne [Int64]$file.bytes -or
        (Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash.ToLowerInvariant() -ne [string]$file.sha256) {
        throw "Provider evaluation payload file hash/length mismatch: $relative"
    }
    $payloadBytes += [UInt64]$item.Length
}
if ($payloadBytes -gt 64MB) {
    throw 'Provider evaluation payload exceeds 64 MiB.'
}

if (-not $PSCmdlet.ShouldProcess($bundleRoot, 'Create immutable, allowlisted Forge lab input bundle')) {
    return
}

$repoOutput = Join-Path $bundleRoot 'repo'
$inputsOutput = Join-Path $bundleRoot 'inputs'
New-Item -ItemType Directory -Path $repoOutput -Force | Out-Null
New-Item -ItemType Directory -Path $inputsOutput -Force | Out-Null
$providerOutput = Join-Path $inputsOutput 'managed-provider-evaluation'
Copy-Item -LiteralPath $providerPayload -Destination $providerOutput -Recurse

$manifestFiles = [System.Collections.Generic.List[object]]::new()
foreach ($relative in ($relativeFiles | Sort-Object -Unique)) {
    $normalized = $relative.Replace('/', '\')
    $source = Join-Path $repository $normalized
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        continue
    }
    $item = Get-Item -LiteralPath $source -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse points are not allowed in a lab bundle: $relative"
    }
    $destination = Join-Path $repoOutput $normalized
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination
    $copied = Get-Item -LiteralPath $destination
    $manifestFiles.Add([pscustomobject]@{
        Path = $relative.Replace('\', '/')
        Length = $copied.Length
        Sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
    })
}

$manifest = [ordered]@{
    SchemaVersion = 2
    RunId = $RunId
    CreatedAtUtc = [DateTime]::UtcNow.ToString('o')
    Source = [ordered]@{
        Branch = $branch
        Commit = $commit
        Dirty = $status.Count -gt 0
        Status = $status
    }
    DependencyPins = [ordered]@{
        SandboxRuntime = '0.0.71'
    }
    EvaluationPayload = [ordered]@{
        Kind = [string]$providerManifest.kind
        Status = [string]$providerManifest.status
        ProviderId = [string]$providerManifest.providerId
        SourcePackage = [string]$providerManifest.sourcePackage
        SourcePackageVersion = [string]$providerManifest.sourcePackageVersion
        ManifestPath = 'inputs/managed-provider-evaluation/evaluation-payload.manifest.json'
        ManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $providerOutput 'evaluation-payload.manifest.json')).Hash.ToLowerInvariant()
        FileCount = $payloadFiles.Count + 1
        Bytes = $payloadBytes + (Get-Item -LiteralPath $providerManifestPath).Length
    }
    Files = @($manifestFiles)
}
$manifestPath = Join-Path $bundleRoot 'bundle.manifest.json'
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Get-FileHash -Algorithm SHA256 -LiteralPath $manifestPath |
    Select-Object @{ Name = 'BundleRoot'; Expression = { $bundleRoot } }, Path, Hash
