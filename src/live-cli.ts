import type { ProviderInferenceObservation } from './inference/contracts.js';
import type { InferenceEvidence, RunArtifact, RunEvent } from './slice0/contracts.js';

export interface LiveCliSink {
  stdout(chunk: string): void;
  stderr(chunk: string): void;
}

export interface InterruptSource {
  once(event: 'SIGINT', listener: () => void): unknown;
  removeListener(event: 'SIGINT', listener: () => void): unknown;
}

export type RunCancellationSource = 'sigint' | 'timeout';

export interface RunCancellation {
  readonly signal: AbortSignal;
  readonly source: RunCancellationSource | undefined;
  dispose(): void;
}

const tokenTotal = (
  evidence: readonly InferenceEvidence[],
  field: 'inputTokens' | 'outputTokens',
): number | undefined => {
  const values = evidence.map((item) => item.usage[field]).filter((value): value is number => value !== undefined);
  return values.length === 0 ? undefined : values.reduce((total, value) => total + value, 0);
};

export class LiveCliPresenter {
  readonly #sink: LiveCliSink;
  #textOpen = false;

  constructor(sink: LiveCliSink = {
    stdout: (chunk) => process.stdout.write(chunk),
    stderr: (chunk) => process.stderr.write(chunk),
  }) {
    this.#sink = sink;
  }

  onInferenceEvent(observation: ProviderInferenceObservation): void {
    const event = observation.event;
    if (event.type === 'text.delta') {
      if (!this.#textOpen) {
        this.#sink.stdout('assistant> ');
        this.#textOpen = true;
      }
      this.#sink.stdout(event.text);
    } else if (event.type === 'response.completed') {
      this.#closeText();
    }
  }

  onRunEvent(event: RunEvent): void {
    if (event.type === 'run.started') {
      this.#status('run ' + event.runId + ' started; snapshot=' + event.snapshotId);
    } else if (event.type === 'context.planned') {
      const selectedBytes = event.plan.selected.reduce((total, item) => total + item.bytes, 0);
      this.#status(
        'context selected=' + event.plan.selected.length
        + ' omitted=' + event.plan.omitted.length
        + ' bytes=' + selectedBytes + '/' + event.plan.budgetBytes,
      );
    } else if (event.type === 'inference.completed') {
      const evidence = event.evidence;
      const usage = [
        evidence.usage.inputTokens === undefined ? undefined : 'in=' + evidence.usage.inputTokens,
        evidence.usage.outputTokens === undefined ? undefined : 'out=' + evidence.usage.outputTokens,
      ].filter((value): value is string => value !== undefined).join(' ');
      this.#status(
        'inference ' + evidence.provider + '/' + evidence.model
        + ' ' + evidence.finishReason
        + ' ' + evidence.durationMs + 'ms'
        + (usage.length === 0 ? '' : ' ' + usage),
      );
    } else if (event.type === 'capability.requested') {
      this.#status('capability requested: ' + event.call.capabilityId);
    } else if (event.type === 'approval.decided') {
      this.#status('approval ' + event.outcome + ': ' + event.callId);
    } else if (event.type === 'capability.completed') {
      this.#status(
        'capability ' + (event.result.success ? 'completed' : 'failed')
        + ': ' + event.result.callId,
      );
    } else if (event.type === 'run.failed') {
      this.#status('run failed: ' + event.code + ' - ' + event.message);
    } else if (event.type === 'run.cancelled') {
      this.#status('run cancelled: ' + event.reason);
    } else if (event.type === 'run.budget_exhausted') {
      this.#status(
        'run budget exhausted: required=' + event.requiredBytes
        + ' budget=' + event.plan.budgetBytes,
      );
    }
  }

  printSummary(artifact: RunArtifact): void {
    this.#closeText();
    const inference = artifact.inferenceEvidence ?? [];
    const successfulCapabilities = artifact.capabilityResults.filter((result) => result.success).length;
    const failedCapabilities = artifact.capabilityResults.length - successfulCapabilities;
    const inputTokens = tokenTotal(inference, 'inputTokens');
    const outputTokens = tokenTotal(inference, 'outputTokens');
    const tokenSummary = inputTokens === undefined && outputTokens === undefined
      ? 'unreported'
      : 'input=' + (inputTokens ?? 'unreported') + ' output=' + (outputTokens ?? 'unreported');
    const selected = artifact.contextPlan?.selected.length ?? 0;
    const omitted = artifact.contextPlan?.omitted.length ?? 0;
    const outputCharacters = artifact.output === undefined ? 0 : Array.from(artifact.output).length;
    this.#sink.stderr([
      '[forge] evidence summary',
      '  run=' + artifact.runId + ' status=' + artifact.status,
      '  snapshot=' + artifact.snapshot.id + ' files=' + artifact.snapshot.files.length,
      '  context selected=' + selected + ' omitted=' + omitted,
      '  inference turns=' + inference.length + ' tokens ' + tokenSummary,
      '  capabilities success=' + successfulCapabilities + ' failed=' + failedCapabilities,
      '  events=' + artifact.events.length + ' outputCharacters=' + outputCharacters,
      '',
    ].join('\n'));
  }

  #status(message: string): void {
    this.#closeText();
    this.#sink.stderr('[forge] ' + message + '\n');
  }

  #closeText(): void {
    if (!this.#textOpen) return;
    this.#sink.stdout('\n');
    this.#textOpen = false;
  }
}

export const createRunCancellation = (
  timeoutMs: number,
  interruptSource: InterruptSource = process,
): RunCancellation => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Run timeout must be a positive safe integer.');
  }
  const controller = new AbortController();
  let source: RunCancellationSource | undefined;
  let disposed = false;

  const abort = (nextSource: RunCancellationSource, message: string): void => {
    if (controller.signal.aborted) return;
    source = nextSource;
    controller.abort(new Error(message));
  };
  const onSigint = (): void => abort('sigint', 'Forge run cancelled by SIGINT.');
  interruptSource.once('SIGINT', onSigint);
  const timer = setTimeout(
    () => abort('timeout', 'Forge run timed out after ' + timeoutMs + 'ms.'),
    timeoutMs,
  );
  timer.unref();

  return {
    signal: controller.signal,
    get source() {
      return source;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      interruptSource.removeListener('SIGINT', onSigint);
    },
  };
};
