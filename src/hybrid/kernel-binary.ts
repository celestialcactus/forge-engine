import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ForgeKernelDiscoverySource =
  | 'configured'
  | 'environment'
  | 'packaged'
  | 'source-release'
  | 'source-debug';

export interface ForgeKernelResolution {
  readonly ready: boolean;
  readonly path?: string;
  readonly source?: ForgeKernelDiscoverySource;
  readonly searchedPaths: readonly string[];
  readonly message: string;
}

export interface ForgeKernelResolutionOptions {
  readonly configuredPath?: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly packageRoot?: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
}

const packageRootFromModule = (): string => {
  let current = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(process.cwd());
    current = parent;
  }
};

const usableBinary = (path: string, platform: NodeJS.Platform): string | undefined => {
  try {
    const canonical = realpathSync(path);
    const details = statSync(canonical);
    if (!details.isFile()) return undefined;
    if (platform !== 'win32' && (details.mode & 0o111) === 0) return undefined;
    return canonical;
  } catch {
    return undefined;
  }
};

const nativePackageName = (platform: NodeJS.Platform, architecture: string): string | undefined => {
  const target = `${platform}-${architecture}`;
  return new Set([
    'win32-x64',
    'win32-arm64',
    'darwin-x64',
    'darwin-arm64',
    'linux-x64',
    'linux-arm64',
  ]).has(target)
    ? `forge-engine-kernel-${target}`
    : undefined;
};

const manifestObject = (path: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
};

const optionalNativePackage = (
  root: string,
  platform: NodeJS.Platform,
  architecture: string,
  executable: string,
): { readonly path?: string; readonly error?: string; readonly packageName?: string } => {
  const packageName = nativePackageName(platform, architecture);
  if (packageName === undefined) return {};
  let nativeManifestPath: string;
  try {
    nativeManifestPath = createRequire(join(root, 'package.json')).resolve(`${packageName}/package.json`);
  } catch {
    return { packageName };
  }
  const nativeBinaryPath = join(dirname(nativeManifestPath), 'bin', executable);
  if (!existsSync(nativeBinaryPath)) return { packageName };
  const rootManifest = manifestObject(join(root, 'package.json'));
  const nativeManifest = manifestObject(nativeManifestPath);
  if (typeof rootManifest?.version !== 'string'
    || nativeManifest?.name !== packageName
    || nativeManifest.version !== rootManifest.version
    || !Array.isArray(nativeManifest.os)
    || !nativeManifest.os.includes(platform)
    || !Array.isArray(nativeManifest.cpu)
    || !nativeManifest.cpu.includes(architecture)) {
    return {
      packageName,
      error: `Installed native package ${packageName} does not match ForgeEngine ${String(rootManifest?.version ?? 'unknown')} for ${platform}-${architecture}.`,
    };
  }
  return { packageName, path: nativeBinaryPath };
};

const explicitResolution = (
  path: string,
  source: 'configured' | 'environment',
  platform: NodeJS.Platform,
): ForgeKernelResolution => {
  const candidate = resolve(path);
  const usable = usableBinary(candidate, platform);
  return usable === undefined
    ? {
        ready: false,
        searchedPaths: [candidate],
        message: `The ${source} Forge kernel path is not an executable file: ${candidate}`,
      }
    : {
        ready: true,
        path: usable,
        source,
        searchedPaths: [candidate],
        message: `Forge Rust kernel selected from ${source} configuration.`,
      };
};

export const resolveForgeKernelBinary = (
  options: ForgeKernelResolutionOptions = {},
): ForgeKernelResolution => {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const configured = options.configuredPath?.trim();
  if (configured !== undefined && configured.length > 0) {
    return explicitResolution(configured, 'configured', platform);
  }

  const environment = options.environment ?? process.env;
  const environmentPath = environment.FORGE_KERNEL_BINARY?.trim();
  if (environmentPath !== undefined && environmentPath.length > 0) {
    return explicitResolution(environmentPath, 'environment', platform);
  }

  const root = resolve(options.packageRoot ?? packageRootFromModule());
  const executable = platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel';
  const nativePackage = optionalNativePackage(root, platform, architecture, executable);
  if (nativePackage.error !== undefined) {
    return {
      ready: false,
      searchedPaths: [],
      message: nativePackage.error,
    };
  }
  const packagedCandidates: ReadonlyArray<readonly [ForgeKernelDiscoverySource, string]> = [
    ...(nativePackage.path === undefined
      ? []
      : [['packaged' as const, nativePackage.path] as const]),
    ['packaged', join(root, 'bin', `${platform}-${architecture}`, executable)],
    ['packaged', join(root, 'bin', executable)],
  ];
  const sourceCandidates: ReadonlyArray<readonly [ForgeKernelDiscoverySource, string]> = [
    ['source-release', join(root, 'target', 'release', executable)],
    ['source-debug', join(root, 'target', 'debug', executable)],
  ];
  const candidates = [...packagedCandidates, ...sourceCandidates];
  const searchedPaths = candidates.map(([, path]) => path);
  for (const [source, candidate] of packagedCandidates) {
    const usable = usableBinary(candidate, platform);
    if (usable !== undefined) {
      return {
        ready: true,
        path: usable,
        source,
        searchedPaths,
        message: `Forge Rust kernel selected from ${source}.`,
      };
    }
  }
  const newestSource = sourceCandidates
    .flatMap(([source, candidate]) => {
      const usable = usableBinary(candidate, platform);
      return usable === undefined
        ? []
        : [{ source, path: usable, modified: statSync(usable).mtimeMs }];
    })
    .sort((left, right) => right.modified - left.modified)[0];
  if (newestSource !== undefined) {
    return {
      ready: true,
      path: newestSource.path,
      source: newestSource.source,
      searchedPaths,
      message: `Forge Rust kernel selected from newest ${newestSource.source} build.`,
    };
  }
  return {
    ready: false,
    searchedPaths,
    message: nativePackage.packageName === undefined
      ? `Forge Rust kernel is unavailable for unsupported host ${platform}-${architecture}.`
      : `Forge Rust kernel is unavailable. Install ${nativePackage.packageName}, build it with \`npm run rust:build\`, or set FORGE_KERNEL_BINARY to an exact kernel path.`,
  };
};

export const forgeKernelProbeProtocolVersion = 'forge.kernel.probe.v4';

export interface ForgeIsolationProviderProbe {
  readonly providerId: string;
  readonly providerClass: 'trusted_baseline' | 'external_attested' | 'native_fallback' | 'native_strong';
  readonly availability: 'available' | 'setup_required' | 'unsupported';
  readonly supportedProfiles: readonly string[];
  readonly restrictedControls: readonly string[];
  readonly restrictedReady: boolean;
  readonly limitations: readonly string[];
}

export interface ForgeKernelProbe {
  readonly ready: boolean;
  readonly kernelVersion?: string;
  readonly runProtocolVersion?: string;
  readonly runStoreProtocolVersion?: string;
  readonly transactionProtocolVersion?: string;
  readonly candidateProtocolVersion?: string;
  readonly sovereignChangeProtocolVersion?: string;
  readonly isolationProvider?: ForgeIsolationProviderProbe;
  readonly isolationCandidates?: readonly ForgeIsolationProviderProbe[];
  readonly message: string;
}

const probeObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
const isolationProfiles = new Set(['trusted', 'host_managed', 'restricted']);
const isolationControls = new Set(['filesystem', 'process', 'network', 'credentials', 'resources']);
const isolationProviderClasses = new Set(['trusted_baseline', 'external_attested', 'native_fallback', 'native_strong']);
const isolationProviderAvailability = new Set(['available', 'setup_required', 'unsupported']);

const parseIsolationProviderProbe = (value: unknown): ForgeIsolationProviderProbe => {
  const provider = probeObject(value);
  if (provider === undefined
    || typeof provider.providerId !== 'string'
    || provider.providerId.trim().length === 0
    || provider.providerId.length > 256
    || typeof provider.providerClass !== 'string'
    || !isolationProviderClasses.has(provider.providerClass)
    || typeof provider.availability !== 'string'
    || !isolationProviderAvailability.has(provider.availability)
    || !Array.isArray(provider.supportedProfiles)
    || provider.supportedProfiles.some((profile) => typeof profile !== 'string')
    || provider.supportedProfiles.length === 0
    || provider.supportedProfiles.length > isolationProfiles.size
    || new Set(provider.supportedProfiles).size !== provider.supportedProfiles.length
    || provider.supportedProfiles.some((profile) => !isolationProfiles.has(profile as string))
    || !Array.isArray(provider.restrictedControls)
    || provider.restrictedControls.some((control) => typeof control !== 'string')
    || provider.restrictedControls.length > isolationControls.size
    || new Set(provider.restrictedControls).size !== provider.restrictedControls.length
    || provider.restrictedControls.some((control) => !isolationControls.has(control as string))
    || typeof provider.restrictedReady !== 'boolean'
    || !Array.isArray(provider.limitations)
    || provider.limitations.length === 0
    || provider.limitations.length > 16
    || provider.limitations.some((item) => typeof item !== 'string'
      || item.trim().length === 0 || item.length > 1_024)) {
    throw new Error('result frame contains invalid isolation-provider readiness');
  }
  const supportedProfiles = provider.supportedProfiles as string[];
  const restrictedControls = provider.restrictedControls as string[];
  const expectedRestrictedReady = supportedProfiles.includes('restricted')
    && provider.providerClass === 'native_strong'
    && provider.availability === 'available'
    && [...isolationControls].every((control) => restrictedControls.includes(control));
  if (provider.restrictedReady !== expectedRestrictedReady) {
    throw new Error('result frame contains inconsistent isolation-provider readiness');
  }
  return {
    providerId: provider.providerId,
    providerClass: provider.providerClass as ForgeIsolationProviderProbe['providerClass'],
    availability: provider.availability as ForgeIsolationProviderProbe['availability'],
    supportedProfiles,
    restrictedControls,
    restrictedReady: provider.restrictedReady,
    limitations: provider.limitations as string[],
  };
};

export const probeForgeKernelBinary = async (
  resolution: ForgeKernelResolution,
  timeoutMs = 5_000,
): Promise<ForgeKernelProbe> => {
  if (!resolution.ready || resolution.path === undefined) {
    return { ready: false, message: resolution.message };
  }
  return new Promise<ForgeKernelProbe>((resolveProbe) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(resolution.path as string, [], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (result: ForgeKernelProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ ready: false, message: `Forge kernel probe exceeded ${timeoutMs} ms.` });
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stdout.length < 65_536) stdout += chunk.slice(0, 65_536 - stdout.length);
    });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length < 65_536) stderr += chunk.slice(0, 65_536 - stderr.length);
    });
    child.once('error', (error) => {
      finish({ ready: false, message: `Forge kernel probe could not start: ${error.message}` });
    });
    child.once('exit', (code) => {
      if (settled) return;
      if (code !== 0) {
        const detail = stderr.trim();
        finish({
          ready: false,
          message: `Forge kernel probe exited with code ${String(code)}${detail.length === 0 ? '.' : `: ${detail}`}`,
        });
        return;
      }
      try {
        const lines = stdout.trim().split(/\r?\n/u);
        if (lines.length !== 1 || lines[0] === undefined) throw new Error('expected one result frame');
        const frame = probeObject(JSON.parse(lines[0]) as unknown);
        if (frame?.type !== 'probe.result'
          || frame.protocolVersion !== forgeKernelProbeProtocolVersion
          || typeof frame.kernelVersion !== 'string'
          || typeof frame.runProtocolVersion !== 'string'
          || typeof frame.runStoreProtocolVersion !== 'string'
          || typeof frame.transactionProtocolVersion !== 'string'
          || typeof frame.candidateProtocolVersion !== 'string'
          || typeof frame.sovereignChangeProtocolVersion !== 'string'
          || probeObject(frame.isolationProvider) === undefined
          || !Array.isArray(frame.isolationCandidates)
          || frame.isolationCandidates.length > 8
        ) {
          throw new Error('result frame does not match the Forge kernel probe contract');
        }
        const isolationProvider = parseIsolationProviderProbe(frame.isolationProvider);
        const isolationCandidates = frame.isolationCandidates.map(parseIsolationProviderProbe);
        const providerIds = [
          isolationProvider.providerId,
          ...isolationCandidates.map((candidate) => candidate.providerId),
        ];
        if (new Set(providerIds).size !== providerIds.length) {
          throw new Error('result frame contains duplicate isolation-provider identities');
        }
        finish({
          ready: true,
          kernelVersion: frame.kernelVersion,
          runProtocolVersion: frame.runProtocolVersion,
          runStoreProtocolVersion: frame.runStoreProtocolVersion,
          transactionProtocolVersion: frame.transactionProtocolVersion,
          candidateProtocolVersion: frame.candidateProtocolVersion,
          sovereignChangeProtocolVersion: frame.sovereignChangeProtocolVersion,
          isolationProvider,
          isolationCandidates,
          message: `Forge kernel ${frame.kernelVersion} passed its protocol probe.`,
        });
      } catch (error) {
        finish({
          ready: false,
          message: `Forge kernel probe returned invalid output: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    });
    child.stdin.on('error', () => {
      // Launch/exit handlers provide the actionable failure.
    });
    child.stdin.end(JSON.stringify({
      type: 'probe.start',
      protocolVersion: forgeKernelProbeProtocolVersion,
    }) + '\n');
  });
};

export const requireForgeKernelBinary = (resolution: ForgeKernelResolution): string => {
  if (resolution.ready && resolution.path !== undefined) return resolution.path;
  throw new Error(resolution.message);
};
