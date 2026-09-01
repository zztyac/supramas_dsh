import { afterEach, describe, expect, it } from 'vitest'
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
import SupraMasArtifacts from '../../supramas-artifacts/src/index.ts'
import * as ToolSupraMas from '../src/index.ts'

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
  await ctx.plugin(SupraMasArtifacts, { root })
  await ctx.plugin(ToolSupraMas)
  const run = await ctx.supramas.create({
    jobId: 'demo', inputTaskPath: 'runs/demo/input_task.yaml', runDir: 'runs/demo',
  })
  await ctx.supramas.storePaper(run.id, {
    paper_id: 'paper-1',
    paper_title: 'BZO pinning in REBCO',
    local_path: 'runs/demo/papers/paper-1.json',
    source_type: 'experimental',
  })
  await ctx.supramas.addEvidenceChunk(run.id, 'paper-1', {
    chunk_id: 'paper-1-abstract',
    page: 1,
    text: 'The abstract reports improved in-field Jc.',
    evidence_kind: 'abstract',
  })
  return ctx
}

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
  it('does not expose legacy model-facing paper or chunk mutation tools', async () => {
    const ctx = await setup()
    const names = ctx.tools.schemas().map(schema => schema.name)
    expect(names).not.toContain('supramas_paper_store')
    expect(names).not.toContain('supramas_chunk_extract')
    expect(names).not.toContain('supramas_artifact_read')
  })

  it('returns the durable evidence kind when a reviewer verifies a literal quote', async () => {
    const ctx = await setup()
    const verified = await call(ctx, 'supramas_evidence_verify', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-abstract',
      page: 1,
      evidence_text: 'improved in-field Jc',
    })
    expect(verified.isError).toBe(false)
    if (verified.isError) throw new Error('expected evidence verification success')
    expect(verified.value).toMatchObject({
      status: 'success',
      data: { verification: { verified: true, evidence_kind: 'abstract' } },
    })
  })

  it('returns an actionable domain error when a quote is not in the local chunk', async () => {
    const ctx = await setup()
    const mismatch = await call(ctx, 'supramas_evidence_verify', {
      run_id: 'supramas:demo',
      paper_id: 'paper-1',
      chunk_id: 'paper-1-abstract',
      page: 1,
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
})
