/** Host owner of the versioned SupraMAS task-control Remote namespace. */

import type { Context } from '@deepseek-ai/cordis'
import {
  SupraMasDomainError,
  SupraMasError,
  SupraMasRunId,
  type RunSnapshot,
  type Stage1NextAction,
  type Stage1RunState,
} from '@deepseek-ai/dsh-supramas'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  SUPRAMAS_API_VERSION,
  type SupraMasCreateStage1RequestV1,
  type SupraMasNextActionV1,
  type SupraMasRunListV1,
  type SupraMasRunSummaryV1,
  type SupraMasRunViewV1,
  type SupraMasStage1ViewV1,
} from './types.ts'

export type * from './types.ts'
export { SUPRAMAS_API_VERSION } from './types.ts'

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const RUN_ID = /^supramas:[a-zA-Z0-9][a-zA-Z0-9._-]*$/

interface NormalizedCreateRequest {
  readonly jobId: string
  readonly researchTopic: string
  readonly materialScope: string[]
  readonly targetProperty: string[]
  readonly maxDepth: number
  readonly maxRootAttempts: number
  readonly maxChildAttemptsPerLimitation: number
  readonly maxBranchPerNode: number | null
  readonly targetChildNodes: number | null
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `supramas` Remote namespace. */
    supramasController: SupraMasController
  }
}

function badRequest(message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code: 'bad-request', message, details: {} })
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw badRequest(`${name} must not be empty`)
  return value.trim()
}

function stringList(value: readonly string[] | undefined, name: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw badRequest(`${name} must be a list`)
  return value.map((item, index) => nonempty(item, `${name}[${index}]`))
}

function integer(value: number | undefined, fallback: number, name: string, minimum: number): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < minimum) {
    throw badRequest(`${name} must be a safe integer greater than or equal to ${minimum}`)
  }
  return resolved
}

function cap(value: number | null | undefined, name: string): number | null {
  if (value === undefined || value === null) return null
  return integer(value, value, name, 1)
}

function normalizeCreate(request: SupraMasCreateStage1RequestV1, generatedJobId: string): NormalizedCreateRequest {
  const jobId = request.jobId === undefined ? generatedJobId : nonempty(request.jobId, 'jobId')
  if (!JOB_ID.test(jobId)) {
    throw badRequest('jobId must contain only letters, numbers, dot, underscore, or hyphen')
  }
  return {
    jobId,
    researchTopic: nonempty(request.researchTopic, 'researchTopic'),
    materialScope: stringList(request.materialScope, 'materialScope'),
    targetProperty: stringList(request.targetProperty, 'targetProperty'),
    maxDepth: integer(request.maxDepth, 2, 'maxDepth', 0),
    maxRootAttempts: integer(request.maxRootAttempts, 3, 'maxRootAttempts', 1),
    maxChildAttemptsPerLimitation: integer(
      request.maxChildAttemptsPerLimitation,
      2,
      'maxChildAttemptsPerLimitation',
      1,
    ),
    maxBranchPerNode: cap(request.maxBranchPerNode, 'maxBranchPerNode'),
    targetChildNodes: cap(request.targetChildNodes, 'targetChildNodes'),
  }
}

function runSummary(run: RunSnapshot): SupraMasRunSummaryV1 {
  return {
    id: run.id,
    jobId: run.jobId,
    revision: run.revision,
    phase: run.phase,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.failure === undefined ? {} : { failure: { ...run.failure } }),
  }
}

function nextActionView(action: Stage1NextAction): SupraMasNextActionV1 {
  switch (action.kind) {
    case 'build_root':
      return { kind: action.kind, attemptIndex: action.attempt_index }
    case 'build_child':
      return {
        kind: action.kind,
        parentNodeId: action.parent_node_id,
        parentLimitationId: action.parent_limitation_id,
        parentExpectation: action.parent_expectation,
        attemptIndex: action.attempt_index,
      }
    case 'review_candidate':
      return {
        kind: action.kind,
        scope: action.scope,
        attemptIndex: action.attempt_index,
        revisionRound: action.revision_round,
        paperId: action.paper_id,
      }
    case 'revise_candidate':
      return {
        kind: action.kind,
        scope: action.scope,
        attemptIndex: action.attempt_index,
        revisionRound: action.revision_round,
        paperId: action.paper_id,
        criticalIssueCount: action.critical_issues.length,
        edgeIssueCount: action.edge_issues.length,
        acceptanceConditionCount: action.acceptance_conditions.length,
      }
    case 'finalize': return { kind: action.kind }
    case 'completed': return { kind: action.kind }
    case 'failed': return { kind: action.kind, reason: action.reason }
  }
}

function stage1View(state: Stage1RunState): SupraMasStage1ViewV1 {
  const { workflow, nextAction } = state
  return {
    status: workflow.status,
    researchTopic: workflow.config.researchTopic,
    materialScope: [...(workflow.config.materialScope ?? [])],
    targetProperty: [...(workflow.config.targetProperty ?? [])],
    limits: {
      maxDepth: workflow.config.maxDepth,
      maxRootAttempts: workflow.config.maxRootAttempts,
      maxChildAttemptsPerLimitation: workflow.config.maxChildAttemptsPerLimitation,
      maxBranchPerNode: workflow.config.maxBranchPerNode ?? null,
      targetChildNodes: workflow.config.targetChildNodes ?? null,
    },
    progress: {
      acceptedPapers: workflow.nodes.length,
      strategyLinks: workflow.edges.length,
      openLimitations: workflow.frontiers.filter(frontier => frontier.status === 'pending').length,
      builderAttempts: workflow.builder_attempts.length,
      reviews: workflow.review_log.length,
    },
    nextAction: nextActionView(nextAction),
  }
}

/** Host service backing the generated `ctx.remote.supramas` namespace. */
export class SupraMasController extends TypertRemoteService {
  static inject = ['supramas']

  private generatedSequence = 0

  constructor(ctx: Context) {
    super(ctx, 'supramasController', { namespace: 'supramas' })
  }

  /**
   * List every task in durable creation order.
  * @returns the versioned public task list.
  */
  @Remote
  list(): Promise<SupraMasRunListV1> {
    return Promise.resolve({
      apiVersion: SUPRAMAS_API_VERSION,
      items: this.ctx.supramas.list().map(run => this.view(run)),
    })
  }

  /**
   * Read one complete public task view.
   * @param runId - Stable public run identity.
  * @returns the current versioned task view.
  */
  @Remote
  get(runId: string): Promise<SupraMasRunViewV1> {
    return Promise.resolve().then(() => {
      const id = this.runId(runId)
      const run = this.ctx.supramas.get(id)
      if (run === undefined) throw this.notFound(runId)
      return this.view(run)
    })
  }

  /**
   * Create a task, approve its normalized task definition, and start Stage 1.
   * @param request - User-facing Stage 1 scope and optional execution limits.
   * @returns the committed task after Stage 1 starts.
   */
  @Remote
  async createStage1(request: SupraMasCreateStage1RequestV1): Promise<SupraMasRunViewV1> {
    const normalized = normalizeCreate(request, this.generatedJobId())
    try {
      const created = await this.ctx.supramas.create({
        jobId: normalized.jobId,
        runDir: `runs/${normalized.jobId}`,
        inputTaskPath: `runs/${normalized.jobId}/input_task.yaml`,
      })
      const ready = await this.ctx.supramas.transition(created, { phase: 'task_ready' })
      const started = await this.ctx.supramas.startStage1(ready, {
        jobId: normalized.jobId,
        researchTopic: normalized.researchTopic,
        materialScope: normalized.materialScope,
        targetProperty: normalized.targetProperty,
        maxDepth: normalized.maxDepth,
        maxRootAttempts: normalized.maxRootAttempts,
        maxChildAttemptsPerLimitation: normalized.maxChildAttemptsPerLimitation,
        maxBranchPerNode: normalized.maxBranchPerNode,
        targetChildNodes: normalized.targetChildNodes,
      })
      return this.view(started.run)
    } catch (error: unknown) {
      throw this.mapFailure(error, { jobId: normalized.jobId })
    }
  }

  /**
   * Resume one run that was durably marked recoverable after interruption.
   * @param runId - Stable public run identity.
   * @param expectedRevision - Revision observed by the caller.
   * @returns the committed resumed task view.
   */
  @Remote
  async resume(runId: string, expectedRevision: number): Promise<SupraMasRunViewV1> {
    return this.transition(runId, expectedRevision, 'running')
  }

  /**
   * Cancel one non-terminal run under compare-and-set revision control.
   * @param runId - Stable public run identity.
   * @param expectedRevision - Revision observed by the caller.
   * @returns the committed cancelled task view.
   */
  @Remote
  async cancel(runId: string, expectedRevision: number): Promise<SupraMasRunViewV1> {
    return this.transition(runId, expectedRevision, 'cancelled')
  }

  private view(run: RunSnapshot): SupraMasRunViewV1 {
    const stage1 = this.ctx.supramas.getStage1(run.id)
    return {
      apiVersion: SUPRAMAS_API_VERSION,
      run: runSummary(run),
      ...(stage1 === undefined ? {} : { stage1: stage1View(stage1) }),
    }
  }

  private async transition(
    runId: string,
    expectedRevision: number,
    phase: 'running' | 'cancelled',
  ): Promise<SupraMasRunViewV1> {
    const id = this.runId(runId)
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw badRequest('expectedRevision must be a positive safe integer')
    }
    try {
      const run = await this.ctx.supramas.transition({ id, revision: expectedRevision }, { phase })
      return this.view(run)
    } catch (error: unknown) {
      throw this.mapFailure(error, { runId, expectedRevision })
    }
  }

  private runId(value: string) {
    if (typeof value !== 'string' || !RUN_ID.test(value)) throw badRequest('runId is invalid')
    return SupraMasRunId(value)
  }

  private generatedJobId(): string {
    this.generatedSequence += 1
    return `materials-${Date.now().toString(36)}-${this.generatedSequence}`
  }

  private notFound(runId: string): TypertRemoteFailure {
    return new TypertRemoteFailure({
      code: 'supramas-run-not-found',
      message: `Material task ${runId} was not found.`,
      details: { runId },
    })
  }

  private mapFailure(
    error: unknown,
    context: { readonly jobId?: string; readonly runId?: string; readonly expectedRevision?: number },
  ): TypertRemoteFailure {
    if (error instanceof TypertRemoteFailure) return error
    if (error instanceof SupraMasDomainError) return badRequest(error.message)
    if (!(error instanceof SupraMasError)) {
      return new TypertRemoteFailure({
        code: 'internal',
        message: 'SupraMAS task operation failed.',
        details: {},
      })
    }
    if (error.code === 'SUPRAMAS_INVALID_REQUEST') return badRequest(error.message)
    if (error.code === 'SUPRAMAS_RUN_EXISTS') {
      const jobId = context.jobId ?? 'unknown'
      return new TypertRemoteFailure({
        code: 'supramas-run-exists',
        message: `Material task ${jobId} already exists.`,
        details: { jobId },
      })
    }
    const runId = context.runId ?? 'unknown'
    if (error.code === 'SUPRAMAS_RUN_NOT_FOUND') return this.notFound(runId)
    const current = RUN_ID.test(runId) ? this.ctx.supramas.get(SupraMasRunId(runId)) : undefined
    if (error.code === 'SUPRAMAS_STALE_REVISION') {
      return new TypertRemoteFailure({
        code: 'supramas-stale-revision',
        message: 'This material task changed. Refresh it before trying again.',
        details: {
          runId,
          expectedRevision: context.expectedRevision ?? 0,
          actualRevision: current?.revision ?? 0,
        },
      })
    }
    return new TypertRemoteFailure({
      code: 'supramas-invalid-transition',
      message: 'This action is not available in the current task stage.',
      details: { runId, phase: current?.phase ?? 'failed' },
    })
  }
}

export default SupraMasController
