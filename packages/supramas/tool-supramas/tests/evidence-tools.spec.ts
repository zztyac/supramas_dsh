import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply,
  Config as storageJsonConfig,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply,
  Config as storageDomainConfig,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SupraMasRuntime from '../../supramas/src/index.ts'
import * as ToolSupraMas from '../src/index.ts'

async function setup(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-tools-'))
  roots.push(root)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({
    name: storageJsonName,
    inject: storageJsonInject,
    apply: storageJsonApply,
    Config: storageJsonConfig,
  }, { root })
  await ctx.plugin({
    name: storageDomainName,
    inject: storageDomainInject,
    apply: storageDomainApply,
    Config: storageDomainConfig,
  }, { backend: 'json' })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SupraMasRuntime)
  await ctx.plugin(ToolSupraMas)
  await ctx.supramas.create({ jobId: 'demo', inputTaskPath: 'runs/demo/input_task.yaml', runDir: 'runs/demo' })
  return ctx
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })))
})

let callId = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`supramas-evidence-${++callId}`),
    name,
    arguments: args,
  })
}

describe('SupraMAS evidence tools', () => {
  it('stores a canonical run-local paper and one provenance-bound chunk', async () => {
    const ctx = await setup()
    const paper = await call(ctx, 'supramas_paper_store', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      paper_title: 'BZO pinning in REBCO',
      local_path: 'runs/demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    expect(paper.isError).toBe(false)
    if (paper.isError) throw new Error('expected paper store success')
    expect(paper.value).toMatchObject({
      status: 'success',
      artifacts: ['runs/demo/papers/paper-1.json'],
      data: { paper: { paper_id: 'paper-1', chunk_count: 0 } },
    })

    const chunk = await call(ctx, 'supramas_chunk_extract', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-p2-performance',
      page: 2,
      text: 'The BZO film retained high in-field Jc at 77 K and 5 T.',
    })
    expect(chunk.isError).toBe(false)
    if (chunk.isError) throw new Error('expected chunk extraction success')
    expect(chunk.value).toMatchObject({
      status: 'success',
      data: { chunk: { chunk_id: 'paper-1-p2-performance', page: 2 } },
    })
  })

  it('lets a reviewer read the local artifact and verify an exact evidence quote', async () => {
    const ctx = await setup()
    await call(ctx, 'supramas_paper_store', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      paper_title: 'BZO pinning in REBCO',
      local_path: 'runs/demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    await call(ctx, 'supramas_chunk_extract', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-p2-performance',
      page: 2,
      text: 'The BZO film retained high in-field Jc at 77 K and 5 T.',
    })

    const artifact = await call(ctx, 'supramas_artifact_read', { run_id: 'supramas:demo', paper_id: 'paper-1' })
    expect(artifact.isError).toBe(false)
    if (artifact.isError) throw new Error('expected artifact read success')
    expect(artifact.value).toMatchObject({
      status: 'success',
      data: { artifact: { paper_id: 'paper-1', chunks: [{ chunk_id: 'paper-1-p2-performance' }] } },
    })

    const verified = await call(ctx, 'supramas_evidence_verify', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-p2-performance',
      page: 2,
      evidence_text: 'retained high in-field Jc at 77 K and 5 T',
    })
    expect(verified.isError).toBe(false)
    if (verified.isError) throw new Error('expected evidence verification success')
    expect(verified.value).toMatchObject({
      status: 'success',
      data: { verification: { verified: true, chunk_id: 'paper-1-p2-performance' } },
    })
  })

  it('returns an actionable domain error when a quote is not in the local chunk', async () => {
    const ctx = await setup()
    await call(ctx, 'supramas_paper_store', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      paper_title: 'BZO pinning in REBCO',
      local_path: 'runs/demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    await call(ctx, 'supramas_chunk_extract', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-p2-performance',
      page: 2,
      text: 'The BZO film retained high in-field Jc at 77 K and 5 T.',
    })

    const mismatch = await call(ctx, 'supramas_evidence_verify', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-p2-performance',
      page: 2,
      evidence_text: 'invented measurement',
    })
    expect(mismatch.isError).toBe(false)
    if (mismatch.isError) throw new Error('expected domain error envelope')
    expect(mismatch.value).toMatchObject({
      status: 'error',
      next_actions: ['read_local_artifact', 'correct_evidence_quote'],
      error: { code: 'SUPRAMAS_EVIDENCE_MISMATCH' },
    })
  })

  it('routes missing and duplicate provenance to distinct recovery actions', async () => {
    const ctx = await setup()
    const missing = await call(ctx, 'supramas_artifact_read', {
      run_id: 'supramas:demo',
      paper_id: 'missing',
    })
    expect(missing.isError).toBe(false)
    if (missing.isError) throw new Error('expected missing-evidence envelope')
    expect(missing.value).toMatchObject({
      status: 'error',
      next_actions: ['store_local_paper_or_chunk', 'retry_evidence_lookup'],
      error: { code: 'SUPRAMAS_EVIDENCE_MISSING' },
    })

    const args = {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      paper_title: 'BZO pinning in REBCO',
      local_path: 'runs/demo/papers/paper-1.json',
      source_type: 'experimental',
    }
    await call(ctx, 'supramas_paper_store', args)
    const duplicate = await call(ctx, 'supramas_paper_store', args)
    expect(duplicate.isError).toBe(false)
    if (duplicate.isError) throw new Error('expected duplicate-id envelope')
    expect(duplicate.value).toMatchObject({
      status: 'error',
      next_actions: ['choose_unique_artifact_id', 'inspect_existing_artifact'],
      error: { code: 'SUPRAMAS_DUPLICATE_ID' },
    })
  })

  it('supports evidence without a claimed page and omits nullish pages from model output', async () => {
    const ctx = await setup()
    await call(ctx, 'supramas_paper_store', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      paper_title: 'BZO pinning in REBCO',
      local_path: 'runs/demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    const chunk = await call(ctx, 'supramas_chunk_extract', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-unpaged',
      text: 'The local chunk has no reliable page marker.',
    })
    expect(chunk.isError).toBe(false)
    if (chunk.isError) throw new Error('expected unpaged chunk success')
    expect(chunk.value).toMatchObject({ data: { chunk: { chunk_id: 'paper-1-unpaged' } } })
    expect((chunk.value as { data: { chunk: object } }).data.chunk).not.toHaveProperty('page')

    const artifact = await call(ctx, 'supramas_artifact_read', {
      run_id: 'supramas:demo', paper_id: 'paper-1',
    })
    expect(artifact.isError).toBe(false)
    if (artifact.isError) throw new Error('expected artifact success')
    const storedChunk = (artifact.value as { data: { artifact: { chunks: object[] } } }).data.artifact.chunks[0]
    expect(storedChunk).not.toHaveProperty('page')

    const verified = await call(ctx, 'supramas_evidence_verify', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-unpaged',
      evidence_text: 'no reliable page marker',
    })
    expect(verified.isError).toBe(false)
    if (verified.isError) throw new Error('expected unpaged verification success')
    expect(verified.value).toMatchObject({ status: 'success' })
  })

  it('does not hide an impossible post-store artifact disappearance', async () => {
    const ctx = await setup()
    await call(ctx, 'supramas_paper_store', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      paper_title: 'BZO pinning in REBCO',
      local_path: 'runs/demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    vi.spyOn(ctx.supramas, 'readPaper').mockReturnValue(undefined)

    const result = await call(ctx, 'supramas_chunk_extract', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-inconsistent',
      text: 'Stored before the simulated internal inconsistency.',
    })
    expect(result.isError).toBe(true)
  })
})
