import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import LiteratureRuntime, {
  LiteratureError,
  chunkParsedPages,
  type DocumentParserProvider,
  type LiteratureIndexProvider,
  type LiteratureProviderCandidate,
  type PaperAcquisitionRequest,
  type PaperAcquisitionProvider,
} from '../src/index.ts'

const baseCandidate: LiteratureProviderCandidate = {
  externalId: 'W1',
  title: 'BaZrO3 pinning in REBCO films',
  authors: ['A. Author'],
  year: 2024,
  doi: '10.1000/rebco.1',
  venue: 'Journal of Materials',
  openAccess: true,
}

function provider(
  id: string,
  candidates: readonly LiteratureProviderCandidate[] = [baseCandidate],
  usable = true,
): LiteratureIndexProvider {
  return {
    id,
    available: () => usable,
    search: vi.fn(() => Promise.resolve({ candidates, truncated: false })),
    resolve: vi.fn((externalId: string) => Promise.resolve({
      ...baseCandidate,
      externalId,
      documentUrl: 'https://example.org/paper.pdf',
    })),
  }
}

function acquisitionProvider(
  id: string,
  bytes = new TextEncoder().encode('%PDF-1.7\nbody'),
  mediaType = 'application/pdf',
  usable = true,
): PaperAcquisitionProvider {
  return {
    id,
    available: () => usable,
    acquire: vi.fn((request: PaperAcquisitionRequest) => Promise.resolve({
      url: request.url,
      statusCode: 200,
      mediaType,
      bytes,
    })),
  }
}

function parserProvider(id = 'pypdf', pages = [{ pageNumber: 1, text: 'page one text' }]): DocumentParserProvider {
  return {
    id,
    available: () => true,
    parse: vi.fn(() => Promise.resolve({ pages })),
  }
}

async function mount(config: ConstructorParameters<typeof LiteratureRuntime>[1] = {}) {
  const ctx = new Context()
  await ctx.plugin(LiteratureRuntime, config)
  return { ctx, literature: ctx.supramasLiterature }
}

describe('SupraMasLiterature provider lifecycle', () => {
  it('registers and disposes one provider without registration-order fallbacks', async () => {
    const { literature } = await mount()
    const dispose = literature.registerIndexProvider(provider('openalex'))
    await expect(literature.search({ query: 'REBCO pinning', maxResults: 5 }))
      .resolves.toMatchObject({ candidates: [{ candidateId: 'openalex:W1' }] })
    dispose()
    await expect(literature.search({ query: 'REBCO pinning', maxResults: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('rejects duplicate provider ids and removes fiber-owned registrations on dispose', async () => {
    const { literature } = await mount()
    literature.registerIndexProvider(provider('openalex'))
    expect(() => literature.registerIndexProvider(provider('openalex')))
      .toThrow(expect.objectContaining({ code: 'SUPRAMAS_LITERATURE_DUPLICATE_PROVIDER' }))

    const second = await mount()
    const fiber = await second.ctx.plugin(Object.assign((inner: Context) => {
      inner.supramasLiterature.registerIndexProvider(provider('openalex'))
    }, { inject: ['supramasLiterature'] }))
    await expect(second.literature.search({ query: 'q', maxResults: 1 })).resolves.toBeDefined()
    await fiber.dispose()
    await expect(second.literature.search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE' })
  })
})

describe('SupraMasLiterature bounded search and resolution', () => {
  it('uses the configured provider, caps over-return, and forwards cancellation', async () => {
    const { literature } = await mount({ indexProvider: 'openalex' })
    const selected = provider('openalex', [
      baseCandidate,
      { ...baseCandidate, externalId: 'W2', doi: '10.1000/rebco.2' },
    ])
    literature.registerIndexProvider(provider('other'))
    literature.registerIndexProvider(selected)
    const controller = new AbortController()
    const result = await literature.search({ query: '  REBCO flux pinning  ', maxResults: 1 }, controller.signal)
    expect(result).toMatchObject({ truncated: true, candidates: [{ candidateId: 'openalex:W1' }] })
    expect(selected.search).toHaveBeenCalledWith({ query: 'REBCO flux pinning', maxResults: 1 }, controller.signal)
  })

  it('reports configured missing, unavailable, and ambiguous providers explicitly', async () => {
    const missing = await mount({ indexProvider: 'missing' })
    missing.literature.registerIndexProvider(provider('openalex'))
    await expect(missing.literature.search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_MISSING' })

    const unavailable = await mount({ indexProvider: 'openalex' })
    unavailable.literature.registerIndexProvider(provider('openalex', [], false))
    await expect(unavailable.literature.search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_UNAVAILABLE' })

    const ambiguous = await mount()
    ambiguous.literature.registerIndexProvider(provider('openalex'))
    ambiguous.literature.registerIndexProvider(provider('arxiv'))
    await expect(ambiguous.literature.search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_AMBIGUOUS' })
  })

  it('routes opaque candidate ids back to the owning provider without trusting model metadata', async () => {
    const { literature } = await mount()
    const openalex = provider('openalex')
    literature.registerIndexProvider(openalex)
    const resolved = await literature.resolve('openalex:W2741809807')
    expect(resolved).toMatchObject({ candidateId: 'openalex:W2741809807', source: 'openalex' })
    expect(openalex.resolve).toHaveBeenCalledWith('W2741809807', undefined)
    await expect(literature.resolve('bad-id')).rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST' })
    await expect(literature.resolve('missing:W1')).rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_UNAVAILABLE' })
  })

  it('deduplicates provider records by external id, DOI, then normalized title', async () => {
    const { literature } = await mount()
    literature.registerIndexProvider(provider('openalex', [
      baseCandidate,
      { ...baseCandidate, externalId: 'W2', doi: 'HTTPS://DOI.ORG/10.1000/REBCO.1' },
      { externalId: 'W3', title: '  BaZrO3—pinning in REBCO films!  ', authors: baseCandidate.authors },
    ]))
    const result = await literature.search({ query: 'pinning', maxResults: 4 })
    expect(result.candidates.map(candidate => candidate.candidateId)).toEqual(['openalex:W1'])
  })

  it('validates query/result bounds before provider execution', async () => {
    const { literature } = await mount({ maxResults: 4, maxQueryChars: 20 })
    const openalex = provider('openalex')
    literature.registerIndexProvider(openalex)
    await expect(literature.search({ query: '   ', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST' })
    await expect(literature.search({ query: 'x'.repeat(21), maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST' })
    await expect(literature.search({ query: 'valid', maxResults: 5 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST' })
    expect(openalex.search).not.toHaveBeenCalled()
  })
})

describe('LiteratureError', () => {
  it('carries a stable machine-routable code', () => {
    const error = new LiteratureError('boom', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
    expect(error.name).toBe('LiteratureError')
    expect(error.code).toBe('SUPRAMAS_LITERATURE_INVALID_REQUEST')
  })
})

describe('SupraMasLiterature paper acquisition', () => {
  it('resolves an opaque candidate before fetching and returns verified PDF bytes plus digest', async () => {
    const { literature } = await mount({ acquisitionProvider: 'http', minDocumentBytes: 5, maxDocumentBytes: 100 })
    literature.registerIndexProvider(provider('openalex'))
    const http = acquisitionProvider('http')
    literature.registerAcquisitionProvider(http)
    const signal = new AbortController().signal

    const result = await literature.acquire('openalex:W1', signal)
    expect(result).toMatchObject({
      candidate: { candidateId: 'openalex:W1', source: 'openalex' },
      finalUrl: 'https://example.org/paper.pdf',
      mediaType: 'application/pdf',
      byteLength: 13,
      sha256: '3f972854841afd236b04b5d7435b73216bc5fa6e39a86aff6e492b744086189c',
    })
    expect(Array.from(result.bytes)).toEqual(Array.from(new TextEncoder().encode('%PDF-1.7\nbody')))
    expect(http.acquire).toHaveBeenCalledWith({ url: 'https://example.org/paper.pdf', maxBytes: 100 }, signal)
  })

  it('fails before acquisition when no open document exists or provider selection is unsafe', async () => {
    const noDocument = provider('openalex')
    noDocument.resolve = () => Promise.resolve(baseCandidate)
    const missingSource = await mount()
    missingSource.literature.registerIndexProvider(noDocument)
    missingSource.literature.registerAcquisitionProvider(acquisitionProvider('http'))
    await expect(missingSource.literature.acquire('openalex:W1'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_SOURCE_UNAVAILABLE' })

    const missingConfigured = await mount({ acquisitionProvider: 'missing' })
    missingConfigured.literature.registerIndexProvider(provider('openalex'))
    missingConfigured.literature.registerAcquisitionProvider(acquisitionProvider('http'))
    await expect(missingConfigured.literature.acquire('openalex:W1'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_CONFIGURED_MISSING' })

    const ambiguous = await mount()
    ambiguous.literature.registerIndexProvider(provider('openalex'))
    ambiguous.literature.registerAcquisitionProvider(acquisitionProvider('http'))
    ambiguous.literature.registerAcquisitionProvider(acquisitionProvider('mirror'))
    await expect(ambiguous.literature.acquire('openalex:W1'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_AMBIGUOUS' })
  })

  it('rejects non-success, oversized, non-PDF, and bad-magic provider results', async () => {
    const cases = [
      { provider: acquisitionProvider('http'), mutate: { statusCode: 404 }, code: 'SUPRAMAS_LITERATURE_HTTP_STATUS' },
      { provider: acquisitionProvider('http', new Uint8Array(101)), mutate: {}, code: 'SUPRAMAS_LITERATURE_TOO_LARGE' },
      { provider: acquisitionProvider('http', new TextEncoder().encode('%PDF-1.7'), 'text/plain'), mutate: {}, code: 'SUPRAMAS_LITERATURE_UNSUPPORTED_MEDIA' },
      { provider: acquisitionProvider('http', new TextEncoder().encode('not-a-pdf')), mutate: {}, code: 'SUPRAMAS_LITERATURE_UNSUPPORTED_MEDIA' },
    ] as const
    for (const item of cases) {
      const original = item.provider.acquire
      item.provider.acquire = async (request, signal) => ({ ...await original(request, signal), ...item.mutate })
      const { literature } = await mount({ minDocumentBytes: 5, maxDocumentBytes: 100 })
      literature.registerIndexProvider(provider('openalex'))
      literature.registerAcquisitionProvider(item.provider)
      await expect(literature.acquire('openalex:W1')).rejects.toMatchObject({ code: item.code })
    }
  })
})

describe('SupraMasLiterature isolated parsing and stable chunks', () => {
  it('selects one parser and revalidates normalized, ordered page output', async () => {
    const { literature } = await mount({ parserProvider: 'pypdf', maxParsedPages: 3, maxPageChars: 30, maxTotalChars: 50 })
    const parser = parserProvider('pypdf', [
      { pageNumber: 2, text: ' second page\r\n' },
      { pageNumber: 1, text: 'first page\u0000  ' },
      { pageNumber: 3, text: '   ' },
    ])
    literature.registerParserProvider(parser)
    const result = await literature.parseDocument('C:\\papers\\paper.pdf')
    expect(result.pages).toEqual([
      { pageNumber: 1, text: 'first page' },
      { pageNumber: 2, text: 'second page' },
    ])
    expect(parser.parse).toHaveBeenCalledWith(expect.objectContaining({ maxPages: 3, maxPageChars: 30, maxTotalChars: 50 }), undefined)
  })

  it('rejects missing parsers, duplicate pages, empty scans, and parser limit violations', async () => {
    const missing = await mount()
    await expect(missing.literature.parseDocument('C:\\papers\\paper.pdf'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PARSER_UNAVAILABLE' })

    const cases = [
      { pages: [{ pageNumber: 1, text: 'a' }, { pageNumber: 1, text: 'b' }], maxPages: 2, code: 'SUPRAMAS_LITERATURE_PARSE_FAILED' },
      { pages: [{ pageNumber: 1, text: '   ' }], maxPages: 1, code: 'SUPRAMAS_LITERATURE_NO_TEXT' },
      { pages: [{ pageNumber: 1, text: 'abcdef' }], maxPages: 1, code: 'SUPRAMAS_LITERATURE_TEXT_LIMIT' },
      { pages: [{ pageNumber: 1, text: 'a' }, { pageNumber: 2, text: 'b' }], maxPages: 1, code: 'SUPRAMAS_LITERATURE_PAGE_LIMIT' },
    ] as const
    for (const item of cases) {
      const { literature } = await mount({ maxParsedPages: item.maxPages, maxPageChars: 5, maxTotalChars: 5 })
      literature.registerParserProvider(parserProvider('pypdf', [...item.pages]))
      await expect(literature.parseDocument('C:\\papers\\paper.pdf')).rejects.toMatchObject({ code: item.code })
    }
  })

  it('creates deterministic overlapping chunks that never cross page boundaries', () => {
    const pages = [
      { pageNumber: 2, text: 'second page' },
      { pageNumber: 1, text: 'alpha beta gamma delta epsilon' },
    ]
    const first = chunkParsedPages('paper-1', pages, 14, 3)
    const second = chunkParsedPages('paper-1', pages, 14, 3)
    expect(second).toEqual(first)
    expect(first.map(chunk => chunk.chunk_id)).toEqual([
      'paper-1-p1-c1', 'paper-1-p1-c2', 'paper-1-p1-c3', 'paper-1-p1-c4', 'paper-1-p2-c1',
    ])
    expect(first.every(chunk => chunk.text.length <= 14)).toBe(true)
    expect(first.filter(chunk => chunk.page === 1)).toHaveLength(4)
  })
})
