import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

const execFileAsync = promisify(execFile);
const cli = [resolve('node_modules/tsx/dist/cli.mjs'), resolve('src/cli.ts')];
const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', 'debug', process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');
const coveredEnvironmentVariables = [
  'FORGE_DEFAULT_PROVIDER',
  'FORGE_DEFAULT_MODEL',
  'FORGE_ENGINE_ROOT',
  'FORGE_OLLAMA_URL',
  'FORGE_OLLAMA_CONTEXT_TOKENS',
  'FORGE_OPENAI_BASE_URL',
  'FORGE_APPROVAL_PROFILE',
  'FORGE_MAX_TURNS',
  'FORGE_MAX_CAPABILITY_CALLS',
  'FORGE_MAX_INPUT_TOKENS',
  'FORGE_MAX_OUTPUT_TOKENS',
  'FORGE_TIMEOUT_MS',
  'OPENAI_API_KEY',
] as const;

const sanitizedEnvironment = (home: string): NodeJS.ProcessEnv => {
  const environment = { ...process.env };
  for (const variable of coveredEnvironmentVariables) delete environment[variable];
  return {
    ...environment,
    HOME: home,
    USERPROFILE: home,
    FORGE_KERNEL_BINARY: kernelBinary,
  };
};

const closeServer = async (server: ReturnType<typeof createServer>): Promise<void> =>
  new Promise((resolveClose, reject) => {
    server.close((error) => error === undefined ? resolveClose() : reject(error));
  });

const runInteractiveCli = async (
  arguments_: readonly string[],
  environment: NodeJS.ProcessEnv,
  input: string,
): Promise<{ readonly code: number | null; readonly stdout: string; readonly stderr: string }> =>
  new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [...cli, ...arguments_], {
      env: environment,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input);
  });

test('source-built configured run and interactive commands use one fixed route without fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-configured-product-'));
  const workspace = join(root, 'workspace');
  const home = join(root, 'home');
  const engineRoot = join(root, 'engine');
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body) as unknown);
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end([
        JSON.stringify({ message: { content: 'Forge configured response' }, done: false }),
        JSON.stringify({
          message: { content: '' },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 8,
          eval_count: 3,
        }),
        '',
      ].join('\n'));
    });
  });

  try {
    await Promise.all([
      mkdir(workspace),
      mkdir(join(home, '.forge'), { recursive: true }),
    ]);
    await writeFile(join(workspace, 'README.md'), '# Configured product fixture\n', 'utf8');
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolveListen);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Fixture inference server has no TCP address.');
    await writeFile(join(home, '.forge', 'config.json'), JSON.stringify({
      schemaVersion: 1,
      inference: { provider: 'ollama', model: 'fixture-model' },
      engineRoot,
      providers: { ollama: { baseUrl: `http://127.0.0.1:${address.port}` } },
    }), 'utf8');
    const environment = sanitizedEnvironment(home);

    const enabled = await execFileAsync(process.execPath, [
      ...cli,
      'memory',
      'autosave',
      'auto',
      '--workspace',
      workspace,
      '--json',
    ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
    assert.equal((JSON.parse(enabled.stdout) as { readonly mode: string }).mode, 'auto');

    const run = await execFileAsync(process.execPath, [
      ...cli,
      'run',
      'Return the configured fixture response.',
      '--workspace',
      workspace,
      '--json',
    ], { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: environment });
    const artifact = JSON.parse(run.stdout) as {
      readonly status: string;
      readonly output?: string;
      readonly outcome: { readonly status: string };
      readonly inferenceEvidence: ReadonlyArray<{
        readonly provider: string;
        readonly model: string;
        readonly routing: { readonly fallbackUsed: boolean };
      }>;
    };
    assert.equal(artifact.status, 'completed');
    assert.equal(artifact.outcome.status, 'not_evaluated');
    assert.equal(artifact.output, 'Forge configured response');
    assert.equal(artifact.inferenceEvidence[0]?.provider, 'ollama');
    assert.equal(artifact.inferenceEvidence[0]?.model, 'fixture-model');
    assert.equal(artifact.inferenceEvidence[0]?.routing.fallbackUsed, false);

    const interactive = await runInteractiveCli(
      ['--workspace', workspace],
      environment,
      'I prefer concise test output.\n/memory explain\n/memory undo\n/exit\n',
    );
    assert.equal(interactive.code, 0, interactive.stderr);
    assert.match(interactive.stdout, /route: ollama\/fixture-model \(user\)/u);
    assert.match(interactive.stdout, /assistant> Forge configured response/u);
    assert.match(interactive.stdout, /Remembered: I prefer concise test output\./u);
    assert.match(interactive.stdout, /exact direct input under this repository’s local auto grant/u);
    assert.match(interactive.stdout, /No recovery copy was retained/u);
    assert.doesNotMatch(interactive.stdout, /Remember this preference\?/u);
    assert.doesNotMatch(interactive.stdout + interactive.stderr, /fallback provider/u);
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal((request as { readonly model?: unknown }).model, 'fixture-model');
    }
    assert.doesNotMatch(await readTree(join(engineRoot, 'memory')), /I prefer concise test output\./u);
  } finally {
    await closeServer(server);
    await rm(root, { recursive: true, force: true });
  }
});

const readTree = async (root: string): Promise<string> => {
  const chunks: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) chunks.push(await readFile(path, 'utf8'));
    }
  };
  await visit(root);
  return chunks.join('\n');
};
