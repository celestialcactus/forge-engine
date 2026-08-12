@{
    SchemaVersion = 1
    Backend = 'virtualbox'

    # The template is installed and patched manually from a licensed Windows image.
    # Per-run VMs are linked clones of this immutable snapshot.
    TemplateVm = 'forge-win11-template'
    TemplateSnapshot = 'toolchain-clean'
    RunVmPrefix = 'forge-eval'
    LabRoot = 'C:\ForgeLab\VirtualBox'

    CpuCount = 4
    MemoryMiB = 8192
    StartType = 'gui'

    # This adapter must already exist. The scripts never create or reconfigure a
    # host-only network. Evaluation VMs have no NAT/bridged adapter.
    HostOnlyAdapter = 'VirtualBox Host-Only Ethernet Adapter'
    CanaryUri = 'http://192.168.56.1:47831/forge-network-canary'

    GuestUsername = 'forge-lab'
    GuestInputRoot = '\\VBOXSVR\forge-input'
    GuestOutputRoot = 'C:\ForgeLab\Artifacts'
    GuestRunRoot = 'C:\ForgeLab\Runs'
    GuestNpmCache = 'C:\ForgeLab\Caches\npm'

    RequiredToolVersions = @{
        Node = '22.19.0'
        Npm = '10.9.3'
        Git = '2.51.0.windows.1'
        Rust = '1.97.1'
        Srt = '0.0.71'
    }
}
