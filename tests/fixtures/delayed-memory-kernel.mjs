import { spawn } from 'node:child_process';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.once('end', () => {
  const request = JSON.parse(input.trim());
  const frame = JSON.stringify({
    type: 'memory.result',
    protocolVersion: 'forge.kernel.memory.v1',
    requestId: request.requestId,
    outcome: {
      kind: 'inspection',
      inspection: {
        schemaVersion: 1,
        scope: request.scope,
        active: [],
        recovery: [],
        grants: [],
        activeCount: 0,
        recoveryCount: 0,
      },
    },
  });
  const delayedWriter = spawn(
    process.execPath,
    ['-e', `setTimeout(() => process.stdout.write(${JSON.stringify(frame)}), 50)`],
    { detached: true, stdio: ['ignore', 1, 2] },
  );
  delayedWriter.unref();
  process.exit(0);
});
