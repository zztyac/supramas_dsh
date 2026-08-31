/** Managed-subprocess pypdf provider for isolated page-aware text extraction. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  LiteratureError,
  type DocumentParserProvider,
  type DocumentParseRequest,
  type DocumentParseResult,
  type ParsedDocumentPage,
} from '@deepseek-ai/dsh-supramas-literature'
import type {} from '@deepseek-ai/dsh-supramas-literature'
import { dirname } from 'node:path'

const PROVIDER_ID = 'pypdf'
const TIMEOUT_CODE = 'SUPRAMAS_PYPDF_TIMEOUT'

const PYTHON_SCRIPT = String.raw`
import json, sys, traceback
sys.stdout.reconfigure(encoding="utf-8", errors="strict")
sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
path = sys.argv[1]
max_pages = int(sys.argv[2])
max_page_chars = int(sys.argv[3])
max_total_chars = int(sys.argv[4])
try:
    from pypdf import PdfReader
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(10)
try:
    reader = PdfReader(path, strict=False)
    if len(reader.pages) > max_pages:
        sys.exit(20)
    pages = []
    total = 0
    for index, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if len(text) > max_page_chars:
            sys.exit(21)
        total += len(text)
        if total > max_total_chars:
            sys.exit(22)
        pages.append({"pageNumber": index + 1, "text": text})
    sys.stdout.write(json.dumps({"pages": pages}, ensure_ascii=False))
except SystemExit:
    raise
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.exit(11)
`

/** Parser process policy. */
export interface Config {
  /** Harness-selected Python executable that provides the pypdf module. */
  readonly pythonExecutable?: string
  /** Maximum wall-clock milliseconds for one parse process. */
  readonly timeoutMs?: number
  /** Grace period before forced process-tree termination after cancellation. */
  readonly graceMs?: number
}

export const Config: z<Config> = z.object({
  pythonExecutable: z.string().default('python'),
  timeoutMs: z.number().default(60_000),
  graceMs: z.number().default(3_000),
})

interface ResolvedConfig {
  readonly pythonExecutable: string
  readonly timeoutMs: number
  readonly graceMs: number
}

function positiveTimer(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(`supramas-pdf-pypdf: ${field} must be a positive timer-safe number`)
  }
  return value
}

function resolvedConfig(config: Config): ResolvedConfig {
  const pythonExecutable = config.pythonExecutable?.trim() ?? 'python'
  if (pythonExecutable.length === 0) throw new Error('supramas-pdf-pypdf: pythonExecutable must be non-empty')
  return {
    pythonExecutable,
    timeoutMs: positiveTimer(config.timeoutMs ?? 60_000, 'timeoutMs'),
    graceMs: positiveTimer(config.graceMs ?? 3_000, 'graceMs'),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function parsedPayload(text: string): DocumentParseResult {
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch (error: unknown) {
    throw new LiteratureError('pypdf returned malformed JSON', 'SUPRAMAS_LITERATURE_PARSE_FAILED', { cause: error })
  }
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    throw new LiteratureError('pypdf returned an invalid page envelope', 'SUPRAMAS_LITERATURE_PARSE_FAILED')
  }
  const pages: ParsedDocumentPage[] = value.pages.map((entry: unknown, index: number) => {
    if (!isRecord(entry)) {
      throw new LiteratureError(`pypdf returned an invalid page at index ${index}`, 'SUPRAMAS_LITERATURE_PARSE_FAILED')
    }
    const pageNumber = entry.pageNumber
    const pageText = entry.text
    if (typeof pageNumber !== 'number' || !Number.isInteger(pageNumber) || typeof pageText !== 'string') {
      throw new LiteratureError(`pypdf returned an invalid page at index ${index}`, 'SUPRAMAS_LITERATURE_PARSE_FAILED')
    }
    return { pageNumber, text: pageText }
  })
  return { pages }
}

function exitError(exitCode: number | null, stderr: string): LiteratureError {
  if (exitCode === 20) return new LiteratureError('PDF exceeds the page limit', 'SUPRAMAS_LITERATURE_PAGE_LIMIT')
  if (exitCode === 21 || exitCode === 22) return new LiteratureError('PDF exceeds extracted text limits', 'SUPRAMAS_LITERATURE_TEXT_LIMIT')
  const detail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 500)
  return new LiteratureError(
    `pypdf process failed${exitCode === null ? '' : ` with exit ${exitCode}`}${detail.length === 0 ? '' : `: ${detail}`}`,
    'SUPRAMAS_LITERATURE_PARSE_FAILED',
  )
}

/** Isolated pypdf adapter backed only by the DSH managed subprocess seam. */
export class PyPdfDocumentParser implements DocumentParserProvider {
  readonly id = PROVIDER_ID
  private readonly config: ResolvedConfig

  constructor(private readonly subprocess: SubprocessRuntime, config: Config = {}) {
    this.config = resolvedConfig(config)
  }

  available(): boolean {
    return true
  }

  /**
   * Extract bounded page text through the managed isolated pypdf child process.
   * @param request - Canonical path and service-owned extraction limits.
   * @param upstream - Optional caller cancellation signal.
   * @returns validated page-aware text with no partial process output.
   */
  async parse(request: DocumentParseRequest, upstream?: AbortSignal): Promise<DocumentParseResult> {
    using d = deadline(upstream, this.config.timeoutMs, TIMEOUT_CODE)
    try {
      const executable = await this.subprocess.resolveExecutable(this.config.pythonExecutable, undefined, d.signal)
      const stdoutMaxBytes = Math.min(64 * 1024 * 1024, request.maxTotalChars * 4 + request.maxPages * 64 + 4_096)
      const spec: SubprocessSpawnSpec = {
        argv: [
          executable,
          '-I',
          '-c',
          PYTHON_SCRIPT,
          request.path,
          String(request.maxPages),
          String(request.maxPageChars),
          String(request.maxTotalChars),
        ],
        cwd: dirname(request.path),
        stdio: {
          stdin: 'ignore',
          stdout: { maxBytes: stdoutMaxBytes },
          stderr: { maxBytes: 64 * 1024 },
        },
        graceMs: this.config.graceMs,
        signal: d.signal,
        env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      }
      const running = this.subprocess.spawn(spec)
      const outcome = await running.done
      const stdout = running.collected.stdout?.readFrom(0)
      const stderr = running.collected.stderr?.readFrom(0)
      if (timeoutOf(d.signal, TIMEOUT_CODE) !== undefined) {
        throw new LiteratureError('pypdf extraction timed out', 'SUPRAMAS_LITERATURE_TIMEOUT')
      }
      if (d.signal.aborted) {
        throw new LiteratureError('pypdf extraction was aborted', 'SUPRAMAS_LITERATURE_ABORTED')
      }
      if (stdout === undefined || stderr === undefined) {
        throw new LiteratureError('pypdf process output was not collected', 'SUPRAMAS_LITERATURE_PARSE_FAILED')
      }
      if (stdout.lossy) {
        throw new LiteratureError('pypdf output exceeded its complete-output bound', 'SUPRAMAS_LITERATURE_TEXT_LIMIT')
      }
      if (outcome.exitCode !== 0) throw exitError(outcome.exitCode, stderr.text)
      return parsedPayload(stdout.text)
    } catch (error: unknown) {
      if (error instanceof LiteratureError) throw error
      if (timeoutOf(d.signal, TIMEOUT_CODE) !== undefined) {
        throw new LiteratureError('pypdf extraction timed out', 'SUPRAMAS_LITERATURE_TIMEOUT', { cause: error })
      }
      if (d.signal.aborted) {
        throw new LiteratureError('pypdf extraction was aborted', 'SUPRAMAS_LITERATURE_ABORTED', { cause: error })
      }
      throw new LiteratureError('pypdf process could not start', 'SUPRAMAS_LITERATURE_PARSE_FAILED', { cause: error })
    }
  }
}

export const name = 'supramas-pdf-pypdf'
export const inject = ['subprocess', 'supramasLiterature']

/** Register the managed pypdf parser. */
export function apply(ctx: Context, config: Config): void {
  ctx.supramasLiterature.registerParserProvider(new PyPdfDocumentParser(ctx.subprocess, config))
}
