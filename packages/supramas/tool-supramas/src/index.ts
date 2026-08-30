/** Model-facing tools for the SupraMAS material-science run capability. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  RUN_PHASES,
  SOURCE_TYPES,
  SupraMasDomainError,
  SupraMasError,
  SupraMasRunId,
  type EvidenceChunk,
  type EvidenceVerification,
  type FinalizedStage1RunState,
  type PaperArtifact,
  type PaperNodeDraft,
  type ProposedStrategyEdge,
  type RunSnapshot,
  type SourceType,
  type Stage1RunState,
} from '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas-artifacts'

export const name = 'tool-supramas'
export const inject = ['tools', 'supramas', 'supramasArtifacts']

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
    paper?: PaperSummary
    chunk?: ToolEvidenceChunk
    artifact?: ToolPaperArtifact
    verification?: EvidenceVerification
    workflow?: Record<string, JsonValue>
    next_action?: Record<string, JsonValue>
    tree?: Record<string, JsonValue>
  }
  error?: ToolFailure
}

interface PaperSummary {
  paper_id: string
  paper_title: string
  local_path: string
  source_type: SourceType
  chunk_count: number
}

interface ToolEvidenceChunk {
  chunk_id: string
  page?: number
  text: string
}

interface ToolPaperArtifact extends Omit<PaperArtifact, 'chunks'> {
  chunks: ToolEvidenceChunk[]
}

const chunkSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chunk_id: { type: 'string', required: true },
    page: { type: 'integer' },
    text: { type: 'string', required: true },
  },
} as const satisfies ValueSchemaSpec

const paperSummarySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paper_id: { type: 'string', required: true },
    paper_title: { type: 'string', required: true },
    local_path: { type: 'string', required: true },
    source_type: { type: 'string', required: true, enum: SOURCE_TYPES },
    chunk_count: { type: 'integer', required: true },
  },
} as const satisfies ValueSchemaSpec

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
        paper: paperSummarySchema,
        chunk: chunkSchema,
        artifact: {
          type: 'object',
          additionalProperties: false,
          properties: {
            paper_id: { type: 'string', required: true },
            paper_title: { type: 'string', required: true },
            local_path: { type: 'string', required: true },
            source_type: { type: 'string', required: true, enum: SOURCE_TYPES },
            chunks: { type: 'array', required: true, items: chunkSchema },
          },
        },
        verification: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verified: { type: 'boolean', required: true },
            paper_id: { type: 'string', required: true },
            chunk_id: { type: 'string', required: true },
            local_path: { type: 'string', required: true },
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

function summarizePaper(artifact: PaperArtifact): PaperSummary {
  return {
    paper_id: artifact.paper_id,
    paper_title: artifact.paper_title,
    local_path: artifact.local_path,
    source_type: artifact.source_type,
    chunk_count: artifact.chunks.length,
  }
}

function modelChunk(chunk: EvidenceChunk): ToolEvidenceChunk {
  return {
    chunk_id: chunk.chunk_id,
    ...(chunk.page === undefined || chunk.page === null ? {} : { page: chunk.page }),
    text: chunk.text,
  }
}

function modelArtifact(artifact: PaperArtifact): ToolPaperArtifact {
  return { ...artifact, chunks: artifact.chunks.map(modelChunk) }
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

/** Register narrow run controls and provenance-bound Stage 1 evidence tools. */
export function apply(ctx: Context): void {
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

  ctx.tools.register(defineTool({
    name: 'supramas_stage1_builder_submit',
    description: 'Submit one builder attempt; candidates remain unaccepted until reviewer approval.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
      paper_node: {
        type: 'object',
        additionalProperties: true,
        description: 'Complete paper-node draft, omitted only when no supported candidate was found.',
      },
      edge: {
        type: 'object',
        additionalProperties: true,
        description: 'Complete proposed child edge; omit for a root or unsupported child bridge.',
      },
      reason: { type: 'string', description: 'Evidence-based reason for an empty candidate or edge.' },
      notes: { type: 'array', items: { type: 'string' }, description: 'Concise builder handoff notes.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const state = await ctx.supramas.submitStage1Builder(
          { id: SupraMasRunId(args.run_id), revision: args.revision },
          {
            paper_node: args.paper_node === undefined ? null : args.paper_node as unknown as PaperNodeDraft,
            edge: args.edge === undefined ? null : args.edge as unknown as ProposedStrategyEdge,
            ...(args.reason === undefined ? {} : { reason: args.reason }),
            notes: args.notes ?? [],
          },
        )
        return stage1Envelope(state, `Recorded builder attempt for ${state.run.jobId}.`)
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_stage1_reviewer_submit',
    description: 'Submit an accept, revise, or reject decision for the current pending candidate.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      revision: { type: 'integer', required: true, description: 'Exact current run revision.' },
      decision: { type: 'string', required: true, enum: ['accept', 'revise', 'reject'] },
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
            summary: args.summary,
            critical_issues: args.critical_issues,
            edge_issues: args.edge_issues,
            acceptance_conditions: args.acceptance_conditions,
          },
        )
        return stage1Envelope(state, `Recorded reviewer decision for ${state.run.jobId}.`)
      })
    },
  }))

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
    name: 'supramas_paper_store',
    description: 'Register one verified paper artifact at its canonical run-local papers path.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      paper_id: { type: 'string', required: true, description: 'Stable paper identity used by one tree node.' },
      paper_title: { type: 'string', required: true, description: 'Verified publication title.' },
      local_path: { type: 'string', required: true, description: 'Canonical runs/<job_id>/papers/<paper_id>.json path.' },
      source_type: { type: 'string', required: true, enum: SOURCE_TYPES, description: 'Scientific source classification.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const runId = SupraMasRunId(args.run_id)
        const artifact = await ctx.supramas.storePaper(runId, {
          paper_id: args.paper_id,
          paper_title: args.paper_title,
          local_path: args.local_path,
          source_type: args.source_type,
        })
        await ctx.supramasArtifacts.syncPaper(runId, artifact.paper_id)
        return {
          status: 'success',
          summary: `Registered local paper ${artifact.paper_id}.`,
          next_actions: ['extract_evidence_chunks'],
          artifacts: [artifact.local_path],
          data: { paper: summarizePaper(artifact) },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_chunk_extract',
    description: 'Persist one page-aware evidence chunk under an already registered local paper.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      paper_id: { type: 'string', required: true, description: 'Owning registered paper identity.' },
      chunk_id: { type: 'string', required: true, description: 'Globally unique run-local chunk identity.' },
      page: { type: 'integer', description: 'One-based source page when available.' },
      text: { type: 'string', required: true, description: 'Full persisted chunk text, not a paraphrase.' },
    },
    output,
    async execute(args) {
      return guard(async () => {
        const runId = SupraMasRunId(args.run_id)
        const chunk = await ctx.supramas.addEvidenceChunk(runId, args.paper_id, {
          chunk_id: args.chunk_id,
          ...(args.page === undefined ? {} : { page: args.page }),
          text: args.text,
        })
        const artifact = ctx.supramas.readPaper(runId, args.paper_id)
        if (artifact === undefined) throw new Error(`stored paper ${args.paper_id} disappeared`)
        await ctx.supramasArtifacts.syncPaper(runId, args.paper_id)
        return {
          status: 'success',
          summary: `Stored evidence chunk ${chunk.chunk_id}.`,
          next_actions: ['extract_more_chunks_or_build_record'],
          artifacts: [artifact.local_path],
          data: { chunk: modelChunk(chunk) },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_artifact_read',
    description: 'Read one detached run-local paper artifact and all persisted evidence chunks.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      paper_id: { type: 'string', required: true, description: 'Registered paper identity.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const artifact = ctx.supramas.readPaper(SupraMasRunId(args.run_id), args.paper_id)
        if (artifact === undefined) {
          throw new SupraMasDomainError(
            `paper ${args.paper_id} has no local artifact`,
            'SUPRAMAS_EVIDENCE_MISSING',
          )
        }
        return {
          status: 'success',
          summary: `Loaded local paper ${artifact.paper_id}.`,
          next_actions: ['verify_candidate_evidence'],
          artifacts: [artifact.local_path],
          data: { artifact: modelArtifact(artifact) },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_evidence_verify',
    description: 'Verify that one literal evidence quote and page resolve to a stored local paper chunk.',
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
