import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  SupraMasDomainError,
  SupraMasError,
  SupraMasRunId,
  type Stage1NextAction,
  type Stage1RunState,
} from '@deepseek-ai/dsh-supramas'
import SupraMasArtifacts from '../../supramas-artifacts/src/index.ts'
import { TypertRemoteFailure, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import SupraMasController from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

async function harness(): Promise<{ controller: SupraMasController; ctx: Context; artifactRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-api-supramas-'))
  const artifactRoot = await mkdtemp(join(tmpdir(), 'dsh-api-supramas-artifacts-'))
  roots.push(root, artifactRoot)
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
  await ctx.plugin(SupraMasArtifacts, { root: artifactRoot })
  await ctx.plugin(SupraMasController)
  return { controller: ctx.supramasController, ctx, artifactRoot }
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

const request = {
  jobId: 'ui-stage1-demo',
  researchTopic: 'REBCO artificial pinning centres',
  materialScope: ['REBCO', 'YBCO'],
  targetProperty: ['in-field Jc'],
  maxDepth: 2,
}

const evidenceText = 'BZO additions improve in-field Jc, but only one loading was measured.'

async function completedRun(controller: SupraMasController, ctx: Context, artifactRoot: string) {
  const created = await controller.createStage1({
    ...request,
    jobId: 'ui-completed-demo',
    maxDepth: 0,
  })
  const rawDir = join(artifactRoot, 'runs/ui-completed-demo/papers/raw')
  await mkdir(rawDir, { recursive: true })
  await writeFile(join(rawDir, 'paper-1.pdf'), '%PDF-1.7 fixture')
  await ctx.supramas.importPaper(SupraMasRunId(created.run.id), {
    metadata: {
      paper_id: 'paper-1',
      paper_title: 'BZO pinning paper',
      local_path: 'runs/ui-completed-demo/papers/paper-1.json',
      source_type: 'experimental',
      full_text_source: {
        local_path: 'runs/ui-completed-demo/papers/raw/paper-1.pdf',
        media_type: 'application/pdf',
        sha256: 'a'.repeat(64),
        byte_length: 1_024,
        page_count: 7,
      },
    },
    chunks: [{ chunk_id: 'paper-1-c1', page: 7, text: evidenceText, evidence_kind: 'full_text' }],
  })
  const built = await ctx.supramas.submitStage1Builder({
    id: SupraMasRunId(created.run.id),
    revision: created.run.revision,
  }, {
    paper_node: {
      paper_id: 'paper-1',
      paper_title: 'BZO pinning paper',
      year: 2024,
      doi: '10.0000/bzo-demo',
      url: 'https://example.invalid/paper-1',
      source_type: 'experimental',
      notes: ['Accepted from full-text evidence.'],
      strategy_records: [{
        record_id: 'R1',
        tuning_dimension: 'Composition tuning',
        tuning_strategy: 'Add BZO artificial pinning centers.',
        tuning_effect: 'BZO additions improve in-field Jc.',
        evidence: { chunk_id: 'paper-1-c1', page: 7, evidence_text: 'BZO additions improve in-field Jc' },
        confidence: 0.9,
      }],
      limitation_records: [{
        limitation_id: 'L1',
        limitation: 'Only one loading was measured.',
        expectation: 'Compare multiple BZO loadings.',
        related_record_ids: ['R1'],
        evidence: { chunk_id: 'paper-1-c1', page: 7, evidence_text: 'only one loading was measured' },
        confidence: 0.8,
      }],
    },
    edge: null,
    notes: [],
  })
  const accepted = await ctx.supramas.submitStage1Review(built.run, {
    decision: 'accept',
    expectation_satisfaction: 'not_applicable',
    summary: 'The local full text supports the node.',
    critical_issues: [],
    edge_issues: [],
    acceptance_conditions: [],
  })
  const completed = await ctx.supramas.finalizeStage1(accepted.run)
  await ctx.supramasArtifacts.syncCompleted(completed.run.id)
  return completed
}

describe('SupraMAS Remote contract', () => {
  it('publishes one versioned namespace with the complete task control surface', async () => {
    const { controller } = await harness()
    expect(controller.typertRemote).toMatchObject({
      serviceKey: 'supramasController',
      namespace: 'supramas',
    })
    expect(remoteMethods(controller)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
      { method: 'get', invocation: { kind: 'direct' } },
      { method: 'tree', invocation: { kind: 'direct' } },
      { method: 'paper', invocation: { kind: 'direct' } },
      { method: 'evidence', invocation: { kind: 'direct' } },
      { method: 'artifacts', invocation: { kind: 'direct' } },
      { method: 'artifact', invocation: { kind: 'direct' } },
      { method: 'createStage1', invocation: { kind: 'direct' } },
      { method: 'resume', invocation: { kind: 'direct' } },
      { method: 'cancel', invocation: { kind: 'direct' } },
    ])
  })

  it('reports only browser-safe output names and readiness', async () => {
    const { controller, artifactRoot } = await harness()
    const created = await controller.createStage1(request)

    await expect(controller.artifacts(created.run.id)).resolves.toEqual({
      apiVersion: 1,
      runId: created.run.id,
      ready: false,
      files: [
        { name: 'strategy_tree.json', ready: false },
        { name: 'node_review_log.jsonl', ready: false },
        { name: 'review_report.md', ready: false },
      ],
    })
    const serialized = JSON.stringify(await controller.artifacts(created.run.id))
    expect(serialized).not.toContain(artifactRoot)
    await expect(controller.artifacts('supramas:missing')).rejects.toMatchObject({
      failure: { code: 'supramas-run-not-found' },
    })
  })

  it('projects the accepted strategy tree and browser-safe paper chunk metadata', async () => {
    const { controller, ctx, artifactRoot } = await harness()
    const completed = await completedRun(controller, ctx, artifactRoot)

    const tree = await controller.tree(completed.run.id)
    expect(tree).toMatchObject({
      apiVersion: 1,
      runId: completed.run.id,
      revision: completed.run.revision,
      status: 'completed',
      nodes: [{
        nodeId: 'N0',
        level: 0,
        parentId: null,
        paperId: 'paper-1',
        paperTitle: 'BZO pinning paper',
        year: 2024,
        strategyRecords: [{
          recordId: 'R1',
          tuningDimension: 'Composition tuning',
          evidence: { chunkId: 'paper-1-c1', page: 7 },
        }],
        limitationRecords: [{
          limitationId: 'L1',
          expectation: 'Compare multiple BZO loadings.',
          relatedRecordIds: ['R1'],
        }],
      }],
      edges: [],
    })
    expect(JSON.stringify(tree)).not.toContain(artifactRoot)
    expect(JSON.stringify(tree)).not.toContain('local_path')

    const paper = await controller.paper(completed.run.id, 'paper-1')
    expect(paper).toEqual({
      apiVersion: 1,
      runId: completed.run.id,
      paperId: 'paper-1',
      paperTitle: 'BZO pinning paper',
      sourceType: 'experimental',
      chunks: [{ chunkId: 'paper-1-c1', page: 7, characters: evidenceText.length }],
    })
    expect(JSON.stringify(paper)).not.toContain(evidenceText)
    expect(JSON.stringify(paper)).not.toContain(artifactRoot)
  })

  it('returns one bounded evidence slice and one canonical artifact payload', async () => {
    const { controller, ctx, artifactRoot } = await harness()
    const completed = await completedRun(controller, ctx, artifactRoot)

    await expect(controller.evidence(completed.run.id, 'paper-1', 'paper-1-c1', 4, 12)).resolves.toEqual({
      apiVersion: 1,
      runId: completed.run.id,
      paperId: 'paper-1',
      chunkId: 'paper-1-c1',
      page: 7,
      start: 4,
      end: 16,
      totalCharacters: evidenceText.length,
      text: evidenceText.slice(4, 16),
    })

    const artifact = await controller.artifact(completed.run.id, 'strategy_tree.json')
    expect(artifact).toMatchObject({
      apiVersion: 1,
      runId: completed.run.id,
      name: 'strategy_tree.json',
      mediaType: 'application/json',
    })
    expect(artifact.content).toContain('"job_id": "ui-completed-demo"')
    expect(artifact.byteLength).toBe(new TextEncoder().encode(artifact.content).byteLength)
  })

  it('classifies invalid evidence and artifact reads without leaking paths', async () => {
    const { controller, ctx, artifactRoot } = await harness()
    const active = await controller.createStage1({ ...request, jobId: 'ui-read-errors' })
    const completed = await completedRun(controller, ctx, artifactRoot)

    await expect(controller.paper(completed.run.id, 'missing')).rejects.toMatchObject({
      failure: { code: 'supramas-paper-not-found', details: { runId: completed.run.id, paperId: 'missing' } },
    })
    await expect(controller.evidence(completed.run.id, 'paper-1', 'missing', 0, 10)).rejects.toMatchObject({
      failure: { code: 'supramas-chunk-not-found', details: { paperId: 'paper-1', chunkId: 'missing' } },
    })
    await expect(controller.evidence(completed.run.id, 'paper-1', 'paper-1-c1', -1, 10)).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
    await expect(controller.evidence(completed.run.id, 'paper-1', 'paper-1-c1', 0, 8_001)).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
    await expect(controller.artifact(active.run.id, 'strategy_tree.json')).rejects.toMatchObject({
      failure: { code: 'supramas-artifact-not-ready', details: { runId: active.run.id } },
    })
    await expect(controller.artifact(completed.run.id, '../tree_state.json' as never)).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
  })

  it('creates, prepares, and starts one Stage 1 run with safe defaults', async () => {
    const { controller, artifactRoot } = await harness()
    const created = await controller.createStage1(request)

    expect(created).toMatchObject({
      apiVersion: 1,
      run: {
        id: 'supramas:ui-stage1-demo',
        jobId: 'ui-stage1-demo',
        phase: 'running',
        revision: 3,
      },
      stage1: {
        status: 'active',
        researchTopic: request.researchTopic,
        materialScope: request.materialScope,
        targetProperty: request.targetProperty,
        limits: {
          maxDepth: 2,
          maxRootAttempts: 3,
          maxChildAttemptsPerLimitation: 3,
          maxBranchPerNode: null,
          targetChildNodes: null,
        },
        progress: {
          acceptedPapers: 0,
          strategyLinks: 0,
          openLimitations: 0,
          builderAttempts: 0,
          reviews: 0,
        },
        nextAction: { kind: 'build_root', attemptIndex: 1 },
      },
    })
    expect(created.run).not.toHaveProperty('inputTaskPath')
    expect(created.run).not.toHaveProperty('runDir')
    const task = await readFile(join(artifactRoot, 'runs/ui-stage1-demo/input_task.yaml'), 'utf8')
    expect(task).toContain('max_child_attempts_per_limitation: 3')
    expect(task).toContain('- "Stage 2 idea generation"')
    expect(task).toContain('- "abstract-only evidence"')

    await expect(controller.list()).resolves.toEqual({
      apiVersion: 1,
      items: [created],
    })
    await expect(controller.get(created.run.id)).resolves.toEqual(created)
  })

  it('resumes recoverable work and cancels with compare-and-set revisions', async () => {
    const { controller, ctx } = await harness()
    const created = await controller.createStage1(request)
    const failed = await ctx.supramas.transition({
      id: SupraMasRunId(created.run.id),
      revision: created.run.revision,
    }, {
      phase: 'recoverable_failed',
      failure: { code: 'network-timeout', message: 'Literature search timed out.', retryable: true },
    })

    const resumed = await controller.resume(failed.id, failed.revision)
    expect(resumed.run).toMatchObject({ phase: 'running', revision: failed.revision + 1 })
    const cancelled = await controller.cancel(resumed.run.id, resumed.run.revision)
    expect(cancelled.run).toMatchObject({ phase: 'cancelled', revision: resumed.run.revision + 1 })
  })

  it('maps caller-correctable failures without leaking runtime internals', async () => {
    const { controller } = await harness()
    const created = await controller.createStage1(request)

    await expect(controller.createStage1(request)).rejects.toMatchObject({
      failure: { code: 'supramas-run-exists', details: { jobId: request.jobId } },
    })
    await expect(controller.get('supramas:missing')).rejects.toMatchObject({
      failure: { code: 'supramas-run-not-found', details: { runId: 'supramas:missing' } },
    })
    await expect(controller.cancel(created.run.id, 1)).rejects.toMatchObject({
      failure: {
        code: 'supramas-stale-revision',
        details: { runId: created.run.id, expectedRevision: 1, actualRevision: 3 },
      },
    })
    await expect(controller.resume(created.run.id, created.run.revision)).rejects.toMatchObject({
      failure: {
        code: 'supramas-invalid-transition',
        details: { runId: created.run.id, phase: 'running' },
      },
    })
    await expect(controller.createStage1({ ...request, researchTopic: '  ' })).rejects.toBeInstanceOf(TypertRemoteFailure)
    await expect(controller.createStage1({ ...request, researchTopic: '  ' })).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
  })

  it('normalizes optional input and rejects every malformed scalar or list shape', async () => {
    const { controller } = await harness()
    const generated = await controller.createStage1({
      researchTopic: '  REBCO interfaces  ',
      maxDepth: 0,
      maxRootAttempts: 1,
      maxChildAttemptsPerLimitation: 1,
      maxBranchPerNode: 2,
      targetChildNodes: null,
    })
    expect(generated.run.jobId).toMatch(/^materials-/)
    expect(generated.stage1).toMatchObject({
      researchTopic: 'REBCO interfaces',
      materialScope: [],
      targetProperty: [],
      limits: {
        maxDepth: 0,
        maxRootAttempts: 1,
        maxChildAttemptsPerLimitation: 1,
        maxBranchPerNode: 2,
        targetChildNodes: null,
      },
    })

    const invalidRequests = [
      { ...request, jobId: 'contains spaces' },
      { ...request, researchTopic: 42 },
      { ...request, materialScope: 'REBCO' },
      { ...request, materialScope: ['REBCO', ' '] },
      { ...request, maxDepth: Number.NaN },
      { ...request, maxDepth: -1 },
      { ...request, maxBranchPerNode: 0 },
    ]
    for (const invalid of invalidRequests) {
      await expect(controller.createStage1(invalid as never)).rejects.toMatchObject({
        failure: { code: 'bad-request' },
      })
    }
    await expect(controller.get('bad-id')).rejects.toMatchObject({ failure: { code: 'bad-request' } })
    await expect(controller.get(42 as never)).rejects.toMatchObject({ failure: { code: 'bad-request' } })
    await expect(controller.cancel(generated.run.id, Number.NaN)).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
    await expect(controller.cancel(generated.run.id, 0)).rejects.toMatchObject({
      failure: { code: 'bad-request' },
    })
  })

  it('merges policy exclusions with caller-provided scope filters', async () => {
    const { controller, ctx } = await harness()
    const created = await controller.createStage1({
      researchTopic: 'REBCO isotropic pinning',
      include: ['BHO nanorods', 'coated conductors'],
      exclude: ['computational-only studies'],
      maxDepth: 0,
    })
    const state = ctx.supramas.getStage1(SupraMasRunId(created.run.id))
    expect(state?.workflow.config).toMatchObject({
      include: ['BHO nanorods', 'coated conductors'],
      exclude: ['abstract-only evidence', 'Stage 2 idea generation', 'computational-only studies'],
    })
  })

  it('projects every durable next action and both optional state branches', async () => {
    const { controller, ctx } = await harness()
    const raw = await ctx.supramas.create({
      jobId: 'not-started',
      runDir: 'runs/not-started',
      inputTaskPath: 'runs/not-started/input_task.yaml',
    })
    await expect(controller.get(raw.id)).resolves.not.toHaveProperty('stage1')

    const created = await controller.createStage1(request)
    const state = ctx.supramas.getStage1(SupraMasRunId(created.run.id))!
    const actions: Stage1NextAction[] = [
      {
        kind: 'build_child',
        parent_node_id: 'node-1',
        parent_limitation_id: 'lim-1',
        parent_expectation: 'Improve angular pinning',
        attempt_index: 2,
        prior_attempts: [],
      },
      { kind: 'review_candidate', scope: 'root', attempt_index: 1, revision_round: 1, paper_id: 'paper-1' },
      {
        kind: 'revise_candidate',
        scope: 'child',
        attempt_index: 2,
        revision_round: 3,
        paper_id: 'paper-2',
        critical_issues: [{} as never],
        edge_issues: [{} as never],
        acceptance_conditions: ['Verify the quote'],
      },
      { kind: 'finalize' },
      { kind: 'completed', tree: {} as never },
      { kind: 'failed', reason: 'attempts_exhausted' },
    ]
    const getStage1 = vi.spyOn(ctx.supramas, 'getStage1')
    for (const nextAction of actions) {
      getStage1.mockReturnValue({
        ...state,
        workflow: {
          ...state.workflow,
          config: {
            ...state.workflow.config,
            materialScope: undefined,
            targetProperty: undefined,
          },
          nodes: [{} as never],
          edges: [{} as never],
          frontiers: [
            { status: 'pending' } as never,
            { status: 'closed' } as never,
          ],
          builder_attempts: [{} as never],
          review_log: [{} as never],
        },
        nextAction,
      } as unknown as Stage1RunState)
      const projected = await controller.get(created.run.id)
      expect(projected.stage1?.nextAction.kind).toBe(nextAction.kind)
      expect(projected.stage1?.materialScope).toEqual([])
      expect(projected.stage1?.targetProperty).toEqual([])
      expect(projected.stage1?.progress).toEqual({
        acceptedPapers: 1,
        strategyLinks: 1,
        openLimitations: 1,
        builderAttempts: 1,
        reviews: 1,
      })
    }
  })

  it('projects run failures and exhaustively classifies runtime failures', async () => {
    const { controller, ctx } = await harness()
    const created = await controller.createStage1(request)
    const failed = await ctx.supramas.transition({
      id: SupraMasRunId(created.run.id),
      revision: created.run.revision,
    }, {
      phase: 'recoverable_failed',
      failure: { code: 'network', message: 'Network interrupted.', retryable: true },
    })
    await expect(controller.get(failed.id)).resolves.toMatchObject({
      run: { failure: { code: 'network', retryable: true } },
    })

    type FailureMapper = {
      mapFailure(
        error: unknown,
        context: { jobId?: string; runId?: string; expectedRevision?: number },
      ): TypertRemoteFailure
    }
    const mapFailure = (error: unknown, context: Parameters<FailureMapper['mapFailure']>[1]) =>
      (controller as unknown as FailureMapper).mapFailure(error, context)
    const remote = new TypertRemoteFailure({ code: 'bad-request', message: 'remote', details: {} })
    expect(mapFailure(remote, {})).toBe(remote)
    expect(mapFailure(new SupraMasDomainError('domain', 'SUPRAMAS_DOMAIN_INVALID'), {}).failure.code)
      .toBe('bad-request')
    expect(mapFailure(new Error('unknown'), {}).failure.code).toBe('internal')
    expect(mapFailure(new SupraMasError('invalid', 'SUPRAMAS_INVALID_REQUEST'), {}).failure.code)
      .toBe('bad-request')
    expect(mapFailure(new SupraMasError('exists', 'SUPRAMAS_RUN_EXISTS'), {}).failure.details)
      .toEqual({ jobId: 'unknown' })
    expect(mapFailure(new SupraMasError('missing', 'SUPRAMAS_RUN_NOT_FOUND'), {}).failure.details)
      .toEqual({ runId: 'unknown' })
    expect(mapFailure(new SupraMasError('stale', 'SUPRAMAS_STALE_REVISION'), {}).failure.details)
      .toEqual({ runId: 'unknown', expectedRevision: 0, actualRevision: 0 })
    expect(mapFailure(new SupraMasError('transition', 'SUPRAMAS_INVALID_TRANSITION'), {}).failure.details)
      .toEqual({ runId: 'unknown', phase: 'failed' })
  })
})
