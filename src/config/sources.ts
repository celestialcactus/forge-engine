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

const boundedIssueText = (value: string, maximumLength = 512): string => {
  const escaped = value.replace(
    /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
  return escaped.length <= maximumLength
    ? escaped
    : `${escaped.slice(0, maximumLength - 1)}…`;
};

const makeIssue = (
  source: FileConfigurationSource,
  code: ConfigurationIssue['code'],
  location: string,
  message: string,
  hint: string,
): ConfigurationIssueError => new ConfigurationIssueError({
  code,
  source,
  location: boundedIssueText(location),
  message: boundedIssueText(message),
  hint: boundedIssueText(hint),
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

const invalidEncoding = (source: FileConfigurationSource, path: string): ConfigurationIssueError =>
  makeIssue(
    source,
    'config_json_invalid',
    path,
    'Forge configuration must be valid UTF-8 JSON.',
    `Save ${path} as UTF-8, then run the command again.`,
  );

const duplicateJsonKey = (source: FileConfigurationSource, path: string): ConfigurationIssueError =>
  makeIssue(
    source,
    'config_json_invalid',
    path,
    'Forge configuration cannot contain duplicate object keys.',
    `Keep each setting exactly once in ${path}, then run the command again.`,
  );

const isContainedBy = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === '' || (
    !isAbsolute(pathFromRoot)
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
  );
};

const outsideWorkspace = (
  source: FileConfigurationSource,
  displayPath: string,
  workspaceRoot: string,
): ConfigurationIssueError => makeIssue(
  source,
  'config_file_outside_workspace',
  displayPath,
  'The workspace configuration resolves outside the opened workspace.',
  `Replace it with a regular file inside ${join(workspaceRoot, '.forge')}${sep}.`,
);

const sameFileIdentity = (
  left: Awaited<ReturnType<Awaited<ReturnType<typeof open>>['stat']>>,
  right: Awaited<ReturnType<typeof stat>>,
): boolean => left.dev === right.dev && left.ino === right.ino;

const readBoundedFile = async (
  source: FileConfigurationSource,
  displayPath: string,
  canonicalPath: string,
  workspaceRoot?: string,
): Promise<Buffer> => {
  let handle;
  try {
    handle = await open(canonicalPath, 'r');
    const openedStat = await handle.stat();
    if (!openedStat.isFile()) throw notRegular(source, displayPath);
    if (openedStat.size > maximumConfigurationFileBytes) throw tooLarge(source, displayPath);

    // Revalidate the exact opened object after opening. This closes the useful
    // path-swap window between the initial canonical containment check and read.
    const postOpenCanonicalPath = await realpath(canonicalPath);
    if (workspaceRoot !== undefined && !isContainedBy(workspaceRoot, postOpenCanonicalPath)) {
      throw outsideWorkspace(source, displayPath, workspaceRoot);
    }
    const postOpenStat = await stat(postOpenCanonicalPath);
    if (!postOpenStat.isFile() || !sameFileIdentity(openedStat, postOpenStat)) {
      throw unreadable(source, displayPath);
    }

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
    throw outsideWorkspace(source, displayPath, workspaceRoot);
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

const assertNoDuplicateJsonKeys = (
  source: FileConfigurationSource,
  path: string,
  text: string,
): void => {
  let offset = 0;
  const skipWhitespace = (): void => {
    while (/\s/u.test(text[offset] ?? '')) offset += 1;
  };
  const readString = (): string => {
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      if (text[offset] === '\\') {
        offset += 2;
      } else if (text[offset] === '"') {
        offset += 1;
        return JSON.parse(text.slice(start, offset)) as string;
      } else {
        offset += 1;
      }
    }
    return '';
  };
  const readValue = (): void => {
    skipWhitespace();
    if (text[offset] === '{') {
      offset += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (text[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        skipWhitespace();
        const key = readString();
        if (keys.has(key)) throw duplicateJsonKey(source, path);
        keys.add(key);
        skipWhitespace();
        offset += 1; // colon; syntax was already accepted by JSON.parse.
        readValue();
        skipWhitespace();
        if (text[offset] === '}') {
          offset += 1;
          return;
        }
        offset += 1; // comma.
      }
      return;
    }
    if (text[offset] === '[') {
      offset += 1;
      skipWhitespace();
      if (text[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        readValue();
        skipWhitespace();
        if (text[offset] === ']') {
          offset += 1;
          return;
        }
        offset += 1; // comma.
      }
      return;
    }
    if (text[offset] === '"') {
      readString();
      return;
    }
    while (offset < text.length && !/[\s,}\]]/u.test(text[offset] ?? '')) offset += 1;
  };
  readValue();
};

const loadLocatedFile = async <Source extends FileConfigurationSource>(
  source: Source,
  displayPath: string,
  workspaceRoot?: string,
): Promise<LoadedConfigurationSource<Source>> => {
  const located = await locateFile(source, displayPath, workspaceRoot);
  if (located === undefined) return { kind: 'absent', source, path: displayPath };
  const bytes = await readBoundedFile(source, displayPath, located.canonicalPath, workspaceRoot);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
  } catch {
    throw invalidEncoding(source, displayPath);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw malformedJson(source, displayPath);
  }
  assertNoDuplicateJsonKeys(source, displayPath, text);
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
