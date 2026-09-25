/** Portable scholarly-index vocabulary for SupraMAS literature discovery. */

/** One bounded user or agent search request. */
export interface LiteratureSearchRequest {
  readonly query: string
  readonly maxResults: number
}

/** Provider-owned candidate before its opaque identity is namespaced by the service. */
export interface LiteratureProviderCandidate {
  readonly externalId: string
  readonly title: string
  readonly authors: readonly string[]
  readonly year?: number
  readonly doi?: string
  readonly venue?: string
  readonly abstract?: string
  readonly citedByCount?: number
  readonly openAccess?: boolean
  readonly landingUrl?: string
}

/** Provider search result; the service enforces the request bound again. */
export interface LiteratureProviderSearchResult {
  readonly candidates: readonly LiteratureProviderCandidate[]
  readonly truncated: boolean
}

/** A candidate safe to expose to model-facing consumers. */
export interface LiteratureCandidate extends Omit<LiteratureProviderCandidate, 'externalId'> {
  readonly candidateId: string
  readonly source: string
}

/** Bounded, normalized literature search outcome. */
export interface LiteratureSearchResult {
  readonly candidates: readonly LiteratureCandidate[]
  readonly truncated: boolean
}

/** Provider-only resolution adds acquisition data that search does not expose. */
export interface ResolvedLiteratureProviderCandidate extends LiteratureProviderCandidate {
  readonly documentUrl?: string
  /** Ordered open-document URL fallbacks; the first entry equals documentUrl when present. */
  readonly documentUrls?: readonly string[]
  readonly documentMediaType?: string
  readonly license?: string
}

/** Resolved candidate routed from one opaque candidate id. */
export interface ResolvedLiteratureCandidate extends Omit<ResolvedLiteratureProviderCandidate, 'externalId'> {
  readonly candidateId: string
  readonly source: string
}

/** One independently swappable structured scholarly-index backend. */
export interface LiteratureIndexProvider {
  readonly id: string
  /** Cheap local availability check; it must not perform network I/O. */
  available: () => boolean
  search: (request: LiteratureSearchRequest, signal?: AbortSignal) => Promise<LiteratureProviderSearchResult>
  resolve: (externalId: string, signal?: AbortSignal) => Promise<ResolvedLiteratureProviderCandidate>
}

/** One provider request for a previously resolved open document URL. */
export interface PaperAcquisitionRequest {
  readonly url: string
  readonly maxBytes: number
}

/** Complete bounded bytes returned by one acquisition provider. */
export interface PaperAcquisitionProviderResult {
  readonly url: string
  readonly statusCode: number
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/** Swappable safe binary transport used only after candidate resolution. */
export interface PaperAcquisitionProvider {
  readonly id: string
  available: () => boolean
  acquire: (request: PaperAcquisitionRequest, signal?: AbortSignal) => Promise<PaperAcquisitionProviderResult>
}

/** Verified in-memory PDF bundle passed to the later persistence/parse transaction. */
export interface AcquiredPaper {
  readonly candidate: ResolvedLiteratureCandidate
  readonly finalUrl: string
  readonly mediaType: 'application/pdf'
  readonly byteLength: number
  readonly sha256: string
  readonly bytes: Uint8Array
}

/** One page extracted by an isolated document parser. */
export interface ParsedDocumentPage {
  readonly pageNumber: number
  readonly text: string
}

/** Bounded internal parser request for one canonical local source path. */
export interface DocumentParseRequest {
  readonly path: string
  readonly maxPages: number
  readonly maxPageChars: number
  readonly maxTotalChars: number
}

/** Complete parser result; the service revalidates every limit and page. */
export interface DocumentParseResult {
  readonly pages: readonly ParsedDocumentPage[]
}

/** Swappable isolated full-text parser backend. */
export interface DocumentParserProvider {
  readonly id: string
  available: () => boolean
  parse: (request: DocumentParseRequest, signal?: AbortSignal) => Promise<DocumentParseResult>
}

/** Deterministic page-aware chunk ready for atomic evidence import. */
export interface StablePaperChunk {
  readonly chunk_id: string
  readonly page: number
  readonly text: string
  readonly evidence_kind: 'full_text'
}

/** Stable service-level literature failure codes. */
export type LiteratureErrorCode =
  | 'SUPRAMAS_LITERATURE_INVALID_REQUEST'
  | 'SUPRAMAS_LITERATURE_DUPLICATE_PROVIDER'
  | 'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE'
  | 'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_MISSING'
  | 'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_UNAVAILABLE'
  | 'SUPRAMAS_LITERATURE_PROVIDER_AMBIGUOUS'
  | 'SUPRAMAS_LITERATURE_RATE_LIMITED'
  | 'SUPRAMAS_LITERATURE_SOURCE_UNAVAILABLE'
  | 'SUPRAMAS_LITERATURE_SOURCE_BLOCKED'
  | 'SUPRAMAS_LITERATURE_REDIRECT_BLOCKED'
  | 'SUPRAMAS_LITERATURE_HTTP_STATUS'
  | 'SUPRAMAS_LITERATURE_TOO_LARGE'
  | 'SUPRAMAS_LITERATURE_UNSUPPORTED_MEDIA'
  | 'SUPRAMAS_LITERATURE_IDENTITY_MISMATCH'
  | 'SUPRAMAS_LITERATURE_TIMEOUT'
  | 'SUPRAMAS_LITERATURE_ABORTED'
  | 'SUPRAMAS_LITERATURE_PARSER_UNAVAILABLE'
  | 'SUPRAMAS_LITERATURE_PARSE_FAILED'
  | 'SUPRAMAS_LITERATURE_NO_TEXT'
  | 'SUPRAMAS_LITERATURE_PAGE_LIMIT'
  | 'SUPRAMAS_LITERATURE_TEXT_LIMIT'
  | 'SUPRAMAS_LITERATURE_PROVIDER_ERROR'
