/** Safe bounded public HTTP(S) acquisition for resolved scholarly PDFs. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  publicHttpNetwork,
  validateFetchUrl,
  type PinnedResponse,
  type PublicAddress,
} from '@deepseek-ai/dsh-web-fetch-http'
import {
  LiteratureError,
  type PaperAcquisitionProvider,
  type PaperAcquisitionProviderResult,
  type PaperAcquisitionRequest,
} from '@deepseek-ai/dsh-supramas-literature'
import type {} from '@deepseek-ai/dsh-supramas-literature'

const TIMEOUT_CODE = 'SUPRAMAS_PAPER_HTTP_TIMEOUT'
const PROVIDER_ID = 'http'
const DEFAULT_USER_AGENT
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([403, 408, 429, 500, 502, 503, 504])

/** Transport policy for open scholarly documents. */
export interface Config {
  /** Maximum wall-clock milliseconds for one complete acquisition. */
  readonly timeoutMs?: number
  /** Maximum independently validated public redirects followed before rejecting the source. */
  readonly maxRedirects?: number
  /** Non-empty HTTP User-Agent sent to scholarly document hosts. */
  readonly userAgent?: string
  /** Extra same-URL attempts after a retryable HTTP status (403/408/429/5xx), bounded by the acquisition deadline. */
  readonly retries?: number
  /** Base backoff milliseconds doubled after every failed same-URL retry without a Retry-After header. */
  readonly retryDelayMs?: number
  /** Upper bound applied to every same-URL retry wait, including parsed Retry-After values. */
  readonly maxRetryDelayMs?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  retries: z.number().default(2),
  retryDelayMs: z.number().default(500),
  maxRetryDelayMs: z.number().default(10_000),
})

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly maxRedirects: number
  readonly userAgent: string
  readonly retries: number
  readonly retryDelayMs: number
  readonly maxRetryDelayMs: number
}

/** Internal follow outcome; carries the bounded Retry-After hint used by the retry loop. */
interface FollowOutcome {
  readonly url: string
  readonly statusCode: number
  readonly mediaType: string
  readonly bytes: Uint8Array
  readonly retryAfterMs?: number
}

/** Resolve one URL hostname to a policy-approved, connection-pinned address set. */
export type PaperHttpResolver = (hostname: string, signal: AbortSignal) => Promise<PublicAddress[]>

function validateConfig(config: Config): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? 30_000
  const maxRedirects = config.maxRedirects ?? 5
  const userAgent = config.userAgent?.trim() || DEFAULT_USER_AGENT
  const retries = config.retries ?? 2
  const retryDelayMs = config.retryDelayMs ?? 500
  const maxRetryDelayMs = config.maxRetryDelayMs ?? 10_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('supramas-paper-http: timeoutMs must be a positive timer-safe number')
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('supramas-paper-http: maxRedirects must be a non-negative integer')
  }
  if (userAgent.length === 0) throw new Error('supramas-paper-http: userAgent must be non-empty')
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    throw new Error('supramas-paper-http: retries must be an integer between 0 and 10')
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs <= 0 || retryDelayMs > 2_147_483_647) {
    throw new Error('supramas-paper-http: retryDelayMs must be a positive timer-safe number')
  }
  if (!Number.isFinite(maxRetryDelayMs) || maxRetryDelayMs <= 0 || maxRetryDelayMs > 2_147_483_647) {
    throw new Error('supramas-paper-http: maxRetryDelayMs must be a positive timer-safe number')
  }
  return { timeoutMs, maxRedirects, userAgent, retries, retryDelayMs, maxRetryDelayMs }
}

function errorCode(error: unknown): string | undefined {
  if (error === null || typeof error !== 'object' || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

function translate(error: unknown, signal: AbortSignal): LiteratureError {
  if (error instanceof LiteratureError) return error
  if (timeoutOf(signal, TIMEOUT_CODE) !== undefined) {
    return new LiteratureError('paper acquisition timed out', 'SUPRAMAS_LITERATURE_TIMEOUT', { cause: error })
  }
  if (signal.aborted) {
    return new LiteratureError('paper acquisition was aborted', 'SUPRAMAS_LITERATURE_ABORTED', { cause: error })
  }
  const code = errorCode(error)
  if (code === 'WEB_BLOCKED_URL' || code === 'WEB_INVALID_URL') {
    return new LiteratureError('paper source URL is blocked by public-network policy', 'SUPRAMAS_LITERATURE_SOURCE_BLOCKED', { cause: error })
  }
  if (code === 'WEB_REDIRECT_BLOCKED') {
    return new LiteratureError('paper source redirect is blocked', 'SUPRAMAS_LITERATURE_REDIRECT_BLOCKED', { cause: error })
  }
  return new LiteratureError('paper source transport failed', 'SUPRAMAS_LITERATURE_PROVIDER_ERROR', { cause: error })
}

function redirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

/** Transient HTTP statuses worth one more bounded same-URL attempt. */
function retryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status)
}

/** Parse one Retry-After header (delta-seconds or HTTP-date) into a bounded millisecond wait. */
function retryAfter(header: string | null, maxMs: number): { retryAfterMs: number } | {} {
  if (header === null) return {}
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Math.min(Number(trimmed), Math.ceil(maxMs / 1000))
    return { retryAfterMs: seconds * 1000 }
  }
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return {}
  return { retryAfterMs: Math.max(0, Math.min(date - Date.now(), maxMs)) }
}

/** Abortable bounded sleep used between same-URL retries. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new LiteratureError('paper acquisition was aborted', 'SUPRAMAS_LITERATURE_ABORTED'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Anonymous PDF transport that returns complete bytes or no bytes at all. */
export class HttpPaperAcquisitionProvider implements PaperAcquisitionProvider {
  readonly id = PROVIDER_ID
  private readonly config: ResolvedConfig

  constructor(config: Config = {}, private readonly resolveAddresses: PaperHttpResolver = publicHttpNetwork.resolve) {
    this.config = validateConfig(config)
  }

  available(): boolean {
    return true
  }

  /**
   * Acquire one already-resolved public PDF URL under the configured transport policy.
   * Retryable HTTP statuses (403/408/429/5xx) are retried on the same URL with bounded
   * backoff honoring Retry-After; transport errors and other statuses fail without retry.
   * @param request - Resolved URL and exact complete-byte limit.
   * @param upstream - Optional caller cancellation signal.
   * @returns one complete bounded response; partial bytes are never returned.
   */
  async acquire(request: PaperAcquisitionRequest, upstream?: AbortSignal): Promise<PaperAcquisitionProviderResult> {
    if (!Number.isInteger(request.maxBytes) || request.maxBytes <= 0) {
      throw new LiteratureError('paper maxBytes must be a positive integer', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    if (upstream?.aborted) {
      throw new LiteratureError('paper acquisition was aborted', 'SUPRAMAS_LITERATURE_ABORTED')
    }
    using d = deadline(upstream, this.config.timeoutMs, TIMEOUT_CODE)
    try {
      let last: FollowOutcome | undefined
      for (let attempt = 0; attempt <= this.config.retries; attempt++) {
        if (attempt > 0) {
          await delay(this.retryDelayMs(attempt, last?.retryAfterMs), d.signal)
        }
        last = await this.follow(request.url, request.maxBytes, d.signal)
        if (last.statusCode >= 200 && last.statusCode < 300) break
        if (!retryableStatus(last.statusCode)) break
      }
      if (last === undefined) {
        throw new LiteratureError('paper acquisition produced no response', 'SUPRAMAS_LITERATURE_PROVIDER_ERROR')
      }
      return {
        url: last.url,
        statusCode: last.statusCode,
        mediaType: last.mediaType,
        bytes: last.bytes,
      }
    } catch (error: unknown) {
      throw translate(error, d.signal)
    }
  }

  /** Bounded same-URL wait for one retry: Retry-After when present, otherwise exponential backoff. */
  private retryDelayMs(attempt: number, retryAfterMs: number | undefined): number {
    const bounded = (value: number): number => Math.max(0, Math.min(value, this.config.maxRetryDelayMs))
    if (retryAfterMs !== undefined) return bounded(retryAfterMs)
    return bounded(this.config.retryDelayMs * 2 ** (attempt - 1))
  }

  private async follow(initial: string, maxBytes: number, signal: AbortSignal): Promise<FollowOutcome> {
    let current = validateFetchUrl(initial)
    let redirects = 0
    for (;;) {
      const request = await this.request(current, signal)
      try {
        const response = request.response
        if (redirectStatus(response.status)) {
          if (redirects >= this.config.maxRedirects) {
            await response.body?.cancel()
            throw new LiteratureError('paper source exceeded the redirect limit', 'SUPRAMAS_LITERATURE_REDIRECT_BLOCKED')
          }
          const location = response.headers.get('location')
          if (location === null) {
            await response.body?.cancel()
            throw new LiteratureError('paper redirect has no Location header', 'SUPRAMAS_LITERATURE_REDIRECT_BLOCKED')
          }
          const target = validateFetchUrl(new URL(location, current).toString())
          await response.body?.cancel()
          current = target
          redirects++
          continue
        }
        const mediaType = response.headers.get('content-type') ?? 'application/octet-stream'
        if (response.status < 200 || response.status >= 300) {
          await response.body?.cancel()
          return {
            url: current.toString(),
            statusCode: response.status,
            mediaType,
            bytes: new Uint8Array(0),
            ...retryAfter(response.headers.get('retry-after'), this.config.maxRetryDelayMs),
          }
        }
        const bytes = await this.readComplete(request, maxBytes)
        return { url: current.toString(), statusCode: response.status, mediaType, bytes }
      } finally {
        await request.close()
      }
    }
  }

  private async request(url: URL, signal: AbortSignal): Promise<PinnedResponse> {
    const addresses = await this.resolveAddresses(url.hostname, signal)
    return publicHttpNetwork.request(url, addresses, {
      'user-agent': this.config.userAgent,
      'accept': 'application/pdf',
    }, signal)
  }

  private async readComplete(request: PinnedResponse, maxBytes: number): Promise<Uint8Array> {
    const response = request.response
    const declared = response.headers.get('content-length')
    if (declared !== null) {
      const length = Number(declared)
      if (Number.isFinite(length) && length > maxBytes) {
        await response.body?.cancel()
        throw new LiteratureError(`paper source exceeds ${maxBytes} bytes`, 'SUPRAMAS_LITERATURE_TOO_LARGE')
      }
    }
    if (response.body === null) return new Uint8Array(0)
    const chunks: Uint8Array[] = []
    let total = 0
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        if (total + next.value.byteLength > maxBytes) {
          throw new LiteratureError(`paper source exceeds ${maxBytes} bytes`, 'SUPRAMAS_LITERATURE_TOO_LARGE')
        }
        chunks.push(next.value)
        total += next.value.byteLength
      }
    } finally {
      await reader.cancel().catch(() => {})
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
}

/** Cordis plugin name. */
export const name = 'supramas-paper-http'
/** Required capability seam. */
export const inject = ['supramasLiterature']

/** Register one safe public HTTP acquisition provider. */
export function apply(ctx: Context, config: Config): void {
  ctx.supramasLiterature.registerAcquisitionProvider(new HttpPaperAcquisitionProvider(config))
}
