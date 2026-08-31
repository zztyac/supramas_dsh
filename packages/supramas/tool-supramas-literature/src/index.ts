/** Bounded model-facing literature discovery and full-text evidence tools. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { SupraMasDomainError, SupraMasError, SupraMasRunId, SOURCE_TYPES } from '@deepseek-ai/dsh-supramas'
import { LiteratureError, type LiteratureCandidate } from '@deepseek-ai/dsh-supramas-literature'
import type { PaperImportSummary } from '@deepseek-ai/dsh-supramas-paper-ingest'
import type {} from '@deepseek-ai/dsh-supramas'
import type {} from '@deepseek-ai/dsh-supramas-literature'
import type {} from '@deepseek-ai/dsh-supramas-paper-ingest'

export const name = 'tool-supramas-literature'
export const inject = ['tools', 'supramas', 'supramasLiterature', 'supramasPaperIngest']

/** Tool presentation and result bounds. */
export interface Config {
  /** Largest candidate count accepted and returned by one search tool call. */
  readonly maxSearchResults?: number
  /** Maximum abstract characters projected for one search candidate. */
  readonly maxAbstractChars?: number
  /** Maximum text-free chunk descriptors returned by one list call. */
  readonly maxChunkIndexEntries?: number
  /** Maximum characters returned by one paginated chunk read. */
  readonly maxChunkReadChars?: number
}

export const Config: z<Config> = z.object({
  maxSearchResults: z.number().default(10),
  maxAbstractChars: z.number().default(1_200),
  maxChunkIndexEntries: z.number().default(1_000),
  maxChunkReadChars: z.number().default(20_000),
})

interface ResolvedConfig {
  readonly maxSearchResults: number
  readonly maxAbstractChars: number
  readonly maxChunkIndexEntries: number
  readonly maxChunkReadChars: number
}

interface CandidateView {
  candidate_id: string
  title: string
  authors: string[]
  year?: number
  doi?: string
  venue?: string
  abstract?: string
  cited_by_count?: number
  open_access?: boolean
  landing_url?: string
}

interface ChunkIndexView {
  chunk_id: string
  page?: number
  char_count: number
}

interface ChunkReadView {
  chunk_id: string
  page?: number
  text: string
  offset: number
  next_offset: number
  total_chars: number
  truncated: boolean
}

interface ToolEnvelope {
  status: 'success' | 'error'
  summary: string
  next_actions: string[]
  artifacts: string[]
  data?: {
    candidates?: CandidateView[]
    imported?: PaperImportSummary
    chunks?: ChunkIndexView[]
    chunk?: ChunkReadView
    truncated?: boolean
  }
  error?: {
    code: string
    root_cause_hint: string
    safe_retry: string
    stop_condition: string
  }
}

const candidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    candidate_id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    authors: { type: 'array', required: true, items: { type: 'string' } },
    year: { type: 'integer' },
    doi: { type: 'string' },
    venue: { type: 'string' },
    abstract: { type: 'string' },
    cited_by_count: { type: 'integer' },
    open_access: { type: 'boolean' },
    landing_url: { type: 'string' },
  },
} as const satisfies ValueSchemaSpec

const chunkIndexSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chunk_id: { type: 'string', required: true },
    page: { type: 'integer' },
    char_count: { type: 'integer', required: true },
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
        candidates: { type: 'array', items: candidateSchema },
        imported: {
          type: 'object',
          additionalProperties: false,
          properties: {
            paperId: { type: 'string', required: true },
            paperTitle: { type: 'string', required: true },
            sourcePath: { type: 'string', required: true },
            artifactPath: { type: 'string', required: true },
            sourceSha256: { type: 'string', required: true },
            sourceBytes: { type: 'integer', required: true },
            pageCount: { type: 'integer', required: true },
            chunkCount: { type: 'integer', required: true },
          },
        },
        chunks: { type: 'array', items: chunkIndexSchema },
        chunk: {
          type: 'object',
          additionalProperties: false,
          properties: {
            chunk_id: { type: 'string', required: true },
            page: { type: 'integer' },
            text: { type: 'string', required: true },
            offset: { type: 'integer', required: true },
            next_offset: { type: 'integer', required: true },
            total_chars: { type: 'integer', required: true },
            truncated: { type: 'boolean', required: true },
          },
        },
        truncated: { type: 'boolean' },
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

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`tool-supramas-literature: ${field} must be a positive integer`)
  return value
}

function resolveConfig(config: Config): ResolvedConfig {
  return {
    maxSearchResults: positiveInteger(config.maxSearchResults ?? 10, 'maxSearchResults'),
    maxAbstractChars: positiveInteger(config.maxAbstractChars ?? 1_200, 'maxAbstractChars'),
    maxChunkIndexEntries: positiveInteger(config.maxChunkIndexEntries ?? 1_000, 'maxChunkIndexEntries'),
    maxChunkReadChars: positiveInteger(config.maxChunkReadChars ?? 20_000, 'maxChunkReadChars'),
  }
}

function failure(error: LiteratureError | SupraMasError | SupraMasDomainError): ToolEnvelope {
  return {
    status: 'error',
    summary: error.message,
    next_actions: ['correct_or_narrow_request'],
    artifacts: [],
    error: {
      code: error.code,
      root_cause_hint: error.message,
      safe_retry: 'Correct the reported source, limit, run, paper, or chunk condition and retry once.',
      stop_condition: 'Do not fabricate metadata, source bytes, pages, chunks, or evidence when the condition persists.',
    },
  }
}

async function guard(action: () => Promise<ToolEnvelope> | ToolEnvelope): Promise<ToolEnvelope> {
  try {
    return await action()
  } catch (error: unknown) {
    if (error instanceof LiteratureError || error instanceof SupraMasError || error instanceof SupraMasDomainError) return failure(error)
    throw error
  }
}

function candidateView(candidate: LiteratureCandidate, maxAbstractChars: number): CandidateView {
  return {
    candidate_id: candidate.candidateId,
    title: candidate.title,
    authors: [...candidate.authors],
    ...(candidate.year === undefined ? {} : { year: candidate.year }),
    ...(candidate.doi === undefined ? {} : { doi: candidate.doi }),
    ...(candidate.venue === undefined ? {} : { venue: candidate.venue }),
    ...(candidate.abstract === undefined ? {} : { abstract: candidate.abstract.slice(0, maxAbstractChars) }),
    ...(candidate.citedByCount === undefined ? {} : { cited_by_count: candidate.citedByCount }),
    ...(candidate.openAccess === undefined ? {} : { open_access: candidate.openAccess }),
    ...(candidate.landingUrl === undefined ? {} : { landing_url: candidate.landingUrl }),
  }
}

/** Register the bounded literature and evidence read tools. */
export function apply(ctx: Context, config: Config): void {
  const limits = resolveConfig(config)

  ctx.tools.register(defineTool({
    name: 'supramas_literature_search',
    description: 'Search a structured scholarly index and return bounded opaque candidates without document download URLs.',
    parameters: {
      query: { type: 'string', required: true, description: 'Specific material-science literature query.' },
      max_results: { type: 'integer', required: true, description: 'Requested candidates within the configured tool cap.' },
    },
    output,
    async execute(args, exec) {
      return guard(async () => {
        if (args.max_results > limits.maxSearchResults) {
          throw new LiteratureError(`max_results exceeds ${limits.maxSearchResults}`, 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
        }
        const result = await ctx.supramasLiterature.search({ query: args.query, maxResults: args.max_results }, exec.signal)
        return {
          status: 'success',
          summary: `Found ${result.candidates.length} bounded literature candidate(s).`,
          next_actions: result.candidates.length === 0 ? ['refine_query'] : ['select_candidate_for_import'],
          artifacts: [],
          data: {
            candidates: result.candidates.map(candidate => candidateView(candidate, limits.maxAbstractChars)),
            truncated: result.truncated,
          },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_paper_import',
    description: 'Acquire, verify, parse, chunk, and atomically persist one service-issued open-access paper candidate.',
    parameters: {
      run_id: { type: 'string', required: true, description: 'Owning deterministic SupraMAS run id.' },
      candidate_id: { type: 'string', required: true, description: 'Opaque candidate id returned by supramas_literature_search.' },
      source_type: { type: 'string', required: true, enum: SOURCE_TYPES, description: 'Scientific source classification.' },
    },
    output,
    async execute(args, exec) {
      return guard(async () => {
        const imported = await ctx.supramasPaperIngest.importCandidate(
          SupraMasRunId(args.run_id),
          args.candidate_id,
          args.source_type,
          exec.signal,
        )
        return {
          status: 'success',
          summary: `Imported ${imported.paperId} with ${imported.chunkCount} bounded evidence chunk(s).`,
          next_actions: ['list_evidence_chunks'],
          artifacts: [imported.sourcePath, imported.artifactPath],
          data: { imported },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_chunk_list',
    description: 'List bounded chunk identities, pages, and character counts for one imported paper without returning full text.',
    parameters: {
      run_id: { type: 'string', required: true },
      paper_id: { type: 'string', required: true },
    },
    output,
    async execute(args) {
      return guard(() => {
        const artifact = ctx.supramas.readPaper(SupraMasRunId(args.run_id), args.paper_id)
        if (artifact === undefined) throw new SupraMasDomainError(`paper ${args.paper_id} has no local artifact`, 'SUPRAMAS_EVIDENCE_MISSING')
        const truncated = artifact.chunks.length > limits.maxChunkIndexEntries
        const chunks = artifact.chunks.slice(0, limits.maxChunkIndexEntries).map(chunk => ({
          chunk_id: chunk.chunk_id,
          ...(chunk.page === undefined || chunk.page === null ? {} : { page: chunk.page }),
          char_count: chunk.text.length,
        }))
        return {
          status: 'success',
          summary: `Listed ${chunks.length} evidence chunk(s) for ${artifact.paper_id}.`,
          next_actions: ['read_relevant_chunk'],
          artifacts: [artifact.local_path],
          data: { chunks, truncated },
        }
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'supramas_chunk_read',
    description: 'Read one bounded slice of one stored evidence chunk; never returns an entire paper or PDF.',
    parameters: {
      run_id: { type: 'string', required: true },
      paper_id: { type: 'string', required: true },
      chunk_id: { type: 'string', required: true },
      offset: { type: 'integer', description: 'Zero-based character offset; defaults to zero.' },
      max_chars: { type: 'integer', description: 'Requested characters within the configured read cap.' },
    },
    output,
    async execute(args) {
      return guard(() => {
        const artifact = ctx.supramas.readPaper(SupraMasRunId(args.run_id), args.paper_id)
        if (artifact === undefined) throw new SupraMasDomainError(`paper ${args.paper_id} has no local artifact`, 'SUPRAMAS_EVIDENCE_MISSING')
        const stored = artifact.chunks.find(chunk => chunk.chunk_id === args.chunk_id)
        if (stored === undefined) throw new SupraMasDomainError(`chunk ${args.chunk_id} does not resolve under paper ${args.paper_id}`, 'SUPRAMAS_EVIDENCE_MISSING')
        const offset = args.offset ?? 0
        const maxChars = args.max_chars ?? limits.maxChunkReadChars
        if (!Number.isInteger(offset) || offset < 0 || offset > stored.text.length) {
          throw new LiteratureError('offset is outside the stored chunk', 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
        }
        if (!Number.isInteger(maxChars) || maxChars <= 0 || maxChars > limits.maxChunkReadChars) {
          throw new LiteratureError(`max_chars must be between 1 and ${limits.maxChunkReadChars}`, 'SUPRAMAS_LITERATURE_INVALID_REQUEST')
        }
        const end = Math.min(offset + maxChars, stored.text.length)
        const chunk: ChunkReadView = {
          chunk_id: stored.chunk_id,
          ...(stored.page === undefined || stored.page === null ? {} : { page: stored.page }),
          text: stored.text.slice(offset, end),
          offset,
          next_offset: end,
          total_chars: stored.text.length,
          truncated: end < stored.text.length,
        }
        return {
          status: 'success',
          summary: `Read characters ${offset}-${end} of evidence chunk ${stored.chunk_id}.`,
          next_actions: chunk.truncated ? ['read_next_chunk_slice_or_use_current_evidence'] : ['use_or_verify_literal_evidence'],
          artifacts: [artifact.local_path],
          data: { chunk },
        }
      })
    },
  }))
}
