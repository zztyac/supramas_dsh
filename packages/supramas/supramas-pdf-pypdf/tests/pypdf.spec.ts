import { describe, expect, it, vi } from 'vitest'
import type { SubprocessHandle, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { PyPdfDocumentParser } from '../src/index.ts'

function handle(stdout: string, exitCode = 0, stderr = '', lossy = false): SubprocessHandle {
  return {
    pid: 1,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: Buffer.byteLength(stdout), lossy }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: Buffer.byteLength(stderr), lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: vi.fn(),
    waitForExit: vi.fn(() => Promise.resolve(true)),
  }
}

function subprocess(next: SubprocessHandle): { runtime: SubprocessRuntime; spawn: ReturnType<typeof vi.fn> } {
  const spawn = vi.fn((_spec: SubprocessSpawnSpec) => next)
  return {
    runtime: {
      resolveExecutable: vi.fn(() => Promise.resolve('C:\\Python\\python.exe')),
      spawn,
    } as unknown as SubprocessRuntime,
    spawn,
  }
}

const request = {
  path: 'C:\\papers\\paper.pdf',
  maxPages: 20,
  maxPageChars: 1_000,
  maxTotalChars: 10_000,
}

describe('PyPdfDocumentParser', () => {
  it('uses an argv-only isolated managed process and parses its bounded page envelope', async () => {
    const fake = subprocess(handle(JSON.stringify({ pages: [{ pageNumber: 1, text: 'REBCO evidence' }] })))
    const result = await new PyPdfDocumentParser(fake.runtime, { pythonExecutable: 'python' }).parse(request)
    expect(result.pages).toEqual([{ pageNumber: 1, text: 'REBCO evidence' }])
    const spec = fake.spawn.mock.calls[0]![0] as SubprocessSpawnSpec
    expect(spec.argv.slice(0, 3)).toEqual(['C:\\Python\\python.exe', '-I', '-c'])
    expect(spec.argv).toContain(request.path)
    expect(spec.stdio.stdin).toBe('ignore')
    expect(spec.env).toEqual({ PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' })
  })

  it.each([
    [20, 'SUPRAMAS_LITERATURE_PAGE_LIMIT'],
    [21, 'SUPRAMAS_LITERATURE_TEXT_LIMIT'],
    [22, 'SUPRAMAS_LITERATURE_TEXT_LIMIT'],
    [11, 'SUPRAMAS_LITERATURE_PARSE_FAILED'],
  ])('maps parser exit %i to %s', async (exitCode, code) => {
    const fake = subprocess(handle('', exitCode, 'parser detail'))
    await expect(new PyPdfDocumentParser(fake.runtime).parse(request)).rejects.toMatchObject({ code })
  })

  it('rejects lossy or malformed output instead of accepting partial evidence', async () => {
    const lossy = subprocess(handle('{"pages":', 0, '', true))
    await expect(new PyPdfDocumentParser(lossy.runtime).parse(request))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_TEXT_LIMIT' })
    const malformed = subprocess(handle('{"pages":'))
    await expect(new PyPdfDocumentParser(malformed.runtime).parse(request))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PARSE_FAILED' })
  })

  it('rejects invalid timer and executable configuration before spawning', () => {
    const fake = subprocess(handle('{}'))
    expect(() => new PyPdfDocumentParser(fake.runtime, { timeoutMs: 0 })).toThrow('timeoutMs')
    expect(() => new PyPdfDocumentParser(fake.runtime, { pythonExecutable: '  ' })).toThrow('pythonExecutable')
  })
})
