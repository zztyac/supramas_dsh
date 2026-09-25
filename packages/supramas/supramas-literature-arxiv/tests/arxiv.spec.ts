import { describe, expect, it, vi } from 'vitest'
import {
  ArxivIndexProvider,
  type ArxivFetchText,
} from '../src/index.ts'

const entry = (overrides: Record<string, string> = {}): string => {
  const id = overrides.id ?? 'http://arxiv.org/abs/2310.12345v2'
  return `
  <entry>
    <id>${id}</id>
    <updated>2024-01-05T12:00:00Z</updated>
    <published>${overrides.published ?? '2023-10-18T17:59:59Z'}</published>
    <title>${overrides.title ?? 'Flux Pinning in REBCO Films with BHO Nanorods'}</title>
    <summary>${overrides.summary ?? 'BaHfO3 nanorods raise the in-field Jc of REBCO films.'}</summary>
    <author><name>A. Author</name></author>
    <author><name>B. Author</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">${overrides.doi ?? '10.1038/s41598-019-42291-x'}</arxiv:doi>
    <link rel="alternate" href="${id}" type="text/html"/>
    <link title="pdf" rel="related" href="http://arxiv.org/pdf/${id.replace(/^https?:\/\/arxiv\.org\/abs\//, '')}" type="application/pdf"/>
  </entry>`
}

const feed = (entries: string, totalResults = 2): string => `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query</title>
  <id>http://arxiv.org/api/query?search_query=rebco</id>
  <updated>2026-09-19T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">${totalResults}</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <opensearch:itemsPerPage xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">10</opensearch:itemsPerPage>
  ${entries}
</feed>`

function fetchFixture(xml: string, overrides: Partial<Awaited<ReturnType<ArxivFetchText>>> = {}) {
  const calls: string[] = []
  const fetchText: ArxivFetchText = vi.fn((url: string) => {
    calls.push(url)
    return Promise.resolve({ statusCode: 200, content: xml, truncated: false, ...overrides })
  })
  return { calls, fetchText }
}

describe('ArxivIndexProvider', () => {
  it('maps Atom entries into bounded provider candidates and reports truncation', async () => {
    const fixture = fetchFixture(feed(`${entry()}${entry({ id: 'http://arxiv.org/abs/2401.00002v1', published: '2024-01-02T00:00:00Z', title: 'BHO Nanorod Angular Pinning', doi: '' })}`, 5))
    const provider = new ArxivIndexProvider(fixture.fetchText)
    const signal = new AbortController().signal
    const result = await provider.search({ query: 'REBCO pinning', maxResults: 2 }, signal)

    expect(result).toEqual({
      candidates: [
        {
          externalId: '2310.12345v2',
          title: 'Flux Pinning in REBCO Films with BHO Nanorods',
          authors: ['A. Author', 'B. Author'],
          year: 2023,
          doi: '10.1038/s41598-019-42291-x',
          venue: 'arXiv',
          abstract: 'BaHfO3 nanorods raise the in-field Jc of REBCO films.',
          openAccess: true,
          landingUrl: 'https://arxiv.org/abs/2310.12345v2',
        },
        {
          externalId: '2401.00002v1',
          title: 'BHO Nanorod Angular Pinning',
          authors: ['A. Author', 'B. Author'],
          year: 2024,
          venue: 'arXiv',
          abstract: 'BaHfO3 nanorods raise the in-field Jc of REBCO films.',
          openAccess: true,
          landingUrl: 'https://arxiv.org/abs/2401.00002v1',
        },
      ],
      truncated: true,
    })
    const url = new URL(fixture.calls[0]!)
    expect(url.searchParams.get('search_query')).toBe('all:"REBCO" AND all:"pinning"')
    expect(url.searchParams.get('max_results')).toBe('2')
    expect(url.searchParams.get('sortBy')).toBe('relevance')
    expect(fixture.fetchText).toHaveBeenCalledWith(fixture.calls[0], signal)
  })

  it('resolves an arXiv id into ordered PDF URL fallbacks with acquisition metadata', async () => {
    const fixture = fetchFixture(feed(entry()))
    const provider = new ArxivIndexProvider(fixture.fetchText)
    const resolved = await provider.resolve('2310.12345v2')
    expect(resolved).toMatchObject({
      externalId: '2310.12345v2',
      documentUrl: 'http://arxiv.org/pdf/2310.12345v2',
      documentUrls: [
        'http://arxiv.org/pdf/2310.12345v2',
        'https://arxiv.org/pdf/2310.12345',
      ],
      documentMediaType: 'application/pdf',
      openAccess: true,
    })
    const url = new URL(fixture.calls[0]!)
    expect(url.searchParams.get('id_list')).toBe('2310.12345v2')
  })

  it('accepts a single Atom entry object and preserves sparse records without inventing fields', async () => {
    const sparse = feed(`
  <entry>
    <id>http://arxiv.org/abs/cond-mat/0406087</id>
    <title>Strongly Enhanced Current Densities in YBCO</title>
    <published>2004-06-03T00:00:00Z</published>
    <author><name>J. L. MacManus-Driscoll</name></author>
  </entry>`, 1)
    const fixture = fetchFixture(sparse)
    const provider = new ArxivIndexProvider(fixture.fetchText)
    const result = await provider.search({ query: 'YBCO', maxResults: 1 })
    expect(result.candidates).toEqual([{
      externalId: 'cond-mat/0406087',
      title: 'Strongly Enhanced Current Densities in YBCO',
      authors: ['J. L. MacManus-Driscoll'],
      year: 2004,
      venue: 'arXiv',
      openAccess: true,
      landingUrl: 'https://arxiv.org/abs/cond-mat/0406087',
    }])
    expect(result.truncated).toBe(false)
  })

  it('maps HTTP status, truncation, invalid XML, and malformed records to stable provider errors', async () => {
    const rateLimited = fetchFixture('', { statusCode: 429 })
    await expect(new ArxivIndexProvider(rateLimited.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_RATE_LIMITED' })

    const serverError = fetchFixture('', { statusCode: 500 })
    await expect(new ArxivIndexProvider(serverError.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })

    const truncated = fetchFixture('', { truncated: true })
    await expect(new ArxivIndexProvider(truncated.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })

    const invalidXml = fetchFixture('not-xml')
    await expect(new ArxivIndexProvider(invalidXml.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })

    const malformed = fetchFixture(feed('<entry><id>https://example.org/not-arxiv</id><title>x</title></entry>'))
    await expect(new ArxivIndexProvider(malformed.fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })

    const emptyResolve = fetchFixture(feed(''))
    await expect(new ArxivIndexProvider(emptyResolve.fetchText).resolve('2310.12345'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_PROVIDER_ERROR' })
    await expect(new ArxivIndexProvider(emptyResolve.fetchText).resolve('../authors/A1'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST' })
  })

  it('rejects a response body that is not representable as text', async () => {
    const fetchText: ArxivFetchText = () => Promise.reject(new Error('unsupported body'))
    await expect(new ArxivIndexProvider(fetchText).search({ query: 'q', maxResults: 1 }))
      .rejects.toThrow('unsupported body')
  })
})
