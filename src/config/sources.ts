import { open, lstat, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  configurationFileRelativePath,
  maximumConfigurationFileBytes,
  type ConfigurationIssue,
} from './contracts.js';
import {
  ConfigurationIssueError,
  parseConfigurationDocument,
  type FileConfigurationSource,
  type ParsedConfigurationDocument,
} from './schema.js';

export type LoadedConfigurationSource<Source extends FileConfigurationSource> =
  | {
      readonly kind: 'absent';
      readonly source: Source;
      readonly path: string;
    }
  | {
      readonly kind: 'present';
      readonly source: Source;
      readonly path: string;
      readonly canonicalPath: string;
      readonly document: ParsedConfigurationDocument<Source>;
    };

export interface LoadedFileConfigurationSources {
  readonly workspace: LoadedConfigurationSource<'workspace'>;
  readonly user: LoadedConfigurationSource<'user'>;
}

const filesystemErrorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

const makeIssue = (
  source: FileConfigurationSource,
  code: ConfigurationIssue['code'],
  location: string,
  message: string,
  hint: string,
): ConfigurationIssueError => new ConfigurationIssueError({
  code,
  source,
  location,
  message,
  hint,
});

const notRegular = (source: FileConfigurationSource, path: string): ConfigurationIssueError =>
  makeIssue(
    source,
    'config_file_not_regular',
    path,
    `Forge expected a regular configuration file at ${path}.`,
    'Replace that directory or special file with a regular JSON file.',
  );

const unreadable = (source: FileConfigurationSource, path: string): ConfigurationIssueError =>
  makeIssue(
    source,
    'config_file_unreadable',
    path,
    `Forge cannot read ${path}.`,
    'Check the file permissions, then run the command again.',
  );

const tooLarge = (source: FileConfigurationSource, path: string): ConfigurationIssueError =>
  makeIssue(
    source,
    'config_file_too_large',
    path,
    `Forge configuration must be ${maximumConfigurationFileBytes} bytes or smaller.`,
    `Remove unrelated content from ${path}.`,
  );

const malformedJson = (source: FileConfigurationSource, path: string): ConfigurationIssueError =>
  makeIssue(
    source,
    'config_json_invalid',
    path,
    'Forge could not read this configuration because it is not valid JSON.',
    `Fix the JSON syntax in ${path} and run the command again.`,
  );

const isContainedBy = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (
    !isAbsolute(pathFromRoot)
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
  );
};

const readBoundedFile = async (
  source: FileConfigurationSource,
  displayPath: string,
  canonicalPath: string,
): Promise<Buffer> => {
  let handle;
  try {
    handle = await open(canonicalPath, 'r');
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw notRegular(source, displayPath);
    if (openedStat.size > maximumConfigurationFileBytes) throw tooLarge(source, displayPath);

    const buffer = Buffer.allocUnsafe(maximumConfigurationFileBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumConfigurationFileBytes) throw tooLarge(source, displayPath);
    return buffer.subarray(0, offset);
  } catch (error: unknown) {
    if (error instanceof ConfigurationIssueError) throw error;
    throw unreadable(source, displayPath);
  } finally {
    await handle?.close().catch(() => undefined);
  }
};

interface LocatedConfigurationFile {
  readonly displayPath: string;
  readonly canonicalPath: string;
}

const locateFile = async <Source extends FileConfigurationSource>(
  source: Source,
  displayPath: string,
  workspaceRoot?: string,
): Promise<LocatedConfigurationFile | undefined> => {
  let entry;
  try {
    entry = await lstat(displayPath);
  } catch (error: unknown) {
    if (filesystemErrorCode(error) === 'ENOENT') return undefined;
    throw unreadable(source, displayPath);
  }

  if (!entry.isFile() && !entry.isSymbolicLink()) throw notRegular(source, displayPath);

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(displayPath);
  } catch {
    throw unreadable(source, displayPath);
  }

  if (workspaceRoot !== undefined && !isContainedBy(workspaceRoot, canonicalPath)) {
    throw makeIssue(
      source,
      'config_file_outside_workspace',
      displayPath,
      'The workspace configuration resolves outside the opened workspace.',
      `Replace it with a regular file inside ${join(workspaceRoot, '.forge')}${sep}.`,
    );
  }

  try {
    const canonicalStat = await stat(canonicalPath);
    if (!canonicalStat.isFile()) throw notRegular(source, displayPath);
  } catch (error: unknown) {
    if (error instanceof ConfigurationIssueError) throw error;
    throw unreadable(source, displayPath);
  }
  return { displayPath, canonicalPath };
};

const loadLocatedFile = async <Source extends FileConfigurationSource>(
  source: Source,
  displayPath: string,
  workspaceRoot?: string,
): Promise<LoadedConfigurationSource<Source>> => {
  const located = await locateFile(source, displayPath, workspaceRoot);
  if (located === undefined) return { kind: 'absent', source, path: displayPath };
  const bytes = await readBoundedFile(source, displayPath, located.canonicalPath);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw malformedJson(source, displayPath);
  }
  return {
    kind: 'present',
    source,
    path: displayPath,
    canonicalPath: located.canonicalPath,
    document: parseConfigurationDocument(source, value, displayPath),
  };
};

export async function loadWorkspaceConfiguration(
  workspaceRoot: string,
): Promise<LoadedConfigurationSource<'workspace'>> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await realpath(resolve(workspaceRoot));
    const rootStat = await stat(canonicalRoot);
    if (!rootStat.isDirectory()) throw new Error('not a directory');
  } catch {
    const path = resolve(workspaceRoot, configurationFileRelativePath);
    throw unreadable('workspace', path);
  }
  const path = resolve(canonicalRoot, configurationFileRelativePath);
  return loadLocatedFile('workspace', path, canonicalRoot);
}

export async function loadUserConfiguration(
  homeDirectory: string = homedir(),
): Promise<LoadedConfigurationSource<'user'>> {
  const path = resolve(homeDirectory, configurationFileRelativePath);
  return loadLocatedFile('user', path);
}

export async function loadFileConfigurationSources(options: {
  readonly workspaceRoot: string;
  readonly homeDirectory?: string;
}): Promise<LoadedFileConfigurationSources> {
  // Keep validation order stable so two invalid present files cannot race to decide
  // which actionable error the user sees first.
  const workspace = await loadWorkspaceConfiguration(options.workspaceRoot);
  const user = options.homeDirectory === undefined
    ? await loadUserConfiguration()
    : await loadUserConfiguration(options.homeDirectory);
  return { workspace, user };
}
