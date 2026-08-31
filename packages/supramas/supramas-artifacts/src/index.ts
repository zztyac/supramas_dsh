/** Filesystem-backed compatibility artifacts for completed SupraMAS Stage 1 runs. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeBytesAtomic, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import {
  type SupraMasRunIdBrand,
} from '@deepseek-ai/dsh-supramas'
import '@deepseek-ai/dsh-supramas'
import {
  TUNING_DIMENSIONS,
  type PaperArtifact,
  type PaperNode,
  type Stage1Workflow,
} from '@deepseek-ai/dsh-supramas-domain'
import { access, open } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Plugin configuration for one workspace-confined compatibility export root. */
export interface Config {
  /** Absolute directory under which canonical `runs/<job_id>` paths are materialized. */
  root: string
}

/** Resolved immutable artifact writer parameters. */
export interface ArtifactsSpec {
  /** Canonical absolute workspace root. */
  root: string
}

/** Stable relative files materialized for one run. */
export interface Stage1ArtifactManifest {
  /** Owning durable run identity. */
  runId: SupraMasRunIdBrand
  /** Canonical paths relative to the configured workspace root. */
  files: string[]
}

/** Closed canonical final-output names in stable presentation order. */
export const STAGE1_OUTPUT_NAMES = [
  'strategy_tree.json',
  'node_review_log.jsonl',
  'review_report.md',
] as const

/** One canonical Stage 1 output basename. */
export type Stage1OutputName = typeof STAGE1_OUTPUT_NAMES[number]

/** Public-safe readiness of one canonical final output. */
export interface Stage1OutputStatus {
  /** Stable basename safe to show in browser clients. */
  name: Stage1OutputName
  /** Whether the file currently exists below the configured workspace root. */
  ready: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    supramasArtifacts: SupraMasArtifacts
  }
}

const DEFAULT_EVIDENCE_POLICY =
  'Use literature search to find papers, persist selected paper evidence locally, and use no placeholder papers.'
const DEFAULT_EXCLUDE = ['Stage 2 idea generation', 'abstract-only evidence']
const SAFE_PAPER_FILE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const MAX_OUTPUT_READ_BYTES = 16 * 1024 * 1024

/**
 * Resolve artifact writer configuration before any filesystem operation.
 * @param config - Raw plugin configuration.
 * @returns the canonical absolute workspace root.
 */
export function resolveArtifactsSpec(config: Config): ArtifactsSpec {
  if (!isAbsolute(config.root)) throw new Error('supramas-artifacts: root must be an absolute path')
  return { root: resolve(config.root) }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function yamlScalar(value: string): string {
  return JSON.stringify(value)
}

function yamlList(lines: string[], indent: number): string[] {
  const prefix = ' '.repeat(indent)
  return lines.length === 0 ? [`${prefix}[]`] : lines.map(value => `${prefix}- ${yamlScalar(value)}`)
}

function renderInputTask(workflow: Stage1Workflow): string {
  const config = workflow.config
  const runDir = `runs/${config.jobId}`
  return [
    `job_id: ${yamlScalar(config.jobId)}`,
    `research_topic: ${yamlScalar(config.researchTopic)}`,
    'material_scope:',
    ...yamlList(config.materialScope ?? [], 2),
    'target_property:',
    ...yamlList(config.targetProperty ?? [], 2),
    'constraints:',
    '  stage: 1',
    `  evidence_policy: ${yamlScalar(config.evidencePolicy ?? DEFAULT_EVIDENCE_POLICY)}`,
    '  dominant_dimensions:',
    ...yamlList([...TUNING_DIMENSIONS], 4),
    '  include:',
    ...yamlList(config.include ?? [], 4),
    '  exclude:',
    ...yamlList(config.exclude ?? DEFAULT_EXCLUDE, 4),
    'tree_limits:',
    '  target_root_nodes: 1',
    `  max_depth: ${config.maxDepth}`,
    `  max_branch_per_node: ${config.maxBranchPerNode ?? 'null'}`,
    `  target_child_nodes: ${config.targetChildNodes ?? 'null'}`,
    'expansion_policy:',
    `  max_root_attempts: ${config.maxRootAttempts}`,
    `  max_child_attempts_per_limitation: ${config.maxChildAttemptsPerLimitation}`,
    '  retry_on_reviewer_reject: true',
    '  retry_uses_acceptance_conditions: true',
    '  stop_after_accept: true',
    `papers_dir: ${runDir}/papers`,
    `output_dir: ${runDir}/outputs`,
    '',
  ].join('\n')
}

function renderPaper(node: PaperNode | undefined, artifact: PaperArtifact): string {
  return json({
    paper_id: artifact.paper_id,
    paper_title: artifact.paper_title,
    ...(node?.year === undefined ? {} : { year: node.year }),
    ...(node?.doi === undefined ? {} : { doi: node.doi }),
    ...(node?.url === undefined ? {} : { url: node.url }),
    source_type: artifact.source_type,
    local_path: artifact.local_path,
    chunks: artifact.chunks,
  })
}

function renderReviewLog(workflow: Stage1Workflow): string {
  return workflow.review_log.map(entry => JSON.stringify(entry)).join('\n') + '\n'
}

function renderReviewReport(workflow: Stage1Workflow): string {
  const lines = [
    '# Stage 1 Assembly Report',
    '',
    `- Job ID: \`${workflow.config.jobId}\``,
    `- Research topic: ${workflow.config.researchTopic}`,
    `- max_depth: \`${workflow.config.maxDepth}\``,
    `- max_child_attempts_per_limitation: \`${workflow.config.maxChildAttemptsPerLimitation}\``,
    `- Exported nodes: \`${workflow.nodes.length}\``,
    `- Exported edges: \`${workflow.edges.length}\``,
    '',
    '## Frontier Status',
    '',
    ...workflow.frontiers.map(frontier =>
      `- \`${frontier.node_id}.${frontier.limitation_id}\`: \`${frontier.status}\`${
        frontier.reason === undefined ? '' : ` - ${frontier.reason}`}`),
    '',
  ]
  return lines.join('\n')
}

function manifestFiles(workflow: Stage1Workflow): string[] {
  const runDir = `runs/${workflow.config.jobId}`
  return [
    `${runDir}/input_task.yaml`,
    ...workflow.nodes.map(node => `${runDir}/papers/${node.paper_id}.json`),
    `${runDir}/tree_state.json`,
    `${runDir}/outputs/strategy_tree.json`,
    `${runDir}/outputs/node_review_log.jsonl`,
    `${runDir}/outputs/review_report.md`,
  ]
}

/** Workspace-confined writer for the Codex-native Stage 1 file layout. */
export class SupraMasArtifacts extends Service {
  static inject = ['supramas']
  static Config: z<Config> = z.object({ root: z.string().required() })

  private readonly spec: ArtifactsSpec
  private operationTail: Promise<void> = Promise.resolve()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'supramasArtifacts')
    this.spec = resolveArtifactsSpec(config)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation)
    this.operationTail = result.then(() => {}, () => {})
    return result
  }

  private absolute(path: string): string {
    const target = resolve(this.spec.root, ...path.split('/'))
    const fromRoot = relative(this.spec.root, target)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error(`supramas-artifacts: refusing path outside root: ${path}`)
    }
    return target
  }

  private write(path: string, content: string): Promise<void> {
    return writeFileAtomic(this.absolute(path), content, { mode: 0o600, dirMode: 0o700 })
  }

  private writeBytes(path: string, content: Uint8Array): Promise<void> {
    return writeBytesAtomic(this.absolute(path), content, { mode: 0o600, dirMode: 0o700 })
  }

  private paperSourceRelative(runJobId: string, paperId: string): string {
    if (!SAFE_PAPER_FILE_ID.test(paperId)) throw new Error('supramas-artifacts: paperId is not filename-safe')
    return `runs/${runJobId}/papers/raw/${paperId}.pdf`
  }

  /**
   * Atomically publish one verified source PDF under the canonical run-local raw directory.
   * The method accepts an owning run id and a filename-safe paper id, never an arbitrary path.
   * @param id - Owning durable run identity.
   * @param paperId - Stable filename-safe paper identity.
   * @param bytes - Complete verified PDF bytes.
   * @returns the canonical path relative to the configured workspace root.
   */
  writePaperSource(id: SupraMasRunIdBrand, paperId: string, bytes: Uint8Array): Promise<string> {
    return this.enqueue(async () => {
      const run = this.ctx.supramas.get(id)
      if (run === undefined) throw new Error(`supramas-artifacts: run ${id} was not found`)
      const path = this.paperSourceRelative(run.jobId, paperId)
      if (bytes.byteLength === 0) throw new Error('supramas-artifacts: paper source must not be empty')
      await this.writeBytes(path, new Uint8Array(bytes))
      return path
    })
  }

  /**
   * Resolve the existing canonical source path for an internal parser.
   * This absolute path is an execution boundary and must never be returned by model-facing tools.
   * @param id - Owning durable run identity.
   * @param paperId - Stable filename-safe paper identity.
   * @returns the canonical absolute source path for internal parser use.
   */
  async resolvePaperSourcePath(id: SupraMasRunIdBrand, paperId: string): Promise<string> {
    const run = this.ctx.supramas.get(id)
    if (run === undefined) throw new Error(`supramas-artifacts: run ${id} was not found`)
    const path = this.absolute(this.paperSourceRelative(run.jobId, paperId))
    await access(path)
    return path
  }

  /**
   * Materialize the current approved task definition.
   * @param id - Owning durable run identity.
   * @returns the canonical relative task path.
   */
  syncTask(id: SupraMasRunIdBrand): Promise<string> {
    return this.enqueue(async () => {
      const state = this.ctx.supramas.getStage1(id)
      if (state === undefined) throw new Error(`supramas-artifacts: run ${id} has no Stage 1 workflow`)
      const path = `runs/${state.run.jobId}/input_task.yaml`
      await this.write(path, renderInputTask(state.workflow))
      return path
    })
  }

  /**
   * Materialize one stored paper and its complete current chunk list.
   * @param id - Owning durable run identity.
   * @param paperId - Stored paper identity.
   * @returns the canonical relative paper path.
   */
  syncPaper(id: SupraMasRunIdBrand, paperId: string): Promise<string> {
    return this.enqueue(async () => {
      const state = this.ctx.supramas.getStage1(id)
      const run = this.ctx.supramas.get(id)
      if (run === undefined) throw new Error(`supramas-artifacts: run ${id} was not found`)
      const artifact = this.ctx.supramas.readPaper(id, paperId)
      if (artifact === undefined) throw new Error(`supramas-artifacts: paper ${paperId} is not stored for ${id}`)
      const expected = `runs/${run.jobId}/papers/${paperId}.json`
      if (artifact.local_path !== expected) {
        throw new Error(`supramas-artifacts: paper path ${artifact.local_path} does not match ${expected}`)
      }
      const node = state?.workflow.pending_candidate?.node.paper_id === paperId
        ? state.workflow.pending_candidate.node
        : state?.workflow.nodes.find(candidate => candidate.paper_id === paperId)
      await this.write(expected, renderPaper(node, artifact))
      return expected
    })
  }

  /**
   * Read final-output readiness without exposing the configured absolute root.
   * @param id - Owning durable run identity.
   * @returns the three stable final output names in contract order.
   */
  async outputStatus(id: SupraMasRunIdBrand): Promise<Stage1OutputStatus[]> {
    const run = this.ctx.supramas.get(id)
    if (run === undefined) throw new Error(`supramas-artifacts: run ${id} was not found`)
    return Promise.all(STAGE1_OUTPUT_NAMES.map(async (name) => {
      try {
        await access(this.absolute(`runs/${run.jobId}/outputs/${name}`))
        return { name, ready: true }
      } catch {
        return { name, ready: false }
      }
    }))
  }

  /**
   * Read one canonical completed output through a caller-supplied complete byte bound.
   * The fixed output-name vocabulary prevents this method from becoming a filesystem read primitive.
   * @param id - Owning durable run identity.
   * @param name - One closed canonical output basename.
   * @param maxBytes - Maximum complete payload size, capped again by the service.
   * @returns detached exact output bytes.
   */
  async readOutput(id: SupraMasRunIdBrand, name: Stage1OutputName, maxBytes: number): Promise<Uint8Array> {
    const run = this.ctx.supramas.get(id)
    if (run === undefined) throw new Error(`supramas-artifacts: run ${id} was not found`)
    if (!STAGE1_OUTPUT_NAMES.includes(name)) {
      throw new Error('supramas-artifacts: name must be a canonical output name')
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
      throw new Error('supramas-artifacts: maxBytes must be a positive safe integer')
    }
    if (maxBytes > MAX_OUTPUT_READ_BYTES) {
      throw new Error(`supramas-artifacts: maxBytes exceeds service limit ${MAX_OUTPUT_READ_BYTES}`)
    }

    const handle = await open(this.absolute(`runs/${run.jobId}/outputs/${name}`), 'r')
    try {
      const stats = await handle.stat()
      if (!stats.isFile()) throw new Error(`supramas-artifacts: output ${name} is not a file`)
      if (stats.size > maxBytes) {
        throw new Error(`supramas-artifacts: output ${name} exceeds ${maxBytes} byte read limit`)
      }
      const buffer = new Uint8Array(maxBytes + 1)
      let total = 0
      while (total < buffer.byteLength) {
        const { bytesRead } = await handle.read(buffer, total, buffer.byteLength - total, total)
        if (bytesRead === 0) break
        total += bytesRead
      }
      if (total > maxBytes) {
        throw new Error(`supramas-artifacts: output ${name} exceeds ${maxBytes} byte read limit`)
      }
      return buffer.slice(0, total)
    } finally {
      await handle.close()
    }
  }

  /**
   * Idempotently materialize every compatibility artifact for a completed run.
   * @param id - Owning durable completed run identity.
   * @returns the stable relative artifact manifest.
   */
  syncCompleted(id: SupraMasRunIdBrand): Promise<Stage1ArtifactManifest> {
    return this.enqueue(async () => {
      const state = this.ctx.supramas.getStage1(id)
      if (state === undefined || state.run.phase !== 'completed' || state.nextAction.kind !== 'completed') {
        throw new Error(`supramas-artifacts: run ${id} is not a completed Stage 1 workflow`)
      }
      const workflow = state.workflow
      const runDir = `runs/${workflow.config.jobId}`
      await this.write(`${runDir}/input_task.yaml`, renderInputTask(workflow))
      for (const node of workflow.nodes) {
        const artifact = this.ctx.supramas.readPaper(id, node.paper_id)
        if (artifact === undefined) {
          throw new Error(`supramas-artifacts: accepted paper ${node.paper_id} has no stored artifact`)
        }
        await this.write(`${runDir}/papers/${node.paper_id}.json`, renderPaper(node, artifact))
      }
      const tree = state.nextAction.tree
      await this.write(`${runDir}/tree_state.json`, json({
        tree,
        frontier_status: workflow.frontiers,
        review_log: workflow.review_log,
        builder_attempts: workflow.builder_attempts,
        assembly_result: {
          status: 'success',
          output_dir: `${runDir}/outputs`,
          node_count: tree.nodes.length,
          edge_count: tree.edges.length,
        },
        schema_validation: { status: 'valid', validator: '@deepseek-ai/dsh-supramas-domain' },
        run_status: state.run.phase,
        last_updated: new Date(state.run.updatedAt).toISOString(),
      }))
      await this.write(`${runDir}/outputs/strategy_tree.json`, json(tree))
      await this.write(`${runDir}/outputs/node_review_log.jsonl`, renderReviewLog(workflow))
      await this.write(`${runDir}/outputs/review_report.md`, renderReviewReport(workflow))
      return { runId: id, files: manifestFiles(workflow) }
    })
  }
}

export default SupraMasArtifacts
