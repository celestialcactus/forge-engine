#Requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ConfigPath,
    [switch]$AsJson
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-CommandPath {
    param([Parameter(Mandatory)][string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        return $null
    }
    return $command.Source
}

function Get-OptionalFeatureState {
    param([Parameter(Mandatory)][string]$Name)

    try {
        $feature = Get-WindowsOptionalFeature -Online -FeatureName $Name -ErrorAction Stop
        return [string]$feature.State
    }
    catch {
        try {
            $feature = Get-CimInstance Win32_OptionalFeature -Filter "Name='$Name'" -ErrorAction Stop
            if ($null -eq $feature) {
                return 'NotPresent'
            }
            $state = switch ([int]$feature.InstallState) {
                1 { 'Enabled' }
                2 { 'Disabled' }
                3 { 'Absent' }
                default { "Unknown:$($feature.InstallState)" }
            }
            return $state
        }
        catch {
            return 'UnavailableOrUnreadable'
        }
    }
}

function Invoke-VBoxReadOnly {
    param(
        [Parameter(Mandatory)][string]$Executable,
        [Parameter(Mandatory)][string[]]$Arguments
    )

    $output = & $Executable @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        return [pscustomobject]@{
            Succeeded = $false
            Output = ($output -join "`n")
        }
    }
    return [pscustomobject]@{
        Succeeded = $true
        Output = ($output -join "`n")
    }
}

$currentVersion = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$virtualizationFirmwareEnabled = $null
$hypervisorPresent = $null
$memoryGiB = $null
$systemDriveFreeGiB = $null
$operatingSystemCaption = $null
$operatingSystemVersion = $null

try {
    $operatingSystem = Get-CimInstance Win32_OperatingSystem
    $computer = Get-CimInstance Win32_ComputerSystem
    $processor = Get-CimInstance Win32_Processor | Select-Object -First 1
    $drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    $virtualizationFirmwareEnabled = [bool]$processor.VirtualizationFirmwareEnabled
    $hypervisorPresent = [bool]$computer.HypervisorPresent
    $memoryGiB = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
    $systemDriveFreeGiB = [math]::Round($drive.FreeSpace / 1GB, 1)
    $operatingSystemCaption = [string]$operatingSystem.Caption
    $operatingSystemVersion = [string]$operatingSystem.Version
}
catch {
    # The Codex filesystem sandbox can deny CIM. Null is intentionally reported
    # rather than turning an unreadable capability into a pass.
}

$virtualBox = Get-CommandPath -Name 'VBoxManage.exe'
$tools = [ordered]@{
    VirtualBox = $virtualBox
    WindowsSandbox = Get-CommandPath -Name 'WindowsSandbox.exe'
    Wsl = Get-CommandPath -Name 'wsl.exe'
    Docker = Get-CommandPath -Name 'docker.exe'
    Podman = Get-CommandPath -Name 'podman.exe'
    Qemu = Get-CommandPath -Name 'qemu-system-x86_64.exe'
    HyperVPowerShell = Get-CommandPath -Name 'New-VM'
    Dism = Get-CommandPath -Name 'dism.exe'
    Robocopy = Get-CommandPath -Name 'robocopy.exe'
    Tar = Get-CommandPath -Name 'tar.exe'
    Ssh = Get-CommandPath -Name 'ssh.exe'
}

$featureStates = [ordered]@{
    HyperV = Get-OptionalFeatureState -Name 'Microsoft-Hyper-V-All'
    WindowsSandbox = Get-OptionalFeatureState -Name 'Containers-DisposableClientVM'
    VirtualMachinePlatform = Get-OptionalFeatureState -Name 'VirtualMachinePlatform'
    Wsl = Get-OptionalFeatureState -Name 'Microsoft-Windows-Subsystem-Linux'
    Containers = Get-OptionalFeatureState -Name 'Containers'
}

$config = $null
$virtualBoxEvidence = $null
$requirements = [System.Collections.Generic.List[object]]::new()

$requirements.Add([pscustomobject]@{
    Requirement = 'Hardware virtualization enabled in UEFI/BIOS'
    Passed = $virtualizationFirmwareEnabled -eq $true
    Evidence = if ($null -eq $virtualizationFirmwareEnabled) { 'unreadable' } else { [string]$virtualizationFirmwareEnabled }
})
$requirements.Add([pscustomobject]@{
    Requirement = 'VBoxManage available'
    Passed = $null -ne $virtualBox
    Evidence = if ($null -eq $virtualBox) { 'not found' } else { $virtualBox }
})

if ($ConfigPath) {
    $resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
    $config = Import-PowerShellDataFile -LiteralPath $resolvedConfig
    if ($config.SchemaVersion -ne 1 -or $config.Backend -ne 'virtualbox') {
        throw 'The lab config must use schema version 1 and backend virtualbox.'
    }

    if ($virtualBox) {
        $version = Invoke-VBoxReadOnly -Executable $virtualBox -Arguments @('--version')
        $template = Invoke-VBoxReadOnly -Executable $virtualBox -Arguments @('showvminfo', [string]$config.TemplateVm, '--machinereadable')
        $snapshots = Invoke-VBoxReadOnly -Executable $virtualBox -Arguments @('snapshot', [string]$config.TemplateVm, 'list', '--machinereadable')
        $hostOnly = Invoke-VBoxReadOnly -Executable $virtualBox -Arguments @('list', 'hostonlyifs')
        $snapshotPresent = $snapshots.Succeeded -and $snapshots.Output.Contains('SnapshotName=') -and $snapshots.Output.Contains([string]$config.TemplateSnapshot)
        $adapterPresent = $hostOnly.Succeeded -and $hostOnly.Output.Contains([string]$config.HostOnlyAdapter)
        $virtualBoxEvidence = [pscustomobject]@{
            Version = $version.Output
            TemplatePresent = $template.Succeeded
            SnapshotPresent = $snapshotPresent
            HostOnlyAdapterPresent = $adapterPresent
        }
        $requirements.Add([pscustomobject]@{ Requirement = 'Template VM exists'; Passed = $template.Succeeded; Evidence = $config.TemplateVm })
        $requirements.Add([pscustomobject]@{ Requirement = 'Immutable template snapshot exists'; Passed = $snapshotPresent; Evidence = $config.TemplateSnapshot })
        $requirements.Add([pscustomobject]@{ Requirement = 'Configured host-only adapter exists'; Passed = $adapterPresent; Evidence = $config.HostOnlyAdapter })
    }
}

$result = [pscustomobject]@{
    InventoryVersion = 1
    CollectedAtUtc = [DateTime]::UtcNow.ToString('o')
    Host = [pscustomobject]@{
        ProductName = if ($operatingSystemCaption) { $operatingSystemCaption } else { [string]$currentVersion.ProductName }
        RegistryProductName = [string]$currentVersion.ProductName
        Version = if ($operatingSystemVersion) { $operatingSystemVersion } else { [Environment]::OSVersion.Version.ToString() }
        DisplayVersion = [string]$currentVersion.DisplayVersion
        Build = "{0}.{1}" -f $currentVersion.CurrentBuild, $currentVersion.UBR
        InstallationType = [string]$currentVersion.InstallationType
        Is64BitOperatingSystem = [Environment]::Is64BitOperatingSystem
        ProcessorCount = [Environment]::ProcessorCount
        VirtualizationFirmwareEnabled = $virtualizationFirmwareEnabled
        HypervisorPresent = $hypervisorPresent
        MemoryGiB = $memoryGiB
        SystemDriveFreeGiB = $systemDriveFreeGiB
    }
    FeatureStates = [pscustomobject]$featureStates
    Tools = [pscustomobject]$tools
    VirtualBox = $virtualBoxEvidence
    Requirements = @($requirements)
    Ready = @($requirements).Count -gt 0 -and @($requirements | Where-Object { -not $_.Passed }).Count -eq 0
}

if ($AsJson) {
    $result | ConvertTo-Json -Depth 8
}
else {
    $result
}
