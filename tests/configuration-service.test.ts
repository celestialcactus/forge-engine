import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { compileProductConfiguration } from '../src/config/compile.js';
import type { ProductApprovalConfiguration } from '../src/approval-profile.js';
import type { TaskPlanner } from '../src/slice0/contracts.js';
import { ScriptedPlanner } from '../src/slice0/fixtures.js';
import { ForgeWorkspaceService, typeScriptConformanceFixture } from '../src/v1/service.js';

const fixtureRoot = resolve('tests/fixtures/slice1-workspace');
const planner = () => new ScriptedPlanner([
  {
    kind: 'call',
    call: { id: 'call:configuration', capabilityId: 'workspace.inventory', input: { maxFiles: 1 } },
  },
  { kind: 'complete', output: 'done' },
]);

test('service callers cannot relax a compiled locked approval baseline', async () => {
  const baselineApproval: ProductApprovalConfiguration = { profile: 'locked' };
  const service = new ForgeWorkspaceService(fixtureRoot, {
    runtime: typeScriptConformanceFixture,
    approval: baselineApproval,
    execution: {
      maxTurns: 8,
      timeoutMs: 30_000,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 6,
        maxReportedInputTokens: 262_144,
        maxReportedOutputTokens: 32_768,
      },
    },
  });
  try {
    (baselineApproval as { profile: string }).profile = 'developer';
    const artifact = await service.executeTask('Inspect.', planner(), {
      approval: { profile: 'developer' },
    });
    const approvalEvent = artifact.events.find((event) => event.type === 'approval.decided');
    assert.equal(approvalEvent?.type, 'approval.decided');
    if (approvalEvent?.type !== 'approval.decided') throw new Error('Expected approval evidence.');
    assert.equal(approvalEvent.outcome, 'deny');
    assert.equal(approvalEvent.facts?.hostPolicy.source, 'forge.product.approval-profile.locked');
    assert.equal(artifact.capabilityResults.some(({ success }) => success), false);
  } finally {
    service.close();
  }
});

test('service callers cannot relax compiled turn or capability ceilings', async () => {
  const execution = {
    maxTurns: 1,
    timeoutMs: 30_000,
    executionBudget: {
      schemaVersion: 1 as const,
      maxCapabilityCalls: 0,
      maxReportedInputTokens: 262_144,
      maxReportedOutputTokens: 32_768,
    },
  };
  const service = new ForgeWorkspaceService(fixtureRoot, {
    runtime: typeScriptConformanceFixture,
    execution,
  });
  try {
    execution.maxTurns = 8;
    execution.executionBudget.maxCapabilityCalls = 6;
    const artifact = await service.executeTask('Inspect.', planner(), {
      maxTurns: 8,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 6,
        maxReportedInputTokens: 262_144,
        maxReportedOutputTokens: 32_768,
      },
    });
    assert.equal(artifact.capabilityResults.length, 0);
    assert.match(JSON.stringify(artifact), /capability.*budget|budget.*capability/iu);
  } finally {
    service.close();
  }
});

test('service construction retains the same immutable effective fields, sources, and digests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forge-config-service-'));
  const home = join(root, 'home');
  await mkdir(home);
  try {
    const compiled = await compileProductConfiguration({
      workspaceRoot: fixtureRoot,
      homeDirectory: home,
      environment: { FORGE_MAX_CAPABILITY_CALLS: '0' },
    });
    const service = new ForgeWorkspaceService(fixtureRoot, {
      runtime: typeScriptConformanceFixture,
      configuration: compiled.effective,
    });
    try {
      assert.strictEqual(service.effectiveConfiguration(), compiled.effective);
      assert.deepEqual(
        service.effectiveConfiguration()?.diagnostics,
        compiled.effective.diagnostics,
      );
      const artifact = await service.inspect(1);
      assert.equal(artifact.capabilityResults.length, 0);
    } finally {
      service.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an equal review baseline accepts an invocation-scoped consent callback', async () => {
  const service = new ForgeWorkspaceService(fixtureRoot, {
    runtime: typeScriptConformanceFixture,
    approval: { profile: 'review' },
  });
  try {
    const artifact = await service.executeTask('Inspect.', planner(), {
      approval: {
        profile: 'review',
        async requestConsent() {
          return {
            status: 'granted',
            source: 'fixture.review',
            reason: 'Fixture granted this exact call.',
          };
        },
      },
    });
    assert.equal(artifact.capabilityResults[0]?.success, true);
  } finally {
    service.close();
  }
});

test('configured service timeouts cancel cooperative planner work and reject invalid bounds', async () => {
  assert.throws(() => new ForgeWorkspaceService(fixtureRoot, {
    runtime: typeScriptConformanceFixture,
    execution: {
      maxTurns: 8,
      timeoutMs: 0,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 6,
        maxReportedInputTokens: 262_144,
        maxReportedOutputTokens: 32_768,
      },
    },
  }), /timeoutMs/u);

  const service = new ForgeWorkspaceService(fixtureRoot, {
    runtime: typeScriptConformanceFixture,
    execution: {
      maxTurns: 8,
      timeoutMs: 10,
      executionBudget: {
        schemaVersion: 1,
        maxCapabilityCalls: 6,
        maxReportedInputTokens: 262_144,
        maxReportedOutputTokens: 32_768,
      },
    },
  });
  const waitingPlanner: TaskPlanner = {
    id: 'waiting-configuration-fixture',
    async next(_request, signal) {
      return new Promise<never>((_resolve, reject) => {
        const keepAlive = setTimeout(() => reject(new Error('Fixture timeout did not fire.')), 1_000);
        signal.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          reject(signal.reason);
        }, { once: true });
      });
    },
  };
  try {
    const artifact = await service.executeTask('Wait.', waitingPlanner);
    assert.equal(artifact.status, 'cancelled');
  } finally {
    service.close();
  }
});
