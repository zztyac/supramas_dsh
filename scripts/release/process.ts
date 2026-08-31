/**
 * Process helpers shared by the release scripts: the release steps drive `git`,
 * `pnpm`, `npm`, and `tar`, and each needs one of three failure behaviours.
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * One executable plus arguments safe for shell-free child_process launch.
 */
export interface ReleaseInvocation {
  readonly command: string
  readonly args: readonly string[]
}

/** Resolve the npm CLI installed beside one PATH entry. */
function windowsNpmCli(environment: NodeJS.ProcessEnv): string {
  const path = environment.Path ?? environment.PATH ?? ''
  for (const entry of path.split(delimiter)) {
    if (entry === '') continue
    const candidate = join(entry, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('release command npm requires an npm CLI reachable from PATH on Windows')
}

/**
 * Resolve Windows package-manager shims to their JavaScript CLIs under the
 * current Node executable. This avoids both `.cmd` spawn failures and a shell
 * command line assembled from release-graph arguments.
 * @param command - executable name supplied by a release step.
 * @param args - command arguments supplied by the release step.
 * @param options - environment used by the child.
 * @param platform - host platform, injectable for contract tests.
 * @returns a shell-free executable and argument vector.
 */
export function releaseInvocation(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
  platform: NodeJS.Platform = process.platform,
): ReleaseInvocation {
  if (platform !== 'win32') return { command, args }
  const environment = options.env ?? process.env
  const node = environment.npm_node_execpath ?? process.execPath
  if (command === 'pnpm') {
    const cli = environment.npm_execpath
    if (cli === undefined || !cli.toLowerCase().includes('pnpm')) {
      throw new Error('release command pnpm must be invoked through pnpm run on Windows')
    }
    return { command: node, args: [cli, ...args] }
  }
  if (command === 'npm') return { command: node, args: [windowsNpmCli(environment), ...args] }
  return { command, args }
}

/** Where and with what environment a release step runs a command. */
export interface RunOptions {
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
}

/** What a command produced, for a caller that decides what a failure means. */
export interface CommandResult {
  /** Exit status, or null when a signal ended the process. */
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Run a command and capture its output without judging the exit status.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The exit status and captured streams.
 */
export function attempt(command: string, args: readonly string[], options: RunOptions = {}): CommandResult {
  const invocation = releaseInvocation(command, args, options)
  const result = spawnSync(invocation.command, [...invocation.args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
  })
  if (result.error !== undefined) throw result.error
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run a command, then echo and return its captured output. Output is buffered
 * until exit and stdout precedes stderr.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The exit status and captured streams.
 */
export function attemptEchoed(command: string, args: readonly string[], options: RunOptions = {}): CommandResult {
  const invocation = releaseInvocation(command, args, options)
  const result = spawnSync(invocation.command, [...invocation.args], {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) throw result.error
  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

/**
 * Run a command, capture its standard output, and fail on a non-zero exit.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns The trimmed standard output.
 */
export function capture(command: string, args: readonly string[], options: RunOptions = {}): string {
  const result = attempt(command, args, options)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}:\n${result.stdout}\n${result.stderr}`)
  }
  return result.stdout.trim()
}

/**
 * Run a command with inherited streams without blocking the event loop, so a
 * caller can hold several commands in flight, and fail on a non-zero exit.
 * Concurrent children interleave their output at line granularity.
 * @param command - executable name.
 * @param args - command arguments.
 * @param options - working directory and environment.
 * @returns Resolves when the command exits with status zero.
 */
export function runConcurrent(command: string, args: readonly string[], options: RunOptions = {}): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    const invocation = releaseInvocation(command, args, options)
    const child = spawn(invocation.command, [...invocation.args], {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
    })
    child.once('error', rejectRun)
    child.once('close', (status, signal) => {
      if (status === 0) resolveRun()
      else rejectRun(new Error(`${command} ${args.join(' ')} exited with ${String(status ?? signal)}`))
    })
  })
}

/**
 * Return whether Node started the given module as the process entry point.
 * @param moduleUrl - the caller's `import.meta.url`.
 * @returns True when Node started this module.
 */
export function isEntry(moduleUrl: string): boolean {
  const invoked = process.argv[1]
  if (invoked === undefined) return false
  return realpathSync(invoked) === realpathSync(fileURLToPath(moduleUrl))
}
