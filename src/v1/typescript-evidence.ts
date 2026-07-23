import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { Capability, CapabilityCall, CapabilityResult, WorkspaceSnapshot } from '../slice0/contracts.js';

const portablePath = (path: string): string => path.replaceAll('\\', '/');

const objectInput = (call: CapabilityCall): Readonly<Record<string, unknown>> => {
  if (call.input === undefined || call.input === null) return {};
  if (typeof call.input !== 'object' || Array.isArray(call.input)) throw new Error(`${call.capabilityId} input must be an object.`);
  return call.input as Readonly<Record<string, unknown>>;
};

const withinRoot = (root: string, target: string): boolean => {
  const fromRoot = relative(root, target);
  return fromRoot !== '..' && !fromRoot.startsWith(`..\\`) && !fromRoot.startsWith('../') && !isAbsolute(fromRoot);
};

const selectConfigPath = (input: Readonly<Record<string, unknown>>, snapshot: WorkspaceSnapshot): string => {
  const requested = input.configPath ?? (snapshot.files.some((file) => file.path === 'tsconfig.json') ? 'tsconfig.json' : 'tsconfig.v1.json');
  if (typeof requested !== 'string' || requested.length === 0 || requested.length > 1_000) {
    throw new Error('configPath must be a non-empty workspace-relative string.');
  }
  const portable = portablePath(requested);
  if (isAbsolute(requested) || /^[A-Za-z]:/u.test(portable)) throw new Error('configPath must be workspace-relative.');
  const normalized = posix.normalize(portable).replace(/^\.\//u, '');
  if (normalized === '..' || normalized.startsWith('../')) throw new Error('configPath traversal is not allowed.');
  if (!snapshot.files.some((file) => file.path === normalized)) throw new Error(`Config is not present in the workspace snapshot: ${normalized}`);
  return normalized;
};

const categoryName = (category: ts.DiagnosticCategory): string => ts.DiagnosticCategory[category]?.toLocaleLowerCase('en-US') ?? 'unknown';

export function createTypeScriptDiagnosticsCapability(workspaceRoot: string): Capability {
  return {
    id: 'typescript.diagnostics',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      signal.throwIfAborted();
      const input = objectInput(call);
      const rawMaximum = input.maxDiagnostics ?? 200;
      if (!Number.isInteger(rawMaximum) || Number(rawMaximum) < 1 || Number(rawMaximum) > 1_000) {
        throw new Error('maxDiagnostics must be an integer from 1 to 1000.');
      }
      const maxDiagnostics = Number(rawMaximum);
      const root = await realpath(resolve(workspaceRoot));
      const configPath = selectConfigPath(input, snapshot);
      const absoluteConfig = await realpath(resolve(root, configPath));
      if (!withinRoot(root, absoluteConfig)) throw new Error('Resolved TypeScript config escapes the workspace boundary.');

      const loaded = ts.readConfigFile(absoluteConfig, ts.sys.readFile);
      if (loaded.error !== undefined) {
        const message = ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n');
        throw new Error(`Unable to read ${configPath}: ${message}`);
      }
      const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(absoluteConfig), { noEmit: true }, absoluteConfig);
      const rootNames = parsed.fileNames.filter((file) => withinRoot(root, resolve(file)));
      const excludedExternalRoots = parsed.fileNames.length - rootNames.length;
      const program = ts.createProgram({
        rootNames,
        options: { ...parsed.options, noEmit: true },
        ...(parsed.projectReferences === undefined ? {} : { projectReferences: parsed.projectReferences }),
      });
      signal.throwIfAborted();
      const allDiagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
      const diagnostics = allDiagnostics.slice(0, maxDiagnostics).map((diagnostic) => {
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
        if (diagnostic.file === undefined || diagnostic.start === undefined) {
          return { code: diagnostic.code, category: categoryName(diagnostic.category), message };
        }
        const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
        const absoluteFile = resolve(diagnostic.file.fileName);
        return {
          code: diagnostic.code,
          category: categoryName(diagnostic.category),
          message,
          path: withinRoot(root, absoluteFile) ? portablePath(relative(root, absoluteFile)) : '<external>',
          line: location.line + 1,
          column: location.character + 1,
        };
      });

      return {
        callId: call.id,
        success: true,
        content: JSON.stringify({
          snapshotId: snapshot.id,
          configPath,
          projectFiles: rootNames.length,
          excludedExternalRoots,
          diagnosticCount: allDiagnostics.length,
          diagnostics,
          truncated: allDiagnostics.length > maxDiagnostics,
          emitted: false,
        }),
      };
    },
  };
}
