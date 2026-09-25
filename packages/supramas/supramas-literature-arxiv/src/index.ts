/** Keyless arXiv Atom structured-index provider for `ctx.supramasLiterature`. */

import type { Context } from '@deepseek-ai/cordis'
import { XMLParser } from 'fast-xml-parser'
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
export interface ArxivFetchTextResult {
  readonly statusCode: number
  readonly content: string
  readonly truncated: boolean
}

/** Injectable text retrieval boundary used by focused provider tests. */
export type ArxivFetchText = (url: string, signal?: AbortSignal) => Promise<ArxivFetchTextResult>

const API_ROOT = 'https://export.arxiv.org'
const PROVIDER_ID = 'arxiv'
const ARXIV_ID = /^(?:[a-z-]+(?:\.[a-z-]+)?\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?$/i
const MAX_DOCUMENT_URLS = 2

const xmlParser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
})

function providerError(message: string, cause?: unknown): LiteratureError {
  return new LiteratureError(
    `arXiv response is invalid: ${message}`,
    'SUPRAMAS_LITERATURE_PROVIDER_ERROR',
    cause === undefined ? undefined : { cause },
  )
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw providerError(`${field} must be an object`)
  return value as Record<string, unknown>
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) throw providerError(`${field} must be a non-empty string`)
  return value.trim()
}

/** Collapse arXiv multiline titles and summaries onto single normalized lines. */
function collapsed(value: string | undefined): string | undefined {
  return value === undefined ? undefined : value.replace(/\s+/g, ' ').trim()
}

/** Normalize one repeated Atom element that appears as a single object or an array. */
function elementList(value: unknown, field: string): Record<string, unknown>[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return value.map((entry, index) => object(entry, `${field}[${index}]`))
  return [object(value, field)]
}

function arxivExternalId(value: unknown, field: string): string {
  const absUrl = optionalString(value, field)
  if (absUrl === undefined) throw providerError(`${field} is required`)
  const externalId = absUrl.replace(/^https?:\/\/arxiv\.org\/abs\//i, '').replace(/\/+$/, '')
  if (externalId.length === 0 || !ARXIV_ID.test(externalId)) throw providerError(`${field} is not an arXiv article id`)
  return externalId
}

function publishedYear(value: unknown, field: string): number | undefined {
  const published = optionalString(value, field)
  if (published === undefined) return undefined
  const match = published.match(/^(\d{4})-/)
  const year = match?.[1]
  return year === undefined ? undefined : Number(year)
}

function pdfLinkHref(links: readonly Record<string, unknown>[]): string | undefined {
  for (const link of links) {
    if (link.type === 'application/pdf' && typeof link.href === 'string' && link.href.trim().length > 0) {
      return link.href.trim()
    }
  }
  return undefined
}

function documentUrlsFor(externalId: string, links: readonly Record<string, unknown>[]): string[] {
  const urls: string[] = []
  const push = (url: string | undefined): void => {
    if (url === undefined) return
    const comparable = url.replace(/^https?:\/\//i, '').toLowerCase()
    if (urls.some(existing => existing.replace(/^https?:\/\//i, '').toLowerCase() === comparable)) return
    if (urls.length >= MAX_DOCUMENT_URLS) return
    urls.push(url)
  }
  push(pdfLinkHref(links))
  push(`https://arxiv.org/pdf/${externalId}`)
  push(`https://arxiv.org/pdf/${externalId.replace(/v\d+$/i, '')}`)
  return urls
}

function mapEntry(value: unknown): { candidate: LiteratureProviderCandidate; resolved: ResolvedLiteratureProviderCandidate } {
  const entry = object(value, 'feed.entry')
  const externalId = arxivExternalId(entry.id, 'entry.id')
  const title = collapsed(optionalString(entry.title, 'entry.title'))
  if (title === undefined || title.length === 0) throw providerError('entry.title is required')
  const abstract = collapsed(optionalString(entry.summary, 'entry.summary'))
  const authors = elementList(entry.author, 'entry.author')
    .map(author => optionalString(author.name, 'entry.author.name'))
    .flatMap(name => name === undefined ? [] : [name])
  const year = publishedYear(entry.published, 'entry.published')
  // An empty <arxiv:doi/> tag means "no DOI"; only a present non-empty string is used.
  const doiRaw = entry.doi
  const doi = typeof doiRaw === 'string' && doiRaw.trim().length > 0
    ? doiRaw.trim().replace(/^info:doi\//i, '')
    : undefined
  const links = elementList(entry.link, 'entry.link')
  const urls = documentUrlsFor(externalId, links)
  const primary = urls[0]
  if (primary === undefined) throw providerError(`entry ${externalId} exposes no PDF location`)
  const candidate: LiteratureProviderCandidate = {
    externalId,
    title,
    authors,
    ...(year === undefined ? {} : { year }),
    ...(doi === undefined || doi.length === 0 ? {} : { doi }),
    venue: 'arXiv',
    ...(abstract === undefined || abstract.length === 0 ? {} : { abstract }),
    openAccess: true,
    landingUrl: `https://arxiv.org/abs/${externalId}`,
  }
  return {
    candidate,
    resolved: {
      ...candidate,
      documentUrl: primary,
      documentUrls: urls,
      documentMediaType: 'application/pdf',
    },
  }
}

function parseXml(response: ArxivFetchTextResult): unknown {
  if (response.statusCode === 429) {
    throw new LiteratureError('arXiv rate limit exceeded', 'SUPRAMAS_LITERATURE_RATE_LIMITED')
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new LiteratureError(`arXiv returned HTTP ${response.statusCode}`, 'SUPRAMAS_LITERATURE_PROVIDER_ERROR')
  }
  if (response.truncated) throw providerError('response was truncated')
  try {
    return xmlParser.parse(response.content)
  } catch (error: unknown) {
    throw providerError('body is not valid Atom XML', error)
  }
}

/** Extract the Atom feed element from one parsed arXiv document root. */
function feedOf(value: unknown): Record<string, unknown> {
  const document = object(value, 'document')
  return object(document.feed, 'feed')
}

function totalResults(feed: Record<string, unknown>): number | undefined {
  const raw = feed.totalResults
  if (raw === null || raw === undefined || typeof raw === 'string' && raw.trim().length === 0) return undefined
  const total = Number(raw)
  if (!Number.isInteger(total) || total < 0) throw providerError('feed totalResults must be a non-negative integer')
  return total
}

function searchQuery(query: string): string {
  const terms = query.trim().split(/\s+/).filter(term => term.length > 0)
  if (terms.length === 0) throw providerError('search query is empty')
  return terms.map(term => `all:"${term}"`).join(' AND ')
}

/** Structured arXiv Atom search and resolution adapter. */
export class ArxivIndexProvider implements LiteratureIndexProvider {
  readonly id = PROVIDER_ID

  constructor(private readonly fetchText: ArxivFetchText) {}

  available(): boolean {
    return true
  }

  /**
   * Search the bounded arXiv Atom API by relevance.
   * @param request - Normalized search query and result limit.
   * @param signal - Optional cancellation signal for the HTTP request.
   * @returns sparse-safe provider candidates and truncation state.
   */
  async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureProviderSearchResult> {
    const url = new URL('/api/query', API_ROOT)
    url.searchParams.set('search_query', searchQuery(request.query))
    url.searchParams.set('start', '0')
    url.searchParams.set('max_results', String(request.maxResults))
    url.searchParams.set('sortBy', 'relevance')
    const feed = feedOf(parseXml(await this.fetchText(url.toString(), signal)))
    const candidates = elementList(feed.entry, 'feed.entry').map(entry => mapEntry(entry).candidate)
    const total = totalResults(feed)
    return { candidates, truncated: total !== undefined && total > candidates.length }
  }

  /**
   * Resolve one arXiv article id for internal acquisition metadata.
   * @param externalId - arXiv article id from an opaque candidate id.
   * @param signal - Optional cancellation signal for the HTTP request.
   * @returns the validated candidate and its ordered PDF URL fallbacks.
   */
  async resolve(externalId: string, signal?: AbortSignal): Promise<ResolvedLiteratureProviderCandidate> {
    if (!ARXIV_ID.test(externalId)) {
      throw new LiteratureError('arXiv candidate id must be a bare arXiv article id', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    const url = new URL('/api/query', API_ROOT)
    url.searchParams.set('id_list', externalId)
    const feed = feedOf(parseXml(await this.fetchText(url.toString(), signal)))
    const entry = elementList(feed.entry, 'feed.entry')[0]
    if (entry === undefined) throw providerError(`no arXiv entry for ${externalId}`)
    return mapEntry(entry).resolved
  }
}

/** Cordis function plugin name. */
export const name = 'supramas-literature-arxiv'
/** Required service seams. */
export const inject = ['web', 'supramasLiterature']

function fromWeb(result: WebFetchResult): ArxivFetchTextResult {
  if (result.body.kind !== 'text') {
    throw new LiteratureError('arXiv returned a non-text response', 'SUPRAMAS_LITERATURE_PROVIDER_ERROR')
  }
  return { statusCode: result.statusCode, content: result.body.content, truncated: result.truncated }
}

/** Register the keyless arXiv provider through the shared safe text-fetch seam. */
export function apply(ctx: Context): void {
  ctx.supramasLiterature.registerIndexProvider(new ArxivIndexProvider(async (url, signal) =>
    fromWeb(await ctx.web.fetch({ url }, signal))))
}
