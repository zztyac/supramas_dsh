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

const contexts: Context[] = []
const roots: string[] = []

async function setup(loadTools = true): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-supramas-'))
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
  if (loadTools) await ctx.plugin(ToolSupraMas)
  return ctx
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

let callId = 0
function call(ctx: Context, name: string, args: unknown) {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`supramas-${++callId}`),
    name,
    arguments: args,
  })
}

describe('dsh-tool-supramas', () => {
  it('registers the run and evidence model-facing tools', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'supramas_run_create',
      'supramas_run_list',
      'supramas_run_get',
      'supramas_run_transition',
      'supramas_paper_store',
      'supramas_chunk_extract',
      'supramas_artifact_read',
      'supramas_evidence_verify',
    ])
  })

  it('creates a run through a deterministic success envelope', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'supramas_run_create', {
      job_id: 'demo',
      input_task_path: 'runs/demo/input_task.yaml',
      run_dir: 'runs/demo',
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected run creation success')
    expect(result.value).toMatchObject({
      status: 'success',
      summary: 'Created SupraMAS run demo.',
      next_actions: ['prepare_input_task'],
      artifacts: ['runs/demo/input_task.yaml', 'runs/demo'],
      data: {
        run: { id: 'supramas:demo', jobId: 'demo', revision: 1, phase: 'created' },
      },
    })
  })

  it('returns a caller-actionable error envelope for a duplicate run', async () => {
    const ctx = await setup()
    const args = {
      job_id: 'demo',
      input_task_path: 'runs/demo/input_task.yaml',
      run_dir: 'runs/demo',
    }
    await call(ctx, 'supramas_run_create', args)
    const result = await call(ctx, 'supramas_run_create', args)
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected domain error envelope')
    expect(result.value).toMatchObject({
      status: 'error',
      next_actions: ['choose_another_job_id', 'inspect_existing_run'],
      artifacts: [],
      error: {
        code: 'SUPRAMAS_RUN_EXISTS',
        root_cause_hint: expect.stringContaining('already exists'),
        safe_retry: expect.stringContaining('job_id'),
        stop_condition: expect.stringContaining('Do not overwrite'),
      },
    })
  })

  it('reads a run and reports a stable recovery path when it is absent', async () => {
    const ctx = await setup()
    const missing = await call(ctx, 'supramas_run_get', { run_id: 'supramas:missing' })
    expect(missing.isError).toBe(false)
    if (missing.isError) throw new Error('expected missing-run envelope')
    expect(missing.value).toMatchObject({
      status: 'error',
      next_actions: ['list_or_create_run'],
      error: { code: 'SUPRAMAS_RUN_NOT_FOUND' },
    })
  })

  it('rejects malformed model arguments before execution', async () => {
    const ctx = await setup()
    const result = await call(ctx, 'supramas_run_create', { job_id: 'demo' })
    expect(result.isError).toBe(true)
  })

  it('unregisters all tools when the plugin fiber is disposed', async () => {
    const ctx = await setup(false)
    const fiber = await ctx.plugin(ToolSupraMas)
    expect(ctx.tools.schemas()).toHaveLength(8)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('reads created and advanced runs with phase-specific next actions', async () => {
    const ctx = await setup()
    const created = await ctx.supramas.create({
      jobId: 'demo',
      inputTaskPath: 'runs/demo/input_task.yaml',
      runDir: 'runs/demo',
    })
    const initial = await call(ctx, 'supramas_run_get', { run_id: created.id })
    expect(initial.isError).toBe(false)
    if (initial.isError) throw new Error('expected created run')
    expect(initial.value).toMatchObject({ next_actions: ['prepare_input_task'] })

    await ctx.supramas.transition(created, { phase: 'task_ready' })
    const advanced = await call(ctx, 'supramas_run_get', { run_id: created.id })
    expect(advanced.isError).toBe(false)
    if (advanced.isError) throw new Error('expected advanced run')
    expect(advanced.value).toMatchObject({ next_actions: ['continue_run'] })
  })

  it('lists durable work and resumes it through compare-and-set transitions', async () => {
    const ctx = await setup()
    const empty = await call(ctx, 'supramas_run_list', {})
    expect(empty.isError).toBe(false)
    if (empty.isError) throw new Error('expected empty durable run list')
    expect(empty.value).toMatchObject({
      summary: 'No SupraMAS runs are available.',
      next_actions: ['create_run'],
      data: { runs: [] },
    })
    await ctx.supramas.create({
      jobId: 'resume-demo',
      inputTaskPath: 'runs/resume-demo/input_task.yaml',
      runDir: 'runs/resume-demo',
    })

    const listed = await call(ctx, 'supramas_run_list', {})
    expect(listed.isError).toBe(false)
    if (listed.isError) throw new Error('expected durable run list')
    expect(listed.value).toMatchObject({
      status: 'success',
      data: { runs: [{ id: 'supramas:resume-demo', revision: 1, phase: 'created' }] },
    })

    const transitioned = await call(ctx, 'supramas_run_transition', {
      run_id: 'supramas:resume-demo',
      revision: 1,
      phase: 'task_ready',
    })
    expect(transitioned.isError).toBe(false)
    if (transitioned.isError) throw new Error('expected run transition')
    expect(transitioned.value).toMatchObject({
      status: 'success',
      data: { run: { revision: 2, phase: 'task_ready' } },
    })

    const stale = await call(ctx, 'supramas_run_transition', {
      run_id: 'supramas:resume-demo',
      revision: 1,
      phase: 'running',
    })
    expect(stale.isError).toBe(false)
    if (stale.isError) throw new Error('expected stale-revision envelope')
    expect(stale.value).toMatchObject({
      status: 'error',
      error: { code: 'SUPRAMAS_STALE_REVISION' },
    })
  })

  it('returns phase-specific recovery, terminal, and completion guidance', async () => {
    const ctx = await setup()

    const completedCreated = await ctx.supramas.create({
      jobId: 'complete-demo',
      inputTaskPath: 'runs/complete-demo/input_task.yaml',
      runDir: 'runs/complete-demo',
    })
    const completedReady = await ctx.supramas.transition(completedCreated, { phase: 'task_ready' })
    const completedRunning = await ctx.supramas.transition(completedReady, { phase: 'running' })
    const completedValidating = await ctx.supramas.transition(completedRunning, { phase: 'validating' })
    const completed = await call(ctx, 'supramas_run_transition', {
      run_id: completedValidating.id,
      revision: completedValidating.revision,
      phase: 'completed',
    })
    expect(completed.isError).toBe(false)
    if (completed.isError) throw new Error('expected completed run')
    expect(completed.value).toMatchObject({ next_actions: ['read_outputs'] })

    const recoverableCreated = await ctx.supramas.create({
      jobId: 'recoverable-demo',
      inputTaskPath: 'runs/recoverable-demo/input_task.yaml',
      runDir: 'runs/recoverable-demo',
    })
    const recoverableReady = await ctx.supramas.transition(recoverableCreated, { phase: 'task_ready' })
    const recoverableRunning = await ctx.supramas.transition(recoverableReady, { phase: 'running' })
    const recoverable = await call(ctx, 'supramas_run_transition', {
      run_id: recoverableRunning.id,
      revision: recoverableRunning.revision,
      phase: 'recoverable_failed',
      failure_code: 'review-timeout',
      failure_message: 'Reviewer timed out',
      failure_retryable: true,
    })
    expect(recoverable.isError).toBe(false)
    if (recoverable.isError) throw new Error('expected recoverable run')
    expect(recoverable.value).toMatchObject({ next_actions: ['inspect_failure_and_resume'] })

    const failed = await ctx.supramas.create({
      jobId: 'failed-demo',
      inputTaskPath: 'runs/failed-demo/input_task.yaml',
      runDir: 'runs/failed-demo',
    })
    const failedResult = await call(ctx, 'supramas_run_transition', {
      run_id: failed.id,
      revision: failed.revision,
      phase: 'failed',
      failure_code: 'fatal-error',
      failure_message: 'Cannot continue',
      failure_retryable: false,
    })
    expect(failedResult.isError).toBe(false)
    if (failedResult.isError) throw new Error('expected failed run')
    expect(failedResult.value).toMatchObject({ next_actions: ['stop_run'] })

    const cancelled = await ctx.supramas.create({
      jobId: 'cancelled-demo',
      inputTaskPath: 'runs/cancelled-demo/input_task.yaml',
      runDir: 'runs/cancelled-demo',
    })
    const cancelledResult = await call(ctx, 'supramas_run_transition', {
      run_id: cancelled.id,
      revision: cancelled.revision,
      phase: 'cancelled',
    })
    expect(cancelledResult.isError).toBe(false)
    if (cancelledResult.isError) throw new Error('expected cancelled run')
    expect(cancelledResult.value).toMatchObject({ next_actions: ['stop_run'] })

    const partial = await ctx.supramas.create({
      jobId: 'partial-demo',
      inputTaskPath: 'runs/partial-demo/input_task.yaml',
      runDir: 'runs/partial-demo',
    })
    const missingCode = await call(ctx, 'supramas_run_transition', {
      run_id: partial.id,
      revision: partial.revision,
      phase: 'failed',
      failure_message: 'Missing a code',
    })
    expect(missingCode.isError).toBe(false)
    if (missingCode.isError) throw new Error('expected failure validation envelope')
    expect(missingCode.value).toMatchObject({ error: { code: 'SUPRAMAS_INVALID_REQUEST' } })
    const missingText = await call(ctx, 'supramas_run_transition', {
      run_id: partial.id,
      revision: partial.revision,
      phase: 'failed',
      failure_retryable: false,
    })
    expect(missingText.isError).toBe(false)
    if (missingText.isError) throw new Error('expected failure validation envelope')
    expect(missingText.value).toMatchObject({ error: { code: 'SUPRAMAS_INVALID_REQUEST' } })
  })

  it('maps general domain failures but preserves unexpected exceptions', async () => {
    const ctx = await setup()
    const invalid = await call(ctx, 'supramas_run_create', {
      job_id: '/bad',
      input_task_path: 'runs/bad/input_task.yaml',
      run_dir: 'runs/bad',
    })
    expect(invalid.isError).toBe(false)
    if (invalid.isError) throw new Error('expected domain error envelope')
    expect(invalid.value).toMatchObject({
      status: 'error',
      next_actions: ['correct_request'],
      error: { code: 'SUPRAMAS_INVALID_REQUEST' },
    })

    vi.spyOn(ctx.supramas, 'create').mockImplementation(() => {
      throw new Error('programming fault')
    })
    const unexpected = await call(ctx, 'supramas_run_create', {
      job_id: 'demo',
      input_task_path: 'runs/demo/input_task.yaml',
      run_dir: 'runs/demo',
    })
    expect(unexpected.isError).toBe(true)
  })
})
