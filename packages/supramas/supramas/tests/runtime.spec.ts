import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SupraMasRuntime, { SupraMasError, SupraMasRunId } from '../src/index.ts'
import type { RunSnapshot } from '../src/types.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SupraMasRuntime)
  return ctx
}

const request = {
  jobId: 'stage1-demo',
  inputTaskPath: 'runs/stage1-demo/input_task.yaml',
  runDir: 'runs/stage1-demo',
}

describe('SupraMasRuntime', () => {
  it('creates one deterministic revisioned run and returns detached snapshots', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const ctx = await setup()
    const created = ctx.supramas.create(request)

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
    ctx.supramas.create(request)
    expect(() => ctx.supramas.create(request)).toThrowError(
      expect.objectContaining({ code: 'SUPRAMAS_RUN_EXISTS' }),
    )
    expect(() => ctx.supramas.create({
      ...request,
      jobId: 'other',
      inputTaskPath: 'runs/stage1-demo/input_task.yaml',
    })).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))
  })

  it('enforces compare-and-set revisions and the run phase graph', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(10).mockReturnValueOnce(20).mockReturnValueOnce(30)
    const ctx = await setup()
    const created = ctx.supramas.create(request)
    const taskReady = ctx.supramas.transition(
      { id: created.id, revision: created.revision },
      { phase: 'task_ready' },
    )
    expect(taskReady).toMatchObject({ revision: 2, phase: 'task_ready', updatedAt: 20 })

    expect(() => ctx.supramas.transition(
      { id: created.id, revision: 1 },
      { phase: 'running' },
    )).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_STALE_REVISION' }))

    expect(() => ctx.supramas.transition(
      { id: taskReady.id, revision: taskReady.revision },
      { phase: 'completed' },
    )).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_TRANSITION' }))
  })

  it('requires failure details and allows a recoverable run to resume', async () => {
    const ctx = await setup()
    const created = ctx.supramas.create(request)
    const ready = ctx.supramas.transition(created, { phase: 'task_ready' })
    const running = ctx.supramas.transition(ready, { phase: 'running' })

    expect(() => ctx.supramas.transition(running, { phase: 'recoverable_failed' }))
      .toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const stopped = ctx.supramas.transition(running, {
      phase: 'recoverable_failed',
      failure: { code: 'review-timeout', message: 'Reviewer timed out', retryable: true },
    })
    const resumed = ctx.supramas.transition(stopped, { phase: 'running' })
    expect(resumed).toMatchObject({ phase: 'running', revision: stopped.revision + 1 })
    expect(resumed.failure).toBeUndefined()
  })

  it('lists runs in creation order without exposing mutable state', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200)
    const ctx = await setup()
    ctx.supramas.create(request)
    ctx.supramas.create({
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

  it('rejects every remaining invalid request boundary', async () => {
    const ctx = await setup()
    expect(() => ctx.supramas.create({
      jobId: '/bad',
      inputTaskPath: 'runs/bad/input_task.yaml',
      runDir: 'runs/bad',
    })).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const created = ctx.supramas.create(request)
    expect(() => ctx.supramas.transition(created, {
      phase: 'task_ready',
      failure: { code: 'unexpected', message: 'not a failed phase', retryable: false },
    })).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    const ready = ctx.supramas.transition(created, { phase: 'task_ready' })
    const running = ctx.supramas.transition(ready, { phase: 'running' })
    expect(() => ctx.supramas.transition(running, {
      phase: 'failed',
      failure: { code: 'fatal', message: 'must not retry', retryable: true },
    })).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_INVALID_REQUEST' }))

    expect(() => ctx.supramas.transition(
      { id: SupraMasRunId('supramas:missing'), revision: 1 },
      { phase: 'task_ready' },
    )).toThrowError(expect.objectContaining({ code: 'SUPRAMAS_RUN_NOT_FOUND' }))
  })
})
