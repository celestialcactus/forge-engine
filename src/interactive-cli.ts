import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';
import type { OutcomeStatus, RunStatus } from './slice0/contracts.js';
import type { InferenceFetch, InferenceRoute } from './inference/contracts.js';
import type { ProductApprovalProfile } from './approval-profile.js';
import type { ConfigurationSource } from './config/contracts.js';
import { classifyInferenceEndpointLocality } from './config/projection.js';
import { resolveInferenceRoute } from './inference/routing.js';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

export interface InteractiveRouteSelection {
  readonly route: InferenceRoute;
  readonly source: ConfigurationSource | 'ollama_discovery' | 'session';
}

export interface ResolveInteractiveRouteOptions {
  readonly configured?: InteractiveRouteSelection;
  readonly ollamaBaseUrl?: string;
  readonly fetch?: InferenceFetch;
  readonly discoveryTimeoutMs?: number;
}

export const chooseOllamaModel = (models: readonly string[]): string | undefined => {
  const ordered = [...new Set(models.map((model) => model.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
  return ordered.find((model) => model === 'qwen2.5-coder:7b')
    ?? ordered.find((model) => model.toLowerCase().includes('coder'))
    ?? ordered[0];
};

export async function discoverOllamaModels(
  baseUrl = 'http://127.0.0.1:11434/',
  fetchImplementation: InferenceFetch = globalThis.fetch,
  timeoutMs = 3_000,
): Promise<readonly string[]> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Ollama discovery timeout must be an integer from 1 to 30000.');
  }
  const endpoint = new URL('/api/tags', baseUrl);
  const response = await fetchImplementation(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.text();
  if (!response.ok) {
    throw new Error('Ollama model discovery failed with HTTP ' + response.status + '.');
  }
  if (body.length > 1_048_576) throw new Error('Ollama model discovery response exceeded 1048576 characters.');
  let decoded: unknown;
  try {
    decoded = JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error('Ollama model discovery returned invalid JSON: '
      + (error instanceof Error ? error.message : String(error)));
  }
  const record = asRecord(decoded);
  if (!Array.isArray(record?.models)) throw new Error('Ollama model discovery did not return a models array.');
  const names: string[] = [];
  for (const candidate of record.models.slice(0, 1_000)) {
    const model = asRecord(candidate);
    const name = typeof model?.name === 'string'
      ? model.name
      : typeof model?.model === 'string'
        ? model.model
        : undefined;
    if (name !== undefined && name.length > 0 && name.length <= 200) names.push(name);
  }
  return [...new Set(names)].sort((left, right) => left.localeCompare(right));
}

export async function resolveInteractiveRoute(
  options: ResolveInteractiveRouteOptions = {},
): Promise<InteractiveRouteSelection> {
  if (options.configured !== undefined) return options.configured;
  const ollamaBaseUrl = options.ollamaBaseUrl ?? 'http://127.0.0.1:11434/';
  if (classifyInferenceEndpointLocality(ollamaBaseUrl).runtimeLocality !== 'local') {
    throw new Error(
      'Forge will not auto-discover models from an off-device or network Ollama endpoint. '
      + 'Configure provider and model explicitly for that endpoint.',
    );
  }
  let models: readonly string[];
  try {
    models = await discoverOllamaModels(
      ollamaBaseUrl,
      options.fetch ?? globalThis.fetch,
      options.discoveryTimeoutMs ?? 3_000,
    );
  } catch (error) {
    throw new Error(
      'Forge could not discover a local Ollama model. Start Ollama and install a model, '
      + 'or configure provider and model together. Cause: '
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const selected = chooseOllamaModel(models);
  if (selected === undefined) {
    throw new Error('Ollama is reachable but has no installed models. Install one before starting interactive Forge.');
  }
  return { route: { provider: 'ollama', model: selected }, source: 'ollama_discovery' };
}

export interface InteractiveSessionIo {
  question(prompt: string, signal?: AbortSignal): Promise<string | undefined>;
  write(line: string): void;
  clear(): void;
  close(): void;
}

export interface NodeInteractiveIoOptions {
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
  readonly terminal?: boolean;
}

export interface InteractiveRunSummary {
  readonly runId: string;
  readonly status: RunStatus;
  readonly outcome: OutcomeStatus;
}

export interface InteractiveSessionOptions {
  readonly workspaceRoot: string;
  readonly initialRoute: InteractiveRouteSelection;
  readonly approvalProfile: ProductApprovalProfile;
  readonly io: InteractiveSessionIo;
  readonly runTask: (task: string, route: InferenceRoute) => Promise<InteractiveRunSummary>;
  readonly validateRoute?: (route: InferenceRoute) => void | Promise<void>;
  readonly notices?: readonly string[];
  readonly memory?: InteractiveMemoryControls;
}

export interface InteractiveMemoryControls {
  capture(input: string): Promise<readonly string[]>;
  status(): Promise<readonly string[]>;
  undo(): Promise<readonly string[]>;
  explain(): Promise<readonly string[]>;
}

const sessionHelp = [
  '/help                         Show this help',
  '/status                       Show workspace, route, approval profile, and last run',
  '/permissions                  Explain the active approval profile',
  '/model                        Show the active provider/model',
  '/model <ollama|openai> <name> Change the route for this session',
  '/memory                       Show the current memory capture mode',
  '/memory undo                  Undo the latest automatic save from this session',
  '/memory explain               Explain the latest automatic save',
  '/clear                        Clear the terminal',
  '/exit                         Exit Forge',
].join('\n');

const routeLabel = (selection: InteractiveRouteSelection): string =>
  selection.route.provider + '/' + selection.route.model + ' (' + selection.source.replaceAll('_', ' ') + ')';

const approvalDescription = (profile: ProductApprovalProfile): string => {
  if (profile === 'developer') {
    return 'registered capabilities are allowed; governed mutations still require exact-change and promotion approval';
  }
  if (profile === 'review') return 'every model-requested capability requires a visible decision';
  return 'every model-requested capability is denied';
};

interface InteractiveLineWaiter {
  readonly resolve: (line: string | undefined) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('Forge interactive prompt was cancelled.');

interface RawModeReadableStream extends NodeJS.ReadableStream {
  readonly isTTY?: boolean;
  readonly isRaw?: boolean;
  setRawMode?(enabled: boolean): unknown;
}

interface RawTerminalEditor {
  prompt(value: string): void;
  close(): void;
}

const terminalEscapeActions = new Map<string, 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'delete'>([
  ['\u001b[A', 'up'],
  ['\u001b[B', 'down'],
  ['\u001b[C', 'right'],
  ['\u001b[D', 'left'],
  ['\u001bOA', 'up'],
  ['\u001bOB', 'down'],
  ['\u001bOC', 'right'],
  ['\u001bOD', 'left'],
  ['\u001b[H', 'home'],
  ['\u001b[F', 'end'],
  ['\u001bOH', 'home'],
  ['\u001bOF', 'end'],
  ['\u001b[1~', 'home'],
  ['\u001b[3~', 'delete'],
  ['\u001b[4~', 'end'],
  ['\u001b[7~', 'home'],
  ['\u001b[8~', 'end'],
]);

const createRawTerminalEditor = (
  input: RawModeReadableStream,
  output: NodeJS.WritableStream,
  onLine: (line: string) => void,
  onClose: () => void,
): RawTerminalEditor => {
  const decoder = new StringDecoder('utf8');
  const knownEscapeSequences = [...terminalEscapeActions.keys()];
  const history: string[] = [];
  let historyIndex = 0;
  let historyDraft: string[] = [];
  let prompt = '';
  let characters: string[] = [];
  let cursor = 0;
  let pendingEscape = '';
  let skipLineFeed = false;
  let closed = false;
  const changedRawMode = input.setRawMode !== undefined && input.isRaw !== true;

  const redraw = (): void => {
    const line = characters.join('');
    const prefix = characters.slice(0, cursor).join('');
    // Reprinting the prefix after a carriage return positions the cursor without
    // guessing the display width of Unicode characters.
    output.write('\r' + prompt + line + '\u001b[K\r' + prompt + prefix);
  };
  const leaveHistory = (): void => {
    historyIndex = history.length;
    historyDraft = [];
  };
  const replaceLine = (value: string): void => {
    characters = Array.from(value);
    cursor = characters.length;
    redraw();
  };
  const submit = (): void => {
    const line = characters.join('');
    output.write('\r\n');
    if (line.length > 0 && history.at(-1) !== line) history.push(line);
    historyIndex = history.length;
    historyDraft = [];
    characters = [];
    cursor = 0;
    prompt = '';
    onLine(line);
  };
  const applyAction = (action: 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'delete'): void => {
    if (action === 'left') cursor = Math.max(0, cursor - 1);
    else if (action === 'right') cursor = Math.min(characters.length, cursor + 1);
    else if (action === 'home') cursor = 0;
    else if (action === 'end') cursor = characters.length;
    else if (action === 'delete') {
      if (cursor < characters.length) {
        characters.splice(cursor, 1);
        leaveHistory();
      }
    } else if (action === 'up') {
      if (history.length === 0) return;
      if (historyIndex === history.length) historyDraft = [...characters];
      historyIndex = Math.max(0, historyIndex - 1);
      replaceLine(history[historyIndex] ?? '');
      return;
    } else {
      if (historyIndex >= history.length) return;
      historyIndex++;
      replaceLine(historyIndex === history.length ? historyDraft.join('') : (history[historyIndex] ?? ''));
      return;
    }
    redraw();
  };
  const applyEscapeCharacter = (character: string): void => {
    pendingEscape += character;
    const action = terminalEscapeActions.get(pendingEscape);
    if (action !== undefined) {
      pendingEscape = '';
      applyAction(action);
      return;
    }
    if (knownEscapeSequences.some((sequence) => sequence.startsWith(pendingEscape))) return;
    if (pendingEscape.startsWith('\u001b[')) {
      const controlSequence = pendingEscape.slice(2);
      const finalCode = controlSequence.codePointAt(controlSequence.length - 1);
      if (controlSequence.length === 0 || finalCode === undefined || finalCode < 0x40 || finalCode > 0x7e) return;
    } else if (pendingEscape.startsWith('\u001bO') && pendingEscape.length < 3) {
      return;
    }
    // Unknown terminal control sequences are ignored instead of becoming prompt text.
    pendingEscape = '';
  };
  const applyCharacter = (character: string): void => {
    if (pendingEscape.length > 0) {
      applyEscapeCharacter(character);
      return;
    }
    if (character === '\u001b') {
      pendingEscape = character;
      return;
    }
    if (character === '\r') {
      skipLineFeed = true;
      submit();
      return;
    }
    if (character === '\n') {
      if (skipLineFeed) skipLineFeed = false;
      else submit();
      return;
    }
    skipLineFeed = false;
    if (character === '\b' || character === '\u007f') {
      if (cursor > 0) {
        characters.splice(cursor - 1, 1);
        cursor--;
        leaveHistory();
        redraw();
      }
      return;
    }
    if (character === '\u0003') {
      output.write('^C\r\n');
      editor.close();
      return;
    }
    if (character === '\u0004') {
      if (characters.length === 0) editor.close();
      else applyAction('delete');
      return;
    }
    if (character === '\u0001') {
      applyAction('home');
      return;
    }
    if (character === '\u0005') {
      applyAction('end');
      return;
    }
    if (character === '\u0015') {
      if (cursor > 0) {
        characters.splice(0, cursor);
        cursor = 0;
        leaveHistory();
        redraw();
      }
      return;
    }
    if (character === '\u000b') {
      if (cursor < characters.length) {
        characters.splice(cursor);
        leaveHistory();
        redraw();
      }
      return;
    }
    if (character < ' ' || character === '\u007f') return;
    characters.splice(cursor, 0, character);
    cursor++;
    leaveHistory();
    redraw();
  };
  const onData = (chunk: unknown): void => {
    const decoded = typeof chunk === 'string'
      ? chunk
      : chunk instanceof Uint8Array
        ? decoder.write(chunk)
        : String(chunk);
    for (const character of decoded) applyCharacter(character);
  };
  const finish = (): void => {
    if (closed) return;
    const remaining = decoder.end();
    for (const character of remaining) applyCharacter(character);
    if (characters.length > 0) onLine(characters.join(''));
    editor.close();
  };
  const onError = (): void => { editor.close(); };
  const editor: RawTerminalEditor = {
    prompt(value) {
      prompt = value;
      output.write(prompt);
      if (characters.length > 0) redraw();
    },
    close() {
      if (closed) return;
      closed = true;
      input.removeListener('data', onData);
      input.removeListener('end', finish);
      input.removeListener('error', onError);
      if (changedRawMode) input.setRawMode?.(false);
      input.pause();
      onClose();
    },
  };
  input.on('data', onData);
  input.once('end', finish);
  input.once('error', onError);
  if (changedRawMode) input.setRawMode?.(true);
  input.resume();
  return editor;
};

export function createNodeInteractiveIo(options: NodeInteractiveIoOptions = {}): InteractiveSessionIo {
  const input = (options.input ?? process.stdin) as RawModeReadableStream;
  const output = options.output ?? process.stdout;
  const terminal = options.terminal ?? input.isTTY === true;
  const queuedLines: string[] = [];
  const waiters: InteractiveLineWaiter[] = [];
  let closed = false;
  const detach = (waiter: InteractiveLineWaiter): void => {
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  };
  const acceptLine = (line: string): void => {
    const waiter = waiters.shift();
    if (waiter === undefined) queuedLines.push(line);
    else {
      detach(waiter);
      waiter.resolve(line);
    }
  };
  const acceptClose = (): void => {
    if (closed) return;
    closed = true;
    for (const waiter of waiters.splice(0)) {
      detach(waiter);
      waiter.resolve(undefined);
    }
  };
  const readline = terminal ? undefined : createInterface({ input, output, terminal: false });
  const terminalEditor = terminal
    ? createRawTerminalEditor(input, output, acceptLine, acceptClose)
    : undefined;
  readline?.on('line', acceptLine);
  readline?.once('close', acceptClose);
  return {
    async question(prompt, signal) {
      if (signal?.aborted === true) throw abortReason(signal);
      if (terminalEditor === undefined) output.write(prompt);
      else terminalEditor.prompt(prompt);
      const queued = queuedLines.shift();
      if (queued !== undefined) return queued;
      if (closed) return undefined;
      return new Promise<string | undefined>((resolveLine, rejectLine) => {
        const waiter: InteractiveLineWaiter = {
          resolve: resolveLine,
          ...(signal === undefined ? {} : { signal }),
        };
        waiters.push(waiter);
        if (signal !== undefined) {
          waiter.onAbort = () => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            detach(waiter);
            rejectLine(abortReason(signal));
          };
          signal.addEventListener('abort', waiter.onAbort, { once: true });
          if (signal.aborted) waiter.onAbort();
        }
      });
    },
    write(line) {
      output.write(line + '\n');
    },
    clear() {
      if (terminal) output.write('\u001bc');
      else output.write('\n');
    },
    close() {
      if (closed) return;
      if (terminalEditor !== undefined) terminalEditor.close();
      else readline?.close();
    },
  };
}

export async function runInteractiveSession(options: InteractiveSessionOptions): Promise<void> {
  let selection = options.initialRoute;
  let lastRun: InteractiveRunSummary | undefined;
  options.io.write('ForgeEngine alpha');
  options.io.write('workspace: ' + options.workspaceRoot);
  options.io.write('route: ' + routeLabel(selection));
  options.io.write('approval: ' + options.approvalProfile + ' — ' + approvalDescription(options.approvalProfile));
  for (const notice of options.notices ?? []) options.io.write(notice);
  options.io.write('Each prompt creates a new evidence run. Type /help for controls.');

  try {
    while (true) {
      const raw = await options.io.question('forge> ');
      if (raw === undefined) return;
      const input = raw.trim();
      if (input.length === 0) continue;
      if (!input.startsWith('/')) {
        try {
          if (options.memory !== undefined) {
            try {
              for (const line of await options.memory.capture(input)) options.io.write(line);
            } catch (error) {
              options.io.write('[forge] memory unchanged: ' + (error instanceof Error ? error.message : String(error)));
            }
          }
          lastRun = await options.runTask(input, selection.route);
        } catch (error) {
          options.io.write('[forge] task error: ' + (error instanceof Error ? error.message : String(error)));
        }
        continue;
      }

      const [rawCommand, ...argumentsList] = input.split(/\s+/u);
      const command = rawCommand?.toLowerCase();
      if (command === '/exit' || command === '/quit') return;
      if (command === '/help') {
        options.io.write(sessionHelp);
      } else if (command === '/status') {
        options.io.write('workspace: ' + options.workspaceRoot);
        options.io.write('route: ' + routeLabel(selection));
        options.io.write('approval: ' + options.approvalProfile + ' — ' + approvalDescription(options.approvalProfile));
        options.io.write(lastRun === undefined
          ? 'last run: none'
          : 'last run: ' + lastRun.runId + ' (status=' + lastRun.status + ', outcome=' + lastRun.outcome + ')');
        options.io.write('conversation: prompts are independent; tool turns within each run are preserved');
      } else if (command === '/permissions') {
        options.io.write('approval: ' + options.approvalProfile + ' — ' + approvalDescription(options.approvalProfile));
        options.io.write('Change it in configuration or restart Forge with --approval-profile <developer|review|locked>.');
      } else if (command === '/model') {
        if (argumentsList.length === 0) {
          options.io.write('route: ' + routeLabel(selection));
          options.io.write('usage: /model <ollama|openai> <model-name>');
        } else if (argumentsList.length !== 2) {
          options.io.write('usage: /model <ollama|openai> <model-name>');
        } else {
          try {
            const route = resolveInferenceRoute(argumentsList[0], argumentsList[1]);
            await options.validateRoute?.(route);
            selection = { route, source: 'session' };
            options.io.write('route changed: ' + routeLabel(selection));
          } catch (error) {
            options.io.write('[forge] route unchanged: ' + (error instanceof Error ? error.message : String(error)));
          }
        }
      } else if (command === '/memory') {
        if (options.memory === undefined) {
          options.io.write('memory: unavailable');
        } else if (argumentsList.length === 0 || argumentsList[0] === 'status') {
          for (const line of await options.memory.status()) options.io.write(line);
        } else if (argumentsList.length === 1 && argumentsList[0] === 'undo') {
          for (const line of await options.memory.undo()) options.io.write(line);
        } else if (argumentsList.length === 1 && argumentsList[0] === 'explain') {
          for (const line of await options.memory.explain()) options.io.write(line);
        } else {
          options.io.write('usage: /memory [status|undo|explain]');
        }
      } else if (command === '/clear') {
        options.io.clear();
      } else {
        options.io.write('Unknown command: ' + String(rawCommand) + '. Type /help.');
      }
    }
  } finally {
    options.io.close();
  }
}
