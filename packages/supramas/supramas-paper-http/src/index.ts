/** Safe bounded public HTTP(S) acquisition for resolved scholarly PDFs. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import {
  isSameOrigin,
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

/** Transport policy for open scholarly documents. */
export interface Config {
  /** Maximum wall-clock milliseconds for one complete acquisition. */
  readonly timeoutMs?: number
  /** Maximum same-origin redirects followed before rejecting the source. */
  readonly maxRedirects?: number
  /** Non-empty HTTP User-Agent sent to scholarly document hosts. */
  readonly userAgent?: string
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(30_000),
  maxRedirects: z.number().default(5),
  userAgent: z.string().default('supramas-dsh/0.1 (+https://github.com/zztyac/supramas_dsh)'),
})

interface ResolvedConfig {
  readonly timeoutMs: number
  readonly maxRedirects: number
  readonly userAgent: string
}

/** Resolve one URL hostname to a policy-approved, connection-pinned address set. */
export type PaperHttpResolver = (hostname: string, signal: AbortSignal) => Promise<PublicAddress[]>

function validateConfig(config: Config): ResolvedConfig {
  const timeoutMs = config.timeoutMs ?? 30_000
  const maxRedirects = config.maxRedirects ?? 5
  const userAgent = config.userAgent?.trim() ?? 'supramas-dsh/0.1 (+https://github.com/zztyac/supramas_dsh)'
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new Error('supramas-paper-http: timeoutMs must be a positive timer-safe number')
  }
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('supramas-paper-http: maxRedirects must be a non-negative integer')
  }
  if (userAgent.length === 0) throw new Error('supramas-paper-http: userAgent must be non-empty')
  return { timeoutMs, maxRedirects, userAgent }
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
      return await this.follow(request.url, request.maxBytes, d.signal)
    } catch (error: unknown) {
      throw translate(error, d.signal)
    }
  }

  private async follow(initial: string, maxBytes: number, signal: AbortSignal): Promise<PaperAcquisitionProviderResult> {
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
          if (!isSameOrigin(current, target)) {
            await response.body?.cancel()
            throw new LiteratureError('cross-origin paper redirect is blocked', 'SUPRAMAS_LITERATURE_REDIRECT_BLOCKED')
          }
          await response.body?.cancel()
          current = target
          redirects++
          continue
        }
        const mediaType = response.headers.get('content-type') ?? 'application/octet-stream'
        if (response.status < 200 || response.status >= 300) {
          await response.body?.cancel()
          return { url: current.toString(), statusCode: response.status, mediaType, bytes: new Uint8Array(0) }
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
