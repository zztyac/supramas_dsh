import { describe, expect, it, vi } from 'vitest'
import {
  OpenAlexIndexProvider,
  type OpenAlexFetchText,
} from '../src/index.ts'

const work = {
  id: 'https://openalex.org/W2741809807',
  doi: 'https://doi.org/10.1038/NMAT1156',
  display_name: 'Strongly Enhanced Current Densities in YBCO + BaZrO3',
  publication_year: 2004,
  cited_by_count: 321,
  authorships: [
    { author: { display_name: 'J. L. MacManus-Driscoll' } },
    { author: { display_name: 'S. R. Foltyn' } },
  ],
  primary_location: { source: { display_name: 'Nature Materials' } },
  best_oa_location: {
    is_oa: true,
    landing_page_url: 'https://arxiv.org/abs/cond-mat/0406087',
    pdf_url: 'https://arxiv.org/pdf/cond-mat/0406087',
    license: 'cc-by-nc-sa',
  },
  open_access: { is_oa: true, oa_status: 'green' },
  abstract_inverted_index: {
    Flux: [2],
    pinning: [3],
    Enhanced: [0],
    vortex: [1],
  },
}

function fetchFixture(value: unknown, overrides: Partial<Awaited<ReturnType<OpenAlexFetchText>>> = {}) {
  const calls: string[] = []
  const fetchText: OpenAlexFetchText = vi.fn((url: string) => {
    calls.push(url)
    return Promise.resolve({ statusCode: 200, content: JSON.stringify(value), truncated: false, ...overrides })
  })
  return { calls, fetchText }
}

describe('OpenAlexIndexProvider', () => {
  it('maps the current work object into a bounded provider candidate', async () => {
    const fixture = fetchFixture({ meta: { count: 1 }, results: [work] })
    const provider = new OpenAlexIndexProvider(fixture.fetchText)
    const signal = new AbortController().signal
    const result = await provider.search({ query: 'REBCO flux pinning', maxResults: 5 }, signal)

    expect(result).toEqual({
      candidates: [{
        externalId: 'W2741809807',
        title: work.display_name,
        authors: ['J. L. MacManus-Driscoll', 'S. R. Foltyn'],
        year: 2004,
        doi: '10.1038/nmat1156',
        venue: 'Nature Materials',
        abstract: 'Enhanced vortex Flux pinning',
        citedByCount: 321,
        openAccess: true,
        landingUrl: 'https://arxiv.org/abs/cond-mat/0406087',
      }],
      truncated: false,
    })
    const url = new URL(fixture.calls[0]!)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.openalex.org/works')
    expect(url.searchParams.get('search')).toBe('REBCO flux pinning')
    expect(url.searchParams.get('per_page')).toBe('5')
    expect(fixture.fetchText).toHaveBeenCalledWith(fixture.calls[0], signal)
  })

  it('resolves an opaque OpenAlex work id and reveals acquisition data only on resolution', async () => {
    const fixture = fetchFixture(work)
    const provider = new OpenAlexIndexProvider(fixture.fetchText)
    const resolved = await provider.resolve('W2741809807')
    expect(resolved).toMatchObject({
      externalId: 'W2741809807',
      documentUrl: 'https://arxiv.org/pdf/cond-mat/0406087',
      documentMediaType: 'application/pdf',
      license: 'cc-by-nc-sa',
    })
    expect(fixture.calls[0]).toContain('/works/W2741809807?')
    await expect(provider.resolve('../authors/A1')).rejects.toMatchObject({
      code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST',
    })
  })

  it('preserves sparse records without inventing DOI, venue, abstract, or OA facts', async () => {
    const sparse = {
      id: 'https://openalex.org/W2',
      title: 'Sparse but valid work',
      authorships: [],
      primary_location: null,
      best_oa_location: null,
      open_access: null,
      abstract_inverted_index: null,
    }
    const fixture = fetchFixture({ results: [sparse] })
    const result = await new OpenAlexIndexProvider(fixture.fetchText).search({ query: 'q', maxResults: 1 })
    expect(result.candidates).toEqual([{ externalId: 'W2', title: 'Sparse but valid work', authors: [] }])
  })

  it('maps HTTP, truncation, malformed JSON, and malformed records to stable provider errors', async () => {
    const status = fetchFixture({}, { statusCode: 429 })
    await expect(new OpenAlexIndexProvider(status.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_RATE_LIMITED' })

    const truncated = fetchFixture({}, { truncated: true })
    await expect(new OpenAlexIndexProvider(truncated.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })

    const invalidJson = fetchFixture('not-json')
    await expect(new OpenAlexIndexProvider(invalidJson.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })

    const invalidShape = fetchFixture({ results: [{ id: 'https://openalex.org/W3' }] })
    await expect(new OpenAlexIndexProvider(invalidShape.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })
  })

  it('rejects a response body that is not representable as text', async () => {
    const fetchText: OpenAlexFetchText = () => Promise.reject(new Error('unsupported body'))
    await expect(new OpenAlexIndexProvider(fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toThrow('unsupported body')
  })
})
