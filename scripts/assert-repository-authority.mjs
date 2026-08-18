import { execFileSync, spawnSync } from 'node:child_process';

const authorityAnchor = '5fff597269168c250b15e89e7ae77d68f0510abc';
const expectedRepository = 'celestialcactus/forge-engine';
const requireCurrentDevelop = process.argv.includes('--require-current-develop');
const asJson = process.argv.includes('--json');
const unknownArguments = process.argv.slice(2).filter((value) => (
  value !== '--require-current-develop' && value !== '--json'
));

if (unknownArguments.length > 0) {
  throw new Error(`Unknown repository-authority arguments: ${unknownArguments.join(', ')}`);
}

const git = (arguments_) => execFileSync('git', arguments_, {
  cwd: process.cwd(),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim();

const isAncestor = (ancestor, descendant) => spawnSync(
  'git',
  ['merge-base', '--is-ancestor', ancestor, descendant],
  { cwd: process.cwd(), stdio: 'ignore' },
).status === 0;

const normalizeRemote = (value) => value
  .replace(/^git@github\.com:/u, '')
  .replace(/^https?:\/\/github\.com\//u, '')
  .replace(/\.git$/u, '')
  .toLowerCase();

const failures = [];
let root;
let head;
let originDevelop;
let remote;
let branch;
let commonDirectory;

try {
  root = git(['rev-parse', '--show-toplevel']);
  head = git(['rev-parse', 'HEAD']);
  originDevelop = git(['rev-parse', 'refs/remotes/origin/develop']);
  remote = git(['remote', 'get-url', 'origin']);
  branch = git(['branch', '--show-current']) || '(detached)';
  commonDirectory = git(['rev-parse', '--git-common-dir']);
} catch (error) {
  failures.push('Git repository metadata or origin/develop is unavailable. Run `git fetch origin develop` from a ForgeEngine clone.');
}

if (remote !== undefined && normalizeRemote(remote) !== expectedRepository) {
  failures.push(`origin points to ${remote}, not ${expectedRepository}.`);
}
if (originDevelop !== undefined && !isAncestor(authorityAnchor, originDevelop)) {
  failures.push(`origin/develop does not contain reconstruction authority anchor ${authorityAnchor}. Fetch the canonical remote; do not start from the archived prototype.`);
}
if (head !== undefined && !isAncestor(authorityAnchor, head)) {
  failures.push(`HEAD does not contain reconstruction authority anchor ${authorityAnchor}. Preserve the work, then replay its bounded diff onto a fresh branch from origin/develop.`);
}
if (requireCurrentDevelop && head !== undefined && originDevelop !== undefined
    && !isAncestor(originDevelop, head)) {
  failures.push('HEAD does not contain the current origin/develop. Refresh before creating a new development lane.');
}

const result = {
  schemaVersion: 1,
  ok: failures.length === 0,
  authorityAnchor,
  expectedRepository,
  root,
  commonDirectory,
  branch,
  head,
  originDevelop,
  requireCurrentDevelop,
  failures,
};

if (asJson) process.stdout.write(`${JSON.stringify(result)}\n`);
else {
  process.stdout.write([
    `Forge repository authority: ${result.ok ? 'PASS' : 'FAIL'}`,
    `  root=${root ?? 'unavailable'}`,
    `  branch=${branch ?? 'unavailable'}`,
    `  head=${head ?? 'unavailable'}`,
    `  origin/develop=${originDevelop ?? 'unavailable'}`,
    ...failures.map((failure) => `  error=${failure}`),
    '',
  ].join('\n'));
}

if (!result.ok) process.exitCode = 1;
