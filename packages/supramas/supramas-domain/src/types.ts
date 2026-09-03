/** Stage 1 wire types preserved from the Codex-native SupraMAS project. */

/** Closed tuning dimensions accepted by Stage 1 strategy records. */
export const TUNING_DIMENSIONS = [
  'Composition tuning',
  'Grain boundary tuning',
  'Interface tuning',
  'Texture tuning',
  'Stress tuning',
] as const

/** Dominant material tuning dimension of one strategy record. */
export type TuningDimension = typeof TUNING_DIMENSIONS[number]

/** Closed paper source classifications accepted by Stage 1. */
export const SOURCE_TYPES = ['experimental', 'review', 'theory', 'dataset', 'unknown'] as const

/** Source classification of one paper artifact or node. */
export type SourceType = typeof SOURCE_TYPES[number]

/** Closed parent-to-child strategy relationship classifications. */
export const EDGE_TYPES = ['direct', 'transferable', 'exploratory'] as const

/** Strength of one parent limitation to child paper relationship. */
export type EdgeType = typeof EDGE_TYPES[number]

/** Closed provenance classifications for one persisted evidence chunk. */
export const EVIDENCE_KINDS = ['abstract', 'full_text'] as const

/** Whether one chunk was reconstructed from metadata or parsed from a complete source document. */
export type EvidenceKind = typeof EVIDENCE_KINDS[number]

/** Durable proof that a complete local PDF was acquired and parsed for one paper. */
export interface FullTextSourceArtifact {
  local_path: string
  media_type: 'application/pdf'
  sha256: string
  byte_length: number
  page_count: number
}

/** One local evidence quote referenced by a strategy or limitation record. */
export interface EvidenceRef {
  chunk_id: string
  page?: number | null
  evidence_text: string
}

/** One persisted local chunk extracted from a paper artifact. */
export interface EvidenceChunk {
  chunk_id: string
  page?: number | null
  text: string
  evidence_kind: EvidenceKind
}

/** Input accepted at manual evidence boundaries; omitted provenance is fail-closed as abstract. */
export type EvidenceChunkInput = Omit<EvidenceChunk, 'evidence_kind'> & {
  evidence_kind?: EvidenceKind
}

/** Metadata required before chunks can be attached to one local paper. */
export interface PaperArtifactMetadata {
  paper_id: string
  paper_title: string
  local_path: string
  source_type: SourceType
  full_text_source?: FullTextSourceArtifact
}

/** Detached view of one run-local paper artifact and all its chunks. */
export interface PaperArtifact extends PaperArtifactMetadata {
  chunks: EvidenceChunk[]
}

/** One evidence-supported material tuning statement inside a paper node. */
export interface StrategyRecord {
  record_id: string
  tuning_dimension: TuningDimension
  tuning_strategy: string
  tuning_effect: string
  evidence: EvidenceRef
  confidence: number
}

/** One evidence-supported limitation and the expectation used for expansion. */
export interface LimitationRecord {
  limitation_id: string
  limitation: string
  expectation: string
  related_record_ids?: string[]
  evidence: EvidenceRef
  confidence: number
}

/** One strategy-tree node; exactly one node corresponds to one paper. */
export interface PaperNode {
  node_id: string
  level: number
  parent_id?: string | null
  paper_id: string
  paper_title: string
  year?: number | null
  doi?: string | null
  url?: string | null
  source_type?: SourceType
  notes?: string[]
  strategy_records: StrategyRecord[]
  limitation_records: LimitationRecord[]
}

/** One expectation-preserving parent limitation to child paper link. */
export interface StrategyEdge {
  edge_id?: string
  parent_node_id: string
  parent_limitation_id: string
  child_node_id: string
  child_record_id?: string
  parent_expectation: string
  child_tuning_effect?: string
  edge_type: EdgeType
  edge_rationale: string
  confidence: number
}

/** Metadata required before nodes and edges can be assembled. */
export interface StrategyTreeMetadata {
  job_id: string
  research_topic: string
  material_scope?: string[]
  target_property?: string[]
}

/** Complete Stage 1 strategy-tree artifact. */
export interface StrategyTree extends StrategyTreeMetadata {
  nodes: PaperNode[]
  edges: StrategyEdge[]
}

/** Stable domain validation and provenance failure classifications. */
export type SupraMasDomainErrorCode =
  | 'SUPRAMAS_DOMAIN_INVALID'
  | 'SUPRAMAS_DUPLICATE_ID'
  | 'SUPRAMAS_BROKEN_REFERENCE'
  | 'SUPRAMAS_EVIDENCE_MISSING'
  | 'SUPRAMAS_EVIDENCE_MISMATCH'
  | 'SUPRAMAS_EVIDENCE_POLICY_VIOLATION'
  | 'SUPRAMAS_EDGE_TYPE_MISMATCH'

/** Successful resolution of one evidence quote against local paper storage. */
export interface EvidenceVerification {
  verified: true
  paper_id: string
  chunk_id: string
  local_path: string
  evidence_kind: EvidenceKind
  /** Exact chunk substring that downstream records must persist. */
  canonical_evidence_text?: string
  /** Whether the submitted selector was already exact or needed whitespace/typography repair. */
  match_kind?: 'exact' | 'normalized'
  /** Zero-based exact substring bounds inside the stored chunk. */
  start_offset?: number
  end_offset?: number
}
