// Temporary managed-provider evaluation adapter. It uses only the package's
// published API and does not copy implementation source or own Forge policy.
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'

const mode = process.argv[2]
const packageRoot = process.argv[3] && resolve(process.argv[3])
const adapterEnvironmentNames = new Set([
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
])

function fail(message) {
  throw new Error(`sandbox-provider-srt: ${message}`)
}

function windowsComparisonPath(value) {
  const path = resolve(value)
  if (path.startsWith('\\\\?\\UNC\\')) return `\\\\${path.slice(8)}`
  return path.startsWith('\\\\?\\') ? path.slice(4) : path
}

function assertScrubbedAdapterEnvironment() {
  const unexpected = Object.keys(process.env)
    .filter((name) => !adapterEnvironmentNames.has(name.toUpperCase()))
  if (unexpected.length !== 0) {
    fail(`session environment contains unexpected names: ${unexpected.sort().join(', ')}`)
  }
}

function validatePreparedEnvironment(environment) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    fail('published wrapper environment is not an object')
  }
  const entries = Object.entries(environment)
  if (entries.length > 64) fail('published wrapper environment exceeds its bounded entry count')
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
        || typeof value !== 'string' || value.length > 32_767 || value.includes('\0')) {
      fail(`published wrapper environment entry is invalid: ${name}`)
    }
  }
  return environment
}

if (!['status', 'session'].includes(mode) || !packageRoot) {
  fail('usage: node sandbox-provider-srt.mjs <status|session> <package-root>')
}

const runtime = await import(pathToFileURL(join(packageRoot, 'dist', 'index.js')).href)

async function status() {
  const diagnostics = {}
  for (const [name, operation] of [
    ['dependencies', () => runtime.checkWindowsDependenciesAsync({ srtWin: { exe: runtime.VENDORED_SRT_WIN_EXE, prependArgs: [] } })],
    ['user', () => runtime.getWindowsSandboxUserStatusAsync({ srtWin: { exe: runtime.VENDORED_SRT_WIN_EXE, prependArgs: [] } })],
    ['wfp', () => runtime.getWindowsWfpStatusAsync({ srtWin: { exe: runtime.VENDORED_SRT_WIN_EXE, prependArgs: [] } })],
    ['wfpVerification', () => runtime.verifyWindowsWfpEgress({ srtWin: { exe: runtime.VENDORED_SRT_WIN_EXE, prependArgs: [] } })],
  ]) {
    try {
      diagnostics[name] = await operation()
    } catch (error) {
      diagnostics[name] = { error: String(error), code: error?.code }
    }
  }
  const dependencyErrors = diagnostics.dependencies?.errors ?? []
  const ready = dependencyErrors.length === 0
    && diagnostics.user?.provisioned === true
    && diagnostics.wfpVerification?.stderr?.includes('BLOCKED') === true
  return {
    type: 'status',
    protocolVersion: 1,
    state: ready ? 'ready' : 'setup_required',
    packageVersion: '0.0.71',
    vendoredExecutable: resolve(runtime.VENDORED_SRT_WIN_EXE),
    diagnostics,
  }
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || request.protocolVersion !== 1) fail('unsupported request')
  if (!request.plan || !request.process || typeof request.caseId !== 'string') fail('request fields are missing')
  const { plan, process } = request
  if (plan.schemaVersion !== 4 || plan.providerId !== 'forge.windows.managed.preview') fail('plan identity is unsupported')
  if (plan.providerClass !== 'native_strong') fail('plan class is not native_strong')
  if (!Array.isArray(plan.requiredControls)
      || !['filesystem', 'process', 'network', 'credentials', 'resources']
        .every((control) => plan.requiredControls.includes(control))) fail('all five controls are required')
  if (!plan.enforceResourceLimits || !Number.isInteger(plan.maxActiveProcesses)
      || !Number.isInteger(plan.maxProcessMemoryBytes)) fail('outer resource limits are missing')
  if (plan.network !== 'deny_direct' || plan.credentials !== 'deny_ambient'
      || !plan.denyFilesystemOutsideRoots || !plan.ownDescendantProcesses) fail('plan restrictions are incomplete')
  if (process.executable !== plan.executable) fail('process executable differs from its Rust plan')
  if (process.workingDirectory !== plan.workingDirectory) fail('process working directory differs from its Rust plan')
  if (process.timeoutMilliseconds !== plan.timeoutMilliseconds) fail('process timeout differs from its Rust plan')
  if (process.maxOutputBytes !== plan.maxOutputBytes) fail('process output limit differs from its Rust plan')
  for (const name of ['arguments', 'environment', 'inheritedEnvironment']) {
    if (!Array.isArray(process[name])) fail(`process ${name} is not an array`)
  }
  if (process.inheritedEnvironment.length !== 0) fail('managed restricted execution forbids inherited environment names')
  if (!/^[0-9a-f]{64}$/.test(plan.planDigest) || !/^[0-9a-f]{64}$/.test(plan.launchDigest)) fail('plan digests are invalid')
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
      envVars: ['FORGE_AMBIENT_SECRET', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']
        .map((name) => ({ name, mode: 'deny' })),
    },
    windows: { srtWin: { path: runtime.VENDORED_SRT_WIN_EXE } },
  }
}

function quoteWindowsArgument(value) {
  if (value.length > 0 && !/[\s"]/.test(value)) return value
  let rendered = '"'
  let backslashes = 0
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1
    } else if (character === '"') {
      rendered += '\\'.repeat(backslashes * 2 + 1) + '"'
      backslashes = 0
    } else {
      rendered += '\\'.repeat(backslashes) + character
      backslashes = 0
    }
  }
  return rendered + '\\'.repeat(backslashes * 2) + '"'
}

function invocationForProcess(processSpec) {
  const executableName = processSpec.executable.toLowerCase().split(/[\\/]/).at(-1)
  if (executableName?.endsWith('cmd.exe')
      && processSpec.arguments.length === 4
      && processSpec.arguments[0].toLowerCase() === '/d'
      && processSpec.arguments[1].toLowerCase() === '/s'
      && processSpec.arguments[2].toLowerCase() === '/c') {
    return {
      command: processSpec.arguments[3],
      shell: { exe: processSpec.executable, args: processSpec.arguments.slice(0, 3) },
    }
  }
  const lastArgument = processSpec.arguments.at(-1)
  if (lastArgument === undefined) fail('direct managed execution requires at least one argument')
  return {
    command: quoteWindowsArgument(lastArgument),
    shell: {
      exe: processSpec.executable,
      args: processSpec.arguments.slice(0, -1),
    },
  }
}

function addExplicitEnvironment(argv, environment) {
  if (environment.length === 0) return argv
  const separator = argv.indexOf('--')
  if (separator < 0) fail('published argv lacks its option terminator')
  const overlay = []
  for (const entry of environment) {
    if (!Array.isArray(entry) || entry.length !== 2
        || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[0]) || entry[1].includes('\0')) {
      fail('Rust-bound environment entry is invalid')
    }
    overlay.push('--env', `${entry[0]}=${entry[1]}`)
  }
  return [...argv.slice(0, separator), ...overlay, ...argv.slice(separator)]
}

async function readOneLine(iterator, label) {
  const next = await iterator.next()
  if (next.done) fail(`${label} frame is missing`)
  return JSON.parse(next.value)
}

async function session() {
  assertScrubbedAdapterEnvironment()
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  const request = await readOneLine(iterator, 'prepare')
  validateRequest(request)
  let initialized = false
  try {
    await runtime.SandboxManager.initialize(configForPlan(request.plan))
    initialized = true
    const invocation = invocationForProcess(request.process)
    const wrapped = await runtime.SandboxManager.wrapWithSandboxArgv(
      invocation.command,
      invocation.shell,
      undefined,
      undefined,
      request.plan.workingDirectory,
      { commandId: request.caseId, commandText: invocation.command },
    )
    const argv = addExplicitEnvironment(wrapped.argv, request.process.environment)
    const executable = windowsComparisonPath(argv[0])
    const packageBoundary = windowsComparisonPath(packageRoot)
    if (executable !== windowsComparisonPath(runtime.VENDORED_SRT_WIN_EXE)
        || !executable.toLowerCase().startsWith(packageBoundary.toLowerCase() + '\\')) {
      fail('published wrapper escaped the configured provider package')
    }
    const environment = validatePreparedEnvironment(wrapped.env)
    process.stdout.write(`${JSON.stringify({
      type: 'prepared',
      protocolVersion: 1,
      planDigest: request.plan.planDigest,
      executable,
      arguments: argv.slice(1),
      environment,
    })}\n`)
    const cleanup = await readOneLine(iterator, 'cleanup')
    if (cleanup?.type !== 'cleanup' || cleanup?.planDigest !== request.plan.planDigest) {
      fail('cleanup frame does not match the prepared plan')
    }
  } finally {
    if (initialized) await runtime.SandboxManager.reset()
  }
}

if (mode === 'status') {
  process.stdout.write(`${JSON.stringify(await status())}\n`)
} else {
  await session()
}
