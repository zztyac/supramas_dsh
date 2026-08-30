/** Browser-safe V1 request, response, and failure vocabulary for SupraMAS. */

/** Current wire contract version. Additive V1 changes must remain backward compatible. */
export const SUPRAMAS_API_VERSION = 1 as const

/** Closed public lifecycle phases copied into the versioned wire contract. */
export type SupraMasRunPhaseV1 =
  | 'created'
  | 'clarifying'
  | 'task_ready'
  | 'running'
  | 'validating'
  | 'completed'
  | 'recoverable_failed'
  | 'failed'
  | 'cancelled'

/** Non-technical task creation form accepted by the V1 API. */
export interface SupraMasCreateStage1RequestV1 {
  /** Optional stable task key; the Host creates one when omitted. */
  readonly jobId?: string
  readonly researchTopic: string
  readonly materialScope?: readonly string[]
  readonly targetProperty?: readonly string[]
  readonly evidencePolicy?: string
  readonly include?: readonly string[]
  readonly exclude?: readonly string[]
  readonly maxDepth?: number
  readonly maxRootAttempts?: number
  readonly maxChildAttemptsPerLimitation?: number
  readonly maxBranchPerNode?: number | null
  readonly targetChildNodes?: number | null
}

/** Failure retained on a failed run. */
export interface SupraMasRunFailureViewV1 {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

/** Public lifecycle view; Host filesystem paths deliberately do not cross the wire. */
export interface SupraMasRunSummaryV1 {
  readonly id: string
  readonly jobId: string
  readonly revision: number
  readonly phase: SupraMasRunPhaseV1
  readonly createdAt: number
  readonly updatedAt: number
  readonly failure?: SupraMasRunFailureViewV1
}

/** Normalized next coordinator operation used by the task UI. */
export type SupraMasNextActionV1 =
  | { readonly kind: 'build_root'; readonly attemptIndex: number }
  | {
    readonly kind: 'build_child'
    readonly parentNodeId: string
    readonly parentLimitationId: string
    readonly parentExpectation: string
    readonly attemptIndex: number
  }
  | {
    readonly kind: 'review_candidate'
    readonly scope: 'root' | 'child'
    readonly attemptIndex: number
    readonly revisionRound: number
    readonly paperId: string
  }
  | {
    readonly kind: 'revise_candidate'
    readonly scope: 'root' | 'child'
    readonly attemptIndex: number
    readonly revisionRound: number
    readonly paperId: string
    readonly criticalIssueCount: number
    readonly edgeIssueCount: number
    readonly acceptanceConditionCount: number
  }
  | { readonly kind: 'finalize' }
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed'; readonly reason: string }

/** Immutable workflow limits displayed in the task detail. */
export interface SupraMasStage1LimitsV1 {
  readonly maxDepth: number
  readonly maxRootAttempts: number
  readonly maxChildAttemptsPerLimitation: number
  readonly maxBranchPerNode: number | null
  readonly targetChildNodes: number | null
}

/** Compact progress counters for a non-technical dashboard. */
export interface SupraMasStage1ProgressV1 {
  readonly acceptedPapers: number
  readonly strategyLinks: number
  readonly openLimitations: number
  readonly builderAttempts: number
  readonly reviews: number
}

/** Public Stage 1 detail, with the validated final tree only after completion. */
export interface SupraMasStage1ViewV1 {
  readonly status: 'active' | 'ready_to_finalize' | 'completed' | 'failed'
  readonly researchTopic: string
  readonly materialScope: readonly string[]
  readonly targetProperty: readonly string[]
  readonly limits: SupraMasStage1LimitsV1
  readonly progress: SupraMasStage1ProgressV1
  readonly nextAction: SupraMasNextActionV1
}

/** One complete task detail response. */
export interface SupraMasRunViewV1 {
  readonly apiVersion: typeof SUPRAMAS_API_VERSION
  readonly run: SupraMasRunSummaryV1
  readonly stage1?: SupraMasStage1ViewV1
}

/** Ordered task list response. */
export interface SupraMasRunListV1 {
  readonly apiVersion: typeof SUPRAMAS_API_VERSION
  readonly items: readonly SupraMasRunViewV1[]
}

/** Browser-safe readiness for one canonical Stage 1 output. */
export interface SupraMasOutputFileV1 {
  readonly name: 'strategy_tree.json' | 'node_review_log.jsonl' | 'review_report.md'
  readonly ready: boolean
}

/** Stable final-output manifest without Host filesystem paths. */
export interface SupraMasArtifactsViewV1 {
  readonly apiVersion: typeof SUPRAMAS_API_VERSION
  readonly runId: string
  readonly ready: boolean
  readonly files: readonly SupraMasOutputFileV1[]
}

/** Stable SupraMAS failure details returned by the Typert namespace. */
export interface SupraMasApiErrorDetailsMap {
  'bad-request': Record<never, never>
  'supramas-run-exists': { readonly jobId: string }
  'supramas-run-not-found': { readonly runId: string }
  'supramas-stale-revision': {
    readonly runId: string
    readonly expectedRevision: number
    readonly actualRevision: number
  }
  'supramas-invalid-transition': { readonly runId: string; readonly phase: SupraMasRunPhaseV1 }
  internal: Record<never, never>
}

/** Business failure carried by a rejected SupraMAS Remote call. */
export type SupraMasApiError = {
  [Code in keyof SupraMasApiErrorDetailsMap]: {
    readonly code: Code
    readonly message: string
    readonly details: SupraMasApiErrorDetailsMap[Code]
  }
}[keyof SupraMasApiErrorDetailsMap]
