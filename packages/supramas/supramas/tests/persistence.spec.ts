import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
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
import SupraMasRuntime, {
  SupraMasRunId,
  type SupraMasRunRecord,
} from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

async function harness(root?: string): Promise<{ ctx: Context; root: string }> {
  const storageRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-supramas-'))
  if (root === undefined) roots.push(storageRoot)
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  await ctx.plugin({
    name: storageJsonName,
    inject: storageJsonInject,
    apply: storageJsonApply,
    Config: storageJsonConfig,
  }, { root: storageRoot })
  await ctx.plugin({
    name: storageDomainName,
    inject: storageDomainInject,
    apply: storageDomainApply,
    Config: storageDomainConfig,
  }, { backend: 'json' })
  await ctx.plugin(SupraMasRuntime)
  return { ctx, root: storageRoot }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  })))
})

describe('SupraMAS durable recovery', () => {
  it('restores runs and evidence, then marks interrupted work as resumable', async () => {
    const first = await harness()
    const untouched = await first.ctx.supramas.create({
      jobId: 'untouched-demo',
      inputTaskPath: 'runs/untouched-demo/input_task.yaml',
      runDir: 'runs/untouched-demo',
    })
    const created = await first.ctx.supramas.create({
      jobId: 'restart-demo',
      inputTaskPath: 'runs/restart-demo/input_task.yaml',
      runDir: 'runs/restart-demo',
    })
    const ready = await first.ctx.supramas.transition(created, { phase: 'task_ready' })
    const running = await first.ctx.supramas.transition(ready, { phase: 'running' })
    await first.ctx.supramas.storePaper(running.id, {
      paper_id: 'paper-1',
      paper_title: 'Durable BZO study',
      local_path: 'runs/restart-demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    await first.ctx.supramas.addEvidenceChunk(running.id, 'paper-1', {
      chunk_id: 'paper-1-p1',
      page: 1,
      text: 'Durable local evidence survives a process restart.',
    })
    await first.ctx.supramas.addEvidenceChunk(running.id, 'paper-1', {
      chunk_id: 'paper-1-unpaged',
      text: 'Evidence without a page remains durable too.',
    })
    const validatingCreated = await first.ctx.supramas.create({
      jobId: 'validating-demo',
      inputTaskPath: 'runs/validating-demo/input_task.yaml',
      runDir: 'runs/validating-demo',
    })
    const validatingReady = await first.ctx.supramas.transition(validatingCreated, { phase: 'task_ready' })
    const validatingRunning = await first.ctx.supramas.transition(validatingReady, { phase: 'running' })
    const validating = await first.ctx.supramas.transition(validatingRunning, { phase: 'validating' })
    await first.ctx.fiber.dispose()

    const second = await harness(first.root)
    expect(second.ctx.supramas.get(untouched.id)).toMatchObject({
      phase: 'created',
      revision: untouched.revision,
    })
    const restored = second.ctx.supramas.get(running.id)
    expect(restored).toMatchObject({
      phase: 'recoverable_failed',
      revision: running.revision + 1,
      failure: { code: 'process-restarted', retryable: true },
    })
    expect(second.ctx.supramas.readPaper(running.id, 'paper-1')).toMatchObject({
      paper_id: 'paper-1',
      chunks: [
        { chunk_id: 'paper-1-p1', page: 1 },
        { chunk_id: 'paper-1-unpaged' },
      ],
    })
    expect(second.ctx.supramas.get(validating.id)).toMatchObject({
      phase: 'recoverable_failed',
      revision: validating.revision + 1,
    })
    expect(second.ctx.supramas.verifyEvidence(running.id, 'paper-1', {
      chunk_id: 'paper-1-p1',
      page: 1,
      evidence_text: 'survives a process restart',
    })).toMatchObject({ verified: true, paper_id: 'paper-1' })

    if (restored === undefined) throw new Error('expected recovered run')
    const resumed = await second.ctx.supramas.transition(restored, { phase: 'running' })
    expect(resumed).toMatchObject({ phase: 'running', revision: restored.revision + 1 })
  })

  it('keeps memory empty when the durable create cannot publish', async () => {
    const { ctx, root } = await harness()
    await mkdir(join(root, 'supramas.json'))

    await expect(ctx.supramas.create({
      jobId: 'write-failure',
      inputTaskPath: 'runs/write-failure/input_task.yaml',
      runDir: 'runs/write-failure',
    })).rejects.toBeDefined()
    expect(ctx.supramas.list()).toEqual([])
  })

  it('rejects durable run identities and paper keys that disagree with their records', async () => {
    const identity = await harness()
    const identityRecord: SupraMasRunRecord = {
      sequence: 0,
      snapshot: {
        id: SupraMasRunId('supramas:identity-record'),
        jobId: 'identity-record',
        revision: 1,
        phase: 'created',
        inputTaskPath: 'runs/identity-record/input_task.yaml',
        runDir: 'runs/identity-record',
        createdAt: 1,
        updatedAt: 1,
      },
      papers: {},
    }
    const identityTable = (identity.ctx.supramas as unknown as {
      table: { put(key: string, value: SupraMasRunRecord): Promise<void> }
    }).table
    await identityTable.put('supramas:different-key', identityRecord)
    await identity.ctx.fiber.dispose()
    await expect(harness(identity.root)).rejects.toThrow('does not match its snapshot identity')

    const paper = await harness()
    const paperId = SupraMasRunId('supramas:paper-record')
    const paperRecord: SupraMasRunRecord = {
      sequence: 0,
      snapshot: {
        id: paperId,
        jobId: 'paper-record',
        revision: 1,
        phase: 'created',
        inputTaskPath: 'runs/paper-record/input_task.yaml',
        runDir: 'runs/paper-record',
        createdAt: 1,
        updatedAt: 1,
      },
      papers: {
        'wrong-paper-key': {
          paper_id: 'paper-1',
          paper_title: 'Stored title',
          local_path: 'runs/paper-record/papers/paper-1.json',
          source_type: 'experimental',
          chunks: [],
        },
      },
    }
    const paperTable = (paper.ctx.supramas as unknown as {
      table: { put(key: string, value: SupraMasRunRecord): Promise<void> }
    }).table
    await paperTable.put(paperId, paperRecord)
    await paper.ctx.fiber.dispose()
    await expect(harness(paper.root)).rejects.toThrow('does not match artifact')
  })

  it('rejects a durable workflow owned by a different job', async () => {
    const first = await harness()
    const created = await first.ctx.supramas.create({
      jobId: 'workflow-owner',
      inputTaskPath: 'runs/workflow-owner/input_task.yaml',
      runDir: 'runs/workflow-owner',
    })
    const ready = await first.ctx.supramas.transition(created, { phase: 'task_ready' })
    const started = await first.ctx.supramas.startStage1(ready, {
      jobId: 'workflow-owner',
      researchTopic: 'REBCO flux pinning',
      maxDepth: 0,
      maxRootAttempts: 1,
      maxChildAttemptsPerLimitation: 1,
    })
    const table = (first.ctx.supramas as unknown as {
      table: {
        get(key: string): SupraMasRunRecord | undefined
        put(key: string, value: SupraMasRunRecord): Promise<void>
      }
    }).table
    const record = table.get(started.run.id)
    if (record?.workflow === undefined) throw new Error('expected durable workflow record')
    await table.put(started.run.id, {
      ...record,
      workflow: {
        ...record.workflow,
        config: { ...record.workflow.config, jobId: 'different-owner' },
      },
    })
    await first.ctx.fiber.dispose()

    await expect(harness(first.root))
      .rejects.toThrow('workflow job different-owner does not match run workflow-owner')
  })
})
