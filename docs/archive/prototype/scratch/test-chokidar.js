import chokidar from 'chokidar';
import fs from 'node:fs';
import path from 'node:path';

const testDir = './.task/proposals_test';
if (!fs.existsSync(testDir)) fs.mkdirSync(testDir, { recursive: true });

console.log('Testing chokidar in this environment...');
const watcher = chokidar.watch(testDir, { persistent: true });

watcher.on('add', (filePath) => {
  console.log(`DETECTED: ${filePath}`);
  process.exit(0);
});

setTimeout(() => {
  console.log('Writing test file...');
  fs.writeFileSync(path.join(testDir, 'test.json'), '{"test":true}');
}, 1000);

setTimeout(() => {
  console.log('Timed out waiting for chokidar.');
  process.exit(1);
}, 5000);
