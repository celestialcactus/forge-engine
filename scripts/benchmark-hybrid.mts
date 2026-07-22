import { stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { RustKernelRuntime } from '../src/hybrid/rust-kernel-runtime.js';
import type { ApprovalFacts, CapabilityCall } from '../src/slice0/contracts.js';
import { allowAll, ScriptedPlanner, slice0Workspace, workspaceInventory } from '../src/slice0/fixtures.js';
import { Slice0Runtime, type Slice0RuntimeOptions } from '../src/slice0/runtime.js';

const samples = Number(process.env.FORGE_BENCHMARK_SAMPLES ?? '30');
if (!Number.isInteger(samples) || samples < 5 || samples > 500) {
  throw new Error('FORGE_BENCHMARK_SAMPLES must be an integer from 5 through 500.');
}
const profile = process.env.FORGE_KERNEL_PROFILE ?? 'release';
const kernelBinary = process.env.FORGE_KERNEL_BINARY
  ?? resolve('target', profile, process.platform === 'win32' ? 'forge-kernel.exe' : 'forge-kernel');
const inspectCall = { id: 'call-1', capabilityId: 'workspace.inventory', input: {} };

const benchmarkApprovalFacts = {
  async collect(call: CapabilityCall, signal: AbortSignal): Promise<ApprovalFacts> {
    signal.throwIfAborted();
    return {
      schemaVersion: 1,
      callId: call.id,
      capabilityId: call.capabilityId,
      hostPolicy: {
        posture: 'allow',
        source: 'benchmark.host-policy',
        reason: 'The benchmark exercises an in-memory read-only fixture.',
      },
      userConsent: {
        status: 'notRequired',
        source: 'benchmark.host-ui',
        reason: 'The benchmark does not require interactive consent.',
      },
    };
  },
};

const runtimeOptions = (): Slice0RuntimeOptions => ({
  planner: new ScriptedPlanner([
    { kind: 'call', call: inspectCall },
    { kind: 'complete', output: 'Workspace inspected.' },
  ]),
  approvalPolicy: allowAll,
  capabilities: [workspaceInventory],
});

const request = (index: number) => ({
  runId: 'benchmark-' + String(index),
  task: 'Inspect the workspace.',
  snapshot: slice0Workspace,
  contextBudgetBytes: 200,
  maxTurns: 2,
});

const measure = async (operation: () => Promise<unknown>): Promise<number> => {
  const started = performance.now();
  await operation();
  return performance.now() - started;
};

const summarize = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return {
    samples: sorted.length,
    meanMs: Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(3)),
    p50Ms: Number(percentile(0.5).toFixed(3)),
    p95Ms: Number(percentile(0.95).toFixed(3)),
    maxMs: Number((sorted.at(-1) ?? 0).toFixed(3)),
  };
};

const typescriptDurations: number[] = [];
const rustDurations: number[] = [];
await new RustKernelRuntime({ ...runtimeOptions(), approvalFacts: benchmarkApprovalFacts, kernelPath: kernelBinary }).run(request(-1));

for (let index = 0; index < samples; index += 1) {
  typescriptDurations.push(await measure(async () =>
    new Slice0Runtime(runtimeOptions()).run(request(index))));
  rustDurations.push(await measure(async () =>
    new RustKernelRuntime({ ...runtimeOptions(), approvalFacts: benchmarkApprovalFacts, kernelPath: kernelBinary }).run(request(index))));
}

const binary = await stat(kernelBinary);
const report = {
  schemaVersion: 1,
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  kernelBinary,
  kernelBinaryBytes: binary.size,
  typescriptControl: summarize(typescriptDurations),
  rustProcessBridge: summarize(rustDurations),
};
console.log(JSON.stringify(report, null, 2));

if (process.argv.includes('--assert') && report.rustProcessBridge.p95Ms > 500) {
  throw new Error('Rust process bridge p95 exceeded the 500 ms spike ceiling.');
}