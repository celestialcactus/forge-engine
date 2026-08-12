// Builds an immutable managed-Windows provider evaluation payload from an already
// installed published package tree. External packages remain separately attributed
// archives; no implementation source is copied into Forge-owned modules.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';

const EXPECTED_PACKAGES = [
  ['@anthropic-ai/sandbox-runtime', '0.0.71', 'Apache-2.0'],
  ['@pondwader/socks5-server', '1.0.10', 'MIT'],
  ['commander', '12.1.0', 'MIT'],
  ['node-forge', '1.4.0', '(BSD-3-Clause OR GPL-2.0)'],
  ['zod', '3.25.76', 'MIT'],
];
const MAX_FILES = 2_000;
const MAX_BYTES = 64 * 1024 * 1024;

function fail(message) {
  throw new Error(`stage-managed-provider-evaluation: ${message}`);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) fail(`unexpected argument ${String(argument)}`);
    const [name, inline] = argument.split('=', 2);
    const value = inline ?? argv[++index];
    if (!value || value.startsWith('--')) fail(`${name} requires a value`);
    if (values.has(name)) fail(`${name} was supplied more than once`);
    values.set(name, value);
  }
  for (const required of ['--package-root', '--adapter', '--output']) {
    if (!values.has(required)) fail(`${required} is required`);
  }
  return {
    packageRoot: resolve(values.get('--package-root')),
    adapter: resolve(values.get('--adapter')),
    output: resolve(values.get('--output')),
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function packageMetadata(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  } catch {
    fail(`cannot read package metadata at ${path}`);
  }
  return parsed;
}

function packageDirectory(nodeModulesRoot, name) {
  return join(nodeModulesRoot, ...name.split('/'));
}

function safePackageName(name) {
  return name.replace(/^@/u, '').replaceAll('/', '__');
}

function registryTarballUrl(name, version) {
  const leaf = name.split('/').at(-1);
  return `https://registry.npmjs.org/${name}/-/${leaf}-${version}.tgz`;
}

async function findLicenseFile(packageRoot) {
  const entries = await readdir(packageRoot, { withFileTypes: true });
  const match = entries
    .filter((entry) => entry.isFile() && /^(licen[cs]e|copying)(\.|$)/iu.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))[0];
  if (!match) fail(`package ${packageRoot} does not contain a top-level license file`);
  return join(packageRoot, match.name);
}

function runNpm(arguments_, cwd) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    windowsHide: true,
    env: {
      ...process.env,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_ignore_scripts: 'true',
      npm_config_update_notifier: 'false',
    },
  });
  if (result.error || result.status !== 0) {
    fail(`npm ${arguments_.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim()}`);
  }
  return result.stdout;
}

async function listFiles(root, current = root) {
  const output = [];
  for (const entry of (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) fail(`symbolic links are forbidden in an evaluation payload: ${path}`);
    if (entry.isDirectory()) output.push(...await listFiles(root, path));
    else if (entry.isFile()) output.push(path);
    else fail(`unsupported filesystem entry in evaluation payload: ${path}`);
  }
  return output;
}

const { packageRoot, adapter, output } = parseArguments(process.argv.slice(2));
if (await exists(output)) fail(`output already exists: ${output}`);
if (!(await stat(adapter)).isFile()) fail(`adapter is not a file: ${adapter}`);

const rootMetadata = await packageMetadata(packageRoot);
if (rootMetadata.name !== '@anthropic-ai/sandbox-runtime' || rootMetadata.version !== '0.0.71') {
  fail('package root must be the exact published @anthropic-ai/sandbox-runtime@0.0.71 tree');
}
const nodeModulesRoot = resolve(packageRoot, '..', '..');
const staging = `${output}.staging-${process.pid}-${Date.now()}`;
await mkdir(join(staging, 'packages'), { recursive: true });
await mkdir(join(staging, 'licenses'), { recursive: true });
await mkdir(join(staging, 'adapter'), { recursive: true });

try {
  const payloadDependencies = {};
  const packages = [];
  for (const [expectedName, expectedVersion, expectedLicense] of EXPECTED_PACKAGES) {
    const sourceRoot = packageDirectory(nodeModulesRoot, expectedName);
    const metadata = await packageMetadata(sourceRoot);
    if (metadata.name !== expectedName || metadata.version !== expectedVersion
      || metadata.license !== expectedLicense) {
      fail(`unexpected identity/license for ${expectedName}: ${metadata.version}/${metadata.license}`);
    }
    const packedOutput = runNpm([
      'pack', registryTarballUrl(expectedName, expectedVersion), '--offline', '--ignore-scripts', '--json',
      '--pack-destination', join(staging, 'packages'),
    ], staging);
    let packed;
    try {
      [packed] = JSON.parse(packedOutput);
    } catch {
      fail(`npm pack returned malformed JSON for ${expectedName}`);
    }
    if (!packed?.filename || packed.name !== expectedName || packed.version !== expectedVersion) {
      fail(`npm pack did not report the exact archive identity for ${expectedName}@${expectedVersion}`);
    }
    const archiveRelative = `packages/${packed.filename}`;
    const archivePath = join(staging, ...archiveRelative.split('/'));
    const licenseSource = await findLicenseFile(sourceRoot);
    const licenseRelative = `licenses/${safePackageName(expectedName)}-${expectedVersion}-${basename(licenseSource)}`;
    const licensePath = join(staging, ...licenseRelative.split('/'));
    await copyFile(licenseSource, licensePath);
    payloadDependencies[expectedName] = `file:${archiveRelative}`;
    packages.push({
      name: expectedName,
      version: expectedVersion,
      license: expectedLicense,
      publishedArchive: archiveRelative,
      publishedArchiveSha256: await sha256(archivePath),
      publishedArchiveBytes: (await stat(archivePath)).size,
      licenseFile: licenseRelative,
      licenseFileSha256: await sha256(licensePath),
    });
  }

  const adapterRelative = 'adapter/sandbox-provider-srt.mjs';
  const adapterTarget = join(staging, ...adapterRelative.split('/'));
  await copyFile(adapter, adapterTarget);
  const payloadPackage = {
    name: '@forge-engine-evaluation/managed-windows-provider-payload',
    version: '0.0.71-evaluation.1',
    private: true,
    description: 'Unpromoted Forge managed-Windows provider evaluation payload',
    license: 'UNLICENSED',
    forgeEvaluationModule: {
      schemaVersion: 1,
      status: 'evaluation_only',
      authority: 'rust_owned',
      externalSourceUse: 'published_packages_and_apis_only',
      verbatimImplementationSourceCopiedIntoForge: false,
    },
    dependencies: payloadDependencies,
  };
  await writeFile(join(staging, 'package.json'), `${JSON.stringify(payloadPackage, null, 2)}\n`, 'utf8');
  runNpm(['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit'], staging);

  const notices = [
    '# Third-party notices for the managed-Windows provider evaluation payload',
    '',
    'This unpromoted evaluation payload contains unmodified published npm archives.',
    'Forge-owned evaluation modules do not copy package implementation source.',
    'The corresponding license texts are preserved byte-for-byte under `licenses/`.',
    '',
    ...packages.flatMap((entry) => [
      `- ${entry.name}@${entry.version}: ${entry.license}; \`${entry.licenseFile}\``,
    ]),
    '',
  ];
  await writeFile(join(staging, 'THIRD_PARTY_NOTICES.md'), notices.join('\n'), 'utf8');
  await writeFile(join(staging, 'README.md'), [
    '# Managed-Windows provider evaluation payload',
    '',
    'This is an evaluation module input, not a Forge application dependency or production provider.',
    'It packages separately attributed published archives and an original Forge published-API adapter.',
    'It must be installed only inside the disposable evaluation lab with scripts disabled and offline mode enabled.',
    '',
  ].join('\n'), 'utf8');

  const filesBeforeManifest = await listFiles(staging);
  if (filesBeforeManifest.length > MAX_FILES) fail(`payload exceeds ${MAX_FILES} files`);
  const totalBytes = (await Promise.all(filesBeforeManifest.map(async (path) => (await stat(path)).size)))
    .reduce((sum, size) => sum + size, 0);
  if (totalBytes > MAX_BYTES) fail(`payload exceeds ${MAX_BYTES} bytes`);
  const files = [];
  for (const path of filesBeforeManifest) {
    files.push({
      path: relative(staging, path).replaceAll('\\', '/'),
      bytes: (await stat(path)).size,
      sha256: await sha256(path),
    });
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'forge.managed-windows-provider.evaluation-payload',
    status: 'evaluation_only',
    createdAtUtc: new Date().toISOString(),
    providerId: 'forge.windows.managed.preview',
    sourcePackage: '@anthropic-ai/sandbox-runtime',
    sourcePackageVersion: '0.0.71',
    architecturePatternEvaluated: 'dedicated identity + recoverable ACL + WFP + broker/runner under a Rust-owned Job',
    forgeAuthority: 'EffectiveSandboxPlan, selection, resources, lifecycle, evidence, and fail-closed readiness remain Rust-owned',
    implementationProvenance: 'published package archives/APIs plus original Forge adapter; no verbatim external implementation source copied into Forge modules',
    packages,
    adapter: {
      path: adapterRelative,
      sha256: await sha256(adapterTarget),
    },
    files,
  };
  const manifestPath = join(staging, 'evaluation-payload.manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await mkdir(dirname(output), { recursive: true });
  await rename(staging, output);
  process.stdout.write(`${JSON.stringify({
    output,
    manifest: join(output, 'evaluation-payload.manifest.json'),
    manifestSha256: await sha256(join(output, 'evaluation-payload.manifest.json')),
    packageCount: packages.length,
    fileCount: files.length + 1,
    bytes: totalBytes + (await stat(join(output, 'evaluation-payload.manifest.json'))).size,
  })}\n`);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}
