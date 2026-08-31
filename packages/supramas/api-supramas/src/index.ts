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
import '@deepseek-ai/dsh-supramas-artifacts'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  SUPRAMAS_API_VERSION,
  type SupraMasArtifactContentV1,
  type SupraMasArtifactsViewV1,
  type SupraMasCreateStage1RequestV1,
  type SupraMasEvidenceRefV1,
  type SupraMasEvidenceSliceViewV1,
  type SupraMasNextActionV1,
  type SupraMasOutputNameV1,
  type SupraMasPaperEvidenceViewV1,
  type SupraMasRunListV1,
  type SupraMasRunSummaryV1,
  type SupraMasRunViewV1,
  type SupraMasStage1ViewV1,
  type SupraMasStrategyTreeViewV1,
  type SupraMasTreeEdgeV1,
  type SupraMasTreeNodeV1,
} from './types.ts'

export type * from './types.ts'
export { SUPRAMAS_API_VERSION } from './types.ts'

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const RUN_ID = /^supramas:[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const MAX_PUBLIC_ID_LENGTH = 256
const MAX_EVIDENCE_CHARACTERS = 8_000
const DEFAULT_EVIDENCE_CHARACTERS = 4_000
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
const OUTPUT_NAMES: readonly SupraMasOutputNameV1[] = [
  'strategy_tree.json',
  'node_review_log.jsonl',
  'review_report.md',
]
const OUTPUT_MEDIA_TYPES: Record<SupraMasOutputNameV1, SupraMasArtifactContentV1['mediaType']> = {
  'strategy_tree.json': 'application/json',
  'node_review_log.jsonl': 'application/x-ndjson',
  'review_report.md': 'text/markdown',
}

interface NormalizedCreateRequest {
  readonly jobId: string
  readonly researchTopic: string
  readonly materialScope: string[]
  readonly targetProperty: string[]
  readonly evidencePolicy?: string
  readonly include?: string[]
  readonly exclude?: string[]
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

function boundedId(value: unknown, name: string): string {
  const id = nonempty(value, name)
  if (id.length > MAX_PUBLIC_ID_LENGTH) throw badRequest(`${name} must not exceed ${MAX_PUBLIC_ID_LENGTH} characters`)
  return id
}

function nonnegative(value: unknown, fallback: number, name: string): number {
  const resolved = value === undefined ? fallback : value
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 0) {
    throw badRequest(`${name} must be a non-negative safe integer`)
  }
  return resolved as number
}

function evidenceLength(value: unknown): number {
  const resolved = value === undefined ? DEFAULT_EVIDENCE_CHARACTERS : value
  if (!Number.isSafeInteger(resolved) || (resolved as number) < 1 || (resolved as number) > MAX_EVIDENCE_CHARACTERS) {
    throw badRequest(`maxCharacters must be a safe integer from 1 to ${MAX_EVIDENCE_CHARACTERS}`)
  }
  return resolved as number
}

function outputName(value: unknown): SupraMasOutputNameV1 {
  if (typeof value !== 'string' || !OUTPUT_NAMES.includes(value as SupraMasOutputNameV1)) {
    throw badRequest('name must be one of the canonical Stage 1 output names')
  }
  return value as SupraMasOutputNameV1
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
    ...(request.evidencePolicy === undefined
      ? {}
      : { evidencePolicy: nonempty(request.evidencePolicy, 'evidencePolicy') }),
    ...(request.include === undefined ? {} : { include: stringList(request.include, 'include') }),
    ...(request.exclude === undefined ? {} : { exclude: stringList(request.exclude, 'exclude') }),
    maxDepth: integer(request.maxDepth, 3, 'maxDepth', 0),
    maxRootAttempts: integer(request.maxRootAttempts, 3, 'maxRootAttempts', 1),
    maxChildAttemptsPerLimitation: integer(
      request.maxChildAttemptsPerLimitation,
      3,
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

type Stage1Node = Stage1RunState['workflow']['nodes'][number]
type Stage1Edge = Stage1RunState['workflow']['edges'][number]

function evidenceRefView(evidence: Stage1Node['strategy_records'][number]['evidence']): SupraMasEvidenceRefV1 {
  return {
    chunkId: evidence.chunk_id,
    page: evidence.page ?? null,
    evidenceText: evidence.evidence_text,
  }
}

function treeNodeView(node: Stage1Node): SupraMasTreeNodeV1 {
  return {
    nodeId: node.node_id,
    level: node.level,
    parentId: node.parent_id ?? null,
    paperId: node.paper_id,
    paperTitle: node.paper_title,
    year: node.year ?? null,
    doi: node.doi ?? null,
    url: node.url ?? null,
    sourceType: node.source_type ?? null,
    notes: [...(node.notes ?? [])],
    strategyRecords: node.strategy_records.map(record => ({
      recordId: record.record_id,
      tuningDimension: record.tuning_dimension,
      tuningStrategy: record.tuning_strategy,
      tuningEffect: record.tuning_effect,
      evidence: evidenceRefView(record.evidence),
      confidence: record.confidence,
    })),
    limitationRecords: node.limitation_records.map(record => ({
      limitationId: record.limitation_id,
      limitation: record.limitation,
      expectation: record.expectation,
      relatedRecordIds: [...(record.related_record_ids ?? [])],
      evidence: evidenceRefView(record.evidence),
      confidence: record.confidence,
    })),
  }
}

function treeEdgeView(edge: Stage1Edge): SupraMasTreeEdgeV1 {
  return {
    edgeId: edge.edge_id ?? null,
    parentNodeId: edge.parent_node_id,
    parentLimitationId: edge.parent_limitation_id,
    childNodeId: edge.child_node_id,
    childRecordId: edge.child_record_id ?? null,
    parentExpectation: edge.parent_expectation,
    childTuningEffect: edge.child_tuning_effect ?? null,
    edgeType: edge.edge_type,
    edgeRationale: edge.edge_rationale,
    confidence: edge.confidence,
  }
}

/** Host service backing the generated `ctx.remote.supramas` namespace. */
export class SupraMasController extends TypertRemoteService {
  static inject = ['supramas', 'supramasArtifacts']

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
   * Read the current accepted Stage 1 tree without exposing pending candidates or Host paths.
   * @param runId - Stable public run identity.
   * @returns accepted nodes and edges at the exact durable revision.
   */
  @Remote
  tree(runId: string): Promise<SupraMasStrategyTreeViewV1> {
    return Promise.resolve().then(() => {
      const id = this.runId(runId)
      const run = this.ctx.supramas.get(id)
      if (run === undefined) throw this.notFound(runId)
      const state = this.ctx.supramas.getStage1(id)
      if (state === undefined) throw badRequest('run has no Stage 1 workflow')
      return {
        apiVersion: SUPRAMAS_API_VERSION,
        runId,
        revision: state.run.revision,
        status: state.workflow.status,
        nodes: state.workflow.nodes.map(treeNodeView),
        edges: state.workflow.edges.map(treeEdgeView),
      }
    })
  }

  /**
   * List text-free local evidence chunks for one run-local paper.
   * @param runId - Stable public run identity.
   * @param paperId - Stable paper identity selected from the accepted tree.
   * @returns paper metadata and bounded chunk summaries without local paths or chunk text.
   */
  @Remote
  paper(runId: string, paperId: string): Promise<SupraMasPaperEvidenceViewV1> {
    return Promise.resolve().then(() => {
      const id = this.runId(runId)
      if (this.ctx.supramas.get(id) === undefined) throw this.notFound(runId)
      const normalizedPaperId = boundedId(paperId, 'paperId')
      const paper = this.ctx.supramas.readPaper(id, normalizedPaperId)
      if (paper === undefined) {
        throw new TypertRemoteFailure({
          code: 'supramas-paper-not-found',
          message: 'The selected paper is not stored for this material task.',
          details: { runId, paperId: normalizedPaperId },
        })
      }
      return {
        apiVersion: SUPRAMAS_API_VERSION,
        runId,
        paperId: paper.paper_id,
        paperTitle: paper.paper_title,
        sourceType: paper.source_type,
        chunks: paper.chunks.map(chunk => ({
          chunkId: chunk.chunk_id,
          page: chunk.page ?? null,
          characters: chunk.text.length,
        })),
      }
    })
  }

  /**
   * Read one bounded text slice from an identified run-local evidence chunk.
   * @param runId - Stable public run identity.
   * @param paperId - Owning paper identity.
   * @param chunkId - Exact local evidence chunk identity.
   * @param start - Zero-based character offset.
   * @param maxCharacters - Complete response character bound, at most 8,000.
   * @returns one detached evidence slice with explicit range metadata.
   */
  @Remote
  evidence(
    runId: string,
    paperId: string,
    chunkId: string,
    start: number,
    maxCharacters: number,
  ): Promise<SupraMasEvidenceSliceViewV1> {
    return Promise.resolve().then(() => {
      const id = this.runId(runId)
      if (this.ctx.supramas.get(id) === undefined) throw this.notFound(runId)
      const normalizedPaperId = boundedId(paperId, 'paperId')
      const normalizedChunkId = boundedId(chunkId, 'chunkId')
      const offset = nonnegative(start, 0, 'start')
      const length = evidenceLength(maxCharacters)
      const paper = this.ctx.supramas.readPaper(id, normalizedPaperId)
      if (paper === undefined) {
        throw new TypertRemoteFailure({
          code: 'supramas-paper-not-found',
          message: 'The selected paper is not stored for this material task.',
          details: { runId, paperId: normalizedPaperId },
        })
      }
      const chunk = paper.chunks.find(candidate => candidate.chunk_id === normalizedChunkId)
      if (chunk === undefined) {
        throw new TypertRemoteFailure({
          code: 'supramas-chunk-not-found',
          message: 'The selected evidence chunk is not stored for this paper.',
          details: { runId, paperId: normalizedPaperId, chunkId: normalizedChunkId },
        })
      }
      const boundedStart = Math.min(offset, chunk.text.length)
      const end = Math.min(boundedStart + length, chunk.text.length)
      return {
        apiVersion: SUPRAMAS_API_VERSION,
        runId,
        paperId: paper.paper_id,
        chunkId: chunk.chunk_id,
        page: chunk.page ?? null,
        start: boundedStart,
        end,
        totalCharacters: chunk.text.length,
        text: chunk.text.slice(boundedStart, end),
      }
    })
  }

  /**
   * Read the browser-safe readiness of the three canonical Stage 1 outputs.
   * @param runId - Stable public run identity.
   * @returns fixed output names and readiness without Host paths.
   */
  @Remote
  async artifacts(runId: string): Promise<SupraMasArtifactsViewV1> {
    const id = this.runId(runId)
    if (this.ctx.supramas.get(id) === undefined) throw this.notFound(runId)
    const files = await this.ctx.supramasArtifacts.outputStatus(id)
    return {
      apiVersion: SUPRAMAS_API_VERSION,
      runId,
      ready: files.every(file => file.ready),
      files,
    }
  }

  /**
   * Read one bounded canonical Stage 1 output for browser download.
   * @param runId - Stable public run identity.
   * @param name - One closed canonical output basename.
   * @returns complete UTF-8 content and media metadata without a Host path.
   */
  @Remote
  async artifact(runId: string, name: SupraMasOutputNameV1): Promise<SupraMasArtifactContentV1> {
    const id = this.runId(runId)
    if (this.ctx.supramas.get(id) === undefined) throw this.notFound(runId)
    const normalizedName = outputName(name)
    const status = await this.ctx.supramasArtifacts.outputStatus(id)
    if (!status.find(file => file.name === normalizedName)?.ready) {
      throw new TypertRemoteFailure({
        code: 'supramas-artifact-not-ready',
        message: 'The selected final output is not ready yet.',
        details: { runId, name: normalizedName },
      })
    }
    try {
      const bytes = await this.ctx.supramasArtifacts.readOutput(id, normalizedName, MAX_ARTIFACT_BYTES)
      return {
        apiVersion: SUPRAMAS_API_VERSION,
        runId,
        name: normalizedName,
        mediaType: OUTPUT_MEDIA_TYPES[normalizedName],
        byteLength: bytes.byteLength,
        content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      }
    } catch {
      throw new TypertRemoteFailure({
        code: 'internal',
        message: 'The selected final output could not be read.',
        details: {},
      })
    }
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
        ...(normalized.evidencePolicy === undefined ? {} : { evidencePolicy: normalized.evidencePolicy }),
        ...(normalized.include === undefined ? {} : { include: normalized.include }),
        ...(normalized.exclude === undefined ? {} : { exclude: normalized.exclude }),
        maxDepth: normalized.maxDepth,
        maxRootAttempts: normalized.maxRootAttempts,
        maxChildAttemptsPerLimitation: normalized.maxChildAttemptsPerLimitation,
        maxBranchPerNode: normalized.maxBranchPerNode,
        targetChildNodes: normalized.targetChildNodes,
      })
      await this.ctx.supramasArtifacts.syncTask(started.run.id)
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
