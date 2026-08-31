import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { releaseInvocation } from './process.ts'

describe('releaseInvocation', () => {
  it('launches pnpm through its JavaScript CLI on Windows', () => {
    expect(releaseInvocation('pnpm', ['pack'], {
      env: {
        npm_execpath: 'C:\\pnpm\\pnpm.cjs',
        npm_node_execpath: 'C:\\node\\node.exe',
      },
    }, 'win32')).toEqual({
      command: 'C:\\node\\node.exe',
      args: ['C:\\pnpm\\pnpm.cjs', 'pack'],
    })
  })

  it('launches the npm JavaScript CLI found beside a Windows PATH entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-release-npm-'))
    try {
      const cli = join(root, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      mkdirSync(join(root, 'node_modules', 'npm', 'bin'), { recursive: true })
      writeFileSync(cli, '')
      expect(releaseInvocation('npm', ['install'], {
        env: { Path: root, npm_node_execpath: 'C:\\node\\node.exe' },
      }, 'win32')).toEqual({
        command: 'C:\\node\\node.exe',
        args: [cli, 'install'],
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves native executables and non-Windows commands unchanged', () => {
    expect(releaseInvocation('git', ['status'], {}, 'win32')).toEqual({
      command: 'git', args: ['status'],
    })
    expect(releaseInvocation('pnpm', ['pack'], {}, 'linux')).toEqual({
      command: 'pnpm', args: ['pack'],
    })
  })
})
