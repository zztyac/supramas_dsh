/** Stage 0/1 role definitions used to derive personas, tool filters, and result validation. */

/** Supported material-science agent roles. */
export type RoleId =
  | 'task-setup'
  | 'strategy-coordinator'
  | 'strategy-builder'
  | 'strategy-reviewer'

/** Minimal authority and structured-output identity for one role. */
export interface RoleSpec {
  readonly id: RoleId
  readonly purpose: string
  readonly tools: readonly string[]
  readonly outputSchema: string
}

/** Closed Stage 0/1 role roster. Tool lists are allowlists, not guidance. */
export const ROLE_SPECS: readonly RoleSpec[] = [
  {
    id: 'task-setup',
    purpose: 'Clarify a research request and create one approved input task.',
    tools: ['ask_user_question', 'supramas_run_create', 'supramas_run_get'],
    outputSchema: 'supramas.task-setup.v1',
  },
  {
    id: 'strategy-coordinator',
    purpose: 'Advance the deterministic Stage 1 run and delegate bounded work.',
    tools: ['supramas_run_get', 'subagent', 'subagent_control'],
    outputSchema: 'supramas.coordinator.v1',
  },
  {
    id: 'strategy-builder',
    purpose: 'Find, verify, persist, and extract one paper candidate.',
    tools: ['supramas_literature_search', 'supramas_paper_store', 'supramas_chunk_extract'],
    outputSchema: 'supramas.builder.v1',
  },
  {
    id: 'strategy-reviewer',
    purpose: 'Review one candidate and its local evidence without mutating it.',
    tools: ['supramas_artifact_read', 'supramas_evidence_verify'],
    outputSchema: 'supramas.reviewer.v1',
  },
] as const

/**
 * Resolve one exact supported role.
 * @param id - Requested role identity.
 * @returns the immutable matching role specification.
 * @throws when the role is absent from the closed Stage 0/1 roster.
 */
export function resolveRole(id: RoleId): RoleSpec {
  const role = ROLE_SPECS.find(candidate => candidate.id === id)
  if (role === undefined) throw new TypeError(`unknown SupraMAS role: ${String(id)}`)
  return role
}
