import { spawn } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
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
  const candidates: ReadonlyArray<readonly [ForgeKernelDiscoverySource, string]> = [
    ['packaged', join(root, 'bin', `${platform}-${architecture}`, executable)],
    ['packaged', join(root, 'bin', executable)],
    ['source-release', join(root, 'target', 'release', executable)],
    ['source-debug', join(root, 'target', 'debug', executable)],
  ];
  const searchedPaths = candidates.map(([, path]) => path);
  for (const [source, candidate] of candidates) {
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
  return {
    ready: false,
    searchedPaths,
    message: 'Forge Rust kernel is unavailable. Build it with `npm run rust:build` or set FORGE_KERNEL_BINARY to an exact kernel path.',
  };
};

export const forgeKernelProbeProtocolVersion = 'forge.kernel.probe.v2';

export interface ForgeKernelProbe {
  readonly ready: boolean;
  readonly kernelVersion?: string;
  readonly runProtocolVersion?: string;
  readonly runStoreProtocolVersion?: string;
  readonly transactionProtocolVersion?: string;
  readonly candidateProtocolVersion?: string;
  readonly sovereignChangeProtocolVersion?: string;
  readonly isolationProvider?: {
    readonly providerId: string;
    readonly supportedProfiles: readonly string[];
    readonly restrictedControls: readonly string[];
    readonly restrictedReady: boolean;
  };
  readonly message: string;
}

const probeObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
const isolationProfiles = new Set(['trusted', 'host_managed', 'restricted']);
const isolationControls = new Set(['filesystem', 'process', 'network', 'credentials', 'resources']);

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
        ) {
          throw new Error('result frame does not match the Forge kernel probe contract');
        }
        const isolationProvider = probeObject(frame.isolationProvider) as Record<string, unknown>;
        if (typeof isolationProvider.providerId !== 'string'
          || isolationProvider.providerId.trim().length === 0
          || !Array.isArray(isolationProvider.supportedProfiles)
          || isolationProvider.supportedProfiles.some((profile) => typeof profile !== 'string')
          || isolationProvider.supportedProfiles.length === 0
          || isolationProvider.supportedProfiles.length > isolationProfiles.size
          || new Set(isolationProvider.supportedProfiles).size !== isolationProvider.supportedProfiles.length
          || isolationProvider.supportedProfiles.some((profile) => !isolationProfiles.has(profile as string))
          || !Array.isArray(isolationProvider.restrictedControls)
          || isolationProvider.restrictedControls.some((control) => typeof control !== 'string')
          || isolationProvider.restrictedControls.length > isolationControls.size
          || new Set(isolationProvider.restrictedControls).size !== isolationProvider.restrictedControls.length
          || isolationProvider.restrictedControls.some((control) => !isolationControls.has(control as string))
          || typeof isolationProvider.restrictedReady !== 'boolean') {
          throw new Error('result frame contains invalid isolation-provider readiness');
        }
        const supportedProfiles = isolationProvider.supportedProfiles as string[];
        const restrictedControls = isolationProvider.restrictedControls as string[];
        const expectedRestrictedReady = supportedProfiles.includes('restricted')
          && [...isolationControls].every((control) => restrictedControls.includes(control));
        if (isolationProvider.restrictedReady !== expectedRestrictedReady) {
          throw new Error('result frame contains inconsistent isolation-provider readiness');
        }
        finish({
          ready: true,
          kernelVersion: frame.kernelVersion,
          runProtocolVersion: frame.runProtocolVersion,
          runStoreProtocolVersion: frame.runStoreProtocolVersion,
          transactionProtocolVersion: frame.transactionProtocolVersion,
          candidateProtocolVersion: frame.candidateProtocolVersion,
          sovereignChangeProtocolVersion: frame.sovereignChangeProtocolVersion,
          isolationProvider: {
            providerId: isolationProvider.providerId,
            supportedProfiles,
            restrictedControls,
            restrictedReady: isolationProvider.restrictedReady,
          },
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
