import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName } from '@deepseek-ai/dsh-storage-json'
import { apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName } from '@deepseek-ai/dsh-storage-domain'
import SupraMasRuntime from '../../supramas/src/index.ts'
import SupraMasArtifacts from '../../supramas-artifacts/src/index.ts'
import LiteratureRuntime, {
  LiteratureError,
  type DocumentParserProvider,
  type LiteratureIndexProvider,
  type PaperAcquisitionProvider,
  type PaperAcquisitionRequest,
} from '../../supramas-literature/src/index.ts'
import SupraMasPaperIngest, { paperIdForCandidate } from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function setup(parser: DocumentParserProvider) {
  const storageRoot = await mkdtemp(join(tmpdir(), 'dsh-ingest-storage-'))
  const artifactRoot = await mkdtemp(join(tmpdir(), 'dsh-ingest-artifacts-'))
  roots.push(storageRoot, artifactRoot)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin(
    { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig },
    { root: storageRoot },
  )
  await ctx.plugin({ name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }, { backend: 'json' })
  await ctx.plugin(SupraMasRuntime)
  await ctx.plugin(SupraMasArtifacts, { root: artifactRoot })
  await ctx.plugin(LiteratureRuntime, { minDocumentBytes: 5, maxDocumentBytes: 1_000 })
  const index: LiteratureIndexProvider = {
    id: 'openalex',
    available: () => true,
    search: vi.fn(() => Promise.resolve({ candidates: [], truncated: false })),
    resolve: vi.fn((externalId: string) => Promise.resolve({
      externalId,
      title: 'Full-text REBCO evidence',
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
  ctx.supramasLiterature.registerIndexProvider(index)
  ctx.supramasLiterature.registerAcquisitionProvider(acquisition)
  ctx.supramasLiterature.registerParserProvider(parser)
  await ctx.plugin(SupraMasPaperIngest, { maxChunkChars: 30, overlapChars: 5 })
  const run = await ctx.supramas.create({ jobId: 'ingest-demo', inputTaskPath: 'runs/ingest-demo/input_task.yaml', runDir: 'runs/ingest-demo' })
  return { ctx, run, artifactRoot, acquisition }
}

describe('SupraMasPaperIngest', () => {
  it('imports acquired bytes, parsed pages, stable chunks, and compatibility JSON end to end', async () => {
    const parser: DocumentParserProvider = {
      id: 'pypdf',
      available: () => true,
      parse: vi.fn(() => Promise.resolve({ pages: [
        { pageNumber: 1, text: 'BZO nanorods improve in-field current density.' },
        { pageNumber: 2, text: 'The study used one loading and reports a limitation.' },
      ] })),
    }
    const { ctx, run, artifactRoot } = await setup(parser)
    const summary = await ctx.supramasPaperIngest.importCandidate(run.id, 'openalex:W123', 'experimental')
    const paperId = paperIdForCandidate('openalex:W123')
    expect(summary).toMatchObject({ paperId, pageCount: 2, sourceBytes: 13 })
    expect(summary.chunkCount).toBeGreaterThan(2)
    expect(new TextDecoder().decode(await readFile(join(artifactRoot, summary.sourcePath)))).toBe('%PDF-complete')
    const artifact = ctx.supramas.readPaper(run.id, paperId)
    expect(artifact?.full_text_source).toEqual({
      local_path: summary.sourcePath,
      media_type: 'application/pdf',
      sha256: summary.sourceSha256,
      byte_length: summary.sourceBytes,
      page_count: summary.pageCount,
    })
    expect(artifact?.chunks).toHaveLength(summary.chunkCount)
    expect(artifact?.chunks[0]).toMatchObject({
      page: 1,
      chunk_id: `${paperId}-p1-c1`,
      evidence_kind: 'full_text',
    })
    const compatible = JSON.parse(await readFile(join(artifactRoot, summary.artifactPath), 'utf8')) as {
      chunks: Array<{ evidence_kind: string }>
      full_text_source: { sha256: string }
    }
    expect(compatible.chunks).toHaveLength(summary.chunkCount)
    expect(compatible.chunks.every(chunk => chunk.evidence_kind === 'full_text')).toBe(true)
    expect(compatible.full_text_source.sha256).toBe(summary.sourceSha256)
  })

  it('leaves no durable paper or compatibility JSON when parsing fails', async () => {
    const parser: DocumentParserProvider = {
      id: 'pypdf',
      available: () => true,
      parse: vi.fn(() => Promise.reject(new LiteratureError('scanned PDF', 'SUPRAMAS_LITERATURE_NO_TEXT'))),
    }
    const { ctx, run, artifactRoot } = await setup(parser)
    const paperId = paperIdForCandidate('openalex:W404')
    await expect(ctx.supramasPaperIngest.importCandidate(run.id, 'openalex:W404'))
      .rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_NO_TEXT' })
    expect(ctx.supramas.readPaper(run.id, paperId)).toBeUndefined()
    await expect(readFile(join(artifactRoot, `runs/ingest-demo/papers/${paperId}.json`))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('accepts a discovered fallback PDF only when parsed text matches the resolved paper identity', async () => {
    const matchingParser: DocumentParserProvider = {
      id: 'pypdf',
      available: () => true,
      parse: vi.fn(() => Promise.resolve({ pages: [{
        pageNumber: 1,
        text: 'Full-text REBCO evidence reports reproducible vortex-pinning measurements.',
      }] })),
    }
    const matching = await setup(matchingParser)
    await matching.ctx.supramasPaperIngest.importCandidate(
      matching.run.id,
      'openalex:W123',
      'experimental',
      undefined,
      'https://repository.example.edu/W123.pdf',
    )
    expect(matching.acquisition.acquire).toHaveBeenCalledWith(
      { url: 'https://repository.example.edu/W123.pdf', maxBytes: 1_000 },
      undefined,
    )

    const mismatchedParser: DocumentParserProvider = {
      id: 'pypdf',
      available: () => true,
      parse: vi.fn(() => Promise.resolve({ pages: [{
        pageNumber: 1,
        text: 'An unrelated polymer mechanics article with no superconducting content.',
      }] })),
    }
    const mismatched = await setup(mismatchedParser)
    await expect(mismatched.ctx.supramasPaperIngest.importCandidate(
      mismatched.run.id,
      'openalex:W123',
      'experimental',
      undefined,
      'https://repository.example.edu/wrong.pdf',
    )).rejects.toMatchObject({ code: 'SUPRAMAS_LITERATURE_IDENTITY_MISMATCH' })
  })
})
