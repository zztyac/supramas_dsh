/** Structured scholarly-index capability seam for SupraMAS. */

import { Context, Service } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type {
  AcquiredPaper,
  DocumentParserProvider,
  DocumentParseResult,
  LiteratureCandidate,
  LiteratureErrorCode,
  LiteratureIndexProvider,
  LiteratureProviderCandidate,
  LiteratureSearchRequest,
  LiteratureSearchResult,
  PaperAcquisitionProvider,
  ParsedDocumentPage,
  ResolvedLiteratureCandidate,
  StablePaperChunk,
} from './types.ts'

export type * from './types.ts'

/** Stable typed error owned by the literature service boundary. */
export class LiteratureError extends HarnessError {
  constructor(message: string, code: LiteratureErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'LiteratureError'
  }
}

/** Provider selection and request limits. */
export interface LiteratureConfig {
  /** Explicit structured-index provider id. Omitted means exactly one usable provider must exist. */
  readonly indexProvider?: string
  /** Explicit PDF acquisition provider id. Omitted means exactly one usable provider must exist. */
  readonly acquisitionProvider?: string
  /** Explicit full-text parser provider id. Omitted means exactly one usable provider must exist. */
  readonly parserProvider?: string
  /** Largest accepted result count on one search. */
  readonly maxResults?: number
  /** Largest accepted normalized query in UTF-16 code units. */
  readonly maxQueryChars?: number
  /** Smallest accepted PDF body; rejects HTML error stubs and empty placeholder files. */
  readonly minDocumentBytes?: number
  /** Largest accepted complete PDF body. */
  readonly maxDocumentBytes?: number
  /** Largest accepted source page count. */
  readonly maxParsedPages?: number
  /** Largest accepted extracted characters on one page. */
  readonly maxPageChars?: number
  /** Largest accepted extracted characters across one document. */
  readonly maxTotalChars?: number
}

const DEFAULT_MAX_RESULTS = 20
const DEFAULT_MAX_QUERY_CHARS = 512
const DEFAULT_MIN_DOCUMENT_BYTES = 10_000
const DEFAULT_MAX_DOCUMENT_BYTES = 25_000_000
const DEFAULT_MAX_PARSED_PAGES = 500
const DEFAULT_MAX_PAGE_CHARS = 100_000
const DEFAULT_MAX_TOTAL_CHARS = 5_000_000
const PROVIDER_ID = /^[a-z][a-z0-9-]{0,63}$/
const PAPER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/

declare module '@deepseek-ai/cordis' {
  interface Context {
    supramasLiterature: SupraMasLiterature
  }
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new LiteratureError(`${field} must be a positive integer`, 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
  }
  return value
}

function text(value: string, field: string): string {
  const normalized = value.trim()
  if (normalized.length === 0) {
    throw new LiteratureError(`${field} must be non-empty`, 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
  }
  return normalized
}

interface SelectableProvider {
  readonly id: string
  available(): boolean
}

function selectedProvider<P extends SelectableProvider>(
  providers: ReadonlyMap<string, P>,
  configuredId: string | undefined,
): P {
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (provider === undefined) {
      throw new LiteratureError(
        `configured literature provider "${configuredId}" is not registered`,
        'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_MISSING',
      )
    }
    if (!provider.available()) {
      throw new LiteratureError(
        `configured literature provider "${configuredId}" is unavailable`,
        'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const provider = usable[0]
  if (provider === undefined) {
    throw new LiteratureError('no usable literature provider is registered', 'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE')
  }
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).sort().join(', ')
    throw new LiteratureError(
      `multiple usable literature providers are registered (${ids}); configure one explicitly`,
      'SUPRAMAS_LITERATURE_PROVIDER_AMBIGUOUS',
    )
  }
  return provider
}

function candidateFrom(providerId: string, candidate: LiteratureProviderCandidate): LiteratureCandidate {
  const externalId = text(candidate.externalId, 'candidate.externalId')
  const title = text(candidate.title, 'candidate.title')
  const authors = candidate.authors.map((author, index) => text(author, `candidate.authors[${index}]`))
  return {
    candidateId: `${providerId}:${externalId}`,
    source: providerId,
    title,
    authors,
    ...(candidate.year === undefined ? {} : { year: candidate.year }),
    ...(candidate.doi === undefined ? {} : { doi: candidate.doi }),
    ...(candidate.venue === undefined ? {} : { venue: candidate.venue }),
    ...(candidate.abstract === undefined ? {} : { abstract: candidate.abstract }),
    ...(candidate.citedByCount === undefined ? {} : { citedByCount: candidate.citedByCount }),
    ...(candidate.openAccess === undefined ? {} : { openAccess: candidate.openAccess }),
    ...(candidate.landingUrl === undefined ? {} : { landingUrl: candidate.landingUrl }),
  }
}

function normalizedDoi(value: string | undefined): string | undefined {
  return value?.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').toLowerCase()
}

function normalizedTitle(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function deduplicate(candidates: readonly LiteratureCandidate[]): LiteratureCandidate[] {
  const externalIds = new Set<string>()
  const dois = new Set<string>()
  const titles = new Set<string>()
  return candidates.filter((candidate) => {
    const external = candidate.candidateId.toLowerCase()
    const doi = normalizedDoi(candidate.doi)
    const title = normalizedTitle(candidate.title)
    if (externalIds.has(external) || doi !== undefined && dois.has(doi) || titles.has(title)) return false
    externalIds.add(external)
    if (doi !== undefined) dois.add(doi)
    titles.add(title)
    return true
  })
}

function normalizedPageText(value: string): string {
  return value
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim()
    .normalize('NFKC')
}

/**
 * Split validated page text deterministically without crossing page boundaries.
 * A small overlap keeps evidence phrases near a boundary available in one chunk.
 * @param paperId - Filename-safe paper identity used in stable chunk ids.
 * @param pages - Validated extracted pages to split in page-number order.
 * @param maxChunkChars - Maximum characters carried by one chunk.
 * @param overlapChars - Characters repeated between adjacent chunks on one page.
 * @returns deterministic page-scoped evidence chunks.
 */
export function chunkParsedPages(
  paperId: string,
  pages: readonly ParsedDocumentPage[],
  maxChunkChars = 12_000,
  overlapChars = 400,
): StablePaperChunk[] {
  if (!PAPER_ID.test(paperId)) {
    throw new LiteratureError('paperId is not filename-safe', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
  }
  positiveInteger(maxChunkChars, 'maxChunkChars')
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChunkChars) {
    throw new LiteratureError('overlapChars must be an integer below maxChunkChars', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
  }
  const chunks: StablePaperChunk[] = []
  for (const page of [...pages].sort((left, right) => left.pageNumber - right.pageNumber)) {
    const text = normalizedPageText(page.text)
    if (text.length === 0) continue
    let start = 0
    let index = 1
    while (start < text.length) {
      const target = Math.min(start + maxChunkChars, text.length)
      let end = target
      if (target < text.length) {
        const minimum = start + Math.floor(maxChunkChars * 0.6)
        const newline = text.lastIndexOf('\n', target)
        const space = text.lastIndexOf(' ', target)
        const boundary = Math.max(newline, space)
        if (boundary >= minimum) end = boundary
      }
      const content = text.slice(start, end).trim()
      if (content.length > 0) {
        chunks.push({ chunk_id: `${paperId}-p${page.pageNumber}-c${index}`, page: page.pageNumber, text: content })
        index++
      }
      if (end >= text.length) break
      start = Math.max(start + 1, end - overlapChars)
    }
  }
  return chunks
}

/** Registry and execution owner for structured scholarly-index providers. */
export class SupraMasLiterature extends Service {
  static Config: z<LiteratureConfig> = z.object({
    indexProvider: z.string(),
    acquisitionProvider: z.string(),
    parserProvider: z.string(),
    maxResults: z.number().default(DEFAULT_MAX_RESULTS),
    maxQueryChars: z.number().default(DEFAULT_MAX_QUERY_CHARS),
    minDocumentBytes: z.number().default(DEFAULT_MIN_DOCUMENT_BYTES),
    maxDocumentBytes: z.number().default(DEFAULT_MAX_DOCUMENT_BYTES),
    maxParsedPages: z.number().default(DEFAULT_MAX_PARSED_PAGES),
    maxPageChars: z.number().default(DEFAULT_MAX_PAGE_CHARS),
    maxTotalChars: z.number().default(DEFAULT_MAX_TOTAL_CHARS),
  })

  private readonly providers = new Map<string, LiteratureIndexProvider>()
  private readonly acquisitionProviders = new Map<string, PaperAcquisitionProvider>()
  private readonly parserProviders = new Map<string, DocumentParserProvider>()
  private readonly configuredProvider: string | undefined
  private readonly configuredAcquisitionProvider: string | undefined
  private readonly configuredParserProvider: string | undefined
  private readonly maxResults: number
  private readonly maxQueryChars: number
  private readonly minDocumentBytes: number
  private readonly maxDocumentBytes: number
  private readonly maxParsedPages: number
  private readonly maxPageChars: number
  private readonly maxTotalChars: number

  constructor(ctx: Context, config: LiteratureConfig = {}) {
    super(ctx, 'supramasLiterature')
    this.configuredProvider = config.indexProvider
    this.configuredAcquisitionProvider = config.acquisitionProvider
    this.configuredParserProvider = config.parserProvider
    this.maxResults = positiveInteger(config.maxResults ?? DEFAULT_MAX_RESULTS, 'maxResults')
    this.maxQueryChars = positiveInteger(config.maxQueryChars ?? DEFAULT_MAX_QUERY_CHARS, 'maxQueryChars')
    this.minDocumentBytes = positiveInteger(config.minDocumentBytes ?? DEFAULT_MIN_DOCUMENT_BYTES, 'minDocumentBytes')
    this.maxDocumentBytes = positiveInteger(config.maxDocumentBytes ?? DEFAULT_MAX_DOCUMENT_BYTES, 'maxDocumentBytes')
    this.maxParsedPages = positiveInteger(config.maxParsedPages ?? DEFAULT_MAX_PARSED_PAGES, 'maxParsedPages')
    this.maxPageChars = positiveInteger(config.maxPageChars ?? DEFAULT_MAX_PAGE_CHARS, 'maxPageChars')
    this.maxTotalChars = positiveInteger(config.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS, 'maxTotalChars')
    if (this.maxDocumentBytes < this.minDocumentBytes) {
      throw new LiteratureError('maxDocumentBytes must be at least minDocumentBytes', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
  }

  /**
   * Register one provider for the calling fiber and return an eager disposer.
   * @param provider - Structured scholarly-index provider with a stable id.
   * @returns a disposer that removes the provider registration.
   */
  registerIndexProvider(provider: LiteratureIndexProvider): () => void {
    if (!PROVIDER_ID.test(provider.id)) {
      throw new LiteratureError('literature provider id is invalid', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    if (this.providers.has(provider.id)) {
      throw new LiteratureError(
        `a literature provider with id "${provider.id}" is already registered`,
        'SUPRAMAS_LITERATURE_DUPLICATE_PROVIDER',
      )
    }
    const providers = this.providers
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'supramasLiterature.registerIndexProvider()')
    return () => { void dispose() }
  }

  /**
   * Register one acquisition provider for the calling fiber.
   * @param provider - Safe complete-byte acquisition provider with a stable id.
   * @returns a disposer that removes the provider registration.
   */
  registerAcquisitionProvider(provider: PaperAcquisitionProvider): () => void {
    if (!PROVIDER_ID.test(provider.id)) {
      throw new LiteratureError('acquisition provider id is invalid', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    if (this.acquisitionProviders.has(provider.id)) {
      throw new LiteratureError(
        `an acquisition provider with id "${provider.id}" is already registered`,
        'SUPRAMAS_LITERATURE_DUPLICATE_PROVIDER',
      )
    }
    const providers = this.acquisitionProviders
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'supramasLiterature.registerAcquisitionProvider()')
    return () => { void dispose() }
  }

  /**
   * Register one isolated document parser for the calling fiber.
   * @param provider - Bounded parser provider with a stable id.
   * @returns a disposer that removes the provider registration.
   */
  registerParserProvider(provider: DocumentParserProvider): () => void {
    if (!PROVIDER_ID.test(provider.id)) {
      throw new LiteratureError('parser provider id is invalid', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    if (this.parserProviders.has(provider.id)) {
      throw new LiteratureError(`a parser provider with id "${provider.id}" is already registered`, 'SUPRAMAS_LITERATURE_DUPLICATE_PROVIDER')
    }
    const providers = this.parserProviders
    const dispose = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => providers.delete(provider.id)
    }, 'supramasLiterature.registerParserProvider()')
    return () => { void dispose() }
  }

  /**
   * Search one selected structured index with complete service-owned bounds.
   * @param request - Normalized query and requested result bound.
   * @param signal - Optional cancellation signal forwarded to the provider.
   * @returns bounded, deduplicated candidates with opaque ids.
   */
  async search(request: LiteratureSearchRequest, signal?: AbortSignal): Promise<LiteratureSearchResult> {
    const query = text(request.query, 'query')
    if (query.length > this.maxQueryChars) {
      throw new LiteratureError(`query exceeds ${this.maxQueryChars} characters`, 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    const maxResults = positiveInteger(request.maxResults, 'maxResults')
    if (maxResults > this.maxResults) {
      throw new LiteratureError(
        `maxResults exceeds the configured limit of ${this.maxResults}`,
        'SUPRAMAS_LITERATURE_INVALID_REQUEST',
      )
    }
    const provider = selectedProvider(this.providers, this.configuredProvider)
    const result = await provider.search({ query, maxResults }, signal)
    const normalized = deduplicate(result.candidates.map(candidate => candidateFrom(provider.id, candidate)))
    const overReturned = result.candidates.length > maxResults || normalized.length > maxResults
    return {
      candidates: normalized.slice(0, maxResults),
      truncated: result.truncated || overReturned,
    }
  }

  /**
   * Resolve one service-issued opaque id through its owning provider.
   * @param candidateId - Opaque provider-qualified candidate identity.
   * @param signal - Optional cancellation signal forwarded to the provider.
   * @returns the validated candidate and any internal acquisition metadata.
   */
  async resolve(candidateId: string, signal?: AbortSignal): Promise<ResolvedLiteratureCandidate> {
    const separator = candidateId.indexOf(':')
    if (separator <= 0 || separator === candidateId.length - 1) {
      throw new LiteratureError('candidateId must be <provider>:<external-id>', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    const providerId = candidateId.slice(0, separator)
    const externalId = candidateId.slice(separator + 1)
    const provider = this.providers.get(providerId)
    if (provider === undefined || !provider.available()) {
      throw new LiteratureError(
        `literature provider "${providerId}" is unavailable`,
        'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE',
      )
    }
    const resolved = await provider.resolve(externalId, signal)
    const candidate = candidateFrom(provider.id, resolved)
    return {
      ...candidate,
      ...(resolved.documentUrl === undefined ? {} : { documentUrl: resolved.documentUrl }),
      ...(resolved.documentMediaType === undefined ? {} : { documentMediaType: resolved.documentMediaType }),
      ...(resolved.license === undefined ? {} : { license: resolved.license }),
    }
  }

  /**
   * Resolve and acquire one open-access PDF without accepting caller-supplied metadata or URLs.
   * @param candidateId - Opaque provider-qualified candidate identity.
   * @param signal - Optional cancellation signal forwarded through acquisition.
   * @returns complete verified PDF bytes plus safe candidate metadata and digest.
   */
  async acquire(candidateId: string, signal?: AbortSignal): Promise<AcquiredPaper> {
    const candidate = await this.resolve(candidateId, signal)
    if (candidate.documentUrl === undefined) {
      throw new LiteratureError(
        `candidate ${candidateId} has no resolved open document`,
        'SUPRAMAS_LITERATURE_SOURCE_UNAVAILABLE',
      )
    }
    const provider = selectedProvider(this.acquisitionProviders, this.configuredAcquisitionProvider)
    const result = await provider.acquire({ url: candidate.documentUrl, maxBytes: this.maxDocumentBytes }, signal)
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new LiteratureError(
        `paper source returned HTTP ${result.statusCode}`,
        'SUPRAMAS_LITERATURE_HTTP_STATUS',
      )
    }
    if (result.bytes.byteLength < this.minDocumentBytes) {
      throw new LiteratureError(
        `paper source is smaller than ${this.minDocumentBytes} bytes`,
        'SUPRAMAS_LITERATURE_UNSUPPORTED_MEDIA',
      )
    }
    if (result.bytes.byteLength > this.maxDocumentBytes) {
      throw new LiteratureError(
        `paper source exceeds ${this.maxDocumentBytes} bytes`,
        'SUPRAMAS_LITERATURE_TOO_LARGE',
      )
    }
    const mediaType = result.mediaType.replace(/;.*$/s, '').trim().toLowerCase()
    const magic = new TextDecoder('ascii').decode(result.bytes.subarray(0, 5))
    if (mediaType !== 'application/pdf' || magic !== '%PDF-') {
      throw new LiteratureError('paper source is not a verified PDF', 'SUPRAMAS_LITERATURE_UNSUPPORTED_MEDIA')
    }
    const bytes = new Uint8Array(result.bytes)
    return {
      candidate,
      finalUrl: result.url,
      mediaType: 'application/pdf',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes,
    }
  }


  /**
   * Parse and revalidate one local source through the explicitly selected isolated parser.
   * @param path - Canonical absolute source path owned by the harness.
   * @param signal - Optional cancellation signal forwarded to the parser.
   * @returns normalized page-aware text within configured limits.
   */
  async parseDocument(path: string, signal?: AbortSignal): Promise<DocumentParseResult> {
    if (!isAbsolute(path)) {
      throw new LiteratureError('document path must be absolute', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    }
    let provider: DocumentParserProvider
    try {
      provider = selectedProvider(this.parserProviders, this.configuredParserProvider)
    } catch (error: unknown) {
      if (error instanceof LiteratureError && error.code === 'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE') {
        throw new LiteratureError('no usable document parser is registered', 'SUPRAMAS_LITERATURE_PARSER_UNAVAILABLE', { cause: error })
      }
      throw error
    }
    let result: DocumentParseResult
    try {
      result = await provider.parse({
        path,
        maxPages: this.maxParsedPages,
        maxPageChars: this.maxPageChars,
        maxTotalChars: this.maxTotalChars,
      }, signal)
    } catch (error: unknown) {
      if (error instanceof LiteratureError) throw error
      throw new LiteratureError('document parser failed', 'SUPRAMAS_LITERATURE_PARSE_FAILED', { cause: error })
    }
    if (result.pages.length > this.maxParsedPages) {
      throw new LiteratureError(`document exceeds ${this.maxParsedPages} pages`, 'SUPRAMAS_LITERATURE_PAGE_LIMIT')
    }
    const seen = new Set<number>()
    const pages: ParsedDocumentPage[] = []
    let total = 0
    for (const page of result.pages) {
      if (!Number.isInteger(page.pageNumber) || page.pageNumber <= 0 || seen.has(page.pageNumber)) {
        throw new LiteratureError('parser returned invalid or duplicate page numbers', 'SUPRAMAS_LITERATURE_PARSE_FAILED')
      }
      seen.add(page.pageNumber)
      const pageText = normalizedPageText(page.text)
      if (pageText.length > this.maxPageChars) {
        throw new LiteratureError(`page ${page.pageNumber} exceeds ${this.maxPageChars} characters`, 'SUPRAMAS_LITERATURE_TEXT_LIMIT')
      }
      total += pageText.length
      if (total > this.maxTotalChars) {
        throw new LiteratureError(`document exceeds ${this.maxTotalChars} extracted characters`, 'SUPRAMAS_LITERATURE_TEXT_LIMIT')
      }
      if (pageText.length > 0) pages.push({ pageNumber: page.pageNumber, text: pageText })
    }
    if (pages.length === 0) {
      throw new LiteratureError('document contains no extractable text', 'SUPRAMAS_LITERATURE_NO_TEXT')
    }
    pages.sort((left, right) => left.pageNumber - right.pageNumber)
    return { pages }
  }
}

export default SupraMasLiterature
