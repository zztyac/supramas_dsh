import { afterEach, describe, expect, it, vi } from 'vitest'
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
import SupraMasRuntime, { EvidenceCatalog, SupraMasError, SupraMasRunId } from '../src/index.ts'
import type { RunSnapshot } from '../src/types.ts'

async function setup(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-supramas-runtime-'))
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
  await ctx.plugin(SupraMasRuntime)
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

const request = {
  jobId: 'stage1-demo',
  inputTaskPath: 'runs/stage1-demo/input_task.yaml',
  runDir: 'runs/stage1-demo',
}

describe('SupraMasRuntime', () => {
  it('creates one deterministic revisioned run and returns detached snapshots', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const ctx = await setup()
    const created = await ctx.supramas.create(request)

    expect(created).toEqual({
      id: 'supramas:stage1-demo',
      jobId: 'stage1-demo',
      revision: 1,
      phase: 'created',
      inputTaskPath: 'runs/stage1-demo/input_task.yaml',
      runDir: 'runs/stage1-demo',
      createdAt: 1_000,
      updatedAt: 1_000,
    })

    ;(created as { phase: string }).phase = 'completed'
    expect(ctx.supramas.get(created.id)?.phase).toBe('created')
  })

  it('rejects duplicate job ids and invalid path ownership with stable codes', async () => {
    const ctx = await setup()
    await ctx.supramas.create(request)
    await expect(ctx.supramas.create(request)).rejects.toThrowError(
      expect.objectContaining({ code: 'SUPRAMAS_RUN_EXISTS' }),
    )
    await expect(ctx.supramas.create({
      ...request,
      jobId: 'other',
      inputTaskPath: 'runs/stage1-demo/input_task.yaml',
    })).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))
  })

  it('enforces compare-and-set revisions and the run phase graph', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(20).mockReturnValueOnce(30)
    const ctx = await setup()
    const created = await ctx.supramas.create(request)
    const taskReady = await ctx.supramas.transition(
      { id: created.id, revision: created.revision },
      { phase: 'task_ready' },
    )
    expect(taskReady).toMatchObject({ revision: 2, phase: 'task_ready', updatedAt: 20 })

    await expect(ctx.supramas.transition(
      { id: created.id, revision: 1 },
      { phase: 'running' },
    )).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_STALE_REVISION' }))

    await expect(ctx.supramas.transition(
      { id: taskReady.id, revision: taskReady.revision },
      { phase: 'completed' },
    )).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_TRANSITION' }))
  })

  it('requires failure details and allows a recoverable run to resume', async () => {
    const ctx = await setup()
    const created = await ctx.supramas.create(request)
    const ready = await ctx.supramas.transition(created, { phase: 'task_ready' })
    const running = await ctx.supramas.transition(ready, { phase: 'running' })

    await expect(ctx.supramas.transition(running, { phase: 'recoverable_failed' }))
      .rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const stopped = await ctx.supramas.transition(running, {
      phase: 'recoverable_failed',
      failure: { code: 'review-timeout', message: 'Reviewer timed out', retryable: true },
    })
    const resumed = await ctx.supramas.transition(stopped, { phase: 'running' })
    expect(resumed).toMatchObject({ phase: 'running', revision: stopped.revision + 1 })
    expect(resumed.failure).toBeUndefined()
  })

  it('lists runs in creation order without exposing mutable state', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200)
    const ctx = await setup()
    await ctx.supramas.create(request)
    await ctx.supramas.create({
      jobId: 'stage1-second',
      inputTaskPath: 'runs/stage1-second/input_task.yaml',
      runDir: 'runs/stage1-second',
    })
    const listed = ctx.supramas.list()
    expect(listed.map((run: RunSnapshot) => run.jobId)).toEqual(['stage1-demo', 'stage1-second'])
    listed.pop()
    expect(ctx.supramas.list()).toHaveLength(2)
  })

  it('uses SupraMasError for every caller-correctable failure', () => {
    const error = new SupraMasError('bad request', 'SUPRAMAS_INVALID_REQUEST')
    expect(error).toMatchObject({ name: 'SupraMasError', code: 'SUPRAMAS_INVALID_REQUEST' })
  })

  it('guards evidence access against unknown and internally inconsistent runs', async () => {
    const ctx = await setup()
    expect(() => ctx.supramas.readPaper(SupraMasRunId('supramas:missing'), 'paper'))
      .toThrowError(expect.objectContaining({ code: 'SUPRAMAS_RUN_NOT_FOUND' }))

    const created = await ctx.supramas.create(request)
    const internals = ctx.supramas as unknown as { evidence: Map<string, unknown> }
    internals.evidence.delete(created.id)
    expect(() => ctx.supramas.readPaper(created.id, 'paper'))
      .toThrowError(`SupraMAS evidence catalog missing for ${created.id}`)
  })

  it('rejects writes to unknown runs and impossible post-write catalog loss', async () => {
    const ctx = await setup()
    const missing = SupraMasRunId('supramas:missing')
    await expect(ctx.supramas.storePaper(missing, {
      paper_id: 'paper-1',
      paper_title: 'Missing run',
      local_path: 'runs/missing/papers/paper-1.json',
      source_type: 'experimental',
    })).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_RUN_NOT_FOUND' }))
    await expect(ctx.supramas.addEvidenceChunk(missing, 'paper-1', {
      chunk_id: 'chunk-1',
      text: 'missing',
    })).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_RUN_NOT_FOUND' }))

    const created = await ctx.supramas.create(request)
    await ctx.supramas.storePaper(created.id, {
      paper_id: 'paper-1',
      paper_title: 'Defensive branch',
      local_path: 'runs/stage1-demo/papers/paper-1.json',
      source_type: 'experimental',
    })
    vi.spyOn(EvidenceCatalog.prototype, 'getPaper').mockReturnValueOnce(undefined)
    await expect(ctx.supramas.addEvidenceChunk(created.id, 'paper-1', {
      chunk_id: 'chunk-1',
      text: 'stored before the defensive read',
    })).rejects.toThrow('disappeared after chunk storage')
  })

  it('fails reads before the runtime storage service is initialized', () => {
    const runtime = new SupraMasRuntime(new Context())
    expect(() => runtime.list()).toThrow('runtime is not started yet')
  })

  it('rejects every remaining invalid request boundary', async () => {
    const ctx = await setup()
    await expect(ctx.supramas.create({
      jobId: '/bad',
      inputTaskPath: 'runs/bad/input_task.yaml',
      runDir: 'runs/bad',
    })).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const created = await ctx.supramas.create(request)
    await expect(ctx.supramas.transition(created, {
      phase: 'task_ready',
      failure: { code: 'unexpected', message: 'not a failed phase', retryable: false },
    })).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const ready = await ctx.supramas.transition(created, { phase: 'task_ready' })
    const running = await ctx.supramas.transition(ready, { phase: 'running' })
    await expect(ctx.supramas.transition(running, {
      phase: 'failed',
      failure: { code: 'fatal', message: 'must not retry', retryable: true },
    })).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    await expect(ctx.supramas.transition(
      { id: SupraMasRunId('supramas:missing'), revision: 1 },
      { phase: 'task_ready' },
    )).rejects.toThrowError(expect.objectContaining({ code: 'SUPRAMAS_RUN_NOT_FOUND' }))
  })
})
