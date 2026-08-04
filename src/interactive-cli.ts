import { createInterface } from 'node:readline';
import type { OutcomeStatus, RunStatus } from './slice0/contracts.js';
import type { InferenceFetch, InferenceRoute } from './inference/contracts.js';
import { resolveInferenceRoute } from './inference/routing.js';

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const ollamaBaseUrl = (environment: NodeJS.ProcessEnv): string =>
  environment.FORGE_OLLAMA_URL ?? 'http://127.0.0.1:11434';

export interface InteractiveRouteSelection {
  readonly route: InferenceRoute;
  readonly source: 'command-line' | 'environment' | 'ollama-discovery' | 'session';
}

export interface ResolveInteractiveRouteOptions {
  readonly provider?: string;
  readonly model?: string;
  readonly environment?: NodeJS.ProcessEnv;
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
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: InferenceFetch = globalThis.fetch,
  timeoutMs = 3_000,
): Promise<readonly string[]> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Ollama discovery timeout must be an integer from 1 to 30000.');
  }
  const base = ollamaBaseUrl(environment);
  const endpoint = new URL('/api/tags', base.endsWith('/') ? base : base + '/');
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
  const environment = options.environment ?? process.env;
  const provider = options.provider ?? environment.FORGE_DEFAULT_PROVIDER;
  const model = options.model ?? environment.FORGE_DEFAULT_MODEL;
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error('Interactive Forge requires provider and model together. Set both flags or both FORGE_DEFAULT_* values.');
  }
  if (provider !== undefined && model !== undefined) {
    return {
      route: resolveInferenceRoute(provider, model),
      source: options.provider !== undefined || options.model !== undefined ? 'command-line' : 'environment',
    };
  }
  let models: readonly string[];
  try {
    models = await discoverOllamaModels(
      environment,
      options.fetch ?? globalThis.fetch,
      options.discoveryTimeoutMs ?? 3_000,
    );
  } catch (error) {
    throw new Error(
      'Forge could not discover a local Ollama model. Start Ollama and install a model, '
      + 'or provide --provider and --model. Cause: '
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const selected = chooseOllamaModel(models);
  if (selected === undefined) {
    throw new Error('Ollama is reachable but has no installed models. Install one before starting interactive Forge.');
  }
  return { route: { provider: 'ollama', model: selected }, source: 'ollama-discovery' };
}

export interface InteractiveSessionIo {
  question(prompt: string, signal?: AbortSignal): Promise<string | undefined>;
  write(line: string): void;
  clear(): void;
  close(): void;
}

export interface InteractiveRunSummary {
  readonly runId: string;
  readonly status: RunStatus;
  readonly outcome: OutcomeStatus;
}

export interface InteractiveSessionOptions {
  readonly workspaceRoot: string;
  readonly initialRoute: InteractiveRouteSelection;
  readonly io: InteractiveSessionIo;
  readonly runTask: (task: string, route: InferenceRoute) => Promise<InteractiveRunSummary>;
  readonly validateRoute?: (route: InferenceRoute) => void | Promise<void>;
  readonly notices?: readonly string[];
}

const sessionHelp = [
  '/help                         Show this help',
  '/status                       Show workspace, route, and last run',
  '/model                        Show the active provider/model',
  '/model <ollama|openai> <name> Change the route for this session',
  '/clear                        Clear the terminal',
  '/exit                         Exit Forge',
].join('\n');

const routeLabel = (selection: InteractiveRouteSelection): string =>
  selection.route.provider + '/' + selection.route.model + ' (' + selection.source + ')';

interface InteractiveLineWaiter {
  readonly resolve: (line: string | undefined) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
}

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new Error('Forge interactive prompt was cancelled.');

export function createNodeInteractiveIo(): InteractiveSessionIo {
  const readline = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
  const queuedLines: string[] = [];
  const waiters: InteractiveLineWaiter[] = [];
  let closed = false;
  const detach = (waiter: InteractiveLineWaiter): void => {
    if (waiter.signal !== undefined && waiter.onAbort !== undefined) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
    }
  };
  readline.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter === undefined) queuedLines.push(line);
    else {
      detach(waiter);
      waiter.resolve(line);
    }
  });
  readline.once('close', () => {
    closed = true;
    for (const waiter of waiters.splice(0)) {
      detach(waiter);
      waiter.resolve(undefined);
    }
  });
  return {
    async question(prompt, signal) {
      if (signal?.aborted === true) throw abortReason(signal);
      process.stdout.write(prompt);
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
      process.stdout.write(line + '\n');
    },
    clear() {
      if (process.stdout.isTTY) process.stdout.write('\u001bc');
      else process.stdout.write('\n');
    },
    close() {
      if (!closed) readline.close();
    },
  };
}

export async function runInteractiveSession(options: InteractiveSessionOptions): Promise<void> {
  let selection = options.initialRoute;
  let lastRun: InteractiveRunSummary | undefined;
  options.io.write('ForgeEngine alpha');
  options.io.write('workspace: ' + options.workspaceRoot);
  options.io.write('route: ' + routeLabel(selection));
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
        options.io.write(lastRun === undefined
          ? 'last run: none'
          : 'last run: ' + lastRun.runId + ' (status=' + lastRun.status + ', outcome=' + lastRun.outcome + ')');
        options.io.write('conversation: prompts are independent; tool turns within each run are preserved');
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
