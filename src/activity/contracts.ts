import type { ProviderInferenceObservation } from '../inference/contracts.js';
import type { RunArtifact, RunEvent } from '../slice0/contracts.js';

export const terminalActivitySchemaVersion = 1 as const;

export const configuredActivityModes = ['auto', 'detailed', 'compact', 'off'] as const;
export type ConfiguredActivityMode = typeof configuredActivityModes[number];

export const resolvedActivityModes = ['detailed', 'compact', 'off'] as const;
export type ResolvedActivityMode = typeof resolvedActivityModes[number];

export const activityAuthorities = [
  'canonical_run',
  'provider_reported',
  'assistant_commentary',
  'presentation_derived',
] as const;
export type ActivityAuthority = typeof activityAuthorities[number];

export const activityKinds = [
  'working',
  'update',
  'run',
  'context',
  'evidence',
  'action',
  'result',
  'approval',
  'verify',
  'warning',
] as const;
export type ActivityKind = typeof activityKinds[number];

export const activityKindsByAuthority = {
  canonical_run: ['run', 'context', 'evidence', 'action', 'result', 'approval', 'verify', 'warning'],
  provider_reported: ['working'],
  assistant_commentary: ['update'],
  presentation_derived: ['run', 'warning'],
} as const satisfies Readonly<Record<ActivityAuthority, readonly ActivityKind[]>>;

export const terminalActivityLimits = {
  providerReasoningScalarValuesPerRequest: 65_536,
  assistantCommentaryScalarValuesPerRequest: 16_384,
  renderedLineCharacters: 1_024,
  capabilityResultPreviewBytes: 4_096,
} as const;

export interface TerminalActivityEnvelope {
  readonly schemaVersion: typeof terminalActivitySchemaVersion;
  readonly ordinal: number;
  readonly authority: ActivityAuthority;
  readonly kind: ActivityKind;
  readonly message: string;
  readonly runId?: string;
  readonly runSequence?: number;
  readonly requestId?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly reasoningFormat?: 'summary' | 'trace';
  readonly assistantPhase?: 'commentary';
  readonly truncated?: true;
}

export interface ActivityModeResolutionInput {
  readonly configured: ConfiguredActivityMode;
  readonly json: boolean;
  readonly stdinTty: boolean;
  readonly stdoutTty: boolean;
  readonly stderrTty: boolean;
}

export type ResolveActivityMode = (input: ActivityModeResolutionInput) => ResolvedActivityMode;

export interface ActivityPresenter {
  onInferenceEvent(observation: ProviderInferenceObservation): void;
  onRunEvent(event: RunEvent): void;
  printAssistantOutput(output: string): void;
  printSummary(artifact: RunArtifact): void;
  close(): void;
}
