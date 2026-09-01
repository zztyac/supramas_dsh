/** Pure migration for the legacy SupraMAS whole-unit JSON document. */

type JsonObject = Record<string, unknown>

const EDGE_SATISFACTION = {
  direct: 'full',
  transferable: 'partial',
  exploratory: 'adjacent',
} as const

/** Counts reported after one successful v1-to-v2 migration. */
export interface SupraMasStorageMigrationStats {
  runs: number
  papers: number
  chunks: number
  reviews: number
  archivedRecommendations: number
}

/** Migrated storage document plus an audit-friendly change summary. */
export interface SupraMasStorageMigrationResult {
  document: JsonObject
  stats: SupraMasStorageMigrationStats
}

function object(value: unknown, path: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`)
  }
  return value as JsonObject
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${path} must be a non-empty string`)
  return value
}

function stringList(value: unknown, path: string): string[] {
  return list(value, path).map((item, index) => string(item, `${path}[${index}]`))
}

function migratePapers(
  value: unknown,
  path: string,
  stats: SupraMasStorageMigrationStats,
): JsonObject {
  const papers = object(value, path)
  return Object.fromEntries(Object.entries(papers).map(([paperId, rawPaper]) => {
    const paper = object(rawPaper, `${path}.${paperId}`)
    const chunks = list(paper.chunks, `${path}.${paperId}.chunks`).map((rawChunk, index) => {
      const chunk = object(rawChunk, `${path}.${paperId}.chunks[${index}]`)
      const evidenceKind = chunk.evidence_kind
      if (evidenceKind !== undefined && evidenceKind !== 'abstract' && evidenceKind !== 'full_text') {
        throw new Error(`${path}.${paperId}.chunks[${index}].evidence_kind is invalid`)
      }
      stats.chunks += 1
      return { ...chunk, evidence_kind: evidenceKind ?? 'abstract' }
    })
    stats.papers += 1
    return [paperId, { ...paper, chunks }]
  }))
}

function childExpectationSatisfaction(workflow: JsonObject, review: JsonObject, path: string): string {
  const paperId = string(review.paper_id, `${path}.paper_id`)
  const nodes = list(workflow.nodes, 'workflow.nodes').map((value, index) =>
    object(value, `workflow.nodes[${index}]`))
  const node = nodes.find(candidate => candidate.paper_id === paperId)
  if (node === undefined) throw new Error(`${path} cannot resolve accepted child paper ${paperId}`)
  const nodeId = string(node.node_id, `${path}.node.node_id`)
  const edges = list(workflow.edges, 'workflow.edges').map((value, index) =>
    object(value, `workflow.edges[${index}]`))
  const edge = edges.find(candidate => candidate.child_node_id === nodeId)
  if (edge === undefined) throw new Error(`${path} cannot resolve an edge for child node ${nodeId}`)
  const edgeType = string(edge.edge_type, `${path}.edge.edge_type`)
  if (!(edgeType in EDGE_SATISFACTION)) throw new Error(`${path}.edge.edge_type ${edgeType} is unsupported`)
  return EDGE_SATISFACTION[edgeType as keyof typeof EDGE_SATISFACTION]
}

function migrateReview(
  workflow: JsonObject,
  value: unknown,
  index: number,
  stats: SupraMasStorageMigrationStats,
): JsonObject {
  const path = `workflow.review_log[${index}]`
  const review = object(value, path)
  const decision = string(review.decision, `${path}.decision`)
  const scope = string(review.scope, `${path}.scope`)
  const criticalIssues = list(review.critical_issues, `${path}.critical_issues`)
  const edgeIssues = list(review.edge_issues, `${path}.edge_issues`)
  const conditions = stringList(review.acceptance_conditions, `${path}.acceptance_conditions`)
  if (decision === 'accept' && (criticalIssues.length > 0 || edgeIssues.length > 0)) {
    throw new Error(`${path} is accepted but still contains unresolved critical or edge issues`)
  }
  const expectationSatisfaction = review.expectation_satisfaction
    ?? (scope === 'root'
      ? 'not_applicable'
      : decision === 'accept'
        ? childExpectationSatisfaction(workflow, review, path)
        : 'none')
  let summary = string(review.summary, `${path}.summary`)
  let acceptanceConditions = conditions
  if (decision === 'accept' && conditions.length > 0) {
    summary += `\n\nLegacy v1 follow-up recommendations (not unresolved acceptance blockers):\n${conditions
      .map(condition => `- ${condition}`)
      .join('\n')}`
    acceptanceConditions = []
    stats.archivedRecommendations += conditions.length
  }
  stats.reviews += 1
  return {
    ...review,
    expectation_satisfaction: expectationSatisfaction,
    summary,
    acceptance_conditions: acceptanceConditions,
  }
}

function migrateWorkflow(value: unknown): JsonObject {
  const workflow = object(value, 'workflow')
  const config = object(workflow.config, 'workflow.config')
  const excludes = config.exclude === undefined ? [] : stringList(config.exclude, 'workflow.config.exclude')
  if (excludes.some(item => item.trim().toLowerCase() === 'abstract-only evidence')) {
    throw new Error('workflow excludes abstract-only evidence, so its legacy abstract records cannot be migrated safely')
  }
  return {
    ...workflow,
    config: {
      ...config,
      requireAgentHandoffs: config.requireAgentHandoffs === true,
    },
  }
}

/**
 * Upgrade one validated-shape SupraMAS whole-unit document from version 1 to version 2.
 * Legacy evidence stays explicitly abstract; the migration never invents PDF provenance or subagent run ids.
 */
export function migrateSupraMasStorageV1(document: unknown): SupraMasStorageMigrationResult {
  const root = object(document, 'storage')
  const unit = object(root.unit, 'storage.unit')
  if (unit.name !== 'supramas') throw new Error('storage.unit.name must be supramas')
  if (unit.version !== 1) throw new Error(`storage.unit.version must be 1, received ${String(unit.version)}`)
  const tables = object(root.tables, 'storage.tables')
  const runs = object(tables.runs, 'storage.tables.runs')
  const stats: SupraMasStorageMigrationStats = {
    runs: 0,
    papers: 0,
    chunks: 0,
    reviews: 0,
    archivedRecommendations: 0,
  }
  const migratedRuns = Object.fromEntries(Object.entries(runs).map(([runId, rawRecord]) => {
    const path = `storage.tables.runs.${runId}`
    const record = object(rawRecord, path)
    const workflow = record.workflow === undefined ? undefined : migrateWorkflow(record.workflow)
    const migratedWorkflow = workflow === undefined
      ? undefined
      : {
        ...workflow,
        review_log: list(workflow.review_log, 'workflow.review_log').map((review, index) =>
          migrateReview(workflow, review, index, stats)),
      }
    stats.runs += 1
    return [runId, {
      ...record,
      papers: migratePapers(record.papers, `${path}.papers`, stats),
      ...(migratedWorkflow === undefined ? {} : { workflow: migratedWorkflow }),
    }]
  }))
  return {
    document: {
      ...root,
      unit: { ...unit, version: 2 },
      tables: { ...tables, runs: migratedRuns },
    },
    stats,
  }
}
