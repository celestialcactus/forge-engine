import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import ts from 'typescript';
import type { Capability, CapabilityCall, CapabilityResult } from '../slice0/contracts.js';
import { canonicalSnapshotFilePath, selectSnapshotFile } from './workspace-path.js';

const supportedCodeExtensions = new Set(['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);

const objectInput = (call: CapabilityCall): Readonly<Record<string, unknown>> => {
  if (call.input === undefined || call.input === null) return {};
  if (typeof call.input !== 'object' || Array.isArray(call.input)) throw new Error(`${call.capabilityId} input must be an object.`);
  return call.input as Readonly<Record<string, unknown>>;
};

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number, name: string): number => {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || Number(selected) < minimum || Number(selected) > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
  }
  return Number(selected);
};

export function createWorkspaceReadCapability(workspaceRoot: string): Capability {
  return {
    id: 'workspace.read',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      signal.throwIfAborted();
      const input = objectInput(call);
      const file = selectSnapshotFile(input.path, snapshot);
      if (file.bytes > 1_048_576) throw new Error('Slice 1 refuses to read files larger than 1 MiB.');
      const startLine = boundedInteger(input.startLine, 1, 1, 1_000_000, 'startLine');
      const maxLines = boundedInteger(input.maxLines, 200, 1, 1_000, 'maxLines');
      const absolute = await canonicalSnapshotFilePath(workspaceRoot, file);
      const bytes = await readFile(absolute);
      if (bytes.includes(0) || !isUtf8(bytes)) {
        throw new Error('Slice 1 returns only valid UTF-8 text evidence.');
      }
      const lines = bytes.toString('utf8').split(/\r?\n/u);
      const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
      const lineEvidence = selected.map((text, index) => ({ line: startLine + index, text }));
      return {
        callId: call.id,
        success: true,
        content: JSON.stringify({
          snapshotId: snapshot.id,
          path: file.path,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          startLine,
          endLine: selected.length === 0 ? startLine - 1 : startLine + selected.length - 1,
          totalLines: lines.length,
          text: selected.join('\n'),
          lines: lineEvidence,
          truncated: startLine - 1 + selected.length < lines.length,
        }),
      };
    },
  };
}

type SymbolEvidence = {
  readonly name: string;
  readonly kind: string;
  readonly path: string;
  readonly line: number;
  readonly column: number;
};

const symbolKind = (node: ts.Node): string | undefined => {
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return 'property';
  if (ts.isVariableDeclaration(node)) return 'variable';
  return undefined;
};

const symbolName = (node: ts.Node): string | undefined => {
  if (!('name' in node)) return undefined;
  const name = (node as ts.NamedDeclaration).name;
  if (name === undefined) return undefined;
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : name.getText();
};

export function createWorkspaceSymbolsCapability(workspaceRoot: string): Capability {
  return {
    id: 'workspace.symbols',
    async invoke(call, snapshot, signal): Promise<CapabilityResult> {
      const input = objectInput(call);
      const maxFiles = boundedInteger(input.maxFiles, 200, 1, 1_000, 'maxFiles');
      const maxSymbols = boundedInteger(input.maxSymbols, 500, 1, 2_000, 'maxSymbols');
      if (input.query !== undefined && typeof input.query !== 'string') throw new Error('query must be a string when supplied.');
      const query = typeof input.query === 'string' ? input.query.toLocaleLowerCase('en-US') : '';
      const candidates = snapshot.files.filter((file) => supportedCodeExtensions.has(extname(file.path).toLocaleLowerCase('en-US')));
      const symbols: SymbolEvidence[] = [];
      let filesScanned = 0;

      for (const file of candidates.slice(0, maxFiles)) {
        signal.throwIfAborted();
        if (file.bytes > 1_048_576) continue;
        const absolute = await canonicalSnapshotFilePath(workspaceRoot, file);
        const bytes = await readFile(absolute);
        if (bytes.includes(0) || !isUtf8(bytes)) continue;
        const source = bytes.toString('utf8');
        const scriptKind = file.path.endsWith('.tsx') ? ts.ScriptKind.TSX : file.path.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS;
        const sourceFile = ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest, true, scriptKind);
        filesScanned++;
        const visit = (node: ts.Node): void => {
          if (symbols.length >= maxSymbols) return;
          const kind = symbolKind(node);
          const name = symbolName(node);
          if (kind !== undefined && name !== undefined && (query.length === 0 || name.toLocaleLowerCase('en-US').includes(query))) {
            const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
            symbols.push({ name, kind, path: file.path, line: location.line + 1, column: location.character + 1 });
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
        if (symbols.length >= maxSymbols) break;
      }

      return {
        callId: call.id,
        success: true,
        content: JSON.stringify({
          snapshotId: snapshot.id,
          query: input.query ?? null,
          filesScanned,
          candidateFiles: candidates.length,
          symbols,
          truncated: symbols.length >= maxSymbols || candidates.length > maxFiles,
        }),
      };
    },
  };
}
