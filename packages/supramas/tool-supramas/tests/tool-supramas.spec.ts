import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
  await ctx.plugin(SupraMasArtifacts, { root })
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
      'supramas_stage1_start',
      'supramas_stage1_get',
      'supramas_stage1_builder_submit',
      'supramas_stage1_reviewer_submit',
      'supramas_stage1_finalize',
      'supramas_artifacts_sync',
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
      },
    })
    const serialized = JSON.stringify(result.value)
    expect(serialized).toContain('already exists')
    expect(serialized).toContain('job_id')
    expect(serialized).toContain('Do not overwrite')
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
    expect(ctx.tools.schemas()).toHaveLength(14)
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

  it('reports Stage 1 lookup and start boundaries through stable envelopes', async () => {
    const ctx = await setup()
    const missingStart = await call(ctx, 'supramas_stage1_start', {
      run_id: 'supramas:missing-stage1',
      revision: 1,
      research_topic: 'REBCO flux pinning',
      max_depth: 0,
      max_root_attempts: 1,
      max_child_attempts_per_limitation: 1,
    })
    expect(missingStart.isError).toBe(false)
    if (missingStart.isError) throw new Error('expected missing Stage 1 start envelope')
    expect(missingStart.value).toMatchObject({ error: { code: 'SUPRAMAS_RUN_NOT_FOUND' } })

    const missingGet = await call(ctx, 'supramas_stage1_get', { run_id: 'supramas:missing-stage1' })
    expect(missingGet.isError).toBe(false)
    if (missingGet.isError) throw new Error('expected missing Stage 1 lookup envelope')
    expect(missingGet.value).toMatchObject({ error: { code: 'SUPRAMAS_RUN_NOT_FOUND' } })

    const created = await ctx.supramas.create({
      jobId: 'stage1-boundaries',
      inputTaskPath: 'runs/stage1-boundaries/input_task.yaml',
      runDir: 'runs/stage1-boundaries',
    })
    const noWorkflow = await call(ctx, 'supramas_stage1_get', { run_id: created.id })
    expect(noWorkflow.isError).toBe(false)
    if (noWorkflow.isError) throw new Error('expected missing workflow envelope')
    expect(noWorkflow.value).toMatchObject({ error: { code: 'SUPRAMAS_INVALID_REQUEST' } })

    const ready = await ctx.supramas.transition(created, { phase: 'task_ready' })
    const started = await call(ctx, 'supramas_stage1_start', {
      run_id: ready.id,
      revision: ready.revision,
      research_topic: 'REBCO flux pinning',
      material_scope: ['REBCO'],
      target_property: ['in-field Jc'],
      max_depth: 1,
      max_root_attempts: 1,
      max_child_attempts_per_limitation: 1,
      max_branch_per_node: 2,
      target_child_nodes: 3,
    })
    expect(started.isError).toBe(false)
    if (started.isError) throw new Error('expected Stage 1 boundary start')
    expect(started.value).toMatchObject({ next_actions: ['build_root'] })

    const loaded = await call(ctx, 'supramas_stage1_get', { run_id: ready.id })
    expect(loaded.isError).toBe(false)
    if (loaded.isError) throw new Error('expected Stage 1 lookup success')
    expect(loaded.value).toMatchObject({
      next_actions: ['build_root'],
      data: {
        workflow: {
          config: {
            materialScope: ['REBCO'],
            targetProperty: ['in-field Jc'],
            maxBranchPerNode: 2,
            targetChildNodes: 3,
          },
        },
      },
    })

    const running = ctx.supramas.get(ready.id)
    if (running === undefined) throw new Error('expected running Stage 1 run')
    await ctx.supramas.transition(running, {
      phase: 'recoverable_failed',
      failure: {
        code: 'reviewer-unavailable',
        message: 'reviewer can be resumed later',
        retryable: true,
      },
    })
    const recoverable = await call(ctx, 'supramas_stage1_get', { run_id: ready.id })
    expect(recoverable.isError).toBe(false)
    if (recoverable.isError) throw new Error('expected recoverable Stage 1 lookup')
    expect(recoverable.value).toMatchObject({ next_actions: ['resume_run', 'build_root'] })
  })

  it('drives the durable Stage 1 builder-reviewer gate through model-facing tools', async () => {
    const ctx = await setup()
    const created = await ctx.supramas.create({
      jobId: 'workflow-tool',
      inputTaskPath: 'runs/workflow-tool/input_task.yaml',
      runDir: 'runs/workflow-tool',
    })
    const ready = await ctx.supramas.transition(created, { phase: 'task_ready' })
    await ctx.supramas.storePaper(ready.id, {
      paper_id: 'paper-1',
      paper_title: 'Tool workflow paper',
      local_path: 'runs/workflow-tool/papers/paper-1.json',
      source_type: 'experimental',
    })
    await ctx.supramas.addEvidenceChunk(ready.id, 'paper-1', {
      chunk_id: 'paper-1-c1',
      page: 1,
      text: 'BZO additions improve in-field Jc, but only one loading was measured.',
    })

    const started = await call(ctx, 'supramas_stage1_start', {
      run_id: ready.id,
      revision: ready.revision,
      research_topic: 'REBCO flux pinning',
      max_depth: 0,
      max_root_attempts: 2,
      max_child_attempts_per_limitation: 2,
    })
    expect(started.isError).toBe(false)
    if (started.isError) throw new Error('expected Stage 1 start success')
    expect(started.value).toMatchObject({
      status: 'success',
      next_actions: ['build_root'],
      data: { run: { phase: 'running', revision: ready.revision + 1 }, next_action: { kind: 'build_root' } },
    })

    const built = await call(ctx, 'supramas_stage1_builder_submit', {
      run_id: ready.id,
      revision: ready.revision + 1,
      paper_node: {
        paper_id: 'paper-1',
        paper_title: 'Tool workflow paper',
        source_type: 'experimental',
        strategy_records: [{
          record_id: 'R1',
          tuning_dimension: 'Composition tuning',
          tuning_strategy: 'Add BZO artificial pinning centers.',
          tuning_effect: 'BZO additions improve in-field Jc.',
          evidence: { chunk_id: 'paper-1-c1', page: 1, evidence_text: 'BZO additions improve in-field Jc' },
          confidence: 0.9,
        }],
        limitation_records: [{
          limitation_id: 'L1',
          limitation: 'Only one loading was measured.',
          expectation: 'Compare multiple BZO loadings.',
          related_record_ids: ['R1'],
          evidence: { chunk_id: 'paper-1-c1', page: 1, evidence_text: 'only one loading was measured' },
          confidence: 0.9,
        }],
      },
      notes: [],
    })
    expect(built.isError).toBe(false)
    if (built.isError) throw new Error('expected builder submission success')
    expect(built.value).toMatchObject({
      next_actions: ['review_candidate'],
      data: { run: { revision: ready.revision + 2 }, next_action: { kind: 'review_candidate' } },
    })

    const malformedHandoff = await call(ctx, 'supramas_stage1_builder_submit', {
      run_id: ready.id,
      revision: ready.revision + 2,
      edge: {
        edge_id: 'unexpected-root-edge',
        parent_node_id: 'N0',
        child_node_id: 'N1',
        source_limitation_id: 'L1',
        expectation: 'Compare multiple BZO loadings.',
        edge_type: 'direct',
      },
      reason: 'exercise a malformed root handoff',
    })
    expect(malformedHandoff.isError).toBe(false)
    if (malformedHandoff.isError) throw new Error('expected malformed handoff envelope')
    expect(malformedHandoff.value).toMatchObject({ error: { code: 'SUPRAMAS_DOMAIN_INVALID' } })

    const reviewed = await call(ctx, 'supramas_stage1_reviewer_submit', {
      run_id: ready.id,
      revision: ready.revision + 2,
      decision: 'accept',
      summary: 'The local chunk supports the candidate.',
      critical_issues: [],
      edge_issues: [],
      acceptance_conditions: [],
    })
    expect(reviewed.isError).toBe(false)
    if (reviewed.isError) throw new Error('expected reviewer submission success')
    expect(reviewed.value).toMatchObject({
      next_actions: ['finalize'],
      data: { run: { revision: ready.revision + 3 }, next_action: { kind: 'finalize' } },
    })

    const completed = await call(ctx, 'supramas_stage1_finalize', {
      run_id: ready.id,
      revision: ready.revision + 3,
    })
    expect(completed.isError).toBe(false)
    if (completed.isError) throw new Error('expected Stage 1 finalization success')
    expect(completed.value).toMatchObject({
      status: 'success',
      next_actions: ['inspect_strategy_tree'],
      data: {
        run: { phase: 'completed', revision: ready.revision + 4 },
        workflow: { status: 'completed' },
        tree: { job_id: 'workflow-tool', nodes: [{ paper_id: 'paper-1' }] },
      },
    })
    await expect(readFile(join(roots.at(-1)!, 'runs/workflow-tool/outputs/strategy_tree.json'), 'utf8'))
      .resolves.toContain('"job_id": "workflow-tool"')

    const synced = await call(ctx, 'supramas_artifacts_sync', { run_id: ready.id })
    expect(synced.isError, JSON.stringify(synced)).toBe(false)
    if (synced.isError) throw new Error('expected idempotent artifact sync')
    expect(synced.value).toMatchObject({
      status: 'success',
      next_actions: ['inspect_exported_artifacts'],
      artifacts: [
        'runs/workflow-tool/input_task.yaml',
        'runs/workflow-tool/papers/paper-1.json',
        'runs/workflow-tool/tree_state.json',
        'runs/workflow-tool/outputs/strategy_tree.json',
        'runs/workflow-tool/outputs/node_review_log.jsonl',
        'runs/workflow-tool/outputs/review_report.md',
      ],
    })
  })
})
