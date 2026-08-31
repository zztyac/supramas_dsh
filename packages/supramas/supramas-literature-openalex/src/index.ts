/** Keyless OpenAlex structured-index provider for `ctx.supramasLiterature`. */

import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchResult } from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-web'
import {
  LiteratureError,
  type LiteratureIndexProvider,
  type LiteratureProviderCandidate,
  type LiteratureProviderSearchResult,
  type LiteratureSearchRequest,
  type ResolvedLiteratureProviderCandidate,
} from '@deepseek-ai/dsh-supramas-literature'
import type {} from '@deepseek-ai/dsh-supramas-literature'

/** Minimal bounded text response consumed from the DSH web seam. */
export interface OpenAlexFetchTextResult {
  readonly statusCode: number
  readonly content: string
  readonly truncated: boolean
}

/** Injectable text retrieval boundary used by focused provider tests. */
export type OpenAlexFetchText = (url: string, signal?: AbortSignal) => Promise<OpenAlexFetchTextResult>

const API_ROOT = 'https://api.openalex.org'
const PROVIDER_ID = 'openalex'
const WORK_ID = /^W\d+$/i
const SELECT = [
  'id',
  'doi',
  'display_name',
  'title',
  'authorships',
  'publication_year',
  'primary_location',
  'best_oa_location',
  'open_access',
  'abstract_inverted_index',
  'cited_by_count',
].join(',')

function providerError(message: string, cause?: unknown): LiteratureError {
  return new LiteratureError(
    `OpenAlex response is invalid: ${message}`,
    'SUPRAMAS_LITERATURE_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw providerError(`${field} must be an object`)
  return value as Record<string, unknown>
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  return value === null || value === undefined ? undefined : object(value, field)
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) throw providerError(`${field} must be a non-empty string`)
  return value.trim()
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === null || value === undefined) return undefined
  if (!Number.isInteger(value) || (value as number) < 0) throw providerError(`${field} must be a non-negative integer`)
  return value as number
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'boolean') throw providerError(`${field} must be a boolean`)
  return value
}

function externalId(value: unknown): string {
  const id = optionalString(value, 'work.id')
  if (id === undefined) throw providerError('work.id is required')
  const suffix = id.split('/').pop() ?? ''
  if (!WORK_ID.test(suffix)) throw providerError('work.id is not an OpenAlex work id')
  return suffix.toUpperCase()
}

function doi(value: unknown): string | undefined {
  const raw = optionalString(value, 'work.doi')
  if (raw === undefined) return undefined
  return raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
}

function authors(value: unknown): string[] {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) throw providerError('work.authorships must be an array')
  return value.flatMap((entry, index) => {
    const authorship = object(entry, `work.authorships[${index}]`)
    const author = optionalObject(authorship.author, `work.authorships[${index}].author`)
    const name = optionalString(author?.display_name, `work.authorships[${index}].author.display_name`)
    return name === undefined ? [] : [name]
  })
}

function reconstructAbstract(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  const index = object(value, 'work.abstract_inverted_index')
  const positioned: Array<{ position: number; word: string }> = []
  for (const [word, rawPositions] of Object.entries(index)) {
    if (!Array.isArray(rawPositions)) throw providerError('abstract positions must be arrays')
    for (const rawPosition of rawPositions) {
      if (!Number.isInteger(rawPosition) || (rawPosition as number) < 0) throw providerError('abstract positions must be non-negative integers')
      positioned.push({ position: rawPosition as number, word })
    }
  }
  positioned.sort((left, right) => left.position - right.position)
  return positioned.length === 0 ? undefined : positioned.map(entry => entry.word).join(' ')
}

function mapWork(value: unknown): { candidate: LiteratureProviderCandidate; resolved: ResolvedLiteratureProviderCandidate } {
  const work = object(value, 'work')
  const title = optionalString(work.display_name ?? work.title, 'work.title')
  if (title === undefined) throw providerError('work.title is required')
  const primaryLocation = optionalObject(work.primary_location, 'work.primary_location')
  const source = optionalObject(primaryLocation?.source, 'work.primary_location.source')
  const best = optionalObject(work.best_oa_location, 'work.best_oa_location')
  const oa = optionalObject(work.open_access, 'work.open_access')
  const isOa = optionalBoolean(oa?.is_oa, 'work.open_access.is_oa')
  const pdfUrl = optionalString(best?.pdf_url, 'work.best_oa_location.pdf_url')
  const landingUrl = optionalString(best?.landing_page_url ?? oa?.oa_url, 'work.best_oa_location.landing_page_url')
  const publicationYear = optionalInteger(work.publication_year, 'work.publication_year')
  const normalizedDoi = doi(work.doi)
  const venue = optionalString(source?.display_name, 'work.primary_location.source.display_name')
  const abstract = reconstructAbstract(work.abstract_inverted_index)
  const citedByCount = optionalInteger(work.cited_by_count, 'work.cited_by_count')
  const license = optionalString(best?.license, 'work.best_oa_location.license')
  const candidate: LiteratureProviderCandidate = {
    externalId: externalId(work.id),
    title,
    authors: authors(work.authorships),
    ...(publicationYear === undefined ? {} : { year: publicationYear }),
    ...(normalizedDoi === undefined ? {} : { doi: normalizedDoi }),
    ...(venue === undefined ? {} : { venue }),
    ...(abstract === undefined ? {} : { abstract }),
    ...(citedByCount === undefined ? {} : { citedByCount }),
    ...(isOa === undefined ? {} : { openAccess: isOa }),
    ...(landingUrl === undefined ? {} : { landingUrl }),
  }
  return {
    candidate,
    resolved: {
      ...candidate,
      ...(pdfUrl === undefined || isOa === false ? {} : { documentUrl: pdfUrl, documentMediaType: 'application/pdf' }),
      ...(license === undefined ? {} : { license }),
    },
  }
}

function parseJson(response: OpenAlexFetchTextResult): unknown {
  if (response.statusCode === 429) {
    throw new LiteratureError('OpenAlex rate limit exceeded', 'SUPRAMAS_LITERATURE_RATE_LIMITED')
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new LiteratureError(`OpenAlex returned HTTP ${response.statusCode}`, 'SUPRAMAS_LITERATURE_PROVIDER_ERROR')
  }
  if (response.truncated) throw providerError('response was truncated')
  try {
    return JSON.parse(response.content) as unknown
  } catch (error: unknown) {
    throw providerError('body is not valid JSON', error)
  }
}

/** Structured OpenAlex works search and resolution adapter. */
export class OpenAlexIndexProvider implements LiteratureIndexProvider {
  readonly id = PROVIDER_ID

  constructor(private readonly fetchText: OpenAlexFetchText) {}

  available(): boolean {
    return true
  }

  /**
   * Search the bounded OpenAlex Works projection.
   * @param request - Normalized search query and result limit.
   * @param signal - Optional cancellation signal for the HTTP request.
   * @returns sparse-safe provider candidates and truncation state.
   */
  async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureProviderSearchResult> {
    const url = new URL('/works', API_ROOT)
    url.searchParams.set('search', request.query)
    url.searchParams.set('per_page', String(request.maxResults))
    url.searchParams.set('select', SELECT)
    const payload = object(parseJson(await this.fetchText(url.toString(), signal)), 'response')
    if (!Array.isArray(payload.results)) throw providerError('response.results must be an array')
    const candidates = payload.results.map(result => mapWork(result).candidate)
    const meta = optionalObject(payload.meta, 'response.meta')
    const count = optionalInteger(meta?.count, 'response.meta.count')
    return { candidates, truncated: count !== undefined && count > candidates.length }
  }

  /**
   * Resolve one OpenAlex work for internal acquisition metadata.
   * @param workId - W-prefixed OpenAlex work identity from an opaque candidate id.
   * @param signal - Optional cancellation signal for the HTTP request.
   * @returns the validated candidate and best reported open PDF location, when present.
   */
  async resolve(workId: string, signal?: AbortSignal): Promise<ResolvedLiteratureProviderCandidate> {
    if (!WORK_ID.test(workId)) {
      throw new LiteratureError('OpenAlex candidate id must be a W-prefixed work id', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    const url = new URL(`/works/${workId.toUpperCase()}`, API_ROOT)
    url.searchParams.set('select', SELECT)
    return mapWork(parseJson(await this.fetchText(url.toString(), signal))).resolved
  }
}

/** Cordis function plugin name. */
export const name = 'supramas-literature-openalex'
/** Required service seams. */
export const inject = ['web', 'supramasLiterature']

function fromWeb(result: WebFetchResult): OpenAlexFetchTextResult {
  if (result.body.kind !== 'text') {
    throw new LiteratureError('OpenAlex returned a non-text response', 'SUPRAMAS_LITERATURE_PROVIDER_ERROR')
  }
  return { statusCode: result.statusCode, content: result.body.content, truncated: result.truncated }
}

/** Register the keyless OpenAlex provider through the shared safe text-fetch seam. */
export function apply(ctx: Context): void {
  ctx.supramasLiterature.registerIndexProvider(new OpenAlexIndexProvider(async (url, signal) =>
    fromWeb(await ctx.web.fetch({ url }, signal))))
}
