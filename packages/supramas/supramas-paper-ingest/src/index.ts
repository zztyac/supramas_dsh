/** End-to-end safe paper import transaction for SupraMAS Stage 1 evidence. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import type { SupraMasRunIdBrand } from '@deepseek-ai/dsh-supramas'
import type { SourceType } from '@deepseek-ai/dsh-supramas-domain'
import { chunkParsedPages } from '@deepseek-ai/dsh-supramas-literature'
import type {} from '@deepseek-ai/dsh-supramas'
import type {} from '@deepseek-ai/dsh-supramas-artifacts'
import type {} from '@deepseek-ai/dsh-supramas-literature'

/** Deterministic evidence chunk policy. */
export interface Config {
  /** Maximum characters stored in one deterministic evidence chunk. */
  readonly maxChunkChars?: number
  /** Characters repeated between adjacent chunks on the same page. */
  readonly overlapChars?: number
}

export const Config: z<Config> = z.object({
  maxChunkChars: z.number().default(12_000),
  overlapChars: z.number().default(400),
})

/** Public-safe result of one complete import; no absolute paths or full text. */
export interface PaperImportSummary {
  readonly paperId: string
  readonly paperTitle: string
  readonly sourcePath: string
  readonly artifactPath: string
  readonly sourceSha256: string
  readonly sourceBytes: number
  readonly pageCount: number
  readonly chunkCount: number
}

interface ResolvedConfig {
  readonly maxChunkChars: number
  readonly overlapChars: number
}

function resolveConfig(config: Config): ResolvedConfig {
  const maxChunkChars = config.maxChunkChars ?? 12_000
  const overlapChars = config.overlapChars ?? 400
  if (!Number.isInteger(maxChunkChars) || maxChunkChars <= 0) {
    throw new Error('supramas-paper-ingest: maxChunkChars must be a positive integer')
  }
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChunkChars) {
    throw new Error('supramas-paper-ingest: overlapChars must be a non-negative integer below maxChunkChars')
  }
  return { maxChunkChars, overlapChars }
}

/**
 * Derive one filename-safe stable paper id from a service-issued opaque candidate id.
 * @param candidateId - Opaque provider-qualified candidate identity.
 * @returns a readable, digest-suffixed, filename-safe paper identity.
 */
export function paperIdForCandidate(candidateId: string): string {
  const separator = candidateId.indexOf(':')
  if (separator <= 0 || separator === candidateId.length - 1) {
    throw new Error('supramas-paper-ingest: candidateId must be <provider>:<external-id>')
  }
  const readable = candidateId.replaceAll(':', '_').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96)
  const digest = createHash('sha256').update(candidateId).digest('hex').slice(0, 10)
  return `${readable}-${digest}`
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    supramasPaperIngest: SupraMasPaperIngest
  }
}

/** Coordinator for acquire -> persist source -> parse -> chunk -> one durable evidence import. */
export class SupraMasPaperIngest extends Service {
  static inject = ['supramas', 'supramasArtifacts', 'supramasLiterature']
  static Config: z<Config> = Config
  private readonly config: ResolvedConfig

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'supramasPaperIngest')
    this.config = resolveConfig(config)
  }

  /**
   * Import one resolved literature candidate into an existing run.
   * Durable metadata and all chunks commit in one runtime mutation after parsing succeeds.
   * @param runId - Owning durable SupraMAS run identity.
   * @param candidateId - Opaque provider-qualified literature candidate identity.
   * @param sourceType - Scientific provenance classification stored with the paper.
   * @param signal - Optional cancellation signal forwarded through acquire and parse.
   * @returns a public-safe summary of the completed durable import.
   */
  async importCandidate(
    runId: SupraMasRunIdBrand,
    candidateId: string,
    sourceType: SourceType = 'unknown',
    signal?: AbortSignal,
  ): Promise<PaperImportSummary> {
    const run = this.ctx.supramas.get(runId)
    if (run === undefined) throw new Error(`supramas-paper-ingest: run ${runId} was not found`)
    const acquired = await this.ctx.supramasLiterature.acquire(candidateId, signal)
    const paperId = paperIdForCandidate(acquired.candidate.candidateId)
    const sourcePath = await this.ctx.supramasArtifacts.writePaperSource(runId, paperId, acquired.bytes)
    const absoluteSourcePath = await this.ctx.supramasArtifacts.resolvePaperSourcePath(runId, paperId)
    const parsed = await this.ctx.supramasLiterature.parseDocument(absoluteSourcePath, signal)
    const chunks = chunkParsedPages(paperId, parsed.pages, this.config.maxChunkChars, this.config.overlapChars)
    if (chunks.length === 0) throw new Error('supramas-paper-ingest: parser produced no evidence chunks')
    const artifactPath = `runs/${run.jobId}/papers/${paperId}.json`
    await this.ctx.supramas.importPaper(runId, {
      metadata: {
        paper_id: paperId,
        paper_title: acquired.candidate.title,
        local_path: artifactPath,
        source_type: sourceType,
        full_text_source: {
          local_path: sourcePath,
          media_type: 'application/pdf',
          sha256: acquired.sha256,
          byte_length: acquired.byteLength,
          page_count: parsed.pages.length,
        },
      },
      chunks,
    })
    await this.ctx.supramasArtifacts.syncPaper(runId, paperId)
    return {
      paperId,
      paperTitle: acquired.candidate.title,
      sourcePath,
      artifactPath,
      sourceSha256: acquired.sha256,
      sourceBytes: acquired.byteLength,
      pageCount: parsed.pages.length,
      chunkCount: chunks.length,
    }
  }
}

export default SupraMasPaperIngest
