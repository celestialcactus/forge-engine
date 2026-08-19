import { randomUUID } from 'node:crypto';
import { link, mkdir, open, realpath, stat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  configurationFileRelativePath,
  type ConfigurationSource,
  type EffectiveConfigurationDiagnostic,
  type EffectiveProductConfiguration,
} from './contracts.js';
import type { LoadedFileConfigurationSources } from './sources.js';

export type ConfigurationFileScope = 'workspace' | 'user';

export interface ProductConfigurationPaths {
  readonly workspace: string;
  readonly user: string;
}

export class ConfigurationCommandError extends Error {
  readonly path: string;
  readonly hint: string;

  constructor(message: string, path: string, hint: string) {
    const safe = (value: string, maximumLength = 512): string => {
      const escaped = value.replace(
        /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
        (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
      );
      return escaped.length <= maximumLength
        ? escaped
        : `${escaped.slice(0, maximumLength - 1)}…`;
    };
    super(safe(message));
    this.name = 'ConfigurationCommandError';
    this.path = safe(path);
    this.hint = safe(hint);
  }
}

export const productConfigurationPaths = (options: {
  readonly workspaceRoot: string;
  readonly homeDirectory?: string;
}): ProductConfigurationPaths => ({
  workspace: resolve(options.workspaceRoot, configurationFileRelativePath),
  user: resolve(options.homeDirectory ?? homedir(), configurationFileRelativePath),
});

const isContainedBy = (root: string, candidate: string): boolean => {
  const fromRoot = relative(root, candidate);
  return fromRoot === '' || (
    !isAbsolute(fromRoot)
    && fromRoot !== '..'
    && !fromRoot.startsWith(`..${sep}`)
  );
};

const fileCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const initTemplate = '{\n  "schemaVersion": 1\n}\n';

/** Create one minimal fixed-path configuration without ever overwriting a file. */
export async function initializeProductConfiguration(options: {
  readonly scope: ConfigurationFileScope;
  readonly workspaceRoot: string;
  readonly homeDirectory?: string;
}): Promise<{ readonly scope: ConfigurationFileScope; readonly path: string }> {
  const paths = productConfigurationPaths(options);
  const displayPath = paths[options.scope];
  let authorityRoot = options.scope === 'workspace'
    ? resolve(options.workspaceRoot)
    : resolve(options.homeDirectory ?? homedir());
  try {
    authorityRoot = await realpath(authorityRoot);
    const authorityStat = await stat(authorityRoot);
    if (!authorityStat.isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ConfigurationCommandError(
      `Forge cannot initialize ${options.scope} configuration because its root is unavailable.`,
      displayPath,
      `Create or repair ${authorityRoot}, then run this command again.`,
    );
  }

  const directory = join(authorityRoot, '.forge');
  try {
    await mkdir(directory, { recursive: true });
  } catch {
    throw new ConfigurationCommandError(
      `Forge cannot create the ${options.scope} configuration directory.`,
      displayPath,
      `Check permissions for ${directory}, then run this command again.`,
    );
  }
  let canonicalDirectory: string;
  try {
    canonicalDirectory = await realpath(directory);
    if (!(await stat(canonicalDirectory)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new ConfigurationCommandError(
      `Forge cannot use the ${options.scope} configuration directory.`,
      displayPath,
      `Replace ${directory} with a regular directory, then run this command again.`,
    );
  }
  if (options.scope === 'workspace' && !isContainedBy(authorityRoot, canonicalDirectory)) {
    throw new ConfigurationCommandError(
      'The workspace configuration directory resolves outside the opened workspace.',
      displayPath,
      `Replace ${directory} with a regular directory inside the workspace.`,
    );
  }

  const targetPath = join(canonicalDirectory, 'config.json');
  const temporaryPath = join(canonicalDirectory, `.config.${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const handle = await open(temporaryPath, 'wx');
    temporaryCreated = true;
    try {
      await handle.writeFile(initTemplate, 'utf8');
      await handle.sync();
      const openedStat = await handle.stat();
      const canonicalTemporaryPath = await realpath(temporaryPath);
      const pathStat = await stat(canonicalTemporaryPath);
      if (!pathStat.isFile() || openedStat.dev !== pathStat.dev || openedStat.ino !== pathStat.ino) {
        throw new Error('configuration temporary file identity changed');
      }
      if (options.scope === 'workspace' && !isContainedBy(authorityRoot, canonicalTemporaryPath)) {
        throw new Error('configuration temporary file escaped workspace');
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
    await link(temporaryPath, targetPath);
    const canonicalTargetPath = await realpath(targetPath);
    if (options.scope === 'workspace' && !isContainedBy(authorityRoot, canonicalTargetPath)) {
      throw new Error('configuration target escaped workspace');
    }
  } catch (error: unknown) {
    if (fileCode(error) === 'EEXIST') {
      throw new ConfigurationCommandError(
        `Forge will not overwrite the existing ${options.scope} configuration.`,
        displayPath,
        `Edit ${displayPath} directly, or move it aside before initializing again.`,
      );
    }
    if (error instanceof ConfigurationCommandError) throw error;
    throw new ConfigurationCommandError(
      `Forge could not initialize ${options.scope} configuration.`,
      displayPath,
      `Check ${canonicalDirectory} and its permissions, then run this command again.`,
    );
  } finally {
    if (temporaryCreated) await unlink(temporaryPath).catch(() => undefined);
  }
  return { scope: options.scope, path: displayPath };
}

const sourceLabel = (source: ConfigurationSource): string => source.replaceAll('_', ' ');

const terminalValue = (value: string, maximumLength = 512): string => {
  const escaped = value.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return escaped.length <= maximumLength
    ? escaped
    : `${escaped.slice(0, maximumLength - 1)}…`;
};

const valueLabel = (diagnostic: EffectiveConfigurationDiagnostic): string => {
  if (diagnostic.redacted) {
    return diagnostic.present ? 'available (value redacted)' : 'not set';
  }
  if (!diagnostic.present) return 'not configured';
  if (diagnostic.field === 'inference.route') {
    return terminalValue(JSON.stringify(`${diagnostic.value?.provider}/${diagnostic.value?.model}`));
  }
  return terminalValue(JSON.stringify(diagnostic.value));
};

/** Human output rendered solely from the same redacted truth used by JSON output. */
export function renderEffectiveConfiguration(
  configuration: EffectiveProductConfiguration,
  options: { readonly includeDigest?: boolean } = {},
): readonly string[] {
  return configuration.diagnostics.map((diagnostic) =>
    `${diagnostic.label}: ${valueLabel(diagnostic)} (from ${diagnostic.sources.map(sourceLabel).join(', ')})`
      + (options.includeDigest === true ? `; digest=${diagnostic.digest}` : ''));
}

export function configurationPathReport(
  paths: ProductConfigurationPaths,
  files?: LoadedFileConfigurationSources,
): {
  readonly workspace: { readonly path: string; readonly status?: 'present' | 'absent' };
  readonly user: { readonly path: string; readonly status?: 'present' | 'absent' };
} {
  return {
    workspace: {
      path: paths.workspace,
      ...(files === undefined ? {} : { status: files.workspace.kind }),
    },
    user: {
      path: paths.user,
      ...(files === undefined ? {} : { status: files.user.kind }),
    },
  };
}
