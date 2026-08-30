import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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
  type PaperNodeDraft,
  type SupraMasRunRecord,
  type Stage1ReviewSubmission,
} from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

async function harness(root?: string): Promise<{ ctx: Context; root: string }> {
  const storageRoot = root ?? await mkdtemp(join(tmpdir(), 'dsh-supramas-workflow-'))
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

const runRequest = {
  jobId: 'workflow-demo',
  inputTaskPath: 'runs/workflow-demo/input_task.yaml',
  runDir: 'runs/workflow-demo',
}

const workflowConfig = {
  jobId: 'workflow-demo',
  researchTopic: 'REBCO flux pinning',
  maxDepth: 0,
  maxRootAttempts: 2,
  maxChildAttemptsPerLimitation: 2,
}

const rootDraft: PaperNodeDraft = {
  paper_id: 'paper-1',
  paper_title: 'Durable root paper',
  source_type: 'experimental',
  strategy_records: [{
    record_id: 'R1',
    tuning_dimension: 'Composition tuning',
    tuning_strategy: 'Add BZO artificial pinning centers.',
    tuning_effect: 'BZO additions improve in-field Jc.',
    evidence: {
      chunk_id: 'paper-1-c1',
      page: 1,
      evidence_text: 'BZO additions improve in-field Jc',
    },
    confidence: 0.9,
  }],
  limitation_records: [{
    limitation_id: 'L1',
    limitation: 'Only one loading was measured.',
    expectation: 'Compare multiple BZO loadings.',
    related_record_ids: ['R1'],
    evidence: {
      chunk_id: 'paper-1-c1',
      page: 1,
      evidence_text: 'only one loading was measured',
    },
    confidence: 0.9,
  }],
}

const acceptedReview: Stage1ReviewSubmission = {
  decision: 'accept',
  summary: 'The local chunk supports the candidate.',
  critical_issues: [],
  edge_issues: [],
  acceptance_conditions: [],
}

async function readyRun(ctx: Context) {
  const created = await ctx.supramas.create(runRequest)
  const ready = await ctx.supramas.transition(created, { phase: 'task_ready' })
  await ctx.supramas.storePaper(ready.id, {
    paper_id: 'paper-1',
    paper_title: 'Durable root paper',
    local_path: 'runs/workflow-demo/papers/paper-1.json',
    source_type: 'experimental',
  })
  await ctx.supramas.addEvidenceChunk(ready.id, 'paper-1', {
    chunk_id: 'paper-1-c1',
    page: 1,
    text: 'BZO additions improve in-field Jc, but only one loading was measured.',
  })
  return ready
}

describe('durable Stage 1 workflow', () => {
  it('resumes the exact reviewer action after restart and finalizes atomically', async () => {
    const first = await harness()
    const ready = await readyRun(first.ctx)
    const started = await first.ctx.supramas.startStage1(ready, workflowConfig)
    expect(started).toMatchObject({
      run: { phase: 'running', revision: ready.revision + 1 },
      nextAction: { kind: 'build_root' },
    })
    const built = await first.ctx.supramas.submitStage1Builder(started.run, {
      paper_node: rootDraft,
      edge: null,
      notes: [],
    })
    expect(built.nextAction).toMatchObject({ kind: 'review_candidate', paper_id: 'paper-1' })
    await first.ctx.fiber.dispose()

    const second = await harness(first.root)
    const restored = second.ctx.supramas.getStage1(built.run.id)
    expect(restored).toMatchObject({
      run: { phase: 'recoverable_failed', revision: built.run.revision + 1 },
      nextAction: { kind: 'review_candidate', paper_id: 'paper-1' },
    })
    if (restored === undefined) throw new Error('expected durable Stage 1 state')

    const resumed = await second.ctx.supramas.transition(restored.run, { phase: 'running' })
    const reviewed = await second.ctx.supramas.submitStage1Review(resumed, acceptedReview)
    expect(reviewed.nextAction).toEqual({ kind: 'finalize' })

    const completed = await second.ctx.supramas.finalizeStage1(reviewed.run)
    expect(completed).toMatchObject({
      run: { phase: 'completed', revision: reviewed.run.revision + 1 },
      workflow: { status: 'completed' },
      tree: { job_id: 'workflow-demo', nodes: [{ paper_id: 'paper-1' }] },
    })
  })

  it('rejects stale workflow writes and mismatched workflow ownership', async () => {
    const { ctx } = await harness()
    const ready = await readyRun(ctx)
    await expect(ctx.supramas.startStage1(ready, { ...workflowConfig, jobId: 'other' }))
      .rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const started = await ctx.supramas.startStage1(ready, workflowConfig)
    await ctx.supramas.submitStage1Builder(started.run, {
      paper_node: rootDraft,
      edge: null,
      notes: [],
    })
    await expect(ctx.supramas.submitStage1Builder(started.run, {
      paper_node: null,
      edge: null,
      reason: 'stale write',
      notes: [],
    })).rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_STALE_REVISION' }))
  })

  it('rejects missing runs, missing workflows, and invalid workflow phases', async () => {
    const missing = SupraMasRunId('supramas:missing-workflow')
    const missingHarness = await harness()
    expect(missingHarness.ctx.supramas.get(missing)).toBeUndefined()
    expect(missingHarness.ctx.supramas.getStage1(missing)).toBeUndefined()
    await expect(missingHarness.ctx.supramas.submitStage1Builder({ id: missing, revision: 1 }, {
      paper_node: null,
      edge: null,
      reason: 'no candidate',
      notes: [],
    })).rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_RUN_NOT_FOUND' }))

    const createdHarness = await harness()
    const created = await createdHarness.ctx.supramas.create({
      jobId: 'created-boundary',
      inputTaskPath: 'runs/created-boundary/input_task.yaml',
      runDir: 'runs/created-boundary',
    })
    expect(createdHarness.ctx.supramas.getStage1(created.id)).toBeUndefined()
    await expect(createdHarness.ctx.supramas.startStage1(created, {
      ...workflowConfig,
      jobId: 'created-boundary',
    })).rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_INVALID_TRANSITION' }))

    const workflowlessHarness = await harness()
    const workflowlessCreated = await workflowlessHarness.ctx.supramas.create({
      jobId: 'workflowless',
      inputTaskPath: 'runs/workflowless/input_task.yaml',
      runDir: 'runs/workflowless',
    })
    const workflowlessReady = await workflowlessHarness.ctx.supramas.transition(workflowlessCreated, {
      phase: 'task_ready',
    })
    const workflowlessRunning = await workflowlessHarness.ctx.supramas.transition(workflowlessReady, {
      phase: 'running',
    })
    await expect(workflowlessHarness.ctx.supramas.submitStage1Builder(workflowlessRunning, {
      paper_node: null,
      edge: null,
      reason: 'no workflow',
      notes: [],
    })).rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const stoppedHarness = await harness()
    const stoppedReady = await readyRun(stoppedHarness.ctx)
    const stoppedStarted = await stoppedHarness.ctx.supramas.startStage1(stoppedReady, workflowConfig)
    const stopped = await stoppedHarness.ctx.supramas.transition(stoppedStarted.run, {
      phase: 'recoverable_failed',
      failure: {
        code: 'paused-for-test',
        message: 'workflow is intentionally not running',
        retryable: true,
      },
    })
    await expect(stoppedHarness.ctx.supramas.submitStage1Builder(stopped, {
      paper_node: null,
      edge: null,
      reason: 'wrong phase',
      notes: [],
    })).rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_INVALID_TRANSITION' }))
  })

  it('rejects a second workflow embedded in a corrupted task-ready record', async () => {
    const { ctx } = await harness()
    const ready = await readyRun(ctx)
    const started = await ctx.supramas.startStage1(ready, workflowConfig)
    const table = (ctx.supramas as unknown as {
      table: {
        get(key: string): SupraMasRunRecord | undefined
        put(key: string, value: SupraMasRunRecord): Promise<void>
      }
    }).table
    const record = table.get(started.run.id)
    if (record === undefined) throw new Error('expected durable workflow record')
    await table.put(started.run.id, {
      ...record,
      snapshot: { ...record.snapshot, phase: 'task_ready' },
    })

    await expect(ctx.supramas.startStage1(started.run, workflowConfig))
      .rejects.toThrow(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))
  })
})
