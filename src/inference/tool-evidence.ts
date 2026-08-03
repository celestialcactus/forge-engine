type JsonRecord = Record<string, unknown>;

type LineEvidence = {
  readonly line: number;
  readonly text: string;
};

const asRecord = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;

const positiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

const readLines = (value: unknown): readonly LineEvidence[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const lines: LineEvidence[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === undefined || !positiveInteger(record.line) || typeof record.text !== 'string') {
      return undefined;
    }
    lines.push({ line: record.line, text: record.text });
  }
  return lines;
};

export const providerToolResultContent = (
  capabilityId: string,
  content: string,
): string => {
  if (capabilityId !== 'workspace.read') return content;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return content;
  }
  const evidence = asRecord(parsed);
  const lines = readLines(evidence?.lines);
  if (
    evidence === undefined
    || typeof evidence.snapshotId !== 'string'
    || typeof evidence.path !== 'string'
    || typeof evidence.sha256 !== 'string'
    || !positiveInteger(evidence.startLine)
    || !positiveInteger(evidence.endLine)
    || !positiveInteger(evidence.totalLines)
    || typeof evidence.truncated !== 'boolean'
    || lines === undefined
  ) {
    return content;
  }
  return [
    'Forge capability evidence: workspace.read',
    'snapshot: ' + evidence.snapshotId,
    'path: ' + evidence.path,
    'sha256: ' + evidence.sha256,
    'range: ' + evidence.startLine + '-' + evidence.endLine + ' of ' + evidence.totalLines,
    'truncated: ' + evidence.truncated,
    'lines:',
    ...lines.map((line) => String(line.line) + ': ' + line.text),
  ].join('\n');
};
