#Requires -Version 5.1

[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory)][ValidateSet('Preflight', 'Create', 'Start', 'InvokeGuest', 'Restart', 'Export', 'Stop', 'Destroy')][string]$Action,
    [Parameter(Mandatory)][string]$ConfigPath,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$')][string]$RunId,
    [string]$BundlePath,
    [string]$ArtifactPath,
    [string]$GuestPasswordFile,
    [ValidateSet(
        'Verify', 'Prepare', 'InstallSrt', 'RunMatrix', 'UninstallSrt',
        'VerifyPayload', 'InstallEvaluationProvider', 'VerifyPostInstallReboot',
        'RunProviderCorpus', 'UninstallEvaluationProvider',
        'VerifyPostUninstallReboot', 'FinalizeGuestEvidence'
    )][string]$GuestMode = 'Verify',
    [ValidateSet('PostInstall', 'PostUninstall')][string]$RestartReason,
    [string]$PlanCasesGuestPath,
    [switch]$Headless
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Import-PowerShellDataFile -LiteralPath $resolvedConfig
if ($config.SchemaVersion -ne 1 -or $config.Backend -ne 'virtualbox') {
    throw 'The lab config must use schema version 1 and backend virtualbox.'
}

if ($Action -eq 'Preflight') {
    $preflight = Join-Path $PSScriptRoot 'Test-ForgeLabHost.ps1'
    $preflightResult = & $preflight -ConfigPath $resolvedConfig
    $preflightResult
    if ($preflightResult.Ready -ne $true) {
        throw 'Forge lab preflight is not ready. No VM action was attempted.'
    }
    return
}

if (-not $RunId) {
    throw "RunId is required for action $Action."
}

$vboxCommand = Get-Command 'VBoxManage.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $vboxCommand) {
    throw 'VBoxManage.exe is unavailable. No fallback provider is selected.'
}
$vbox = $vboxCommand.Source
$vmName = '{0}-{1}' -f $config.RunVmPrefix, $RunId

function Invoke-VBox {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = & $vbox @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "VBoxManage failed ($($Arguments -join ' ')):`n$($output -join "`n")"
    }
    return @($output)
}

function Test-VmExists {
    param([Parameter(Mandatory)][string]$Name)

    & $vbox showvminfo $Name '--machinereadable' *> $null
    return $LASTEXITCODE -eq 0
}

function Get-VmState {
    param([Parameter(Mandatory)][string]$Name)

    $info = Invoke-VBox -Arguments @('showvminfo', $Name, '--machinereadable')
    $stateLine = $info | Where-Object { $_ -match '^VMState=' } | Select-Object -First 1
    if (-not $stateLine) {
        throw "Could not determine VM state for $Name."
    }
    return ($stateLine -replace '^VMState="?', '' -replace '"$', '')
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

function Write-HostLifecycleEvent {
    param(
        [Parameter(Mandatory)][string]$State,
        [Parameter(Mandatory)]$Details
    )

    if (-not $ArtifactPath) {
        throw "Action $Action requires ArtifactPath so host lifecycle evidence cannot be omitted."
    }
    $artifacts = [IO.Path]::GetFullPath($ArtifactPath)
    New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
    $path = Join-Path $artifacts 'host-lifecycle.jsonl'
    $lines = if (Test-Path -LiteralPath $path -PathType Leaf) {
        @(Get-Content -LiteralPath $path | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    }
    else { @() }
    foreach ($line in $lines) {
        $record = $line | ConvertFrom-Json
        if ($record.RunId -ne $RunId -or $record.VmName -ne $vmName) {
            throw 'Host lifecycle log contains a different run or VM identity.'
        }
    }
    $previousHash = if ($lines.Count -gt 0) { Get-TextSha256 -Value ([string]$lines[-1]) } else { $null }
    $record = [ordered]@{
        SchemaVersion = 2
        Sequence = $lines.Count + 1
        TimestampUtc = [DateTime]::UtcNow.ToString('o')
        RunId = $RunId
        VmName = $vmName
        State = $State
        PreviousRecordSha256 = $previousHash
        Details = $Details
    }
    Add-Content -LiteralPath $path -Value ($record | ConvertTo-Json -Depth 8 -Compress) -Encoding UTF8
}

switch ($Action) {
    'Create' {
        if (-not $BundlePath -or -not $ArtifactPath) {
            throw 'Create requires BundlePath and ArtifactPath.'
        }
        $bundle = (Resolve-Path -LiteralPath $BundlePath).Path
        if (-not (Test-Path -LiteralPath (Join-Path $bundle 'bundle.manifest.json') -PathType Leaf)) {
            throw 'BundlePath is not a Forge lab bundle.'
        }
        $artifacts = [IO.Path]::GetFullPath($ArtifactPath)
        if (Test-VmExists -Name $vmName) {
            throw "Run VM already exists: $vmName"
        }
        if ($PSCmdlet.ShouldProcess($vmName, "Create linked clone from $($config.TemplateVm)/$($config.TemplateSnapshot)")) {
            New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
            $registered = $false
            try {
                Invoke-VBox -Arguments @(
                    'clonevm', [string]$config.TemplateVm,
                    '--snapshot', [string]$config.TemplateSnapshot,
                    '--options', 'Link',
                    '--name', $vmName,
                    '--basefolder', [string]$config.LabRoot,
                    '--register'
                ) | Out-Null
                $registered = $true
                Invoke-VBox -Arguments @(
                    'modifyvm', $vmName,
                    '--cpus', [string]$config.CpuCount,
                    '--memory', [string]$config.MemoryMiB,
                    '--clipboard-mode', 'disabled',
                    '--drag-and-drop', 'disabled',
                    '--nic1', 'hostonly',
                    '--host-only-adapter1', [string]$config.HostOnlyAdapter,
                    '--nic2', 'none',
                    '--nic3', 'none',
                    '--nic4', 'none'
                ) | Out-Null
                Invoke-VBox -Arguments @('sharedfolder', 'add', $vmName, '--name', 'forge-input', '--hostpath', $bundle, '--readonly', '--automount') | Out-Null
                Write-HostLifecycleEvent -State 'created' -Details ([ordered]@{
                    BundlePath = $bundle
                    BundleManifestSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $bundle 'bundle.manifest.json')).Hash.ToLowerInvariant()
                    TemplateVm = [string]$config.TemplateVm
                    TemplateSnapshot = [string]$config.TemplateSnapshot
                })
                [pscustomobject]@{ RunId = $RunId; VmName = $vmName; Bundle = $bundle; Artifacts = $artifacts; State = 'created' }
            }
            catch {
                if ($registered -and (Test-VmExists -Name $vmName)) {
                    & $vbox unregistervm $vmName '--delete' *> $null
                }
                throw
            }
        }
    }
    'Start' {
        if (-not $ArtifactPath) { throw 'Start requires ArtifactPath.' }
        $startType = if ($Headless) { 'headless' } else { [string]$config.StartType }
        if ($PSCmdlet.ShouldProcess($vmName, "Start VM as $startType")) {
            Invoke-VBox -Arguments @('startvm', $vmName, '--type', $startType) | Out-Null
            Write-HostLifecycleEvent -State 'started' -Details ([ordered]@{ StartType = $startType })
            [pscustomobject]@{ RunId = $RunId; VmName = $vmName; State = 'started'; StartType = $startType }
        }
    }
    'InvokeGuest' {
        if (-not $GuestPasswordFile -or -not $ArtifactPath) {
            throw 'InvokeGuest requires ArtifactPath and an ACL-protected GuestPasswordFile outside the repository and bundle.'
        }
        $passwordFile = (Resolve-Path -LiteralPath $GuestPasswordFile).Path
        $providerLifecycleModes = @(
            'VerifyPayload', 'InstallEvaluationProvider', 'VerifyPostInstallReboot',
            'RunProviderCorpus', 'UninstallEvaluationProvider',
            'VerifyPostUninstallReboot', 'FinalizeGuestEvidence'
        )
        $guestScriptName = if ($GuestMode -in $providerLifecycleModes) {
            'Invoke-ForgeProviderLifecycleGuest.ps1'
        }
        else { 'Invoke-ForgeLabGuest.ps1' }
        $useGuestLocalScript = $GuestMode -in @(
            'RunMatrix', 'UninstallSrt', 'InstallEvaluationProvider',
            'VerifyPostInstallReboot', 'RunProviderCorpus',
            'UninstallEvaluationProvider', 'VerifyPostUninstallReboot',
            'FinalizeGuestEvidence'
        )
        $guestScript = if ($useGuestLocalScript) {
            Join-Path (Join-Path (Join-Path ([string]$config.GuestRunRoot) $RunId) 'repo') 'scripts\lab\guest\Invoke-ForgeLabGuest.ps1'
        }
        else {
            Join-Path ([string]$config.GuestInputRoot) 'repo\scripts\lab\guest\Invoke-ForgeLabGuest.ps1'
        }
        $guestScript = Join-Path (Split-Path -Parent $guestScript) $guestScriptName
        $guestArguments = @(
            'guestcontrol', $vmName, 'run',
            '--exe', 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
            '--username', [string]$config.GuestUsername,
            '--passwordfile', $passwordFile,
            '--timeout', '7200000',
            '--wait-stdout', '--wait-stderr',
            '--', 'powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
            '-ExecutionPolicy', 'Bypass', '-File', $guestScript,
            '-Mode', $GuestMode,
            '-RunId', $RunId,
            '-InputRoot', [string]$config.GuestInputRoot,
            '-OutputRoot', [string]$config.GuestOutputRoot,
            '-GuestRunRoot', [string]$config.GuestRunRoot,
            '-NpmCache', [string]$config.GuestNpmCache,
            '-CanaryUri', [string]$config.CanaryUri
        )
        if ($PlanCasesGuestPath) {
            $guestArguments += @('-PlanCasesPath', $PlanCasesGuestPath)
        }
        if ($PSCmdlet.ShouldProcess($vmName, "Invoke guest lab mode $GuestMode")) {
            try {
                $output = Invoke-VBox -Arguments $guestArguments
                Write-HostLifecycleEvent -State 'guest-mode-completed' -Details ([ordered]@{ Mode = $GuestMode })
                $output
            }
            catch {
                Write-HostLifecycleEvent -State 'guest-mode-failed' -Details ([ordered]@{ Mode = $GuestMode; Error = $_.Exception.Message })
                throw
            }
        }
    }
    'Restart' {
        if (-not $ArtifactPath -or -not $RestartReason) {
            throw 'Restart requires ArtifactPath and RestartReason.'
        }
        $state = Get-VmState -Name $vmName
        if ($state -ne 'running') {
            throw "Refusing to restart $vmName while state is $state."
        }
        if ($PSCmdlet.ShouldProcess($vmName, "Hard-reset disposable guest for $RestartReason recovery evidence")) {
            Invoke-VBox -Arguments @('controlvm', $vmName, 'reset') | Out-Null
            Write-HostLifecycleEvent -State 'hard-reset-requested' -Details ([ordered]@{
                Reason = $RestartReason
                Method = 'VirtualBox controlvm reset'
            })
            [pscustomobject]@{ RunId = $RunId; VmName = $vmName; State = 'hard-reset-requested'; Reason = $RestartReason }
        }
    }
    'Export' {
        if (-not $GuestPasswordFile -or -not $ArtifactPath) {
            throw 'Export requires GuestPasswordFile and ArtifactPath.'
        }
        $passwordFile = (Resolve-Path -LiteralPath $GuestPasswordFile).Path
        $artifacts = [IO.Path]::GetFullPath($ArtifactPath)
        New-Item -ItemType Directory -Path $artifacts -Force | Out-Null
        $guestSource = Join-Path (Join-Path ([string]$config.GuestOutputRoot) $RunId) '*'
        if ($PSCmdlet.ShouldProcess($vmName, "Export guest-local evidence to $artifacts")) {
            Invoke-VBox -Arguments @(
                'guestcontrol', $vmName, 'copyfrom',
                '--username', [string]$config.GuestUsername,
                '--passwordfile', $passwordFile,
                '--recursive',
                $guestSource,
                $artifacts
            ) | Out-Null
            Write-HostLifecycleEvent -State 'artifacts-exported' -Details ([ordered]@{ ArtifactPath = $artifacts })
            [pscustomobject]@{ RunId = $RunId; VmName = $vmName; State = 'artifacts-exported'; Artifacts = $artifacts }
        }
    }
    'Stop' {
        if (-not $ArtifactPath) { throw 'Stop requires ArtifactPath.' }
        if ($PSCmdlet.ShouldProcess($vmName, 'Request ACPI shutdown')) {
            Invoke-VBox -Arguments @('controlvm', $vmName, 'acpipowerbutton') | Out-Null
            Write-HostLifecycleEvent -State 'shutdown-requested' -Details ([ordered]@{ Method = 'ACPI power button' })
            [pscustomobject]@{ RunId = $RunId; VmName = $vmName; State = 'shutdown-requested' }
        }
    }
    'Destroy' {
        if (-not $ArtifactPath) { throw 'Destroy requires ArtifactPath.' }
        $state = Get-VmState -Name $vmName
        if ($state -ne 'poweroff') {
            throw "Refusing to destroy $vmName while state is $state. Shut it down and export artifacts first."
        }
        if ($PSCmdlet.ShouldProcess($vmName, 'Unregister and delete disposable linked clone')) {
            Invoke-VBox -Arguments @('unregistervm', $vmName, '--delete') | Out-Null
            if (Test-VmExists -Name $vmName) {
                throw "Disposable VM still exists after destroy: $vmName"
            }
            Write-HostLifecycleEvent -State 'destroyed' -Details ([ordered]@{ PreviousState = $state })
            [pscustomobject]@{ RunId = $RunId; VmName = $vmName; State = 'destroyed' }
        }
    }
}
