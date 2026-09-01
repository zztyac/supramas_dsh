/** Durable SupraMAS run-and-evidence record over the DSH storage-domain form. */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { SOURCE_TYPES } from '@deepseek-ai/dsh-supramas-domain'
import type { Stage1Workflow } from '@deepseek-ai/dsh-supramas-domain'
import { RUN_PHASES, type SupraMasRunId } from './types.ts'

/** Stable branded run id at the durability boundary. */
const runId = z.string().transform(value => value as SupraMasRunId)

/** One caller-visible lifecycle failure persisted with its run revision. */
export const supraMasRunFailure = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean(),
})

/** Complete durable run snapshot. */
export const supraMasRunSnapshot = z.object({
  id: runId,
  jobId: z.string(),
  revision: z.number().int().positive(),
  phase: z.enum(RUN_PHASES),
  inputTaskPath: z.string(),
  runDir: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  failure: supraMasRunFailure.optional(),
})

/** One page-aware local evidence chunk stored inside its owning paper. */
export const supraMasEvidenceChunk = z.object({
  chunk_id: z.string(),
  page: z.number().int().positive().nullable().optional(),
  text: z.string(),
  evidence_kind: z.enum(['abstract', 'full_text']),
})

/** Durable acquisition and parsing proof for one complete PDF source. */
export const supraMasFullTextSource = z.object({
  local_path: z.string(),
  media_type: z.literal('application/pdf'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byte_length: z.number().int().positive(),
  page_count: z.number().int().positive(),
})

/** One complete local paper artifact, including every extracted chunk. */
export const supraMasPaperArtifact = z.object({
  paper_id: z.string(),
  paper_title: z.string(),
  local_path: z.string(),
  source_type: z.enum(SOURCE_TYPES),
  full_text_source: supraMasFullTextSource.optional(),
  chunks: z.array(supraMasEvidenceChunk),
})

/** Workflow is semantically revalidated with its reconstructed evidence catalog on startup. */
export const supraMasStage1Workflow = z.custom<Stage1Workflow>(
  value => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Stage 1 workflow must be an object',
)

/** Atomic persistence unit for one run and all of its provenance. */
export const supraMasRunRecord = z.object({
  sequence: z.number().int().nonnegative(),
  snapshot: supraMasRunSnapshot,
  papers: z.record(z.string(), supraMasPaperArtifact),
  workflow: supraMasStage1Workflow.optional(),
})

/** Stored run record inferred from the durability schema. */
export type SupraMasRunRecord = z.infer<typeof supraMasRunRecord>

/**
 * One whole-unit domain. A run mutation replaces its complete record, so
 * lifecycle and evidence never commit as separate partial states.
 */
export const supraMasDomainSpec = defineDomain({
  name: 'supramas',
  version: 2,
  tables: {
    runs: domainTable<SupraMasRunId, SupraMasRunRecord>(supraMasRunRecord),
  },
})
