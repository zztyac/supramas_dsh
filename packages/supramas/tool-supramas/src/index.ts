/** Model-facing tools for the SupraMAS material-science run capability. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  SOURCE_TYPES,
  SupraMasDomainError,
  SupraMasError,
  SupraMasRunId,
  type EvidenceChunk,
  type EvidenceVerification,
  type PaperArtifact,
  type RunSnapshot,
  type SourceType,
} from '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas'

export const name = 'tool-supramas'
export const inject = ['tools', 'supramas']

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
    paper?: PaperSummary
    chunk?: ToolEvidenceChunk
    artifact?: ToolPaperArtifact
    verification?: EvidenceVerification
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
        run: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            jobId: { type: 'string', required: true },
            revision: { type: 'integer', required: true },
            phase: {
              type: 'string',
              required: true,
              enum: [
                'created',
                'clarifying',
                'task_ready',
                'running',
                'validating',
                'completed',
                'recoverable_failed',
                'failed',
                'cancelled',
              ],
            },
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
        },
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

function guard(action: () => ToolEnvelope): ToolEnvelope {
  try {
    return action()
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
      return guard(() => {
        const run = ctx.supramas.create({
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
      return guard(() => {
        const artifact = ctx.supramas.storePaper(SupraMasRunId(args.run_id), {
          paper_id: args.paper_id,
          paper_title: args.paper_title,
          local_path: args.local_path,
          source_type: args.source_type,
        })
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
      return guard(() => {
        const runId = SupraMasRunId(args.run_id)
        const chunk = ctx.supramas.addEvidenceChunk(runId, args.paper_id, {
          chunk_id: args.chunk_id,
          ...(args.page === undefined ? {} : { page: args.page }),
          text: args.text,
        })
        const artifact = ctx.supramas.readPaper(runId, args.paper_id)
        if (artifact === undefined) throw new Error(`stored paper ${args.paper_id} disappeared`)
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
