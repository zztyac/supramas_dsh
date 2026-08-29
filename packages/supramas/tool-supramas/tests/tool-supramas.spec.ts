import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SupraMasRuntime from '../../supramas/src/index.ts'
import * as ToolSupraMas from '../src/index.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SupraMasRuntime)
  await ctx.plugin(ToolSupraMas)
  return ctx
}

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
  it('registers two narrow model-facing tools', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'supramas_run_create',
      'supramas_run_get',
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

  it('unregisters both tools when the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(SupraMasRuntime)
    const fiber = await ctx.plugin(ToolSupraMas)
    expect(ctx.tools.schemas()).toHaveLength(2)
    await fiber.dispose()
    expect(ctx.tools.schemas()).toHaveLength(0)
  })

  it('reads created and advanced runs with phase-specific next actions', async () => {
    const ctx = await setup()
    const created = ctx.supramas.create({
      jobId: 'demo',
      inputTaskPath: 'runs/demo/input_task.yaml',
      runDir: 'runs/demo',
    })
    const initial = await call(ctx, 'supramas_run_get', { run_id: created.id })
    expect(initial.isError).toBe(false)
    if (initial.isError) throw new Error('expected created run')
    expect(initial.value).toMatchObject({ next_actions: ['prepare_input_task'] })

    ctx.supramas.transition(created, { phase: 'task_ready' })
    const advanced = await call(ctx, 'supramas_run_get', { run_id: created.id })
    expect(advanced.isError).toBe(false)
    if (advanced.isError) throw new Error('expected advanced run')
    expect(advanced.value).toMatchObject({ next_actions: ['continue_run'] })
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
