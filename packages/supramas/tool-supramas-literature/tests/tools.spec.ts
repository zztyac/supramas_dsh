import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName } from '@deepseek-ai/dsh-storage-json'
import { apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName } from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SupraMasRuntime from '../../supramas/src/index.ts'
import SupraMasArtifacts from '../../supramas-artifacts/src/index.ts'
import LiteratureRuntime, {
  type DocumentParserProvider,
  type LiteratureIndexProvider,
  type PaperAcquisitionProvider,
  type PaperAcquisitionRequest,
} from '../../supramas-literature/src/index.ts'
import SupraMasPaperIngest from '../../supramas-paper-ingest/src/index.ts'
import * as LiteratureTools from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []
let callSequence = 0

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`supramas-lit-${++callSequence}`),
    name,
    arguments: args,
  })
}

async function setup(): Promise<Context> {
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-lit-tools-storage-'))
  const artifactRoot = await mkdtemp(join(tmpdir(), 'dsh-lit-tools-artifacts-'))
  roots.push(storageRoot, artifactRoot)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: storageRoot },
  )
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SupraMasRuntime)
  await ctx.plugin(SupraMasArtifacts, { root: artifactRoot })
  await ctx.plugin(LiteratureRuntime, { minDocumentBytes: 5, maxDocumentBytes: 1_000 })
  const index: LiteratureIndexProvider = {
    id: 'openalex',
    available: () => true,
    search: vi.fn(() => Promise.resolve({ candidates: [{
      externalId: 'W1',
      title: 'BZO pinning in REBCO',
      authors: ['Researcher'],
      abstract: 'A'.repeat(200),
      openAccess: true,
      landingUrl: 'https://example.org/work',
    }], truncated: false })),
    resolve: vi.fn((externalId: string) => Promise.resolve({
      externalId,
      title: 'BZO pinning in REBCO',
      authors: ['Researcher'],
      documentUrl: 'https://example.org/paper.pdf',
    })),
  }
  const acquisition: PaperAcquisitionProvider = {
    id: 'http',
    available: () => true,
    acquire: vi.fn((request: PaperAcquisitionRequest) => Promise.resolve({
      url: request.url,
      statusCode: 200,
      mediaType: 'application/pdf',
      bytes: new TextEncoder().encode('%PDF-complete'),
    })),
  }
  const parser: DocumentParserProvider = {
    id: 'pypdf',
    available: () => true,
    parse: vi.fn(() => Promise.resolve({ pages: [{ pageNumber: 1, text: 'BZO nanorods improve in-field current density and reveal a loading limitation.' }] })),
  }
  ctx.supramasLiterature.registerIndexProvider(index)
  ctx.supramasLiterature.registerAcquisitionProvider(acquisition)
  ctx.supramasLiterature.registerParserProvider(parser)
  await ctx.plugin(SupraMasPaperIngest, { maxChunkChars: 40, overlapChars: 5 })
  await ctx.plugin(LiteratureTools, { maxAbstractChars: 20, maxChunkReadChars: 15 })
  await ctx.supramas.create({ jobId: 'tools-demo', inputTaskPath: 'runs/tools-demo/input_task.yaml', runDir: 'runs/tools-demo' })
  return ctx
}

describe('SupraMAS bounded literature tools', () => {
  it('registers the discovery, import, chunk index, and bounded chunk read tools', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'supramas_literature_search',
      'supramas_paper_import',
      'supramas_chunk_list',
      'supramas_chunk_read',
    ])
  })

  it('searches without exposing a document URL and bounds abstracts', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'supramas_literature_search', { query: 'REBCO BZO', max_results: 3 })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected search success')
    const serialized = JSON.stringify(result.value)
    expect(result.value).toMatchObject({
      status: 'success',
      data: { candidates: [{ candidate_id: 'openalex:W1', abstract: 'A'.repeat(20) }] },
    })
    expect(serialized).not.toContain('paper.pdf')
    expect(serialized).not.toContain('documentUrl')
  })

  it('imports one opaque candidate and exposes text only through one bounded chunk slice', async () => {
    const ctx = await setup()
    const imported = await call(ctx, 'supramas_paper_import', {
      run_id: 'supramas:tools-demo', candidate_id: 'openalex:W1', source_type: 'experimental',
    })
    expect(imported.isError).toBe(false)
    if (imported.isError) throw new Error('expected import success')
    const summary = (imported.value as { data: { imported: { paperId: string } } }).data.imported

    const listed = await call(ctx, 'supramas_chunk_list', {
      run_id: 'supramas:tools-demo', paper_id: summary.paperId,
    })
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('expected chunk list success')
    const chunks = (listed.value as { data: { chunks: Array<{ chunk_id: string; char_count: number }> } }).data.chunks
    expect(chunks[0]?.char_count).toBeGreaterThan(15)
    expect(JSON.stringify(listed.value)).not.toContain('nanorods')

    const read = await call(ctx, 'supramas_chunk_read', {
      run_id: 'supramas:tools-demo', paper_id: summary.paperId, chunk_id: chunks[0]!.chunk_id, max_chars: 15,
    })
    expect(read.isError).toBe(false)
    if (read.isError) throw new Error('expected chunk read success')
    expect(read.value).toMatchObject({ data: { chunk: { text: 'BZO nanorods im', offset: 0, next_offset: 15, truncated: true } } })
    expect((read.value as { data: { chunk: { text: string } } }).data.chunk.text).toHaveLength(15)
  })

  it('returns stable error envelopes for unsafe bounds and missing evidence', async () => {
    const ctx = await setup()
    const tooMany = await call(ctx, 'supramas_literature_search', { query: 'q', max_results: 11 })
    expect(tooMany.isError).toBe(false)
    if (tooMany.isError) throw new Error('expected error envelope')
    expect(tooMany.value).toMatchObject({ status: 'error', error: { code: 'SUPRAMAS_LITERATURE_INVALID_REQUEST' } })

    const missing = await call(ctx, 'supramas_chunk_list', { run_id: 'supramas:tools-demo', paper_id: 'missing' })
    expect(missing.isError).toBe(false)
    if (missing.isError) throw new Error('expected error envelope')
    expect(missing.value).toMatchObject({ status: 'error', error: { code: 'SUPRAMAS_EVIDENCE_MISSING' } })
  })
})
