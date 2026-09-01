/** Deterministic, resumable Stage 1 builder/reviewer orchestration. */

import {
  SupraMasDomainError,
  validateStrategyTree,
  type EvidenceCatalog,
} from './index.ts'
import type {
  EdgeType,
  PaperNode,
  StrategyEdge,
  StrategyTree,
} from './types.ts'

/** Builder wire payload before the coordinator assigns tree topology ids. */
export type PaperNodeDraft = Omit<PaperNode, 'node_id' | 'level' | 'parent_id'>

/** Builder-proposed bridge; topology and parent expectation are coordinator-owned. */
export interface ProposedStrategyEdge {
  parent_limitation_id: string
  child_record_id?: string
  child_tuning_effect?: string
  edge_type: EdgeType
  edge_rationale: string
  confidence: number
}

/** One normalized actionable reviewer finding. */
export interface Stage1ReviewFinding {
  target_id: string
  issue: string
  required_action: 'revise' | 'remove' | 'downgrade' | 'provide_more_evidence' | 'answer_question'
}

/** Closed scientific review decisions. */
export type Stage1ReviewDecision = 'accept' | 'revise' | 'reject'

/** Reviewer assessment of how completely one child satisfies its parent expectation. */
export type ExpectationSatisfaction = 'not_applicable' | 'full' | 'partial' | 'adjacent' | 'none'

/** Reviewer result persisted verbatim enough to guide the next builder turn. */
export interface Stage1ReviewSubmission {
  reviewer_run_id?: string
  decision: Stage1ReviewDecision
  expectation_satisfaction: ExpectationSatisfaction
  summary: string
  critical_issues: Stage1ReviewFinding[]
  edge_issues: Stage1ReviewFinding[]
  acceptance_conditions: string[]
}

/** One builder result for a fresh attempt or reviewer-guided revision. */
export interface Stage1BuilderSubmission {
  builder_run_id?: string
  paper_node: PaperNodeDraft | null
  edge: ProposedStrategyEdge | null
  reason?: string
  notes: string[]
}

/** Immutable limits and research scope controlling one Stage 1 workflow. */
export interface Stage1WorkflowConfig {
  jobId: string
  researchTopic: string
  materialScope?: string[]
  targetProperty?: string[]
  evidencePolicy?: string
  include?: string[]
  exclude?: string[]
  maxDepth: number
  maxRootAttempts: number
  maxChildAttemptsPerLimitation: number
  maxBranchPerNode?: number | null
  targetChildNodes?: number | null
  requireAgentHandoffs?: boolean
}

/** Terminal and active states for one limitation frontier. */
export type Stage1FrontierStatus =
  | 'pending'
  | 'accepted_edge'
  | 'no_supported_child_after_attempt_budget'
  | 'depth_limit_reached'
  | 'width_cap_reached'
  | 'target_child_cap_reached'

/** Durable expansion obligation derived from one accepted limitation. */
export interface Stage1Frontier {
  key: string
  node_id: string
  limitation_id: string
  status: Stage1FrontierStatus
  attempts: number
  reason?: string
}

/** Builder-attempt terminal or intermediate status. */
export type Stage1BuilderAttemptStatus =
  | 'review_pending'
  | 'revision_requested'
  | 'accepted'
  | 'rejected'
  | 'no_candidate'
  | 'no_edge_proposed'

/** Durable account of one real literature-search attempt. */
export interface Stage1BuilderAttempt {
  attempt_index: number
  scope: 'root' | 'child'
  frontier_key?: string
  revision_round: number
  status: Stage1BuilderAttemptStatus
  paper_id?: string
  builder_run_id?: string
  reason?: string
}

/** Durable reviewer log row. */
export interface Stage1ReviewEntry extends Stage1ReviewSubmission {
  review_round: number
  scope: 'root' | 'child'
  attempt_index: number
  revision_round: number
  paper_id: string
  frontier_key?: string
}

/** Candidate held outside the accepted tree until an explicit accept decision. */
export interface Stage1PendingCandidate {
  scope: 'root' | 'child'
  attempt_index: number
  revision_round: number
  frontier_key?: string
  node: PaperNode
  edge?: StrategyEdge
  reviewer_feedback?: Stage1ReviewSubmission
}

/** Durable workflow phase independent from the enclosing run lifecycle. */
export type Stage1WorkflowStatus = 'active' | 'ready_to_finalize' | 'completed' | 'failed'

/** Complete resumable Stage 1 coordinator state. */
export interface Stage1Workflow {
  status: Stage1WorkflowStatus
  config: Stage1WorkflowConfig
  nodes: PaperNode[]
  edges: StrategyEdge[]
  frontiers: Stage1Frontier[]
  builder_attempts: Stage1BuilderAttempt[]
  review_log: Stage1ReviewEntry[]
  pending_candidate?: Stage1PendingCandidate
  failure?: string
}

/** Next deterministic coordinator action. */
export type Stage1NextAction =
  | { kind: 'build_root'; attempt_index: number }
  | {
    kind: 'build_child'
    parent_node_id: string
    parent_limitation_id: string
    parent_expectation: string
    attempt_index: number
    prior_attempts: Stage1BuilderAttempt[]
  }
  | {
    kind: 'review_candidate'
    scope: 'root' | 'child'
    attempt_index: number
    revision_round: number
    paper_id: string
  }
  | {
    kind: 'revise_candidate'
    scope: 'root' | 'child'
    attempt_index: number
    revision_round: number
    paper_id: string
    critical_issues: Stage1ReviewFinding[]
    edge_issues: Stage1ReviewFinding[]
    acceptance_conditions: string[]
  }
  | { kind: 'finalize' }
  | { kind: 'completed'; tree: StrategyTree }
  | { kind: 'failed'; reason: string }

/** Finalized state and its strictly validated artifact. */
export interface FinalizedStage1Workflow {
  workflow: Stage1Workflow
  tree: StrategyTree
}

const JOB_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const ABSTRACT_ONLY_EXCLUSION = 'abstract-only evidence'
const EXPECTATION_SATISFACTIONS: readonly ExpectationSatisfaction[] = [
  'not_applicable', 'full', 'partial', 'adjacent', 'none',
]
const EXPECTED_EDGE_TYPE: Readonly<Partial<Record<ExpectationSatisfaction, EdgeType>>> = {
  full: 'direct',
  partial: 'transferable',
  adjacent: 'exploratory',
}

function fail(message: string): never {
  throw new SupraMasDomainError(message, 'SUPRAMAS_DOMAIN_INVALID')
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nonempty(value: string, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) fail(`${path} must be a non-empty string`)
  return value.trim()
}

function positiveInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${path} must be a positive safe integer`)
  return value
}

function nonnegativeInteger(value: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${path} must be a non-negative safe integer`)
  return value
}

function optionalCap(value: number | null | undefined, path: string): number | null | undefined {
  return value === null || value === undefined ? value : positiveInteger(value, path)
}

function stringList(value: readonly string[], path: string): string[] {
  return value.map((item, index) => nonempty(item, `${path}[${index}]`))
}

function treeOf(workflow: Stage1Workflow): StrategyTree {
  return {
    job_id: workflow.config.jobId,
    research_topic: workflow.config.researchTopic,
    ...(workflow.config.materialScope === undefined ? {} : { material_scope: workflow.config.materialScope }),
    ...(workflow.config.targetProperty === undefined ? {} : { target_property: workflow.config.targetProperty }),
    nodes: workflow.nodes,
    edges: workflow.edges,
  }
}

function nodeById(workflow: Stage1Workflow, nodeId: string): PaperNode {
  const node = workflow.nodes.find(candidate => candidate.node_id === nodeId)
  if (node === undefined) fail(`accepted parent node ${nodeId} is missing`)
  return node
}

function frontierByKey(workflow: Stage1Workflow, key: string): Stage1Frontier {
  const frontier = workflow.frontiers.find(candidate => candidate.key === key)
  if (frontier === undefined) fail(`frontier ${key} is missing`)
  return frontier
}

function pendingFrontier(workflow: Stage1Workflow): Stage1Frontier | undefined {
  return workflow.frontiers.find(frontier => frontier.status === 'pending')
}

function rootAttempts(workflow: Stage1Workflow): Stage1BuilderAttempt[] {
  return workflow.builder_attempts.filter(attempt => attempt.scope === 'root')
}

function attemptsFor(workflow: Stage1Workflow, key: string): Stage1BuilderAttempt[] {
  return workflow.builder_attempts.filter(attempt => attempt.frontier_key === key)
}

function validateFinding(finding: Stage1ReviewFinding, path: string): Stage1ReviewFinding {
  const actions: Stage1ReviewFinding['required_action'][] = [
    'revise', 'remove', 'downgrade', 'provide_more_evidence', 'answer_question',
  ]
  if (!actions.includes(finding.required_action)) fail(`${path}.required_action is invalid`)
  return {
    target_id: nonempty(finding.target_id, `${path}.target_id`),
    issue: nonempty(finding.issue, `${path}.issue`),
    required_action: finding.required_action,
  }
}

function validateReview(review: Stage1ReviewSubmission): Stage1ReviewSubmission {
  const decisions: Stage1ReviewDecision[] = ['accept', 'revise', 'reject']
  if (!decisions.includes(review.decision)) fail('review.decision is invalid')
  if (!EXPECTATION_SATISFACTIONS.includes(review.expectation_satisfaction)) {
    fail('review.expectation_satisfaction is invalid')
  }
  const validated = {
    ...(review.reviewer_run_id === undefined
      ? {}
      : { reviewer_run_id: nonempty(review.reviewer_run_id, 'review.reviewer_run_id') }),
    decision: review.decision,
    expectation_satisfaction: review.expectation_satisfaction,
    summary: nonempty(review.summary, 'review.summary'),
    critical_issues: review.critical_issues.map((finding, index) =>
      validateFinding(finding, `review.critical_issues[${index}]`)),
    edge_issues: review.edge_issues.map((finding, index) =>
      validateFinding(finding, `review.edge_issues[${index}]`)),
    acceptance_conditions: stringList(review.acceptance_conditions, 'review.acceptance_conditions'),
  }
  if (
    validated.decision === 'accept'
    && (
      validated.critical_issues.length > 0
      || validated.edge_issues.length > 0
      || validated.acceptance_conditions.length > 0
    )
  ) {
    fail('accept review cannot retain unresolved work; use revise or reject')
  }
  return validated
}

function requiresNonAbstractEvidence(config: Stage1WorkflowConfig): boolean {
  return config.exclude?.some(item => item.trim().toLowerCase() === ABSTRACT_ONLY_EXCLUSION) ?? false
}

function enforceNodeEvidencePolicy(
  config: Stage1WorkflowConfig,
  node: PaperNode,
  catalog: EvidenceCatalog,
): void {
  if (!requiresNonAbstractEvidence(config)) return
  const artifact = catalog.getPaper(node.paper_id)
  if (artifact?.full_text_source === undefined) {
    throw new SupraMasDomainError(
      `paper ${node.paper_id} has no durable full-text source required by the task policy`,
      'SUPRAMAS_EVIDENCE_POLICY_VIOLATION',
    )
  }
  const evidence = [
    ...node.strategy_records.map(record => record.evidence),
    ...node.limitation_records.map(record => record.evidence),
  ]
  if (!evidence.some(reference => catalog.verify(node.paper_id, reference).evidence_kind === 'full_text')) {
    throw new SupraMasDomainError(
      `paper ${node.paper_id} cites only abstract evidence while the task excludes abstract-only evidence`,
      'SUPRAMAS_EVIDENCE_POLICY_VIOLATION',
    )
  }
}

function enforceReviewSemantics(
  pending: Stage1PendingCandidate,
  review: Stage1ReviewSubmission,
): void {
  if (pending.scope === 'root') {
    if (review.expectation_satisfaction !== 'not_applicable') {
      throw new SupraMasDomainError(
        'root review expectation_satisfaction must be not_applicable',
        'SUPRAMAS_EDGE_TYPE_MISMATCH',
      )
    }
    return
  }
  if (review.expectation_satisfaction === 'not_applicable') {
    throw new SupraMasDomainError(
      'child review must assess expectation satisfaction',
      'SUPRAMAS_EDGE_TYPE_MISMATCH',
    )
  }
  if (review.decision !== 'accept') return
  const edge = pending.edge
  /* v8 ignore next -- every pending child candidate is validated with an edge before review. */
  if (edge === undefined) fail('accepted child review has no proposed edge')
  const expected = EXPECTED_EDGE_TYPE[review.expectation_satisfaction]
  if (expected === undefined || edge.edge_type !== expected) {
    throw new SupraMasDomainError(
      `child expectation satisfaction ${review.expectation_satisfaction} cannot be accepted as ${edge.edge_type}`,
      'SUPRAMAS_EDGE_TYPE_MISMATCH',
    )
  }
}

function enforceAcceptedWorkflowPolicies(workflow: Stage1Workflow, catalog: EvidenceCatalog): void {
  for (const node of workflow.nodes) {
    enforceNodeEvidencePolicy(workflow.config, node, catalog)
    const scope = node.parent_id === null ? 'root' : 'child'
    const accepted = [...workflow.review_log].reverse().find(entry =>
      entry.scope === scope && entry.paper_id === node.paper_id && entry.decision === 'accept')
    if (accepted === undefined) {
      throw new SupraMasDomainError(
        `accepted ${scope} ${node.paper_id} has no accepted reviewer entry`,
        'SUPRAMAS_EDGE_TYPE_MISMATCH',
      )
    }
    if (workflow.config.requireAgentHandoffs === true && accepted.reviewer_run_id === undefined) {
      fail(`accepted ${scope} ${node.paper_id} has no reviewer subagent run id`)
    }
    const review = validateReview(accepted)
    const edge = scope === 'child'
      ? workflow.edges.find(item => item.child_node_id === node.node_id)
      : undefined
    if (scope === 'child' && edge === undefined) {
      throw new SupraMasDomainError(
        `accepted child ${node.paper_id} has no accepted edge`,
        'SUPRAMAS_EDGE_TYPE_MISMATCH',
      )
    }
    enforceReviewSemantics({
      scope,
      attempt_index: accepted.attempt_index,
      revision_round: accepted.revision_round,
      node,
      ...(edge === undefined ? {} : { edge }),
    }, review)
  }
}

function validateDraft(draft: PaperNodeDraft, catalog: EvidenceCatalog): PaperNodeDraft {
  const [validated] = validateStrategyTree({
    job_id: catalog.jobId,
    research_topic: 'candidate validation',
    nodes: [{ ...draft, node_id: 'candidate', level: 0, parent_id: null }],
    edges: [],
  }, catalog).nodes
  /* v8 ignore next -- validateStrategyTree returns the supplied single node or throws before this invariant. */
  if (validated === undefined) fail('candidate validation produced no node')
  const { node_id: _nodeId, level: _level, parent_id: _parentId, ...result } = validated
  return result
}

function topologyNode(
  workflow: Stage1Workflow,
  draft: PaperNodeDraft,
  scope: 'root' | 'child',
  frontier?: Stage1Frontier,
  existing?: PaperNode,
): PaperNode {
  const nodeId = existing?.node_id ?? `N${workflow.nodes.length}`
  if (scope === 'root') return { ...draft, node_id: nodeId, level: 0, parent_id: null }
  /* v8 ignore next -- a build_child or child revision action is derived only from an existing pending frontier. */
  if (frontier === undefined) fail('child candidate has no active frontier')
  const parent = nodeById(workflow, frontier.node_id)
  return { ...draft, node_id: nodeId, level: parent.level + 1, parent_id: parent.node_id }
}

function topologyEdge(
  workflow: Stage1Workflow,
  proposed: ProposedStrategyEdge,
  frontier: Stage1Frontier,
  child: PaperNode,
  existing?: StrategyEdge,
): StrategyEdge {
  if (proposed.parent_limitation_id !== frontier.limitation_id) {
    fail(`edge parent limitation must be active frontier ${frontier.limitation_id}`)
  }
  const parent = nodeById(workflow, frontier.node_id)
  const limitation = parent.limitation_records.find(item => item.limitation_id === frontier.limitation_id)
  /* v8 ignore next -- nextStage1Action resolves this same accepted limitation before topologyEdge can run. */
  if (limitation === undefined) fail(`frontier limitation ${frontier.limitation_id} is missing from ${parent.node_id}`)
  return {
    edge_id: existing?.edge_id ?? `E${workflow.edges.length}`,
    parent_node_id: parent.node_id,
    parent_limitation_id: limitation.limitation_id,
    child_node_id: child.node_id,
    ...(proposed.child_record_id === undefined ? {} : { child_record_id: proposed.child_record_id }),
    parent_expectation: limitation.expectation,
    ...(proposed.child_tuning_effect === undefined ? {} : { child_tuning_effect: proposed.child_tuning_effect }),
    edge_type: proposed.edge_type,
    edge_rationale: proposed.edge_rationale,
    confidence: proposed.confidence,
  }
}

function validateProspective(
  workflow: Stage1Workflow,
  node: PaperNode,
  edge: StrategyEdge | undefined,
  catalog: EvidenceCatalog,
): void {
  validateStrategyTree({
    ...treeOf(workflow),
    nodes: [...workflow.nodes, node],
    edges: edge === undefined ? workflow.edges : [...workflow.edges, edge],
  }, catalog)
}

function updateAttempt(
  workflow: Stage1Workflow,
  pending: Stage1PendingCandidate,
  update: Partial<Pick<Stage1BuilderAttempt, 'status' | 'revision_round' | 'builder_run_id' | 'reason'>>,
): void {
  const attempt = [...workflow.builder_attempts].reverse().find(candidate =>
    candidate.scope === pending.scope
    && candidate.attempt_index === pending.attempt_index
    && candidate.frontier_key === pending.frontier_key)
  if (attempt === undefined) fail('pending candidate has no builder attempt')
  Object.assign(attempt, update)
}

function setReadyWhenClosed(workflow: Stage1Workflow): void {
  workflow.status = workflow.nodes.length > 0 && pendingFrontier(workflow) === undefined
    ? 'ready_to_finalize'
    : 'active'
}

function exhaustCurrent(workflow: Stage1Workflow, scope: 'root' | 'child', frontierKey?: string): void {
  if (scope === 'root') {
    if (rootAttempts(workflow).length >= workflow.config.maxRootAttempts) {
      workflow.status = 'failed'
      workflow.failure = 'no_supported_root_after_attempt_budget'
    }
    return
  }
  /* v8 ignore next -- child scope is selected only from a build_child action carrying its frontier key. */
  if (frontierKey === undefined) fail('child attempt has no frontier key')
  const frontier = frontierByKey(workflow, frontierKey)
  if (frontier.attempts >= workflow.config.maxChildAttemptsPerLimitation) {
    frontier.status = 'no_supported_child_after_attempt_budget'
    frontier.reason = 'Every configured builder attempt completed without an accepted child edge.'
  }
  setReadyWhenClosed(workflow)
}

function applyCaps(workflow: Stage1Workflow): void {
  const target = workflow.config.targetChildNodes
  const childCount = workflow.nodes.filter(node => node.level > 0).length
  if (target !== undefined && target !== null && childCount >= target) {
    for (const frontier of workflow.frontiers) {
      if (frontier.status !== 'pending') continue
      frontier.status = 'target_child_cap_reached'
      frontier.reason = `Accepted child target ${target} was reached.`
    }
  }
  const width = workflow.config.maxBranchPerNode
  if (width !== undefined && width !== null) {
    for (const frontier of workflow.frontiers) {
      if (frontier.status !== 'pending') continue
      const outgoing = workflow.edges.filter(edge => edge.parent_node_id === frontier.node_id).length
      if (outgoing < width) continue
      frontier.status = 'width_cap_reached'
      frontier.reason = `Parent branch cap ${width} was reached.`
    }
  }
  setReadyWhenClosed(workflow)
}

/**
 * Start one empty, deterministic Stage 1 coordinator state.
 * @param config - Immutable research scope and attempt limits.
 * @returns the normalized active workflow.
 */
export function createStage1Workflow(config: Stage1WorkflowConfig): Stage1Workflow {
  if (!JOB_ID.test(config.jobId)) fail('workflow.jobId is not a valid stable id')
  const normalized: Stage1WorkflowConfig = {
    jobId: config.jobId,
    researchTopic: nonempty(config.researchTopic, 'workflow.researchTopic'),
    ...(config.materialScope === undefined
      ? {}
      : { materialScope: stringList(config.materialScope, 'workflow.materialScope') }),
    ...(config.targetProperty === undefined
      ? {}
      : { targetProperty: stringList(config.targetProperty, 'workflow.targetProperty') }),
    ...(config.evidencePolicy === undefined
      ? {}
      : { evidencePolicy: nonempty(config.evidencePolicy, 'workflow.evidencePolicy') }),
    ...(config.include === undefined
      ? {}
      : { include: stringList(config.include, 'workflow.include') }),
    ...(config.exclude === undefined
      ? {}
      : { exclude: stringList(config.exclude, 'workflow.exclude') }),
    maxDepth: nonnegativeInteger(config.maxDepth, 'workflow.maxDepth'),
    maxRootAttempts: positiveInteger(config.maxRootAttempts, 'workflow.maxRootAttempts'),
    maxChildAttemptsPerLimitation: positiveInteger(
      config.maxChildAttemptsPerLimitation,
      'workflow.maxChildAttemptsPerLimitation',
    ),
    ...(config.maxBranchPerNode === undefined
      ? {}
      : { maxBranchPerNode: optionalCap(config.maxBranchPerNode, 'workflow.maxBranchPerNode') ?? null }),
    ...(config.targetChildNodes === undefined
      ? {}
      : { targetChildNodes: optionalCap(config.targetChildNodes, 'workflow.targetChildNodes') ?? null }),
    requireAgentHandoffs: config.requireAgentHandoffs === true,
  }
  return {
    status: 'active',
    config: normalized,
    nodes: [],
    edges: [],
    frontiers: [],
    builder_attempts: [],
    review_log: [],
  }
}

/**
 * Compute the only legal next coordinator operation from durable state.
 * @param workflow - Current durable workflow.
 * @returns the next builder, reviewer, or terminal action.
 */
export function nextStage1Action(workflow: Stage1Workflow): Stage1NextAction {
  if (workflow.status === 'completed') return { kind: 'completed', tree: clone(treeOf(workflow)) }
  if (workflow.status === 'failed') return { kind: 'failed', reason: workflow.failure ?? 'workflow_failed' }
  const pending = workflow.pending_candidate
  if (pending !== undefined) {
    const feedback = pending.reviewer_feedback
    if (feedback !== undefined) {
      return {
        kind: 'revise_candidate',
        scope: pending.scope,
        attempt_index: pending.attempt_index,
        revision_round: pending.revision_round,
        paper_id: pending.node.paper_id,
        critical_issues: clone(feedback.critical_issues),
        edge_issues: clone(feedback.edge_issues),
        acceptance_conditions: [...feedback.acceptance_conditions],
      }
    }
    return {
      kind: 'review_candidate',
      scope: pending.scope,
      attempt_index: pending.attempt_index,
      revision_round: pending.revision_round,
      paper_id: pending.node.paper_id,
    }
  }
  if (workflow.nodes.length === 0) {
    return { kind: 'build_root', attempt_index: rootAttempts(workflow).length + 1 }
  }
  const frontier = pendingFrontier(workflow)
  if (frontier !== undefined) {
    const parent = nodeById(workflow, frontier.node_id)
    const limitation = parent.limitation_records.find(item => item.limitation_id === frontier.limitation_id)
    if (limitation === undefined) fail(`frontier limitation ${frontier.limitation_id} is missing`)
    return {
      kind: 'build_child',
      parent_node_id: parent.node_id,
      parent_limitation_id: limitation.limitation_id,
      parent_expectation: limitation.expectation,
      attempt_index: frontier.attempts + 1,
      prior_attempts: clone(attemptsFor(workflow, frontier.key)),
    }
  }
  return { kind: 'finalize' }
}

/**
 * Record one builder result while preserving the reviewer acceptance gate.
 * @param workflow - Current durable workflow.
 * @param submission - Builder candidate, edge proposal, or no-result record.
 * @param catalog - Run-local evidence available for literal validation.
 * @returns a detached workflow advanced to its next legal state.
 */
export function submitStage1Builder(
  workflow: Stage1Workflow,
  submission: Stage1BuilderSubmission,
  catalog: EvidenceCatalog,
): Stage1Workflow {
  const next = nextStage1Action(workflow)
  if (next.kind !== 'build_root' && next.kind !== 'build_child' && next.kind !== 'revise_candidate') {
    fail(`builder submission is not legal while next action is ${next.kind}`)
  }
  if (workflow.config.requireAgentHandoffs === true && submission.builder_run_id === undefined) {
    fail('builder submission requires a builder subagent run id')
  }
  const builderRunId = submission.builder_run_id === undefined
    ? undefined
    : nonempty(submission.builder_run_id, 'builder.builder_run_id')
  const updated = clone(workflow)
  if (next.kind === 'revise_candidate') {
    const pending = updated.pending_candidate
    /* v8 ignore next -- revise_candidate is emitted only for a pending candidate carrying reviewer feedback. */
    if (pending === undefined || pending.reviewer_feedback === undefined) fail('revision has no pending reviewed candidate')
    if (submission.paper_node === null) fail('a revision must return the same corrected paper candidate')
    const draft = validateDraft(submission.paper_node, catalog)
    if (draft.paper_id !== pending.node.paper_id) fail('a revision cannot replace the reviewed paper')
    const frontier = pending.frontier_key === undefined ? undefined : frontierByKey(updated, pending.frontier_key)
    const node = topologyNode(updated, draft, pending.scope, frontier, pending.node)
    let edge: StrategyEdge | undefined
    if (pending.scope === 'child') {
      if (frontier === undefined || submission.edge === null) fail('a child revision must retain a proposed edge')
      edge = topologyEdge(updated, submission.edge, frontier, node, pending.edge)
      validateProspective(updated, node, edge, catalog)
    }
    pending.node = node
    if (edge === undefined) delete pending.edge
    else pending.edge = edge
    pending.revision_round += 1
    delete pending.reviewer_feedback
    updateAttempt(updated, pending, {
      status: 'review_pending',
      revision_round: pending.revision_round,
      ...(builderRunId === undefined ? {} : { builder_run_id: builderRunId }),
    })
    return updated
  }

  const scope = next.kind === 'build_root' ? 'root' : 'child'
  const frontier = next.kind === 'build_child' ? pendingFrontier(updated) : undefined
  const frontierKey = frontier?.key
  const attemptIndex = next.attempt_index
  if (frontier !== undefined) frontier.attempts += 1
  if (submission.paper_node === null) {
    updated.builder_attempts.push({
      attempt_index: attemptIndex,
      scope,
      ...(frontierKey === undefined ? {} : { frontier_key: frontierKey }),
      revision_round: 0,
      status: 'no_candidate',
      ...(builderRunId === undefined ? {} : { builder_run_id: builderRunId }),
      reason: nonempty(submission.reason ?? 'builder returned no candidate', 'builder.reason'),
    })
    exhaustCurrent(updated, scope, frontierKey)
    return updated
  }

  const draft = validateDraft(submission.paper_node, catalog)
  if (updated.nodes.some(node => node.paper_id === draft.paper_id)) {
    throw new SupraMasDomainError(`paper ${draft.paper_id} is already an accepted ancestor`, 'SUPRAMAS_DUPLICATE_ID')
  }
  const node = topologyNode(updated, draft, scope, frontier)
  if (scope === 'child' && submission.edge === null) {
    updated.builder_attempts.push({
      attempt_index: attemptIndex,
      scope,
      /* v8 ignore next -- no-edge records exist only for child actions, which always carry a frontier key. */
      ...(frontierKey === undefined ? {} : { frontier_key: frontierKey }),
      revision_round: 0,
      status: 'no_edge_proposed',
      paper_id: node.paper_id,
      ...(builderRunId === undefined ? {} : { builder_run_id: builderRunId }),
      reason: nonempty(submission.reason ?? 'builder returned no proposed edge', 'builder.reason'),
    })
    exhaustCurrent(updated, scope, frontierKey)
    return updated
  }

  let edge: StrategyEdge | undefined
  if (scope === 'child') {
    /* v8 ignore next -- the preceding no-edge branch returns and build_child always resolves a frontier. */
    if (frontier === undefined || submission.edge === null) fail('child candidate has no active edge')
    edge = topologyEdge(updated, submission.edge, frontier, node)
    validateProspective(updated, node, edge, catalog)
  }
  updated.builder_attempts.push({
    attempt_index: attemptIndex,
    scope,
    ...(frontierKey === undefined ? {} : { frontier_key: frontierKey }),
    revision_round: 0,
    status: 'review_pending',
    paper_id: node.paper_id,
    ...(builderRunId === undefined ? {} : { builder_run_id: builderRunId }),
  })
  updated.pending_candidate = {
    scope,
    attempt_index: attemptIndex,
    revision_round: 0,
    ...(frontierKey === undefined ? {} : { frontier_key: frontierKey }),
    node,
    ...(edge === undefined ? {} : { edge }),
  }
  updated.status = 'active'
  return updated
}

/**
 * Record one reviewer decision and advance only through its declared outcome.
 * @param workflow - Current durable workflow with a pending candidate.
 * @param submission - Normalized reviewer decision and required actions.
 * @param catalog - Run-local evidence available for acceptance validation.
 * @returns a detached workflow advanced to its next legal state.
 */
export function submitStage1Review(
  workflow: Stage1Workflow,
  submission: Stage1ReviewSubmission,
  catalog: EvidenceCatalog,
): Stage1Workflow {
  const next = nextStage1Action(workflow)
  if (next.kind !== 'review_candidate') fail(`review submission is not legal while next action is ${next.kind}`)
  const updated = clone(workflow)
  const pending = updated.pending_candidate
  /* v8 ignore next -- review_candidate is emitted only for an unreviewed pending candidate. */
  if (pending === undefined || pending.reviewer_feedback !== undefined) fail('review has no pending candidate')
  if (updated.config.requireAgentHandoffs === true && submission.reviewer_run_id === undefined) {
    fail('review submission requires a reviewer subagent run id')
  }
  const review = validateReview(submission)
  enforceReviewSemantics(pending, review)
  if (review.decision === 'accept') enforceNodeEvidencePolicy(updated.config, pending.node, catalog)
  updated.review_log.push({
    ...review,
    review_round: updated.review_log.length + 1,
    scope: pending.scope,
    attempt_index: pending.attempt_index,
    revision_round: pending.revision_round,
    paper_id: pending.node.paper_id,
    ...(pending.frontier_key === undefined ? {} : { frontier_key: pending.frontier_key }),
  })

  if (review.decision === 'revise') {
    pending.reviewer_feedback = review
    updateAttempt(updated, pending, { status: 'revision_requested' })
    return updated
  }
  if (review.decision === 'reject') {
    updateAttempt(updated, pending, { status: 'rejected' })
    const { scope, frontier_key: frontierKey } = pending
    delete updated.pending_candidate
    exhaustCurrent(updated, scope, frontierKey)
    return updated
  }

  validateProspective(updated, pending.node, pending.edge, catalog)
  updated.nodes.push(pending.node)
  if (pending.edge !== undefined) updated.edges.push(pending.edge)
  updateAttempt(updated, pending, { status: 'accepted' })
  if (pending.frontier_key !== undefined) {
    const frontier = frontierByKey(updated, pending.frontier_key)
    frontier.status = 'accepted_edge'
    frontier.reason = `Reviewer accepted child paper ${pending.node.paper_id}.`
  }
  for (const limitation of pending.node.limitation_records) {
    const atDepthLimit = pending.node.level >= updated.config.maxDepth
    updated.frontiers.push({
      key: `${pending.node.node_id}:${limitation.limitation_id}`,
      node_id: pending.node.node_id,
      limitation_id: limitation.limitation_id,
      status: atDepthLimit ? 'depth_limit_reached' : 'pending',
      attempts: 0,
      ...(atDepthLimit ? { reason: `Node level ${pending.node.level} reached max depth ${updated.config.maxDepth}.` } : {}),
    })
  }
  delete updated.pending_candidate
  applyCaps(updated)
  validateStrategyTree(treeOf(updated), catalog)
  return updated
}

/**
 * Finalize only after every reachable frontier has a terminal status.
 * @param workflow - Workflow whose next legal action is finalization.
 * @param catalog - Run-local evidence used for final tree validation.
 * @returns the completed workflow and strictly validated strategy tree.
 */
export function finalizeStage1Workflow(
  workflow: Stage1Workflow,
  catalog: EvidenceCatalog,
): FinalizedStage1Workflow {
  const next = nextStage1Action(workflow)
  if (next.kind !== 'finalize') fail(`workflow cannot finalize while next action is ${next.kind}`)
  enforceAcceptedWorkflowPolicies(workflow, catalog)
  const tree = validateStrategyTree(treeOf(workflow), catalog)
  const completed = clone(workflow)
  completed.status = 'completed'
  return { workflow: completed, tree }
}

/**
 * Revalidate a durable workflow after deserialization before it can resume.
 * @param workflow - Stored coordinator state.
 * @param catalog - Reconstructed run-local evidence catalog.
 * @returns a detached validated workflow.
 */
export function validateStage1Workflow(
  workflow: Stage1Workflow,
  catalog: EvidenceCatalog,
): Stage1Workflow {
  const validated = clone(workflow)
  const normalized = createStage1Workflow(validated.config).config
  validated.config = normalized
  if (normalized.jobId !== catalog.jobId) fail(`workflow job ${normalized.jobId} does not own this evidence catalog`)
  if (validated.nodes.length === 0) {
    if (validated.edges.length > 0 || validated.frontiers.length > 0) {
      fail('a workflow without an accepted root cannot contain edges or frontiers')
    }
  } else {
    validateStrategyTree(treeOf(validated), catalog)
    enforceAcceptedWorkflowPolicies(validated, catalog)
  }

  const frontierKeys = new Set<string>()
  for (const frontier of validated.frontiers) {
    if (frontierKeys.has(frontier.key)) fail(`duplicate frontier ${frontier.key}`)
    frontierKeys.add(frontier.key)
    const owner = nodeById(validated, frontier.node_id)
    if (!owner.limitation_records.some(record => record.limitation_id === frontier.limitation_id)) {
      fail(`frontier ${frontier.key} does not resolve to an accepted limitation`)
    }
    if (frontier.key !== `${frontier.node_id}:${frontier.limitation_id}`) {
      fail(`frontier ${frontier.key} does not match its owner and limitation`)
    }
    nonnegativeInteger(frontier.attempts, `frontier ${frontier.key}.attempts`)
  }

  const pending = validated.pending_candidate
  if (pending !== undefined) {
    if (validated.nodes.some(node => node.paper_id === pending.node.paper_id)) {
      fail(`pending paper ${pending.node.paper_id} is already accepted`)
    }
    if (pending.scope === 'root') {
      if (validated.nodes.length > 0 || pending.frontier_key !== undefined || pending.edge !== undefined) {
        fail('a pending root candidate cannot have accepted ancestry or an edge')
      }
    } else {
      if (pending.frontier_key === undefined || pending.edge === undefined) {
        fail('a pending child candidate requires its frontier and proposed edge')
      }
      const frontier = frontierByKey(validated, pending.frontier_key)
      if (frontier.status !== 'pending') fail(`pending child frontier ${frontier.key} is already terminal`)
    }
    validateProspective(validated, pending.node, pending.edge, catalog)
  }

  if (validated.status === 'completed') {
    if (pending !== undefined) fail('a completed workflow cannot retain a pending candidate')
    validateStrategyTree(treeOf(validated), catalog)
    enforceAcceptedWorkflowPolicies(validated, catalog)
  } else if (validated.status === 'failed') {
    nonempty(validated.failure ?? '', 'workflow.failure')
  } else {
    const next = nextStage1Action(validated)
    if (validated.status === 'ready_to_finalize' && next.kind !== 'finalize') {
      fail(`ready workflow produced next action ${next.kind}`)
    }
    if (validated.status === 'active' && next.kind === 'finalize') {
      fail('active workflow has no remaining action and must be ready_to_finalize')
    }
  }
  return validated
}
