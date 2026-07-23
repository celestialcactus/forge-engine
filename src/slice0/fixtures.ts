import type {
  ApprovalPolicy,
  Capability,
  CapabilityCall,
  CapabilityResult,
  PlannerRequest,
  PlannerTurn,
  TaskPlanner,
  WorkspaceSnapshot,
} from './contracts.js';

export const slice0Workspace: WorkspaceSnapshot = {
  id: 'workspace:fixture-1',
  rootLabel: 'slice0-fixture',
  files: [
    { path: 'src/greeting.ts', bytes: 28 },
    { path: 'package.json', bytes: 42 },
    { path: 'README.md', bytes: 19 },
  ],
};

export class ScriptedPlanner implements TaskPlanner {
  readonly id = 'scripted-fixture';
  readonly #turns: PlannerTurn[];

  constructor(turns: readonly PlannerTurn[]) {
    this.#turns = [...turns];
  }

  async next(_request: PlannerRequest, signal: AbortSignal): Promise<PlannerTurn> {
    signal.throwIfAborted();
    const turn = this.#turns.shift();
    if (turn === undefined) throw new Error('Fixture planner has no remaining turns.');
    return turn;
  }
}

export const allowAll: ApprovalPolicy = {
  async decide() {
    return { outcome: 'allow', reason: 'Fixture permits read-only evidence inspection.' };
  },
};

export const denyAll: ApprovalPolicy = {
  async decide() {
    return { outcome: 'deny', reason: 'Fixture policy denied this capability.' };
  },
};

export const workspaceInventory: Capability = {
  id: 'workspace.inventory',
  async invoke(call: CapabilityCall, snapshot: WorkspaceSnapshot, signal: AbortSignal): Promise<CapabilityResult> {
    signal.throwIfAborted();
    if (call.input !== undefined && typeof call.input !== 'object') throw new Error('workspace.inventory input must be an object.');
    return {
      callId: call.id,
      success: true,
      content: JSON.stringify({ snapshotId: snapshot.id, files: [...snapshot.files].map((file) => file.path).sort() }),
    };
  },
};

export const explodingCapability: Capability = {
  id: 'fixture.explodes',
  async invoke(call: CapabilityCall): Promise<CapabilityResult> {
    throw new Error(`Fixture capability ${call.id} failed.`);
  },
};
