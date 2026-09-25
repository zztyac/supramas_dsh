/** Model-facing tools for the SupraMAS material-science run capability. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  defineTool,
  valueSchemaSpecToJsonSchema,
  type JsonValue,
  type ToolRunContext,
  type ValueSchemaSpec,
} from '@deepseek-ai/dsh-tools'
import type { SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-subagent'
import {
  EDGE_TYPES,
  RUN_PHASES,
  SOURCE_TYPES,
  SupraMasDomainError,
  SupraMasError,
  SupraMasRunId,
  TUNING_DIMENSIONS,
  type EvidenceVerification,
  type FinalizedStage1RunState,
  type PaperArtifact,
  type RunSnapshot,
  type Stage1BuilderSubmission,
  type Stage1ReviewSubmission,
  type Stage1RunState,
} from '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas-artifacts'

export const name = 'tool-supramas'
export const inject = ['tools', 'supramas', 'supramasArtifacts']

/** Model handoff policy for Stage 1 submission tools. */
export interface Config {
  /** Orchestrated mode atomically delegates; direct mode exists for trusted integration callers. */
  mode?: 'orchestrated' | 'direct'
  /** Registered one-shot subagent provider used by orchestrated mode. */
  subagentProvider?: string
  /** Legacy shared wall-clock limit for builder and reviewer handoffs. */
  handoffTimeoutMs?: number
  /** Maximum wall-clock time for one discovery-heavy builder handoff. */
  builderHandoffTimeoutMs?: number
  /** Maximum wall-clock time for one bounded reviewer handoff. */
  reviewerHandoffTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  mode: z.union(['orchestrated', 'direct'] as const).default('orchestrated'),
  subagentProvider: z.string().default('spawn'),
  handoffTimeoutMs: z.number().step(1).min(1_000).max(3_600_000),
  builderHandoffTimeoutMs: z.number().step(1).min(1_000).max(3_600_000),
  reviewerHandoffTimeoutMs: z.number().step(1).min(1_000).max(3_600_000),
})

const DEFAULT_BUILDER_HANDOFF_TIMEOUT_MS = 3_600_000
const DEFAULT_REVIEWER_HANDOFF_TIMEOUT_MS = 600_000

interface ToolFailure {
  code: string
  root_cause_hint: string
  safe_retry: string
  stop_condition: string
}

interface ToolEnvelope {
  status: 'success' | 'error'
  summary: string
  next_actions: string[]
  artifacts: string[]
  data?: {
    run?: RunSnapshot
    runs?: RunSnapshot[]
    verification?: EvidenceVerification
    workflow?: Record<string, JsonValue>
    next_action?: Record<string, JsonValue>
    tree?: Record<string, JsonValue>
  }
  error?: ToolFailure
}

const runSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    jobId: { type: 'string', required: true },
    revision: { type: 'integer', required: true },
    phase: { type: 'string', required: true, enum: RUN_PHASES },
    inputTaskPath: { type: 'string', required: true },
    runDir: { type: 'string', required: true },
    createdAt: { type: 'integer', required: true },
    updatedAt: { type: 'integer', required: true },
    failure: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        message: { type: 'string', required: true },
        retryable: { type: 'boolean', required: true },
      },
    },
  },
} as const satisfies ValueSchemaSpec

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['success', 'error'] },
    summary: { type: 'string', required: true },
    next_actions: { type: 'array', required: true, items: { type: 'string' } },
    artifacts: { type: 'array', required: true, items: { type: 'string' } },
    data: {
      type: 'object',
      additionalProperties: false,
      properties: {
        run: runSchema,
        runs: { type: 'array', items: runSchema },
        verification: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verified: { type: 'boolean', required: true },
            paper_id: { type: 'string', required: true },
            chunk_id: { type: 'string', required: true },
            local_path: { type: 'string', required: true },
            evidence_kind: { type: 'string', required: true, enum: ['abstract', 'full_text'] },
            canonical_evidence_text: { type: 'string' },
            match_kind: { type: 'string', enum: ['exact', 'normalized'] },
            start_offset: { type: 'integer' },
            end_offset: { type: 'integer' },
          },
        },
        workflow: { type: 'object', additionalProperties: true },
        next_action: { type: 'object', additionalProperties: true },
        tree: { type: 'object', additionalProperties: true },
      },
    },
    error: {
      type: 'object',
      additionalProperties: false,
      properties: {
        code: { type: 'string', required: true },
        root_cause_hint: { type: 'string', required: true },
        safe_retry: { type: 'string', required: true },
        stop_condition: { type: 'string', required: true },
      },
    },
  },
} as const satisfies ValueSchemaSpec

const output = {
  schema: outputSchema,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

function domainError(error: SupraMasError | SupraMasDomainError): ToolEnvelope {
  if (error.code === 'SUPRAMAS_RUN_EXISTS') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['choose_another_job_id', 'inspect_existing_run'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Retry with a new job_id, or inspect the existing run first.',
        stop_condition: 'Do not overwrite an existing run or reuse its job_id blindly.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_RUN_NOT_FOUND') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['list_or_create_run'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Verify the run_id or create the run before reading it.',
        stop_condition: 'Stop if the requested run belongs to another workspace or job.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_EVIDENCE_MISMATCH') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['read_local_artifact', 'correct_evidence_quote'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Read the stored chunk and retry with a literal quote and matching page.',
        stop_condition: 'Do not accept or assemble the record while the quote disagrees with local evidence.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_EVIDENCE_MISSING') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['store_local_paper_or_chunk', 'retry_evidence_lookup'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Store the paper and its referenced chunk under the same run, then retry once.',
        stop_condition: 'Stop if the paper or chunk cannot be persisted from a verified source.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_EVIDENCE_POLICY_VIOLATION') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['import_full_text_and_rebuild_candidate'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Use supramas_paper_import for a verified open-access PDF, then rebuild the same candidate from full-text chunks.',
        stop_condition: 'Do not accept, finalize, or replace missing full text with a search abstract.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_EDGE_TYPE_MISMATCH') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['downgrade_edge_or_revise'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Revise the edge so full maps to direct, partial to transferable, or adjacent to exploratory.',
        stop_condition: 'Do not accept a child whose declared expectation satisfaction disagrees with its edge type.',
      },
    }
  }
  if (error.code === 'SUPRAMAS_DUPLICATE_ID') {
    return {
      status: 'error',
      summary: error.message,
      next_actions: ['choose_unique_artifact_id', 'inspect_existing_artifact'],
      artifacts: [],
      error: {
        code: error.code,
        root_cause_hint: error.message,
        safe_retry: 'Inspect the existing artifact or retry with a genuinely unique id.',
        stop_condition: 'Do not overwrite provenance already registered under the duplicate id.',
      },
    }
  }
  return {
    status: 'error',
    summary: error.message,
    next_actions: ['correct_request'],
    artifacts: [],
    error: {
      code: error.code,
      root_cause_hint: error.message,
      safe_retry: 'Correct the request using the reported lifecycle constraint, then retry once.',
      stop_condition: 'Stop after the same validated request fails again without state changing.',
    },
  }
}

async function guard(action: () => ToolEnvelope | Promise<ToolEnvelope>): Promise<ToolEnvelope> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof SupraMasError || error instanceof SupraMasDomainError) return domainError(error)
    throw error
  }
}

function jsonObject(value: object): Record<string, JsonValue> {
  return structuredClone(value) as unknown as Record<string, JsonValue>
}

function stage1Envelope(state: Stage1RunState, summary: string): ToolEnvelope {
  return {
    status: 'success',
    summary,
    next_actions: state.run.phase === 'recoverable_failed'
      ? ['resume_run', state.nextAction.kind]
      : [state.nextAction.kind],
    artifacts: [state.run.runDir],
    data: {
      run: state.run,
      workflow: jsonObject(state.workflow),
      next_action: jsonObject(state.nextAction),
    },
  }
}

function finalizedEnvelope(state: FinalizedStage1RunState, artifacts: string[]): ToolEnvelope {
  return {
    status: 'success',
    summary: `Completed Stage 1 workflow ${state.run.jobId}.`,
    next_actions: ['inspect_strategy_tree'],
    artifacts,
    data: {
      run: state.run,
      workflow: jsonObject(state.workflow),
      next_action: jsonObject(state.nextAction),
      tree: jsonObject(state.tree),
    },
  }
}

const reviewFindingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    target_id: { type: 'string', required: true },
    issue: { type: 'string', required: true },
    required_action: {
      type: 'string',
      required: true,
      enum: ['revise', 'remove', 'downgrade', 'provide_more_evidence', 'answer_question'],
    },
  },
} as const satisfies ValueSchemaSpec

const evidenceRefSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chunk_id: { type: 'string', required: true, description: 'Exact imported local chunk id.' },
    page: { type: 'integer', description: 'One-based source page when available.' },
    evidence_text: { type: 'string', required: true, description: 'Literal quote contained in the referenced chunk.' },
  },
} as const satisfies ValueSchemaSpec

const strategyRecordSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    record_id: { type: 'string', required: true, description: 'Stable paper-local strategy record id.' },
    tuning_dimension: {
      type: 'string',
      required: true,
      enum: TUNING_DIMENSIONS,
      description: 'Exactly one closed dominant SupraMAS tuning dimension.',
    },
    tuning_strategy: { type: 'string', required: true, description: 'Evidence-supported material tuning action.' },
    tuning_effect: { type: 'string', required: true, description: 'Evidence-supported observed effect of the tuning action.' },
    evidence: { ...evidenceRefSchema, required: true },
    confidence: { type: 'number', required: true, description: 'Record confidence from 0 to 1.' },
  },
} as const satisfies ValueSchemaSpec

const limitationRecordSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limitation_id: { type: 'string', required: true, description: 'Stable paper-local limitation id.' },
    limitation: { type: 'string', required: true, description: 'Evidence-supported limitation of the reported strategy.' },
    expectation: { type: 'string', required: true, description: 'Specific improvement expectation used for child expansion.' },
    related_record_ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional strategy record ids constrained by this limitation.',
    },
    evidence: { ...evidenceRefSchema, required: true },
    confidence: { type: 'number', required: true, description: 'Limitation confidence from 0 to 1.' },
  },
} as const satisfies ValueSchemaSpec

const paperNodeDraftSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paper_id: { type: 'string', required: true, description: 'Exact id of one imported paper artifact.' },
    paper_title: { type: 'string', required: true, description: 'Verified publication title.' },
    year: { type: 'integer', description: 'Publication year when verified.' },
    doi: { type: 'string', description: 'Verified DOI when available.' },
    url: { type: 'string', description: 'Verified public landing URL when available.' },
    source_type: { type: 'string', enum: SOURCE_TYPES, description: 'Scientific source classification.' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Concise node-level caveats.' },
    strategy_records: {
      type: 'array',
      required: true,
      items: strategyRecordSchema,
      description: 'One or more evidence-supported tuning records using the closed schema.',
    },
    limitation_records: {
      type: 'array',
      required: true,
      items: limitationRecordSchema,
      description: 'One or more evidence-supported limitation/expectation records.',
    },
  },
} as const satisfies ValueSchemaSpec

const proposedStrategyEdgeSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    parent_limitation_id: { type: 'string', required: true, description: 'Open parent limitation id from next_action.' },
    child_record_id: { type: 'string', description: 'Child strategy record that answers the parent expectation.' },
    child_tuning_effect: { type: 'string', description: 'Evidence-supported child effect relevant to the bridge.' },
    edge_type: { type: 'string', required: true, enum: EDGE_TYPES, description: 'Proposed expectation relationship.' },
    edge_rationale: { type: 'string', required: true, description: 'Scientific rationale for the parent-to-child bridge.' },
    confidence: { type: 'number', required: true, description: 'Edge confidence from 0 to 1.' },
  },
} as const satisfies ValueSchemaSpec

const builderHandoffSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paper_node: {
      required: true,
      oneOf: [paperNodeDraftSchema, { type: 'null' }],
      description: 'Complete paper draft, or null when no supported full-text candidate exists.',
    },
    edge: {
      required: true,
      oneOf: [proposedStrategyEdgeSchema, { type: 'null' }],
      description: 'Complete child bridge, or null for a root or unsupported bridge.',
    },
    reason: { type: 'string', description: 'Evidence-based explanation for a null candidate or edge.' },
    infrastructure: {
      type: 'boolean',
      description:
        'True only when a null candidate is an environmental acquisition failure (403, timeout, non-PDF body, blocked mirror) rather than a scientific no-candidate verdict. Requires paper_node null and a precise reason.',
    },
    notes: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const satisfies ValueSchemaSpec

const reviewerHandoffSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    decision: { type: 'string', required: true, enum: ['accept', 'revise', 'reject'] },
    expectation_satisfaction: {
      type: 'string',
      required: true,
      enum: ['not_applicable', 'full', 'partial', 'adjacent', 'none'],
    },
    summary: { type: 'string', required: true },
    critical_issues: { type: 'array', required: true, items: reviewFindingSchema },
    edge_issues: { type: 'array', required: true, items: reviewFindingSchema },
    acceptance_conditions: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const satisfies ValueSchemaSpec

const BUILDER_PERSONA = `You are the SupraMAS Stage 1 strategy builder. Execute exactly one bounded
build_root, build_child, or revise_candidate action from the supplied durable state. When
available_imported_papers is non-empty, choose exactly one listed paper, do not search or import, and read
only the bounded chunks needed for the result. When it is empty, make at most two web searches, three
structured literature searches, and six import attempts, then stop discovery after the first supported
full-text candidate. If an indexed PDF returns 403, times out, or is not a PDF, first retry the same
candidate once: every candidate may expose multiple ordered document URLs, so try the remaining mirrors
through supramas_paper_import before abandoning it. If all mirrors fail, use web_search with the
candidate DOI or exact title to find a direct public PDF and retry supramas_paper_import for the same
candidate with document_url. Search
abstracts are discovery metadata and must never be cited. Every evidence_text must be a literal substring
of its cited full_text chunk and must contain complete supporting sentences rather than labels or sentence
fragments. It must cover every number, comparison, material/process qualifier, and mechanism asserted by
the record. Before returning, call supramas_evidence_verify for every proposed evidence quote and correct
any mismatch against supramas_chunk_read; never return an unverified quote. Always copy
verification.canonical_evidence_text into the record, especially when match_kind is normalized. Attempt exact-character repair
at most twice per quote, use at most twelve chunk reads and twelve evidence verifications for one handoff,
and return a null paper_node with a precise reason instead of continuing a repeated verification loop. Set
infrastructure true in the result only when the null paper_node is caused by environmental acquisition
failures (HTTP 403 or timeout, blocked redirects, non-PDF bodies, no importable mirror after the retries
above); set it false or omit it when the literature genuinely lacks a supported candidate for the request.
Copy paper_id and paper_title verbatim from the imported paper artifact or its available_imported_papers
entry; never compose, truncate, or restyle the title from search-result metadata, because the coordinator
rejects any title that differs from the stored local paper.
On revision,
keep the same paper and address every reviewer condition. Never review, accept, submit workflow state, or
assemble a tree. Finish promptly with exactly one structured result matching the required schema; use null
paper_node when no supported full-text candidate exists and null edge for a root or unsupported child bridge.
For a child edge, copy parent_node_id, parent_limitation_id, and parent_expectation exactly from next_action;
choose child_record_id from paper_node.strategy_records and copy child_tuning_effect byte-for-byte from that
same record. Self-check these edge links before returning.`

const REVIEWER_PERSONA = `You are the independent SupraMAS Stage 1 evidence reviewer. Review exactly one
pending paper candidate and proposed edge from the supplied durable state. Read the local chunks and use
supramas_evidence_verify for every cited quote. Treat deterministic_evidence_audit findings as mandatory
revision conditions. Independently reject sentence fragments, material-name-only quotes, and evidence that
omits any number, comparison, qualifier, result, or mechanism asserted by its record. Never mutate evidence,
search for replacement papers,
submit workflow state, or assemble a tree. Root reviews use not_applicable. For children, full maps to
direct, partial to transferable, adjacent to exploratory, and none cannot be accepted. An accept decision
must have empty critical_issues, edge_issues, and acceptance_conditions; return revise or reject whenever
required work remains. Report exactly one final structured result matching the required schema.`

type StructuredSchema = NonNullable<SubagentStartRequest['outputSchema']>

interface StructuredDelegation<T> {
  runId: string
  value: T
}

type HandoffAbortKind = 'caller_aborted' | 'timeout' | 'subagent_aborted'

class HandoffAbortError extends Error {
  constructor(readonly kind: HandoffAbortKind, message: string) {
    super(message)
    this.name = 'HandoffAbortError'
  }
}

function handoffAbortError(
  label: string,
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal,
  timeoutMs: number,
): HandoffAbortError {
  if (callerSignal.aborted) {
    return new HandoffAbortError('caller_aborted', `SupraMAS ${label} handoff was cancelled by its caller`)
  }
  if (timeoutSignal.aborted) {
    return new HandoffAbortError(
      'timeout',
      `SupraMAS ${label} handoff timed out after ${timeoutMs} ms`,
    )
  }
  return new HandoffAbortError('subagent_aborted', `SupraMAS ${label} subagent aborted independently`)
}

async function delegateStructured<T>(
  ctx: Context,
  exec: ToolRunContext,
  options: {
    provider: string
    label: string
    prompt: string
    persona: string
    toolFilter: { allow: string[] }
    schema: ValueSchemaSpec
    timeoutMs: number
  },
): Promise<StructuredDelegation<T>> {
  if (exec.agent === undefined) {
    throw new Error('orchestrated SupraMAS handoff requires a calling agent')
  }
  const subagents = ctx.get('subagents')
  if (subagents === undefined) {
    throw new Error('orchestrated SupraMAS handoff requires the subagents service')
  }
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs)
  const signal = AbortSignal.any([exec.signal, timeoutSignal])
  try {
    const run = await subagents.start(options.provider, {
      label: options.label,
      prompt: [{ type: 'text', text: options.prompt }],
      parent: exec.agent,
      signal,
      outputSchema: valueSchemaSpecToJsonSchema(options.schema) as StructuredSchema,
      maxDepth: 1,
      persona: options.persona,
      toolFilter: options.toolFilter,
    })
    try {
      const result = await run.result
      if (result.stopReason === 'aborted') {
        throw handoffAbortError(options.label, exec.signal, timeoutSignal, options.timeoutMs)
      }
      if (result.stopReason !== 'completed') {
        throw new Error(
          `SupraMAS ${options.label} subagent ended with ${result.stopReason}`
          + (result.diagnostic === undefined ? '' : `: ${result.diagnostic}`),
        )
      }
      if (result.structured === undefined) {
        throw new Error(`SupraMAS ${options.label} subagent returned no structured handoff`)
      }
      return {
        runId: String(run.id),
        value: structuredClone(result.structured) as T,
      }
    } finally {
      await run.dispose()
    }
  } catch (error) {
    if (!(error instanceof HandoffAbortError) && signal.aborted) {
      throw handoffAbortError(options.label, exec.signal, timeoutSignal, options.timeoutMs)
    }
    throw error
  }
}

interface HandoffPaperSummary {
  paper_id: string
  paper_title: string
  local_path: string
  source_type: string
  page_count: number
  chunk_count: number
}

export interface EvidenceAuditIssue {
  target_id: string
  issue: string
  required_action: 'revise'
}

const MIN_EVIDENCE_QUOTE_CHARS = 120

function numericFacts(value: string): string[] {
  return [...new Set(value.match(/\d+(?:[.,]\d+)*/g) ?? [])]
}

/** Deterministically reject evidence fragments and numeric claims absent from their literal quote. */
export function auditPaperNodeEvidence(
  node: NonNullable<Stage1BuilderSubmission['paper_node']>,
): EvidenceAuditIssue[] {
  const issues: EvidenceAuditIssue[] = []
  const inspect = (targetId: string, claim: string, evidenceText: string) => {
    const quote = evidenceText.trim()
    if (quote.length < MIN_EVIDENCE_QUOTE_CHARS) {
      issues.push({
        target_id: targetId,
        issue: `Evidence quote has ${quote.length} characters; provide complete supporting sentences of at least ${MIN_EVIDENCE_QUOTE_CHARS} characters or narrow the claim.`,
        required_action: 'revise',
      })
    }
    const evidenceNumbers = new Set(numericFacts(quote))
    const missing = numericFacts(claim).filter(value => !evidenceNumbers.has(value))
    if (missing.length > 0) {
      issues.push({
        target_id: targetId,
        issue: `Evidence quote does not contain claimed numeric value(s): ${missing.join(', ')}. Add literal support or remove the unsupported values.`,
        required_action: 'revise',
      })
    }
  }
  for (const record of node.strategy_records) {
    inspect(record.record_id, `${record.tuning_strategy} ${record.tuning_effect}`, record.evidence.evidence_text)
  }
  for (const record of node.limitation_records) {
    inspect(record.limitation_id, record.limitation, record.evidence.evidence_text)
  }
  return issues
}

/** Convert an unsafe model accept into a durable reviewer-guided revision. */
export function evidenceAuditedReview(
  review: Stage1ReviewSubmission,
  issues: readonly EvidenceAuditIssue[],
): Stage1ReviewSubmission {
  if (review.decision === 'reject' || issues.length === 0) return review
  return {
    ...review,
    decision: 'revise',
    summary: `${review.summary} Deterministic evidence audit requires revision before acceptance.`,
    critical_issues: [...review.critical_issues, ...issues],
    edge_issues: [...review.edge_issues],
    acceptance_conditions: [
      ...review.acceptance_conditions,
      ...issues.map(issue => `${issue.target_id}: ${issue.issue}`),
    ],
  }
}

function evidenceAudit(state: Stage1RunState): EvidenceAuditIssue[] {
  const node = state.workflow.pending_candidate?.node
  return node === undefined ? [] : auditPaperNodeEvidence(node)
}

function summarizePaper(paper: PaperArtifact): HandoffPaperSummary {
  return {
    paper_id: paper.paper_id,
    paper_title: paper.paper_title,
    local_path: paper.local_path,
    source_type: paper.source_type,
    page_count: paper.full_text_source?.page_count ?? 0,
    chunk_count: paper.chunks.length,
  }
}

function searchTerms(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(term => term.length >= 4) ?? []
}

function builderQuery(state: Stage1RunState): string {
  if (state.nextAction.kind === 'build_child') {
    const action = state.nextAction
    const parent = state.workflow.nodes.find(node => node.node_id === action.parent_node_id)
    const limitation = parent?.limitation_records.find(record =>
      record.limitation_id === action.parent_limitation_id)
    return [limitation?.limitation, action.parent_expectation].filter(Boolean).join(' ')
  }
  return [
    state.workflow.config.researchTopic,
    ...(state.workflow.config.materialScope ?? []),
    ...(state.workflow.config.targetProperty ?? []),
  ].join(' ')
}

function paperRelevance(paper: PaperArtifact, terms: string[]): number {
  const titleTerms = searchTerms(paper.paper_title)
  return terms.reduce((score, term) => score + titleTerms.reduce((best, titleTerm) =>
    Math.max(best, titleTerm.includes(term) || term.includes(titleTerm) ? Math.min(term.length, titleTerm.length) : 0),
  0), 0)
}

function availableBuilderPapers(state: Stage1RunState, papers: PaperArtifact[]): HandoffPaperSummary[] {
  const fullTextPapers = papers.filter(paper =>
    paper.full_text_source !== undefined
    && paper.chunks.some(chunk => chunk.evidence_kind === 'full_text'),
  )
  if (state.nextAction.kind === 'revise_candidate') {
    const paperId = state.nextAction.paper_id
    return fullTextPapers
      .filter(paper => paper.paper_id === paperId)
      .map(summarizePaper)
  }
  const used = new Set([
    ...state.workflow.nodes.map(node => node.paper_id),
    ...state.workflow.builder_attempts.flatMap(attempt =>
      attempt.paper_id === undefined ? [] : [attempt.paper_id]),
  ])
  const terms = searchTerms(builderQuery(state))
  const ranked = fullTextPapers
    .filter(paper => !used.has(paper.paper_id))
    .map((paper, index) => ({ paper, index, score: paperRelevance(paper, terms) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
  const frontierKey = state.nextAction.kind === 'build_child'
    ? `${state.nextAction.parent_node_id}:${state.nextAction.parent_limitation_id}`
    : undefined
  // Step past one ranked paper per prior scientific no-candidate attempt: that attempt
  // evaluated the offered paper and rejected it. Infrastructure failures never evaluated
  // any paper, so they must not advance the selection.
  const priorEmptyAttempts = state.workflow.builder_attempts.filter(attempt =>
    attempt.paper_id === undefined
    && attempt.status !== 'no_candidate_infrastructure'
    && (frontierKey === undefined ? attempt.scope === 'root' : attempt.frontier_key === frontierKey),
  ).length
  const selected = ranked[priorEmptyAttempts] ?? ranked[0]
  return selected === undefined ? [] : [summarizePaper(selected.paper)]
}

function reviewerPapers(state: Stage1RunState, papers: PaperArtifact[]): HandoffPaperSummary[] {
  const paperId = state.workflow.pending_candidate?.node.paper_id
  if (paperId === undefined) return []
  return papers.filter(paper => paper.paper_id === paperId).map(summarizePaper)
}

function handoffPrompt(
  kind: 'builder' | 'reviewer',
  state: Stage1RunState,
  availablePapers: HandoffPaperSummary[],
): string {
  return [
    `Execute the ${kind} handoff for the only legal next action below.`,
    'Use the exact run_id and paper ids shown in this payload.',
    JSON.stringify({
      run_id: state.run.id,
      job_id: state.run.jobId,
      revision: state.run.revision,
      workflow: state.workflow,
      next_action: state.nextAction,
      available_imported_papers: availablePapers,
      ...(kind === 'reviewer' ? { deterministic_evidence_audit: evidenceAudit(state) } : {}),
    }, null, 2),
  ].join('\n\n')
}

function handoffFailureEnvelope(
  state: Stage1RunState,
  kind: 'builder' | 'reviewer',
  error: unknown,
  retryInProcess: boolean,
): ToolEnvelope {
  const detail = (error instanceof Error ? error.message : String(error)).replaceAll(/\s+/g, ' ').slice(0, 1_000)
  const code = error instanceof HandoffAbortError
    ? {
      timeout: 'SUPRAMAS_SUBAGENT_HANDOFF_TIMEOUT',
      caller_aborted: 'SUPRAMAS_SUBAGENT_HANDOFF_CALLER_ABORTED',
      subagent_aborted: 'SUPRAMAS_SUBAGENT_HANDOFF_ABORTED',
    }[error.kind]
    : 'SUPRAMAS_SUBAGENT_HANDOFF_FAILED'
  return {
    status: 'error',
    summary: `SupraMAS ${kind} handoff failed before state mutation: ${detail}`,
    next_actions: [retryInProcess ? 'retry_same_revision_once' : 'restart_process_and_resume_same_revision'],
    artifacts: [state.run.runDir],
    data: {
      run: state.run,
      workflow: jsonObject(state.workflow),
      next_action: jsonObject(state.nextAction),
    },
    error: {
      code,
      root_cause_hint: detail,
      safe_retry: retryInProcess
        ? `Retry ${kind} once in this process with run_id ${state.run.id} at revision ${state.run.revision}.`
        : `Restart the DSH process, then resume run_id ${state.run.id} at revision ${state.run.revision}.`,
      stop_condition: retryInProcess
        ? `Do not start more than one retry for this ${kind} revision.`
        : `Do not call the ${kind} submit tool again in this process for the same revision.`,
    },
  }
}

function handoffInProgressEnvelope(state: Stage1RunState, kind: 'builder' | 'reviewer'): ToolEnvelope {
  return {
    status: 'error',
    summary: `A SupraMAS ${kind} handoff is already active for revision ${state.run.revision}.`,
    next_actions: ['wait_for_active_handoff'],
    artifacts: [state.run.runDir],
    data: {
      run: state.run,
      workflow: jsonObject(state.workflow),
      next_action: jsonObject(state.nextAction),
    },
    error: {
      code: 'SUPRAMAS_SUBAGENT_HANDOFF_IN_PROGRESS',
      root_cause_hint: 'A duplicate handoff was rejected before a second subagent could start.',
      safe_retry: 'Wait for the active handoff result, then read supramas_stage1_get before taking another action.',
      stop_condition: `Do not start another ${kind} handoff for this revision while one is active.`,
    },
  }
}

/** Register narrow run controls and provenance-bound Stage 1 evidence tools. */
export function apply(ctx: Context, config: Config): void {
  const failedHandoffs = new Map<string, number>()
  const activeHandoffs = new Set<string>()
  ctx.tools.register(defineTool({
    name: 'supramas_run_create',
    description: 'Create one deterministic, revisioned SupraMAS material-science run.',
    parameters: {
      job_id: { type: 'string', required: true, description: 'Stable job id used below runs/<job_id>.' },
      input_task_path: { type: 'string', required: true, description: 'Canonical runs/<job_id>/input_task.yaml path.' },
      run_dir: { type: 'string', required: true, description: 'Canonical runs/<job_id> directory.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const run = await ctx.supramas.create({
          jobId: args.job_id,
          inputTaskPath: args.input_task_path,
          runDir: args.run_dir,
        })
        return {
          status: 'success',
          summary: `Created SupraMAS run ${run.jobId}.`,
          next_actions: ['prepare_input_task'],
          artifacts: [run.inputTaskPath, run.runDir],
          data: { run },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_run_list',
    description: 'List all durable SupraMAS runs in stable creation order for discovery and recovery.',
    parameters: {},
    output,
    async execute() {
      return guard(() => {
        const runs = ctx.supramas.list()
        return {
          status: 'success',
          summary: runs.length === 0
            ? 'No SupraMAS runs are available.'
            : `Loaded ${runs.length} SupraMAS run(s).`,
          next_actions: runs.length === 0 ? ['create_run'] : ['inspect_or_resume_run'],
          artifacts: [...new Set(runs.flatMap(run => [run.inputTaskPath, run.runDir]))],
          data: { runs },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_run_get',
    description: 'Read the current detached snapshot of one SupraMAS run.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Deterministic run id such as supramas:demo.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const run = ctx.supramas.get(SupraMasRunId(args.run_id))
        if (run === undefined) {
          throw new SupraMasError(`SupraMAS run ${args.run_id} was not found.`, 'SUPRAMAS_RUN_NOT_FOUND')
        }
        return {
          status: 'success',
          summary: `Loaded SupraMAS run ${run.jobId}.`,
          next_actions: run.phase === 'created' ? ['prepare_input_task'] : ['continue_run'],
          artifacts: [run.inputTaskPath, run.runDir],
          data: { run },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_run_transition',
    description: 'Advance or resume one durable SupraMAS run with compare-and-set revision protection.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Deterministic run id such as supramas:demo.' },
      revision: { type: 'integer', required: true, description: 'Exact current revision returned by list or get.' },
      phase: { type: 'string', required: true, enum: RUN_PHASES, description: 'Requested next durable lifecycle phase.' },
      failure_code: { type: 'string', description: 'Stable failure code; required for a failed phase.' },
      failure_message: { type: 'string', description: 'Actionable failure detail; required for a failed phase.' },
      failure_retryable: { type: 'boolean', description: 'Whether an operator may safely resume this failure.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const hasFailure = args.failure_code !== undefined
          || args.failure_message !== undefined
          || args.failure_retryable !== undefined
        const run = await ctx.supramas.transition(
          { id: SupraMasRunId(args.run_id), revision: args.revision },
          {
            phase: args.phase,
            ...(hasFailure
              ? {
                failure: {
                  code: args.failure_code ?? '',
                  message: args.failure_message ?? '',
                  retryable: args.failure_retryable ?? false,
                },
              }
              : {}),
          },
        )
        const nextActions = run.phase === 'completed'
          ? ['read_outputs']
          : run.phase === 'recoverable_failed'
            ? ['inspect_failure_and_resume']
            : run.phase === 'failed' || run.phase === 'cancelled'
              ? ['stop_run']
              : ['continue_run']
        return {
          status: 'success',
          summary: `Transitioned SupraMAS run ${run.jobId} to ${run.phase}.`,
          next_actions: nextActions,
          artifacts: [run.inputTaskPath, run.runDir],
          data: { run },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_stage1_start',
    description: 'Start the durable Stage 1 coordinator from one approved task-ready run.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      revision: { type: 'integer', required: true, description: 'Exact task-ready run revision.' },
      research_topic: { type: 'string', required: true, description: 'Approved Stage 1 research topic.' },
      material_scope: { type: 'array', items: { type: 'string' }, description: 'Optional material search scope.' },
      target_property: { type: 'array', items: { type: 'string' }, description: 'Optional target properties.' },
      evidence_policy: { type: 'string', description: 'Optional evidence acceptance policy preserved in input_task.yaml.' },
      include: { type: 'array', items: { type: 'string' }, description: 'Optional Stage 1 search inclusion guidance.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Optional Stage 1 search exclusion guidance.' },
      max_depth: { type: 'integer', required: true, description: 'Maximum accepted child depth; zero keeps only roots.' },
      max_root_attempts: { type: 'integer', required: true, description: 'Real builder attempt budget for a root.' },
      max_child_attempts_per_limitation: {
        type: 'integer',
        required: true,
        description: 'Real builder attempt budget for each accepted limitation.',
      },
      max_branch_per_node: { type: 'integer', description: 'Optional accepted outgoing-edge cap per paper.' },
      target_child_nodes: { type: 'integer', description: 'Optional accepted child-node target.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const runId = SupraMasRunId(args.run_id)
        const run = ctx.supramas.get(runId)
        if (run === undefined) {
          throw new SupraMasError(`SupraMAS run ${args.run_id} was not found.`, 'SUPRAMAS_RUN_NOT_FOUND')
        }
        const state = await ctx.supramas.startStage1(
          { id: runId, revision: args.revision },
          {
            jobId: run.jobId,
            researchTopic: args.research_topic,
            ...(args.material_scope === undefined ? {} : { materialScope: args.material_scope }),
            ...(args.target_property === undefined ? {} : { targetProperty: args.target_property }),
            ...(args.evidence_policy === undefined ? {} : { evidencePolicy: args.evidence_policy }),
            ...(args.include === undefined ? {} : { include: args.include }),
            ...(args.exclude === undefined ? {} : { exclude: args.exclude }),
            maxDepth: args.max_depth,
            maxRootAttempts: args.max_root_attempts,
            maxChildAttemptsPerLimitation: args.max_child_attempts_per_limitation,
            ...(args.max_branch_per_node === undefined ? {} : { maxBranchPerNode: args.max_branch_per_node }),
            ...(args.target_child_nodes === undefined ? {} : { targetChildNodes: args.target_child_nodes }),
            requireAgentHandoffs: config.mode !== 'direct',
          },
        )
        await ctx.supramasArtifacts.syncTask(state.run.id)
        return stage1Envelope(state, `Started Stage 1 workflow ${state.run.jobId}.`)
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_stage1_get',
    description: 'Read the durable Stage 1 workflow and its only legal next action.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const runId = SupraMasRunId(args.run_id)
        if (ctx.supramas.get(runId) === undefined) {
          throw new SupraMasError(`SupraMAS run ${args.run_id} was not found.`, 'SUPRAMAS_RUN_NOT_FOUND')
        }
        const state = ctx.supramas.getStage1(runId)
        if (state === undefined) {
          throw new SupraMasError(`SupraMAS run ${args.run_id} has no Stage 1 workflow.`, 'SUPRAMAS_INVALID_REQUEST')
        }
        return stage1Envelope(state, `Loaded Stage 1 workflow ${state.run.jobId}.`)
      })
    },
  }))

  if (config.mode === 'direct') {
    ctx.tools.register(defineTool({
      name: 'supramas_stage1_builder_submit',
      description: 'Submit one trusted builder attempt directly; candidates still require reviewer approval.',
      parameters: {
        run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
        revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
        paper_node: {
          ...paperNodeDraftSchema,
          description: 'Complete paper-node draft, omitted only when no supported candidate was found.',
        },
        edge: {
          ...proposedStrategyEdgeSchema,
          description: 'Complete proposed child edge; omit for a root or unsupported child bridge.',
        },
        reason: { type: 'string', description: 'Evidence-based reason for an empty candidate or edge.' },
        infrastructure: {
          type: 'boolean',
          description: 'True only for an environmental acquisition failure behind a null candidate.',
        },
        notes: { type: 'array', items: { type: 'string' }, description: 'Concise builder handoff notes.' },
      },
      output,
      async execute(args) {
        return guard(async () => {
          const state = await ctx.supramas.submitStage1Builder(
            { id: SupraMasRunId(args.run_id), revision: args.revision },
            {
              paper_node: args.paper_node === undefined ? null : args.paper_node,
              edge: args.edge === undefined ? null : args.edge,
              ...(args.reason === undefined ? {} : { reason: args.reason }),
              ...(args.infrastructure === undefined ? {} : { infrastructure: args.infrastructure }),
              notes: args.notes ?? [],
            },
          )
          return stage1Envelope(state, `Recorded trusted builder attempt for ${state.run.jobId}.`)
        })
      },
    }))

    ctx.tools.register(defineTool({
      name: 'supramas_stage1_reviewer_submit',
      description: 'Submit one trusted reviewer decision directly.',
      parameters: {
        run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
        revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
        decision: { type: 'string', required: true, enum: ['accept', 'revise', 'reject'] },
        expectation_satisfaction: {
          type: 'string',
          required: true,
          enum: ['not_applicable', 'full', 'partial', 'adjacent', 'none'],
          description: 'Root uses not_applicable; child coverage maps full/direct, partial/transferable, adjacent/exploratory.',
        },
        summary: { type: 'string', required: true, description: 'Evidence-grounded review summary.' },
        critical_issues: { type: 'array', required: true, items: reviewFindingSchema },
        edge_issues: { type: 'array', required: true, items: reviewFindingSchema },
        acceptance_conditions: { type: 'array', required: true, items: { type: 'string' } },
      },
      output,
      async execute(args) {
        return guard(async () => {
          const state = await ctx.supramas.submitStage1Review(
            { id: SupraMasRunId(args.run_id), revision: args.revision },
            {
              decision: args.decision,
              expectation_satisfaction: args.expectation_satisfaction,
              summary: args.summary,
              critical_issues: args.critical_issues,
              edge_issues: args.edge_issues,
              acceptance_conditions: args.acceptance_conditions,
            },
          )
          return stage1Envelope(state, `Recorded trusted reviewer decision for ${state.run.jobId}.`)
        })
      },
    }))
  } else {
    ctx.tools.register(defineTool({
      name: 'supramas_stage1_builder_submit',
      description: 'Atomically delegate the current build action and persist the structured builder handoff.',
      parameters: {
        run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
        revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
      },
      output,
      async execute(args, exec) {
        return guard(async () => {
          const runId = SupraMasRunId(args.run_id)
          const current = ctx.supramas.getStage1(runId)
          if (current === undefined) {
            throw new SupraMasError(`SupraMAS run ${args.run_id} has no Stage 1 workflow.`, 'SUPRAMAS_INVALID_REQUEST')
          }
          if (current.run.revision !== args.revision) {
            throw new SupraMasError(
              `SupraMAS run ${args.run_id} expected revision ${current.run.revision}, received ${args.revision}.`,
              'SUPRAMAS_STALE_REVISION',
            )
          }
          const handoffKey = `builder:${runId}:${args.revision}`
          const priorFailures = failedHandoffs.get(handoffKey) ?? 0
          if (priorFailures >= 2) {
            return handoffFailureEnvelope(
              current,
              'builder',
              'two prior builder handoffs already failed in this process',
              false,
            )
          }
          if (activeHandoffs.has(handoffKey)) {
            return handoffInProgressEnvelope(current, 'builder')
          }
          activeHandoffs.add(handoffKey)
          const availablePapers = availableBuilderPapers(current, ctx.supramas.listPapers(runId))
          const allowDiscovery = availablePapers.length === 0 && current.nextAction.kind !== 'revise_candidate'
          try {
            const handoff = await delegateStructured<Stage1BuilderSubmission>(ctx, exec, {
              provider: config.subagentProvider ?? 'spawn',
              label: 'SupraMAS Stage 1 builder',
              prompt: handoffPrompt('builder', current, availablePapers),
              persona: BUILDER_PERSONA,
              schema: builderHandoffSchema,
              timeoutMs: config.builderHandoffTimeoutMs
                ?? config.handoffTimeoutMs
                ?? DEFAULT_BUILDER_HANDOFF_TIMEOUT_MS,
              toolFilter: {
                allow: [
                  ...(allowDiscovery ? ['web_search', 'supramas_literature_search', 'supramas_paper_import'] : []),
                  'supramas_chunk_list',
                  'supramas_chunk_read',
                  'supramas_evidence_verify',
                ],
              },
            })
            const state = await ctx.supramas.submitStage1Builder(
              { id: runId, revision: args.revision },
              { ...handoff.value, builder_run_id: handoff.runId },
            )
            failedHandoffs.delete(handoffKey)
            return stage1Envelope(state, `Recorded attested builder handoff for ${state.run.jobId}.`)
          } catch (error) {
            const failures = priorFailures + 1
            failedHandoffs.set(handoffKey, failures)
            return handoffFailureEnvelope(current, 'builder', error, failures < 2)
          } finally {
            activeHandoffs.delete(handoffKey)
          }
        })
      },
    }))

    ctx.tools.register(defineTool({
      name: 'supramas_stage1_reviewer_submit',
      description: 'Atomically delegate independent review and persist the structured reviewer handoff.',
      parameters: {
        run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
        revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
      },
      output,
      async execute(args, exec) {
        return guard(async () => {
          const runId = SupraMasRunId(args.run_id)
          const current = ctx.supramas.getStage1(runId)
          if (current === undefined) {
            throw new SupraMasError(`SupraMAS run ${args.run_id} has no Stage 1 workflow.`, 'SUPRAMAS_INVALID_REQUEST')
          }
          if (current.run.revision !== args.revision) {
            throw new SupraMasError(
              `SupraMAS run ${args.run_id} expected revision ${current.run.revision}, received ${args.revision}.`,
              'SUPRAMAS_STALE_REVISION',
            )
          }
          const handoffKey = `reviewer:${runId}:${args.revision}`
          const priorFailures = failedHandoffs.get(handoffKey) ?? 0
          if (priorFailures >= 2) {
            return handoffFailureEnvelope(
              current,
              'reviewer',
              'two prior reviewer handoffs already failed in this process',
              false,
            )
          }
          if (activeHandoffs.has(handoffKey)) {
            return handoffInProgressEnvelope(current, 'reviewer')
          }
          activeHandoffs.add(handoffKey)
          try {
            const handoff = await delegateStructured<Stage1ReviewSubmission>(ctx, exec, {
              provider: config.subagentProvider ?? 'spawn',
              label: 'SupraMAS Stage 1 reviewer',
              prompt: handoffPrompt('reviewer', current, reviewerPapers(current, ctx.supramas.listPapers(runId))),
              persona: REVIEWER_PERSONA,
              schema: reviewerHandoffSchema,
              timeoutMs: config.reviewerHandoffTimeoutMs
                ?? config.handoffTimeoutMs
                ?? DEFAULT_REVIEWER_HANDOFF_TIMEOUT_MS,
              toolFilter: {
                allow: ['supramas_chunk_list', 'supramas_chunk_read', 'supramas_evidence_verify'],
              },
            })
            const reviewed = evidenceAuditedReview(handoff.value, evidenceAudit(current))
            const state = await ctx.supramas.submitStage1Review(
              { id: runId, revision: args.revision },
              { ...reviewed, reviewer_run_id: handoff.runId },
            )
            failedHandoffs.delete(handoffKey)
            return stage1Envelope(state, `Recorded attested reviewer handoff for ${state.run.jobId}.`)
          } catch (error) {
            const failures = priorFailures + 1
            failedHandoffs.set(handoffKey, failures)
            return handoffFailureEnvelope(current, 'reviewer', error, failures < 2)
          } finally {
            activeHandoffs.delete(handoffKey)
          }
        })
      },
    }))
  }

  ctx.tools.register(defineTool({
    name: 'supramas_stage1_finalize',
    description: 'Strictly validate and atomically complete a Stage 1 workflow with no open frontier.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const state = await ctx.supramas.finalizeStage1({
          id: SupraMasRunId(args.run_id),
          revision: args.revision,
        })
        const manifest = await ctx.supramasArtifacts.syncCompleted(state.run.id)
        return finalizedEnvelope(state, manifest.files)
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_artifacts_sync',
    description: 'Idempotently repair or refresh the Stage 1 compatibility files from durable state.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const runId = SupraMasRunId(args.run_id)
        const run = ctx.supramas.get(runId)
        if (run === undefined) {
          throw new SupraMasError(`SupraMAS run ${args.run_id} was not found.`, 'SUPRAMAS_RUN_NOT_FOUND')
        }
        const files = run.phase === 'completed'
          ? (await ctx.supramasArtifacts.syncCompleted(runId)).files
          : [await ctx.supramasArtifacts.syncTask(runId)]
        return {
          status: 'success',
          summary: `Synchronized SupraMAS artifacts for ${run.jobId}.`,
          next_actions: run.phase === 'completed' ? ['inspect_exported_artifacts'] : ['continue_run'],
          artifacts: files,
          data: { run },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_evidence_verify',
    description: 'Resolve one evidence selector to a canonical literal chunk quote and verify its page.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      paper_id: { type: 'string', required: true, description: 'Expected owning paper identity.' },
      chunk_id: { type: 'string', required: true, description: 'Referenced local chunk identity.' },
      page: { type: 'integer', description: 'One-based source page when claimed by the record.' },
      evidence_text: { type: 'string', required: true, description: 'Literal quote that must occur in the chunk.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const verification = ctx.supramas.verifyEvidence(SupraMasRunId(args.run_id), args.paper_id, {
          chunk_id: args.chunk_id,
          ...(args.page === undefined ? {} : { page: args.page }),
          evidence_text: args.evidence_text,
        })
        return {
          status: 'success',
          summary: `Verified evidence chunk ${verification.chunk_id}.`,
          next_actions: ['review_record_or_edge'],
          artifacts: [verification.local_path],
          data: { verification },
        }
      })
    },
  }))
}
