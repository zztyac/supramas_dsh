/** Pure material-science run types shared by the runtime and its consumers. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable identity of one SupraMAS run. */
export type SupraMasRunId = Branded<'SupraMasRunId'>

/** Compare-and-set identity of one exact run revision. */
export interface RunRef {
  readonly id: SupraMasRunId
  readonly revision: number
}

/** Closed durable lifecycle phases of a material-science run. */
export const RUN_PHASES = [
  'created',
  'clarifying',
  'task_ready',
  'running',
  'validating',
  'completed',
  'recoverable_failed',
  'failed',
  'cancelled',
] as const

/** Durable lifecycle phase of a material-science run. */
export type RunPhase = typeof RUN_PHASES[number]

/** Structured failure retained on failed run revisions. */
export interface RunFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

/** Current complete state of one run. */
export interface RunSnapshot extends RunRef {
  readonly jobId: string
  readonly phase: RunPhase
  readonly inputTaskPath: string
  readonly runDir: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly failure?: RunFailure
}

/** Request to create a run before its Stage 0 task is approved. */
export interface CreateRunRequest {
  readonly jobId: string
  readonly inputTaskPath: string
  readonly runDir: string
}

/** Requested next run phase and its required failure details when applicable. */
export interface TransitionRunRequest {
  readonly phase: RunPhase
  readonly failure?: RunFailure
}

/** Stable caller-correctable runtime error classifications. */
export type SupraMasErrorCode =
  | 'SUPRAMAS_INVALID_REQUEST'
  | 'SUPRAMAS_RUN_EXISTS'
  | 'SUPRAMAS_RUN_NOT_FOUND'
  | 'SUPRAMAS_STALE_REVISION'
  | 'SUPRAMAS_INVALID_TRANSITION'
