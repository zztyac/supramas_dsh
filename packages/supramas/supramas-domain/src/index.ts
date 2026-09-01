/** Strict local evidence and Stage 1 strategy-tree validation. */

import {
  EDGE_TYPES,
  EVIDENCE_KINDS,
  SOURCE_TYPES,
  TUNING_DIMENSIONS,
  type EdgeType,
  type EvidenceChunk,
  type EvidenceChunkInput,
  type EvidenceKind,
  type EvidenceRef,
  type EvidenceVerification,
  type LimitationRecord,
  type PaperArtifact,
  type PaperArtifactMetadata,
  type FullTextSourceArtifact,
  type PaperNode,
  type SourceType,
  type StrategyEdge,
  type StrategyRecord,
  type StrategyTree,
  type StrategyTreeMetadata,
  type SupraMasDomainErrorCode,
  type TuningDimension,
} from './types.ts'

export type * from './types.ts'
export { EDGE_TYPES, EVIDENCE_KINDS, SOURCE_TYPES, TUNING_DIMENSIONS } from './types.ts'
export type * from './orchestration.ts'
export {
  createStage1Workflow,
  finalizeStage1Workflow,
  nextStage1Action,
  submitStage1Builder,
  submitStage1Review,
  validateStage1Workflow,
} from './orchestration.ts'

type UnknownObject = Record<string, unknown>

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/
const SHA256 = /^[a-f0-9]{64}$/

/** Caller-correctable Stage 1 structure, reference, or evidence failure. */
export class SupraMasDomainError extends Error {
  /**
   * @param message - Human-readable validation explanation.
   * @param code - Stable machine-routable domain classification.
   */
  constructor(message: string, readonly code: SupraMasDomainErrorCode) {
    super(message)
    this.name = 'SupraMasDomainError'
  }
}

function fail(message: string, code: SupraMasDomainErrorCode = 'SUPRAMAS_DOMAIN_INVALID'): never {
  throw new SupraMasDomainError(message, code)
}

function asObject(value: unknown, path: string): UnknownObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${path} must be an object`)
  return value as UnknownObject
}

function exactKeys(value: UnknownObject, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key))
  if (unexpected !== undefined) fail(`${path}.${unexpected} is not allowed`)
}

function requiredString(value: UnknownObject, key: string, path: string): string {
  const item = value[key]
  if (typeof item !== 'string' || item.trim().length === 0) fail(`${path}.${key} must be a non-empty string`)
  return item
}

function identifier(value: UnknownObject, key: string, path: string): string {
  const item = requiredString(value, key, path)
  if (!ID.test(item)) fail(`${path}.${key} is not a valid stable id`)
  return item
}

function optionalNullableString(value: UnknownObject, key: string, path: string): string | null | undefined {
  const item = value[key]
  if (item === undefined || item === null) return item
  if (typeof item !== 'string') fail(`${path}.${key} must be a string or null`)
  return item
}

function integer(value: unknown, path: string, minimum?: number): number {
  if (!Number.isSafeInteger(value) || minimum !== undefined && (value as number) < minimum) {
    fail(`${path} must be an integer${minimum === undefined ? '' : ` >= ${minimum}`}`)
  }
  return value as number
}

function parseFullTextSource(
  value: unknown,
  jobId: string,
  paperId: string,
  path: string,
): FullTextSourceArtifact {
  const item = asObject(value, path)
  exactKeys(item, ['local_path', 'media_type', 'sha256', 'byte_length', 'page_count'], path)
  const localPath = requiredString(item, 'local_path', path).replaceAll('\\', '/')
  const expected = `runs/${jobId}/papers/raw/${paperId}.pdf`
  if (localPath !== expected) fail(`${path}.local_path must be ${expected}`)
  if (item.media_type !== 'application/pdf') fail(`${path}.media_type must be application/pdf`)
  const sha256 = requiredString(item, 'sha256', path)
  if (!SHA256.test(sha256)) fail(`${path}.sha256 must be a lowercase SHA-256 digest`)
  return {
    local_path: localPath,
    media_type: 'application/pdf',
    sha256,
    byte_length: integer(item.byte_length, `${path}.byte_length`, 1),
    page_count: integer(item.page_count, `${path}.page_count`, 1),
  }
}

function optionalNullableInteger(value: UnknownObject, key: string, path: string, minimum?: number): number | null | undefined {
  const item = value[key]
  if (item === undefined || item === null) return item
  return integer(item, `${path}.${key}`, minimum)
}

function confidence(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${path} must be a confidence from 0 to 1`)
  }
  return value
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) fail(`${path}[${index}] must be a non-empty string`)
    return item
  })
}

function optionalStringArray(value: UnknownObject, key: string, path: string): string[] | undefined {
  return value[key] === undefined ? undefined : stringArray(value[key], `${path}.${key}`)
}

function oneOf<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(`${path} is not an accepted value`)
  return value as T
}

function parseEvidence(value: unknown, path: string): EvidenceRef {
  const item = asObject(value, path)
  exactKeys(item, ['chunk_id', 'page', 'evidence_text'], path)
  const page = optionalNullableInteger(item, 'page', path, 1)
  return {
    chunk_id: identifier(item, 'chunk_id', path),
    ...(page === undefined ? {} : { page }),
    evidence_text: requiredString(item, 'evidence_text', path),
  }
}

function parseStrategyRecord(value: unknown, path: string): StrategyRecord {
  const item = asObject(value, path)
  exactKeys(item, ['record_id', 'tuning_dimension', 'tuning_strategy', 'tuning_effect', 'evidence', 'confidence'], path)
  return {
    record_id: identifier(item, 'record_id', path),
    tuning_dimension: oneOf<TuningDimension>(item.tuning_dimension, TUNING_DIMENSIONS, `${path}.tuning_dimension`),
    tuning_strategy: requiredString(item, 'tuning_strategy', path),
    tuning_effect: requiredString(item, 'tuning_effect', path),
    evidence: parseEvidence(item.evidence, `${path}.evidence`),
    confidence: confidence(item.confidence, `${path}.confidence`),
  }
}

function parseLimitationRecord(value: unknown, path: string): LimitationRecord {
  const item = asObject(value, path)
  exactKeys(item, ['limitation_id', 'limitation', 'expectation', 'related_record_ids', 'evidence', 'confidence'], path)
  const related = optionalStringArray(item, 'related_record_ids', path)
  return {
    limitation_id: identifier(item, 'limitation_id', path),
    limitation: requiredString(item, 'limitation', path),
    expectation: requiredString(item, 'expectation', path),
    ...(related === undefined ? {} : { related_record_ids: related }),
    evidence: parseEvidence(item.evidence, `${path}.evidence`),
    confidence: confidence(item.confidence, `${path}.confidence`),
  }
}

function parseNode(value: unknown, path: string): PaperNode {
  const item = asObject(value, path)
  exactKeys(item, [
    'node_id', 'level', 'parent_id', 'paper_id', 'paper_title', 'year', 'doi', 'url', 'source_type', 'notes',
    'strategy_records', 'limitation_records',
  ], path)
  if (!Array.isArray(item.strategy_records) || item.strategy_records.length === 0) {
    fail(`${path}.strategy_records must contain at least one record`)
  }
  if (!Array.isArray(item.limitation_records)) fail(`${path}.limitation_records must be an array`)
  const parent = optionalNullableString(item, 'parent_id', path)
  const year = optionalNullableInteger(item, 'year', path)
  const doi = optionalNullableString(item, 'doi', path)
  const url = optionalNullableString(item, 'url', path)
  const source = item.source_type === undefined
    ? undefined
    : oneOf<SourceType>(item.source_type, SOURCE_TYPES, `${path}.source_type`)
  const notes = optionalStringArray(item, 'notes', path)
  return {
    node_id: identifier(item, 'node_id', path),
    level: integer(item.level, `${path}.level`, 0),
    ...(parent === undefined ? {} : { parent_id: parent }),
    paper_id: identifier(item, 'paper_id', path),
    paper_title: requiredString(item, 'paper_title', path),
    ...(year === undefined ? {} : { year }),
    ...(doi === undefined ? {} : { doi }),
    ...(url === undefined ? {} : { url }),
    ...(source === undefined ? {} : { source_type: source }),
    ...(notes === undefined ? {} : { notes }),
    strategy_records: item.strategy_records.map((record, index) => parseStrategyRecord(record, `${path}.strategy_records[${index}]`)),
    limitation_records: item.limitation_records.map((record, index) => parseLimitationRecord(record, `${path}.limitation_records[${index}]`)),
  }
}

function parseEdge(value: unknown, path: string): StrategyEdge {
  const item = asObject(value, path)
  exactKeys(item, [
    'edge_id', 'parent_node_id', 'parent_limitation_id', 'child_node_id', 'child_record_id', 'parent_expectation',
    'child_tuning_effect', 'edge_type', 'edge_rationale', 'confidence',
  ], path)
  const edgeId = item.edge_id === undefined ? undefined : identifier(item, 'edge_id', path)
  const childRecordId = item.child_record_id === undefined ? undefined : identifier(item, 'child_record_id', path)
  const childEffect = item.child_tuning_effect === undefined
    ? undefined
    : requiredString(item, 'child_tuning_effect', path)
  return {
    ...(edgeId === undefined ? {} : { edge_id: edgeId }),
    parent_node_id: identifier(item, 'parent_node_id', path),
    parent_limitation_id: identifier(item, 'parent_limitation_id', path),
    child_node_id: identifier(item, 'child_node_id', path),
    ...(childRecordId === undefined ? {} : { child_record_id: childRecordId }),
    parent_expectation: requiredString(item, 'parent_expectation', path),
    ...(childEffect === undefined ? {} : { child_tuning_effect: childEffect }),
    edge_type: oneOf<EdgeType>(item.edge_type, EDGE_TYPES, `${path}.edge_type`),
    edge_rationale: requiredString(item, 'edge_rationale', path),
    confidence: confidence(item.confidence, `${path}.confidence`),
  }
}

function parseMetadata(value: unknown, path: string): StrategyTreeMetadata {
  const item = asObject(value, path)
  const material = optionalStringArray(item, 'material_scope', path)
  const target = optionalStringArray(item, 'target_property', path)
  return {
    job_id: identifier(item, 'job_id', path),
    research_topic: requiredString(item, 'research_topic', path),
    ...(material === undefined ? {} : { material_scope: material }),
    ...(target === undefined ? {} : { target_property: target }),
  }
}

function parseTree(value: unknown): StrategyTree {
  const item = asObject(value, 'strategy_tree')
  exactKeys(item, ['job_id', 'research_topic', 'material_scope', 'target_property', 'nodes', 'edges'], 'strategy_tree')
  if (!Array.isArray(item.nodes) || item.nodes.length === 0) fail('strategy_tree.nodes must contain one root paper')
  if (!Array.isArray(item.edges)) fail('strategy_tree.edges must be an array')
  return {
    ...parseMetadata(item, 'strategy_tree'),
    nodes: item.nodes.map((node, index) => parseNode(node, `strategy_tree.nodes[${index}]`)),
    edges: item.edges.map((edge, index) => parseEdge(edge, `strategy_tree.edges[${index}]`)),
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Process-local catalog proving that every evidence id resolves to a run-local paper artifact. */
export class EvidenceCatalog {
  private readonly papers = new Map<string, PaperArtifact>()
  private readonly chunkOwners = new Map<string, string>()

  /** @param jobId - Job whose canonical `runs/<jobId>/papers` directory owns every artifact. */
  constructor(readonly jobId: string) {
    if (!ID.test(jobId)) fail('jobId is not a valid stable id')
  }

  /**
   * Register one paper before adding evidence chunks.
   * @param metadata - Canonical paper identity, title, path, and source type.
   * @returns a detached empty artifact.
   */
  storePaper(metadata: PaperArtifactMetadata): PaperArtifact {
    const paper = asObject(metadata, 'paper')
    exactKeys(paper, ['paper_id', 'paper_title', 'local_path', 'source_type', 'full_text_source'], 'paper')
    const paperId = identifier(paper, 'paper_id', 'paper')
    const localPath = requiredString(paper, 'local_path', 'paper').replaceAll('\\', '/')
    const expected = `runs/${this.jobId}/papers/${paperId}.json`
    if (localPath !== expected) fail(`paper.local_path must be ${expected}`)
    if (this.papers.has(paperId)) fail(`paper ${paperId} already exists`, 'SUPRAMAS_DUPLICATE_ID')
    const fullTextSource = paper.full_text_source === undefined
      ? undefined
      : parseFullTextSource(paper.full_text_source, this.jobId, paperId, 'paper.full_text_source')
    const artifact: PaperArtifact = {
      paper_id: paperId,
      paper_title: requiredString(paper, 'paper_title', 'paper'),
      local_path: localPath,
      source_type: oneOf<SourceType>(paper.source_type, SOURCE_TYPES, 'paper.source_type'),
      ...(fullTextSource === undefined ? {} : { full_text_source: fullTextSource }),
      chunks: [],
    }
    this.papers.set(paperId, artifact)
    return clone(artifact)
  }

  /**
   * Add one uniquely identified local evidence chunk.
   * @param paperId - Owning paper id.
   * @param chunk - Page-aware full local text.
   * @returns a detached stored chunk.
   */
  addChunk(paperId: string, chunk: EvidenceChunkInput): EvidenceChunk {
    const artifact = this.papers.get(paperId)
    if (artifact === undefined) fail(`paper ${paperId} has no local artifact`, 'SUPRAMAS_EVIDENCE_MISSING')
    const item = asObject(chunk, 'chunk')
    exactKeys(item, ['chunk_id', 'page', 'text', 'evidence_kind'], 'chunk')
    const chunkId = identifier(item, 'chunk_id', 'chunk')
    if (this.chunkOwners.has(chunkId)) fail(`chunk ${chunkId} already exists`, 'SUPRAMAS_DUPLICATE_ID')
    const page = optionalNullableInteger(item, 'page', 'chunk', 1)
    const stored: EvidenceChunk = {
      chunk_id: chunkId,
      ...(page === undefined ? {} : { page }),
      text: requiredString(item, 'text', 'chunk'),
      evidence_kind: item.evidence_kind === undefined
        ? 'abstract'
        : oneOf<EvidenceKind>(item.evidence_kind, EVIDENCE_KINDS, 'chunk.evidence_kind'),
    }
    artifact.chunks.push(stored)
    this.chunkOwners.set(chunkId, paperId)
    return clone(stored)
  }

  /**
   * Read one detached paper artifact.
   * @param paperId - Paper identity.
   * @returns the artifact or `undefined` when it has not been stored.
   */
  getPaper(paperId: string): PaperArtifact | undefined {
    const paper = this.papers.get(paperId)
    return paper === undefined ? undefined : clone(paper)
  }

  /**
   * List detached paper artifacts in their stable insertion order.
   * @returns every paper currently available to the run.
   */
  listPapers(): PaperArtifact[] {
    return [...this.papers.values()].map(paper => clone(paper))
  }

  /**
   * Verify one quote against the exact local chunk and page.
   * @param paperId - Expected owning paper.
   * @param evidence - Strategy-tree evidence reference.
   * @returns stable verified provenance.
   */
  verify(paperId: string, evidence: EvidenceRef): EvidenceVerification {
    const artifact = this.papers.get(paperId)
    if (artifact === undefined) fail(`paper ${paperId} has no local artifact`, 'SUPRAMAS_EVIDENCE_MISSING')
    const owner = this.chunkOwners.get(evidence.chunk_id)
    const chunk = artifact.chunks.find(candidate => candidate.chunk_id === evidence.chunk_id)
    if (owner !== paperId || chunk === undefined) {
      fail(`chunk ${evidence.chunk_id} does not resolve under paper ${paperId}`, 'SUPRAMAS_EVIDENCE_MISSING')
    }
    if (evidence.page !== undefined && evidence.page !== null && chunk.page !== evidence.page) {
      fail(`chunk ${evidence.chunk_id} does not match evidence page ${evidence.page}`, 'SUPRAMAS_EVIDENCE_MISMATCH')
    }
    if (!chunk.text.includes(evidence.evidence_text.trim())) {
      fail(`evidence quote is not present in chunk ${evidence.chunk_id}`, 'SUPRAMAS_EVIDENCE_MISMATCH')
    }
    return {
      verified: true,
      paper_id: paperId,
      chunk_id: evidence.chunk_id,
      local_path: artifact.local_path,
      evidence_kind: chunk.evidence_kind,
    }
  }
}

/**
 * Validate the Stage 1 wire shape, tree relationships, and every local evidence quote.
 * @param value - Untrusted strategy-tree value.
 * @param evidence - Run-local evidence catalog.
 * @returns a detached validated strategy tree.
 */
export function validateStrategyTree(value: unknown, evidence: EvidenceCatalog): StrategyTree {
  const tree = parseTree(value)
  if (tree.job_id !== evidence.jobId) fail(`strategy_tree.job_id must match evidence job ${evidence.jobId}`)

  const nodes = new Map<string, PaperNode>()
  const papers = new Set<string>()
  for (const node of tree.nodes) {
    if (nodes.has(node.node_id)) fail(`duplicate node_id ${node.node_id}`, 'SUPRAMAS_DUPLICATE_ID')
    if (papers.has(node.paper_id)) fail(`paper ${node.paper_id} is represented by more than one node`, 'SUPRAMAS_DUPLICATE_ID')
    nodes.set(node.node_id, node)
    papers.add(node.paper_id)
  }

  const roots = tree.nodes.filter(node => node.level === 0)
  const [root] = roots
  if (root === undefined || roots.length !== 1 || root.parent_id !== null && root.parent_id !== undefined) {
    fail('strategy tree must contain exactly one parentless level-0 root', 'SUPRAMAS_BROKEN_REFERENCE')
  }

  for (const node of tree.nodes) {
    if (node.level > 0) {
      const parent = node.parent_id === undefined || node.parent_id === null ? undefined : nodes.get(node.parent_id)
      if (parent === undefined || node.level !== parent.level + 1) {
        fail(`node ${node.node_id} does not follow a parent at the previous level`, 'SUPRAMAS_BROKEN_REFERENCE')
      }
    }
    const artifact = evidence.getPaper(node.paper_id)
    if (artifact === undefined) fail(`paper ${node.paper_id} has no local artifact`, 'SUPRAMAS_EVIDENCE_MISSING')
    if (artifact.paper_title !== node.paper_title) {
      fail(`node ${node.node_id} title does not match local paper ${node.paper_id}`, 'SUPRAMAS_BROKEN_REFERENCE')
    }
    const recordIds = new Set<string>()
    for (const record of node.strategy_records) {
      if (recordIds.has(record.record_id)) fail(`duplicate record_id ${record.record_id}`, 'SUPRAMAS_DUPLICATE_ID')
      recordIds.add(record.record_id)
      evidence.verify(node.paper_id, record.evidence)
    }
    const limitationIds = new Set<string>()
    for (const limitation of node.limitation_records) {
      if (limitationIds.has(limitation.limitation_id)) {
        fail(`duplicate limitation_id ${limitation.limitation_id}`, 'SUPRAMAS_DUPLICATE_ID')
      }
      limitationIds.add(limitation.limitation_id)
      for (const recordId of limitation.related_record_ids ?? []) {
        if (!recordIds.has(recordId)) {
          fail(`limitation ${limitation.limitation_id} references missing record ${recordId}`, 'SUPRAMAS_BROKEN_REFERENCE')
        }
      }
      evidence.verify(node.paper_id, limitation.evidence)
    }
  }

  const edgeIds = new Set<string>()
  const incoming = new Map<string, number>()
  for (const edge of tree.edges) {
    if (edge.edge_id !== undefined && edgeIds.has(edge.edge_id)) fail(`duplicate edge_id ${edge.edge_id}`, 'SUPRAMAS_DUPLICATE_ID')
    if (edge.edge_id !== undefined) edgeIds.add(edge.edge_id)
    const parent = nodes.get(edge.parent_node_id)
    const child = nodes.get(edge.child_node_id)
    if (parent === undefined || child === undefined || child.parent_id !== parent.node_id || child.level !== parent.level + 1) {
      fail('edge endpoints do not match the child parent relationship', 'SUPRAMAS_BROKEN_REFERENCE')
    }
    const limitation = parent.limitation_records.find(candidate => candidate.limitation_id === edge.parent_limitation_id)
    if (limitation === undefined || limitation.expectation !== edge.parent_expectation) {
      fail('edge parent expectation does not match its limitation record', 'SUPRAMAS_BROKEN_REFERENCE')
    }
    if (edge.child_record_id !== undefined) {
      const record = child.strategy_records.find(candidate => candidate.record_id === edge.child_record_id)
      if (record === undefined || edge.child_tuning_effect !== undefined && edge.child_tuning_effect !== record.tuning_effect) {
        fail('edge child claim does not match its strategy record', 'SUPRAMAS_BROKEN_REFERENCE')
      }
    }
    incoming.set(child.node_id, (incoming.get(child.node_id) ?? 0) + 1)
  }
  for (const node of tree.nodes) {
    if (node.level > 0 && incoming.get(node.node_id) !== 1) {
      fail(`non-root node ${node.node_id} must have exactly one incoming edge`, 'SUPRAMAS_BROKEN_REFERENCE')
    }
  }
  return clone(tree)
}

/** Incremental builder whose final artifact crosses the same strict validation boundary. */
export class StrategyTreeAssembler {
  private readonly nodes: PaperNode[] = []
  private readonly edges: StrategyEdge[] = []
  private readonly metadata: StrategyTreeMetadata

  /**
   * @param metadata - Immutable tree identity and research scope.
   * @param evidence - Run-local evidence catalog used at finalization.
   */
  constructor(metadata: StrategyTreeMetadata, private readonly evidence: EvidenceCatalog) {
    this.metadata = parseMetadata(metadata, 'strategy_tree')
  }

  /**
   * Add one structurally valid, uniquely identified paper node.
   * @param node - Candidate paper node.
   */
  addNode(node: PaperNode): void {
    const parsed = parseNode(node, 'node')
    if (this.nodes.some(candidate => candidate.node_id === parsed.node_id || candidate.paper_id === parsed.paper_id)) {
      fail(`node ${parsed.node_id} or paper ${parsed.paper_id} already exists`, 'SUPRAMAS_DUPLICATE_ID')
    }
    this.nodes.push(parsed)
  }

  /**
   * Add one structurally valid strategy edge.
   * @param edge - Parent limitation to child paper edge.
   */
  addEdge(edge: StrategyEdge): void {
    const parsed = parseEdge(edge, 'edge')
    if (parsed.edge_id !== undefined && this.edges.some(candidate => candidate.edge_id === parsed.edge_id)) {
      fail(`edge ${parsed.edge_id} already exists`, 'SUPRAMAS_DUPLICATE_ID')
    }
    this.edges.push(parsed)
  }

  /**
   * Finalize the assembled tree through the strict domain boundary.
   * @returns a detached complete tree after structure, relationship, and evidence validation.
   */
  build(): StrategyTree {
    return validateStrategyTree({ ...this.metadata, nodes: this.nodes, edges: this.edges }, this.evidence)
  }
}
