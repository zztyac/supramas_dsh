/** Material-science run registry with compare-and-set lifecycle transitions. */

import { Context, Service } from '@deepseek-ai/cordis'
import {
  EvidenceCatalog,
  type EvidenceChunk,
  type EvidenceRef,
  type EvidenceVerification,
  type PaperArtifact,
  type PaperArtifactMetadata,
} from '@deepseek-ai/dsh-supramas-domain'
import type {
  CreateRunRequest,
  RunFailure,
  RunPhase,
  RunRef,
  RunSnapshot,
  SupraMasErrorCode,
  SupraMasRunId as SupraMasRunIdBrand,
  TransitionRunRequest,
} from './types.ts'

export type * from './types.ts'
export type * from './roles.ts'
export { ROLE_SPECS, resolveRole } from './roles.ts'
export type * from '@deepseek-ai/dsh-supramas-domain'
export {
  EDGE_TYPES,
  EvidenceCatalog,
  SOURCE_TYPES,
  StrategyTreeAssembler,
  SupraMasDomainError,
  TUNING_DIMENSIONS,
  validateStrategyTree,
} from '@deepseek-ai/dsh-supramas-domain'

declare module '@deepseek-ai/cordis' {
  interface Context {
    supramas: SupraMasRuntime
  }
}

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const FAILURE_CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

const TRANSITIONS: Readonly<Record<RunPhase, readonly RunPhase[]>> = {
  created: ['clarifying', 'task_ready', 'failed', 'cancelled'],
  clarifying: ['task_ready', 'failed', 'cancelled'],
  task_ready: ['running', 'failed', 'cancelled'],
  running: ['validating', 'recoverable_failed', 'failed', 'cancelled'],
  validating: ['completed', 'running', 'recoverable_failed', 'failed', 'cancelled'],
  recoverable_failed: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

/** Caller-correctable run validation or lifecycle failure. */
export class SupraMasError extends Error {
  /**
   * @param message - Human-readable failure explanation.
   * @param code - Stable machine-routable classification.
   */
  constructor(message: string, readonly code: SupraMasErrorCode) {
    super(message)
    this.name = 'SupraMasError'
  }
}

/**
 * Brand a validated raw run id.
 * @param id - Raw run identity.
 * @returns the same string with the SupraMAS run brand.
 */
export function SupraMasRunId(id: string): SupraMasRunIdBrand {
  return id as SupraMasRunIdBrand
}

function runBase(run: RunSnapshot): Omit<RunSnapshot, 'failure'> {
  return {
    id: run.id,
    jobId: run.jobId,
    revision: run.revision,
    phase: run.phase,
    inputTaskPath: run.inputTaskPath,
    runDir: run.runDir,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function cloneRun(run: RunSnapshot): RunSnapshot {
  const base = runBase(run)
  return run.failure === undefined ? base : { ...base, failure: { ...run.failure } }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/\/$/, '')
}

function resolveCreate(request: CreateRunRequest): CreateRunRequest {
  const { jobId } = request
  if (!JOB_ID.test(jobId)) {
    throw new SupraMasError(
      'jobId must start with an alphanumeric character and contain only alphanumerics, dot, underscore, or hyphen',
      'SUPRAMAS_INVALID_REQUEST',
    )
  }
  const runDir = normalizePath(request.runDir)
  const inputTaskPath = normalizePath(request.inputTaskPath)
  if (runDir !== `runs/${jobId}` || inputTaskPath !== `${runDir}/input_task.yaml`) {
    throw new SupraMasError(
      `run paths must be runs/${jobId} and runs/${jobId}/input_task.yaml`,
      'SUPRAMAS_INVALID_REQUEST',
    )
  }
  return { jobId, runDir, inputTaskPath }
}

function resolveFailure(phase: RunPhase, failure: RunFailure | undefined): RunFailure | undefined {
  const failed = phase === 'failed' || phase === 'recoverable_failed'
  if (!failed && failure !== undefined) {
    throw new SupraMasError('failure details are valid only for failed phases', 'SUPRAMAS_INVALID_REQUEST')
  }
  if (!failed) return undefined
  if (failure === undefined || !FAILURE_CODE.test(failure.code) || failure.message.trim().length === 0) {
    throw new SupraMasError(
      'failed phases require a lower-kebab-case code and non-empty message',
      'SUPRAMAS_INVALID_REQUEST',
    )
  }
  if (failure.retryable !== (phase === 'recoverable_failed')) {
    throw new SupraMasError('failure retryable must match the requested failed phase', 'SUPRAMAS_INVALID_REQUEST')
  }
  return { code: failure.code, message: failure.message.trim(), retryable: failure.retryable }
}

/** Process-local material-science run registry. Later persistence providers consume the same API. */
export class SupraMasRuntime extends Service {
  private readonly runs = new Map<SupraMasRunIdBrand, RunSnapshot>()
  private readonly evidence = new Map<SupraMasRunIdBrand, EvidenceCatalog>()

  constructor(ctx: Context) {
    super(ctx, 'supramas')
  }

  /**
   * Create one run in the `created` phase.
   * @param request - Job identity and canonical run-local paths.
   * @returns a detached initial snapshot.
   */
  create(request: CreateRunRequest): RunSnapshot {
    const spec = resolveCreate(request)
    const id = SupraMasRunId(`supramas:${spec.jobId}`)
    if (this.runs.has(id)) {
      throw new SupraMasError(`SupraMAS run ${spec.jobId} already exists`, 'SUPRAMAS_RUN_EXISTS')
    }
    const now = Date.now()
    const run: RunSnapshot = {
      id,
      jobId: spec.jobId,
      revision: 1,
      phase: 'created',
      inputTaskPath: spec.inputTaskPath,
      runDir: spec.runDir,
      createdAt: now,
      updatedAt: now,
    }
    this.runs.set(id, run)
    this.evidence.set(id, new EvidenceCatalog(spec.jobId))
    return cloneRun(run)
  }

  private evidenceFor(id: SupraMasRunIdBrand): EvidenceCatalog {
    if (!this.runs.has(id)) throw new SupraMasError(`SupraMAS run ${id} does not exist`, 'SUPRAMAS_RUN_NOT_FOUND')
    const catalog = this.evidence.get(id)
    if (catalog === undefined) throw new Error(`SupraMAS evidence catalog missing for ${id}`)
    return catalog
  }

  /**
   * Register one canonical paper artifact under a run.
   * @param id - Stable owning run identity.
   * @param metadata - Canonical run-local paper metadata.
   * @returns a detached empty artifact.
   */
  storePaper(id: SupraMasRunIdBrand, metadata: PaperArtifactMetadata): PaperArtifact {
    return this.evidenceFor(id).storePaper(metadata)
  }

  /**
   * Add one provenance-bound chunk to a stored paper.
   * @param id - Stable owning run identity.
   * @param paperId - Owning paper identity.
   * @param chunk - Local page-aware evidence text.
   * @returns a detached stored chunk.
   */
  addEvidenceChunk(id: SupraMasRunIdBrand, paperId: string, chunk: EvidenceChunk): EvidenceChunk {
    return this.evidenceFor(id).addChunk(paperId, chunk)
  }

  /**
   * Read one detached local paper artifact.
   * @param id - Stable owning run identity.
   * @param paperId - Paper identity.
   * @returns the artifact or `undefined` when absent.
   */
  readPaper(id: SupraMasRunIdBrand, paperId: string): PaperArtifact | undefined {
    return this.evidenceFor(id).getPaper(paperId)
  }

  /**
   * Verify one evidence quote against run-local paper chunks.
   * @param id - Stable owning run identity.
   * @param paperId - Expected owning paper.
   * @param evidence - Chunk, page, and exact evidence quote.
   * @returns stable verified provenance.
   */
  verifyEvidence(id: SupraMasRunIdBrand, paperId: string, evidence: EvidenceRef): EvidenceVerification {
    return this.evidenceFor(id).verify(paperId, evidence)
  }

  /**
   * Read one current run.
   * @param id - Stable run identity.
   * @returns a detached snapshot or `undefined` when absent.
   */
  get(id: SupraMasRunIdBrand): RunSnapshot | undefined {
    const run = this.runs.get(id)
    return run === undefined ? undefined : cloneRun(run)
  }

  /**
   * List every current run without exposing mutable registry state.
   * @returns detached snapshots in creation order.
   */
  list(): RunSnapshot[] {
    return [...this.runs.values()].map(cloneRun)
  }

  /**
   * Commit one legal compare-and-set phase transition.
   * @param ref - Expected current revision.
   * @param request - Next phase and required failure details.
   * @returns the detached committed snapshot.
   */
  transition(ref: RunRef, request: TransitionRunRequest): RunSnapshot {
    const current = this.runs.get(ref.id)
    if (current === undefined) {
      throw new SupraMasError(`SupraMAS run ${ref.id} does not exist`, 'SUPRAMAS_RUN_NOT_FOUND')
    }
    if (current.revision !== ref.revision) {
      throw new SupraMasError(
        `stale run revision ${ref.revision}; current revision is ${current.revision}`,
        'SUPRAMAS_STALE_REVISION',
      )
    }
    if (!TRANSITIONS[current.phase].includes(request.phase)) {
      throw new SupraMasError(
        `cannot transition run ${current.id} from ${current.phase} to ${request.phase}`,
        'SUPRAMAS_INVALID_TRANSITION',
      )
    }
    const failure = resolveFailure(request.phase, request.failure)
    const base = runBase(current)
    const updated: RunSnapshot = {
      ...base,
      revision: current.revision + 1,
      phase: request.phase,
      updatedAt: Math.max(Date.now(), current.updatedAt),
      ...failure === undefined ? {} : { failure },
    }
    this.runs.set(ref.id, updated)
    return cloneRun(updated)
  }
}

export default SupraMasRuntime
