import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

import {
  SandboxManager,
  VENDORED_SRT_WIN_EXE,
  checkWindowsDependenciesAsync,
  getWindowsSandboxUserStatusAsync,
  getWindowsWfpStatusAsync,
  verifyWindowsWfpEgress,
} from '@anthropic-ai/sandbox-runtime'

const REQUIRED_PLAN_KEYS = [
  'schemaVersion',
  'providerId',
  'providerClass',
  'executable',
  'workingDirectory',
  'readableRoots',
  'deniedReadRoots',
  'deniedWriteRoots',
  'writableRoots',
  'protectedRelativePaths',
  'denyFilesystemOutsideRoots',
  'network',
  'credentials',
  'ownDescendantProcesses',
  'enforceResourceLimits',
  'timeoutMilliseconds',
  'maxOutputBytes',
  'requiredControls',
  'launchDigest',
  'planDigest',
]

const CASE_IDS = [
  'allowed_candidate_write',
  'workspace_outside_write_denied',
  'protected_path_write_denied',
  'sensitive_read_denied',
  'direct_network_denied',
  'credential_environment_scrubbed',
  'child_grandchild_contained',
  'timeout_contained',
  'cancellation_contained',
  'owner_death_contained',
  'residue_orphan_check',
  'shell_compatibility',
  'node_compatibility',
  'npm_compatibility',
  'git_compatibility',
  'cargo_compatibility',
  'rustc_compatibility',
]

function argValue(args, name) {
  const prefix = `${name}=`
  const item = args.find((value) => value.startsWith(prefix))
  return item?.slice(prefix.length)
}

function fail(message) {
  throw new Error(`sandbox-conformance: ${message}`)
}

function windowsLaunchPath(path) {
  if (path.startsWith('\\\\?\\UNC\\')) {
    fail(`UNC working directories are unsupported by the bounded Windows adapter: ${path}`)
  }
  return path.startsWith('\\\\?\\') ? path.slice(4) : path
}

function addPublishedSrtEnvironment(argv, environment) {
  if (environment.length === 0) return argv
  const separator = argv.indexOf('--')
  if (separator < 0) fail('published srt-win argv did not contain an option terminator')
  const overlay = []
  for (const [name, value] of environment) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || value.includes('\0')) {
      fail(`invalid Rust-bound explicit environment entry ${name}`)
    }
    overlay.push('--env', `${name}=${value}`)
  }
  return [...argv.slice(0, separator), ...overlay, ...argv.slice(separator)]
}

function validatePlan(plan, caseId) {
  if (!plan || typeof plan !== 'object') fail(`${caseId}: missing effectiveSandboxPlan`)
  for (const key of REQUIRED_PLAN_KEYS) {
    if (!(key in plan)) fail(`${caseId}: plan is missing ${key}`)
  }
  if (plan.schemaVersion !== 4) fail(`${caseId}: unsupported plan schema ${plan.schemaVersion}`)
  if (plan.providerClass !== 'external_attested' && plan.providerClass !== 'native_strong') {
    fail(`${caseId}: provider class is not an enforcing class`)
  }
  if (plan.network !== 'deny_direct') fail(`${caseId}: network is not deny_direct`)
  if (plan.credentials !== 'deny_ambient') fail(`${caseId}: credentials are not deny_ambient`)
  if (plan.denyFilesystemOutsideRoots !== true) fail(`${caseId}: filesystem outside-root denial is absent`)
  if (plan.ownDescendantProcesses !== true) fail(`${caseId}: descendant ownership is absent`)
  if (plan.enforceResourceLimits || plan.requiredControls.includes('resources')) {
    fail(`${caseId}: SRT probe cannot represent Forge resource limits`)
  }
  if (!Array.isArray(plan.requiredControls) || plan.requiredControls.length === 0) {
    fail(`${caseId}: requiredControls is empty`)
  }
  if (!/^[0-9a-f]{64}$/.test(plan.planDigest) || !/^[0-9a-f]{64}$/.test(plan.launchDigest)) {
    fail(`${caseId}: plan/launch digest is not lowercase sha256`)
  }
}

function validateCase(record) {
  if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
    fail('every case must have a string id')
  }
  validatePlan(record.effectiveSandboxPlan, record.id)
  const plan = record.effectiveSandboxPlan
  if (record.executable !== plan.executable) fail(`${record.id}: executable differs from plan`)
  if (record.workingDirectory !== plan.workingDirectory) fail(`${record.id}: working directory differs from plan`)
  if (!Array.isArray(record.arguments)) fail(`${record.id}: arguments must be an array`)
  if (!Array.isArray(record.environment)) fail(`${record.id}: environment must be an array`)
  if (!Array.isArray(record.inheritedEnvironment)) fail(`${record.id}: inheritedEnvironment must be an array`)
  if (record.expected !== 'success' && record.expected !== 'denied' && record.expected !== 'terminated') {
    fail(`${record.id}: expected must be success, denied, or terminated`)
  }
}

function snapshotRecoveryResidue(root) {
  const recovery = `${root}\\.forge-sandbox-recovery`
  if (!existsSync(recovery)) return []
  return readdirSync(recovery).sort()
}

function snapshotAcls(paths) {
  return Object.fromEntries(paths.map((path) => {
    const result = spawnSync('icacls.exe', [path], { encoding: 'utf8', windowsHide: true })
    return [path.toLowerCase(), {
      status: result.status,
      stdout: result.stdout?.replaceAll('\r\n', '\n').trim(),
      stderr: result.stderr?.replaceAll('\r\n', '\n').trim(),
    }]
  }))
}

function snapshotSandboxProcesses() {
  const images = ['forge-sandbox-conformance.exe', 'srt-win.exe']
  return Object.fromEntries(images.map((name) => {
    const result = spawnSync('tasklist.exe', ['/fo', 'csv', '/nh', '/fi', `IMAGENAME eq ${name}`], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const rows = result.status === 0
      ? result.stdout.split(/\r?\n/).filter((line) => line.startsWith(`"${name}"`)).sort()
      : []
    return [name, { status: result.status, rows }]
  }))
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const started = performance.now()
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let timedOut = false
    let cancelled = false
    let ownerKilled = false
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve({
        ...result,
        launchMilliseconds: performance.now() - started,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        stdoutBytes,
        stderrBytes,
        ownerKilled,
      })
    }
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length
      if (Buffer.concat(stdout).length < 8192) stdout.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length
      if (Buffer.concat(stderr).length < 8192) stderr.push(chunk)
    })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, options.timeoutMilliseconds)
    const cancellationTimer = options.cancelAfterMilliseconds == null ? null : setTimeout(() => {
      cancelled = true
      child.kill()
    }, options.cancelAfterMilliseconds)
    const ownerTimer = options.killWhenExists == null ? null : setInterval(() => {
      if (existsSync(options.killWhenExists)) {
        ownerKilled = child.kill()
        clearInterval(ownerTimer)
      }
    }, 25)
    child.on('error', (error) => {
      clearTimeout(timer)
      if (cancellationTimer) clearTimeout(cancellationTimer)
      if (ownerTimer) clearInterval(ownerTimer)
      finish({ status: null, error: String(error), timedOut, cancelled })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (cancellationTimer) clearTimeout(cancellationTimer)
      if (ownerTimer) clearInterval(ownerTimer)
      finish({ status: code, signal, timedOut, cancelled })
    })
  })
}

async function createSrtAdapter(plan) {
  if (process.platform !== 'win32') {
    return { state: 'unsupported', limitations: ['The bounded SRT probe is Windows-only in this checkout.'] }
  }
  if (!plan.providerId.includes('anthropic') && !plan.providerId.includes('srt')) {
    return { state: 'rejected', limitations: ['Adapter refuses to execute a plan for another provider.'] }
  }
  const srtWin = { exe: VENDORED_SRT_WIN_EXE, prependArgs: [] }
  const diagnostics = {}
  for (const [name, operation] of [
    ['dependencies', () => checkWindowsDependenciesAsync({ srtWin })],
    ['user', () => getWindowsSandboxUserStatusAsync({ srtWin })],
    ['wfp', () => getWindowsWfpStatusAsync({ srtWin })],
    ['wfpVerification', () => verifyWindowsWfpEgress({ srtWin })],
  ]) {
    try {
      diagnostics[name] = await operation()
    } catch (error) {
      diagnostics[name] = { error: String(error), code: error?.code }
    }
  }
  const dependencyErrors = diagnostics.dependencies?.errors ?? []
  if (dependencyErrors.length > 0 || diagnostics.user?.provisioned !== true) {
    return {
      state: 'setup_required',
      diagnostics,
      limitations: [
        'The SRT Windows account/WFP setup is not ready; no installation or system mutation was attempted.',
      ],
    }
  }
  if (!Array.isArray(plan.protectedRelativePaths) || !Array.isArray(plan.writableRoots)) {
    return { state: 'ready', diagnostics }
  }
  return { state: 'ready', diagnostics }
}

function configForPlan(plan) {
  const protectedPaths = plan.protectedRelativePaths.map((relative) => join(plan.workingDirectory, relative))
  return {
    network: { allowedDomains: [], deniedDomains: [], allowLocalBinding: false },
    filesystem: {
      denyRead: [...plan.deniedReadRoots, ...protectedPaths],
      allowRead: plan.readableRoots,
      allowWrite: plan.writableRoots,
      denyWrite: [...plan.deniedWriteRoots, ...protectedPaths],
    },
    credentials: {
      envVars: ['FORGE_AMBIENT_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].map((name) => ({ name, mode: 'deny' })),
    },
    windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } },
  }
}

async function executeCase(adapter, record, fixtureRoot) {
  const plan = record.effectiveSandboxPlan
  const residuePaths = [...new Set([
    plan.workingDirectory,
    ...plan.readableRoots,
    ...plan.deniedReadRoots,
    ...plan.deniedWriteRoots,
    ...plan.writableRoots,
  ])]
  const beforeRecoveryResidue = snapshotRecoveryResidue(dirname(plan.workingDirectory))
  const beforeAcls = snapshotAcls(residuePaths)
  const beforeProcesses = snapshotSandboxProcesses()
  const setupStarted = performance.now()
  if (adapter.state !== 'ready') {
    return {
      id: record.id,
      state: adapter.state,
      expected: record.expected,
      passed: false,
      setupMilliseconds: performance.now() - setupStarted,
      launchMilliseconds: null,
      stdoutBytes: 0,
      stderrBytes: 0,
      recoveryResidueBefore: beforeRecoveryResidue,
      recoveryResidueAfter: beforeRecoveryResidue,
      diagnostics: adapter.diagnostics,
      limitations: adapter.limitations,
    }
  }
  const [arg0, arg1, arg2, commandText, ...extraArguments] = record.arguments
  if (arg0 !== '/d' || arg1 !== '/s' || arg2 !== '/c' || !commandText || extraArguments.length > 0) {
    fail(`${record.id}: SRT adapter requires the Rust plan to bind cmd.exe /d /s /c and one command string`)
  }
  let setupMilliseconds
  let resetMilliseconds
  let result
  try {
    await SandboxManager.initialize(configForPlan(plan))
    const launchDirectory = windowsLaunchPath(record.workingDirectory)
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      commandText,
      { exe: plan.executable, args: [arg0, arg1, arg2] },
      undefined,
      undefined,
      launchDirectory,
      { commandId: record.id, commandText: commandText },
    )
    setupMilliseconds = performance.now() - setupStarted
    const argv = addPublishedSrtEnvironment(wrapped.argv, record.environment)
    result = await runProcess(argv[0], argv.slice(1), {
      cwd: launchDirectory,
      env: {
        ...wrapped.env,
        FORGE_AMBIENT_SECRET: 'conformance-sentinel-not-a-real-secret',
      },
      timeoutMilliseconds: plan.timeoutMilliseconds,
      cancelAfterMilliseconds: record.cancelAfterMilliseconds,
      killWhenExists: record.id === 'owner_death_contained'
        ? join(launchDirectory, 'owner-ready.txt')
        : undefined,
    })
  } finally {
    const resetStarted = performance.now()
    await SandboxManager.reset()
    resetMilliseconds = performance.now() - resetStarted
  }
  if ([
    'child_grandchild_contained',
    'timeout_contained',
    'cancellation_contained',
    'owner_death_contained',
  ].includes(record.id)) {
    await new Promise((resolve) => setTimeout(resolve, 2500))
  }
  const afterRecoveryResidue = snapshotRecoveryResidue(dirname(plan.workingDirectory))
  const afterAcls = snapshotAcls(residuePaths)
  const afterProcesses = snapshotSandboxProcesses()
  const survivorMarker = join(plan.workingDirectory, {
    child_grandchild_contained: 'descendant-survivor.txt',
    timeout_contained: 'timeout-survivor.txt',
    cancellation_contained: 'cancellation-survivor.txt',
    owner_death_contained: 'owner-death-survivor.txt',
  }[record.id] ?? 'descendant-survivor.txt')
  const descendantClean = !existsSync(survivorMarker)
  const aclClean = JSON.stringify(beforeAcls) === JSON.stringify(afterAcls)
  const recoveryClean = JSON.stringify(beforeRecoveryResidue) === JSON.stringify(afterRecoveryResidue)
  const processClean = JSON.stringify(beforeProcesses) === JSON.stringify(afterProcesses)
  const expectedProcessOutcome = record.expected === 'success'
    ? result.status === 0 && !result.timedOut
    : record.expected === 'denied'
      ? result.status !== 0 && !result.timedOut
      : result.timedOut || result.status !== 0
  const artifactChecks = {
    allowedWriteCreated: existsSync(join(plan.workingDirectory, 'allowed.txt')),
    outsideWriteAbsent: !existsSync(join(fixtureRoot, 'outside', 'breach.txt')),
    protectedPathUnchanged: readFileSync(join(plan.workingDirectory, '.git', 'config'), 'utf8') === 'protected\n',
    sensitiveSentinelAbsent: !result.stdout.includes('FORGE_SENSITIVE_SENTINEL'),
  }
  const caseSpecificOutcome = {
    allowed_candidate_write: artifactChecks.allowedWriteCreated,
    workspace_outside_write_denied: artifactChecks.outsideWriteAbsent,
    protected_path_write_denied: artifactChecks.protectedPathUnchanged,
    sensitive_read_denied: artifactChecks.sensitiveSentinelAbsent,
    timeout_contained: result.timedOut && descendantClean,
    cancellation_contained: result.cancelled && descendantClean,
    owner_death_contained: result.ownerKilled && descendantClean,
    child_grandchild_contained: descendantClean,
  }[record.id] ?? true
  const passed = expectedProcessOutcome && caseSpecificOutcome
  return {
    id: record.id,
    state: 'executed',
    expected: record.expected,
    passed,
    setupMilliseconds,
    resetMilliseconds,
    launchMilliseconds: result.launchMilliseconds,
    status: result.status,
    signal: result.signal,
    timedOut: result.timedOut,
    cancelled: result.cancelled,
    ownerKilled: result.ownerKilled,
    stdoutBytes: result.stdoutBytes,
    stderrBytes: result.stderrBytes,
    recoveryResidueBefore: beforeRecoveryResidue,
    recoveryResidueAfter: afterRecoveryResidue,
    sandboxProcessesBefore: beforeProcesses,
    sandboxProcessesAfter: afterProcesses,
    aclClean,
    recoveryClean,
    processClean,
    descendantClean,
    artifactChecks,
    residueClean: aclClean && recoveryClean && processClean && descendantClean,
    stderr: result.stderr.slice(0, 512),
    error: result.error,
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log('Usage: node scripts/sandbox-conformance.mjs --plan-cases=<rust-json> [--provider=srt] [--output=<json>] [--status-only]')
    return
  }
  const provider = argValue(args, '--provider') ?? 'srt'
  const casesPath = argValue(args, '--plan-cases')
  const outputPath = argValue(args, '--output')
  if (!casesPath && !args.includes('--status-only')) fail('--plan-cases is required unless --status-only is used')
  const corpus = casesPath ? JSON.parse(await readFile(casesPath, 'utf8')) : { cases: [] }
  if (!Array.isArray(corpus.cases)) fail('--plan-cases must contain an object with a cases array')
  const cases = corpus.cases
  for (const record of cases) validateCase(record)
  const plan = cases[0]?.effectiveSandboxPlan ?? { providerId: provider }
  const adapter = provider === 'srt' ? await createSrtAdapter(plan) : { state: 'rejected', limitations: [`Unknown provider ${provider}.`] }
  const results = []
  if (!args.includes('--status-only')) {
    for (const record of cases) results.push(await executeCase(adapter, record, corpus.fixtureRoot))
  }
  const executed = results.filter((result) => result.state === 'executed')
  const postAdapter = !args.includes('--status-only') && adapter.state === 'ready'
    ? await createSrtAdapter(plan)
    : adapter
  const providerStateClean = JSON.stringify({
    dependencies: adapter.diagnostics?.dependencies,
    user: adapter.diagnostics?.user,
    wfpVerificationBlocked: Boolean(adapter.diagnostics?.wfpVerification?.stderr?.includes('BLOCKED')),
  }) === JSON.stringify({
    dependencies: postAdapter.diagnostics?.dependencies,
    user: postAdapter.diagnostics?.user,
    wfpVerificationBlocked: Boolean(postAdapter.diagnostics?.wfpVerification?.stderr?.includes('BLOCKED')),
  })
  const report = {
    harness: 'forge-sandbox-conformance-v1',
    provider,
    adapterState: adapter.state,
    caseCount: cases.length,
    requiredCaseIds: CASE_IDS,
    presentCaseIds: cases.map((record) => record.id),
    missingCaseIds: CASE_IDS.filter((id) => !cases.some((record) => record.id === id)),
    setupMilliseconds: executed.length ? executed.reduce((sum, result) => sum + result.setupMilliseconds, 0) / executed.length : null,
    resetMilliseconds: executed.length ? executed.reduce((sum, result) => sum + result.resetMilliseconds, 0) / executed.length : null,
    launchMilliseconds: executed.length ? executed.reduce((sum, result) => sum + result.launchMilliseconds, 0) / executed.length : null,
    bytes: executed.reduce((sum, result) => sum + result.stdoutBytes + result.stderrBytes, 0),
    tokens: null,
    retries: 0,
    correctiveTurns: 0,
    providerStateClean,
    allExecutedCasesPassed: executed.length === cases.length && executed.length > 0 && providerStateClean && executed.every((result) => result.passed && result.residueClean),
    diagnostics: adapter.diagnostics,
    postDiagnostics: postAdapter.diagnostics,
    limitations: adapter.limitations,
    results,
  }
  const encoded = `${JSON.stringify(report, null, 2)}\n`
  if (outputPath) await writeFile(outputPath, encoded, { encoding: 'utf8', flag: 'wx' })
  console.log(encoded.trimEnd())
}

main().catch((error) => {
  console.error(error.stack ?? String(error))
  process.exitCode = 1
})
