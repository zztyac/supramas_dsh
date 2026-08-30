/** Filesystem-backed compatibility artifacts for completed SupraMAS Stage 1 runs. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
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
import { access } from 'node:fs/promises'
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

/** Public-safe readiness of one canonical final output. */
export interface Stage1OutputStatus {
  /** Stable basename safe to show in browser clients. */
  name: 'strategy_tree.json' | 'node_review_log.jsonl' | 'review_report.md'
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
    const names: Stage1OutputStatus['name'][] = [
      'strategy_tree.json',
      'node_review_log.jsonl',
      'review_report.md',
    ]
    return Promise.all(names.map(async (name) => {
      try {
        await access(this.absolute(`runs/${run.jobId}/outputs/${name}`))
        return { name, ready: true }
      } catch {
        return { name, ready: false }
      }
    }))
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
