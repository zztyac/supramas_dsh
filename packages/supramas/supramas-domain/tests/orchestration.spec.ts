import { describe, expect, it } from 'vitest'
import {
  EvidenceCatalog,
  SupraMasDomainError,
  createStage1Workflow,
  finalizeStage1Workflow,
  nextStage1Action,
  submitStage1Builder,
  submitStage1Review,
  validateStage1Workflow,
  type PaperNodeDraft,
  type ProposedStrategyEdge,
  type Stage1ReviewSubmission,
  type Stage1Workflow,
  type Stage1WorkflowConfig,
} from '../src/index.ts'

function evidence(): EvidenceCatalog {
  const catalog = new EvidenceCatalog('demo')
  catalog.storePaper({
    paper_id: 'paper-1',
    paper_title: 'Root paper',
    local_path: 'runs/demo/papers/paper-1.json',
    source_type: 'experimental',
  })
  catalog.addChunk('paper-1', {
    chunk_id: 'paper-1-c1',
    page: 1,
    text: 'BZO additions improve in-field Jc, but only one loading was measured.',
  })
  catalog.storePaper({
    paper_id: 'paper-2',
    paper_title: 'Child paper',
    local_path: 'runs/demo/papers/paper-2.json',
    source_type: 'experimental',
  })
  catalog.addChunk('paper-2', {
    chunk_id: 'paper-2-c1',
    page: 2,
    text: 'A loading series preserved epitaxy and improved angular pinning, while chemistry remained unresolved.',
  })
  catalog.storePaper({
    paper_id: 'paper-3',
    paper_title: 'Alternative paper',
    local_path: 'runs/demo/papers/paper-3.json',
    source_type: 'experimental',
  })
  catalog.addChunk('paper-3', {
    chunk_id: 'paper-3-c1',
    page: 3,
    text: 'An alternative APC study reports a different composition response and an unresolved mechanism.',
  })
  return catalog
}

function rootDraft(effect = 'BZO additions improve in-field Jc.'): PaperNodeDraft {
  return {
    paper_id: 'paper-1',
    paper_title: 'Root paper',
    source_type: 'experimental',
    strategy_records: [{
      record_id: 'R1',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Add BZO artificial pinning centers.',
      tuning_effect: effect,
      evidence: { chunk_id: 'paper-1-c1', page: 1, evidence_text: 'BZO additions improve in-field Jc' },
      confidence: 0.9,
    }],
    limitation_records: [{
      limitation_id: 'L1',
      limitation: 'Only one loading was measured.',
      expectation: 'Compare multiple BZO loadings while preserving epitaxy.',
      related_record_ids: ['R1'],
      evidence: { chunk_id: 'paper-1-c1', page: 1, evidence_text: 'only one loading was measured' },
      confidence: 0.9,
    }],
  }
}

function childDraft(): PaperNodeDraft {
  return {
    paper_id: 'paper-2',
    paper_title: 'Child paper',
    source_type: 'experimental',
    strategy_records: [{
      record_id: 'R2',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Compare a BZO loading series.',
      tuning_effect: 'A loading series preserved epitaxy and improved angular pinning.',
      evidence: { chunk_id: 'paper-2-c1', page: 2, evidence_text: 'loading series preserved epitaxy and improved angular pinning' },
      confidence: 0.9,
    }],
    limitation_records: [{
      limitation_id: 'L2',
      limitation: 'The resulting chemistry remained unresolved.',
      expectation: 'Resolve APC chemistry while retaining the measured pinning response.',
      evidence: { chunk_id: 'paper-2-c1', page: 2, evidence_text: 'chemistry remained unresolved' },
      confidence: 0.8,
    }],
  }
}

function alternativeDraft(): PaperNodeDraft {
  return {
    paper_id: 'paper-3',
    paper_title: 'Alternative paper',
    source_type: 'experimental',
    strategy_records: [{
      record_id: 'R3',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Compare an alternative APC composition.',
      tuning_effect: 'The alternative composition changes the measured response.',
      evidence: { chunk_id: 'paper-3-c1', page: 3, evidence_text: 'alternative APC study' },
      confidence: 0.7,
    }],
    limitation_records: [{
      limitation_id: 'L3',
      limitation: 'The mechanism remained unresolved.',
      expectation: 'Resolve the alternative APC mechanism.',
      evidence: { chunk_id: 'paper-3-c1', page: 3, evidence_text: 'unresolved mechanism' },
      confidence: 0.7,
    }],
  }
}

function childEdge(overrides: Partial<ProposedStrategyEdge> = {}): ProposedStrategyEdge {
  return {
    parent_limitation_id: 'L1',
    child_record_id: 'R2',
    child_tuning_effect: 'A loading series preserved epitaxy and improved angular pinning.',
    edge_type: 'direct',
    edge_rationale: 'The child directly compares the requested loading variable.',
    confidence: 0.9,
    ...overrides,
  }
}

function review(decision: Stage1ReviewSubmission['decision'], summary = `${decision} review`): Stage1ReviewSubmission {
  return {
    decision,
    summary,
    critical_issues: decision === 'revise'
      ? [{ target_id: 'R1', issue: 'Narrow the effect wording.', required_action: 'revise' }]
      : [],
    edge_issues: [],
    acceptance_conditions: decision === 'revise' ? ['Use wording supported by the local chunk.'] : [],
  }
}

function started(): Stage1Workflow {
  return createStage1Workflow({
    jobId: 'demo',
    researchTopic: 'REBCO flux pinning',
    materialScope: ['REBCO'],
    targetProperty: ['in-field Jc'],
    maxDepth: 1,
    maxRootAttempts: 2,
    maxChildAttemptsPerLimitation: 2,
  })
}

function configured(overrides: Partial<Stage1WorkflowConfig> = {}): Stage1Workflow {
  return createStage1Workflow({
    jobId: 'demo',
    researchTopic: 'REBCO flux pinning',
    maxDepth: 1,
    maxRootAttempts: 2,
    maxChildAttemptsPerLimitation: 2,
    ...overrides,
  })
}

function acceptedRoot(catalog: EvidenceCatalog, workflow = configured(), draft = rootDraft()): Stage1Workflow {
  const built = submitStage1Builder(workflow, { paper_node: draft, edge: null, notes: [] }, catalog)
  return submitStage1Review(built, review('accept'), catalog)
}

describe('Stage 1 builder/reviewer orchestration', () => {
  it('enforces revise-before-accept and recursively closes child frontiers', () => {
    const catalog = evidence()
    const initial = started()
    expect(nextStage1Action(initial)).toMatchObject({ kind: 'build_root', attempt_index: 1 })

    const awaitingReview = submitStage1Builder(initial, { paper_node: rootDraft(), edge: null, notes: [] }, catalog)
    expect(initial.nodes).toEqual([])
    expect(nextStage1Action(awaitingReview)).toMatchObject({ kind: 'review_candidate', scope: 'root' })

    const awaitingRevision = submitStage1Review(awaitingReview, review('revise'), catalog)
    expect(nextStage1Action(awaitingRevision)).toMatchObject({
      kind: 'revise_candidate',
      attempt_index: 1,
      acceptance_conditions: ['Use wording supported by the local chunk.'],
    })
    expect(() => submitStage1Review(awaitingRevision, review('accept'), catalog)).toThrow(SupraMasDomainError)

    const revised = submitStage1Builder(
      awaitingRevision,
      { paper_node: rootDraft('BZO additions improve in-field Jc.'), edge: null, notes: ['revised'] },
      catalog,
    )
    const rootAccepted = submitStage1Review(revised, review('accept'), catalog)
    expect(rootAccepted.nodes).toHaveLength(1)
    expect(rootAccepted.frontiers).toMatchObject([{ node_id: 'N0', limitation_id: 'L1', status: 'pending' }])
    expect(nextStage1Action(rootAccepted)).toMatchObject({
      kind: 'build_child',
      parent_node_id: 'N0',
      parent_limitation_id: 'L1',
      attempt_index: 1,
    })

    const childBuilt = submitStage1Builder(rootAccepted, {
      paper_node: childDraft(),
      edge: {
        parent_limitation_id: 'L1',
        child_record_id: 'R2',
        child_tuning_effect: 'A loading series preserved epitaxy and improved angular pinning.',
        edge_type: 'direct',
        edge_rationale: 'The child directly compares the requested loading variable.',
        confidence: 0.9,
      },
      notes: [],
    }, catalog)
    const childAccepted = submitStage1Review(childBuilt, review('accept'), catalog)
    expect(childAccepted.nodes.map(node => node.node_id)).toEqual(['N0', 'N1'])
    expect(childAccepted.edges).toMatchObject([{
      edge_id: 'E0',
      parent_node_id: 'N0',
      child_node_id: 'N1',
      parent_expectation: 'Compare multiple BZO loadings while preserving epitaxy.',
    }])
    expect(childAccepted.frontiers).toMatchObject([
      { node_id: 'N0', limitation_id: 'L1', status: 'accepted_edge' },
      { node_id: 'N1', limitation_id: 'L2', status: 'depth_limit_reached' },
    ])
    expect(nextStage1Action(childAccepted)).toEqual({ kind: 'finalize' })

    const completed = finalizeStage1Workflow(childAccepted, catalog)
    expect(completed.workflow.status).toBe('completed')
    expect(completed.tree.nodes).toHaveLength(2)
    expect(nextStage1Action(completed.workflow)).toMatchObject({ kind: 'completed' })
  })

  it('preserves the Stage 1 task policy needed to reproduce input_task.yaml', () => {
    const workflow = createStage1Workflow({
      jobId: 'task-policy',
      researchTopic: 'BZO pinning in REBCO',
      materialScope: ['REBCO coated conductors'],
      targetProperty: ['in-field Jc'],
      evidencePolicy: 'Use full-text local evidence only.',
      include: ['BZO artificial pinning centers'],
      exclude: ['abstract-only evidence', 'Stage 2 idea generation'],
      maxDepth: 3,
      maxRootAttempts: 2,
      maxChildAttemptsPerLimitation: 3,
      maxBranchPerNode: null,
      targetChildNodes: null,
    })

    expect(workflow.config).toMatchObject({
      evidencePolicy: 'Use full-text local evidence only.',
      include: ['BZO artificial pinning centers'],
      exclude: ['abstract-only evidence', 'Stage 2 idea generation'],
    })
    expect(validateStage1Workflow(workflow, new EvidenceCatalog('task-policy')).config)
      .toEqual(workflow.config)
  })

  it('uses real empty builder attempts before exhausting a frontier budget', () => {
    const catalog = evidence()
    const rootBuilt = submitStage1Builder(started(), { paper_node: rootDraft(), edge: null, notes: [] }, catalog)
    const rootAccepted = submitStage1Review(rootBuilt, review('accept'), catalog)

    const firstMiss = submitStage1Builder(rootAccepted, {
      paper_node: null,
      edge: null,
      reason: 'No supported paper in the first query.',
      notes: [],
    }, catalog)
    expect(nextStage1Action(firstMiss)).toMatchObject({ kind: 'build_child', attempt_index: 2 })

    const exhausted = submitStage1Builder(firstMiss, {
      paper_node: null,
      edge: null,
      reason: 'No supported paper after reviewer-guided narrowing.',
      notes: [],
    }, catalog)
    expect(exhausted.frontiers).toMatchObject([{
      status: 'no_supported_child_after_attempt_budget',
      attempts: 2,
    }])
    expect(nextStage1Action(exhausted)).toEqual({ kind: 'finalize' })
  })

  it('rejects skipped review, invalid child edges, duplicate ancestor papers, and early finalization', () => {
    const catalog = evidence()
    const workflow = started()
    expect(() => submitStage1Review(workflow, review('accept'), catalog)).toThrow(SupraMasDomainError)
    expect(() => finalizeStage1Workflow(workflow, catalog)).toThrow(SupraMasDomainError)

    const rootBuilt = submitStage1Builder(workflow, { paper_node: rootDraft(), edge: null, notes: [] }, catalog)
    const rootAccepted = submitStage1Review(rootBuilt, review('accept'), catalog)
    expect(() => submitStage1Builder(rootAccepted, {
      paper_node: childDraft(),
      edge: {
        parent_limitation_id: 'wrong',
        edge_type: 'direct',
        edge_rationale: 'Wrong frontier.',
        confidence: 0.5,
      },
      notes: [],
    }, catalog)).toThrow(SupraMasDomainError)
    expect(() => submitStage1Builder(rootAccepted, {
      paper_node: rootDraft(),
      edge: {
        parent_limitation_id: 'L1',
        edge_type: 'direct',
        edge_rationale: 'Duplicate ancestor.',
        confidence: 0.5,
      },
      notes: [],
    }, catalog)).toThrow(SupraMasDomainError)
  })

  it('validates and normalizes every workflow configuration boundary', () => {
    const normalized = createStage1Workflow({
      jobId: 'demo.config',
      researchTopic: '  REBCO flux pinning  ',
      materialScope: [' REBCO '],
      targetProperty: [' Jc '],
      maxDepth: 0,
      maxRootAttempts: 1,
      maxChildAttemptsPerLimitation: 1,
      maxBranchPerNode: null,
      targetChildNodes: null,
    })
    expect(normalized.config).toMatchObject({
      researchTopic: 'REBCO flux pinning',
      materialScope: ['REBCO'],
      targetProperty: ['Jc'],
      maxBranchPerNode: null,
      targetChildNodes: null,
    })
    const invalid: Stage1WorkflowConfig[] = [
      { ...normalized.config, jobId: '/bad' },
      { ...normalized.config, researchTopic: ' ' },
      { ...normalized.config, maxDepth: -1 },
      { ...normalized.config, maxRootAttempts: 0 },
      { ...normalized.config, maxChildAttemptsPerLimitation: 0 },
      { ...normalized.config, materialScope: [''] },
      { ...normalized.config, targetProperty: [''] },
      { ...normalized.config, maxBranchPerNode: 0 },
      { ...normalized.config, targetChildNodes: 0 },
    ]
    for (const config of invalid) expect(() => createStage1Workflow(config)).toThrow(SupraMasDomainError)
  })

  it('records root rejection and exhaustion with stable failed actions', () => {
    const catalog = evidence()
    const firstMiss = submitStage1Builder(configured(), {
      paper_node: null, edge: null, notes: [],
    }, catalog)
    expect(firstMiss.builder_attempts).toMatchObject([{
      scope: 'root', status: 'no_candidate', reason: 'builder returned no candidate',
    }])
    expect(nextStage1Action(firstMiss)).toMatchObject({ kind: 'build_root', attempt_index: 2 })

    const workflow = configured({ maxRootAttempts: 1 })
    const built = submitStage1Builder(workflow, { paper_node: rootDraft(), edge: null, notes: [] }, catalog)
    expect(() => submitStage1Review(built, { ...review('accept'), decision: 'invalid' as never }, catalog))
      .toThrow(SupraMasDomainError)
    expect(() => submitStage1Review(built, { ...review('accept'), summary: ' ' }, catalog))
      .toThrow(SupraMasDomainError)
    expect(() => submitStage1Review(built, {
      ...review('accept'),
      critical_issues: [{ target_id: '', issue: '', required_action: 'invalid' as never }],
    }, catalog)).toThrow(SupraMasDomainError)
    expect(() => submitStage1Review(built, {
      ...review('revise'), acceptance_conditions: [''],
    }, catalog)).toThrow(SupraMasDomainError)
    expect(() => submitStage1Review({ ...built, builder_attempts: [] }, review('accept'), catalog))
      .toThrow(SupraMasDomainError)

    const rejected = submitStage1Review(built, {
      ...review('reject'),
      edge_issues: [{ target_id: 'L1', issue: 'Unsupported edge.', required_action: 'remove' }],
    }, catalog)
    expect(nextStage1Action(rejected)).toEqual({
      kind: 'failed', reason: 'no_supported_root_after_attempt_budget',
    })
    const rejectedWithoutFailure = structuredClone(rejected)
    delete rejectedWithoutFailure.failure
    expect(nextStage1Action(rejectedWithoutFailure))
      .toEqual({ kind: 'failed', reason: 'workflow_failed' })
    expect(() => submitStage1Builder(rejected, {
      paper_node: null, edge: null, notes: [],
    }, catalog)).toThrow(SupraMasDomainError)
  })

  it('supports child revision and rejects paper replacement or missing revised edges', () => {
    const catalog = evidence()
    const root = acceptedRoot(catalog)
    const built = submitStage1Builder(root, {
      paper_node: childDraft(), edge: childEdge(), notes: [],
    }, catalog)
    const revise = submitStage1Review(built, {
      ...review('revise'),
      critical_issues: [],
      edge_issues: [{ target_id: 'E0', issue: 'Clarify the bridge.', required_action: 'revise' }],
    }, catalog)
    expect(() => submitStage1Builder(revise, {
      paper_node: null, edge: null, notes: [],
    }, catalog)).toThrow(SupraMasDomainError)
    expect(() => submitStage1Builder(revise, {
      paper_node: alternativeDraft(), edge: childEdge(), notes: [],
    }, catalog)).toThrow(SupraMasDomainError)
    expect(() => submitStage1Builder(revise, {
      paper_node: childDraft(), edge: null, notes: [],
    }, catalog)).toThrow(SupraMasDomainError)

    const rebuilt = submitStage1Builder(revise, {
      paper_node: childDraft(),
      edge: childEdge({ edge_rationale: 'A clarified direct loading comparison.' }),
      notes: [],
    }, catalog)
    expect(nextStage1Action(rebuilt)).toMatchObject({
      kind: 'review_candidate', scope: 'child', revision_round: 1,
    })
    const accepted = submitStage1Review(rebuilt, review('accept'), catalog)
    expect(accepted.edges).toMatchObject([{
      edge_id: 'E0', edge_rationale: 'A clarified direct loading comparison.',
    }])
  })

  it('counts a child candidate without a supported edge as a real exhausted attempt', () => {
    const catalog = evidence()
    const root = acceptedRoot(catalog, configured({ maxChildAttemptsPerLimitation: 1 }))
    const exhausted = submitStage1Builder(root, {
      paper_node: childDraft(), edge: null, notes: [],
    }, catalog)
    expect(exhausted.builder_attempts).toMatchObject([
      { scope: 'root', status: 'accepted' },
      { scope: 'child', status: 'no_edge_proposed', reason: 'builder returned no proposed edge' },
    ])
    expect(nextStage1Action(exhausted)).toEqual({ kind: 'finalize' })
  })

  it('applies target and parent-width caps without overwriting terminal frontiers', () => {
    const catalog = evidence()
    const targetedRoot = acceptedRoot(catalog, configured({ maxDepth: 2, targetChildNodes: 1 }))
    const targetedChild = submitStage1Builder(targetedRoot, {
      paper_node: childDraft(), edge: childEdge(), notes: [],
    }, catalog)
    const targeted = submitStage1Review(targetedChild, review('accept'), catalog)
    expect(targeted.frontiers).toMatchObject([
      { status: 'accepted_edge' },
      { status: 'target_child_cap_reached' },
    ])

    const twoLimits = rootDraft()
    twoLimits.limitation_records.push({
      limitation_id: 'L1b',
      limitation: 'The angular response was not compared.',
      expectation: 'Compare angular response in a second study.',
      evidence: { chunk_id: 'paper-1-c1', page: 1, evidence_text: 'only one loading was measured' },
      confidence: 0.7,
    })
    const widthRoot = acceptedRoot(catalog, configured({ maxDepth: 1, maxBranchPerNode: 1 }), twoLimits)
    const minimalChildEdge = childEdge()
    delete minimalChildEdge.child_record_id
    delete minimalChildEdge.child_tuning_effect
    const widthChild = submitStage1Builder(widthRoot, {
      paper_node: childDraft(),
      edge: minimalChildEdge,
      notes: [],
    }, catalog)
    const widthCapped = submitStage1Review(widthChild, review('accept'), catalog)
    expect(widthCapped.frontiers).toMatchObject([
      { limitation_id: 'L1', status: 'accepted_edge' },
      { limitation_id: 'L1b', status: 'width_cap_reached' },
      { limitation_id: 'L2', status: 'depth_limit_reached' },
    ])
    expect(nextStage1Action(widthCapped)).toEqual({ kind: 'finalize' })
  })

  it('rejects corrupted durable workflow ownership, topology, frontiers, and phases', () => {
    const catalog = evidence()
    const empty = configured()
    const rootPending = submitStage1Builder(empty, { paper_node: rootDraft(), edge: null, notes: [] }, catalog)
    const root = submitStage1Review(rootPending, review('accept'), catalog)
    const childPending = submitStage1Builder(root, {
      paper_node: childDraft(), edge: childEdge(), notes: [],
    }, catalog)
    const completedBase = acceptedRoot(catalog, configured({ maxDepth: 0 }))
    const completed = finalizeStage1Workflow(completedBase, catalog).workflow

    expect(validateStage1Workflow(empty, catalog)).not.toBe(empty)
    expect(validateStage1Workflow(rootPending, catalog)).toMatchObject({
      pending_candidate: { scope: 'root' },
    })
    expect(validateStage1Workflow(childPending, catalog)).toMatchObject({
      pending_candidate: { scope: 'child' },
    })
    expect(validateStage1Workflow(completed, catalog)).toMatchObject({ status: 'completed' })
    expect(validateStage1Workflow({ ...root, status: 'failed', failure: 'operator-stopped' }, catalog))
      .toMatchObject({ status: 'failed' })

    const firstFrontier = root.frontiers[0]
    const rootNode = root.nodes[0]
    const pendingRoot = rootPending.pending_candidate
    const pendingChild = childPending.pending_candidate
    if (firstFrontier === undefined || rootNode === undefined
      || pendingRoot === undefined || pendingChild === undefined || pendingChild.edge === undefined) {
      throw new Error('expected complete workflow fixtures')
    }
    const childPendingWithoutFrontier = structuredClone(pendingChild)
    delete childPendingWithoutFrontier.frontier_key
    const childPendingWithoutEdge = structuredClone(pendingChild)
    delete childPendingWithoutEdge.edge
    const corruptions: Stage1Workflow[] = [
      { ...empty, config: { ...empty.config, jobId: 'other' } },
      { ...empty, edges: [{} as never] },
      { ...root, frontiers: [...root.frontiers, structuredClone(firstFrontier)] },
      { ...root, frontiers: [{ ...firstFrontier, node_id: 'missing' }] },
      { ...root, frontiers: [{ ...firstFrontier, limitation_id: 'missing' }] },
      { ...root, frontiers: [{ ...firstFrontier, key: 'wrong' }] },
      { ...root, frontiers: [{ ...firstFrontier, attempts: -1 }] },
      { ...childPending, pending_candidate: { ...pendingChild, node: rootNode } },
      { ...rootPending, nodes: root.nodes },
      { ...rootPending, pending_candidate: { ...pendingRoot, frontier_key: 'N0:L1' } },
      { ...rootPending, pending_candidate: { ...pendingRoot, edge: pendingChild.edge } },
      { ...childPending, pending_candidate: childPendingWithoutFrontier },
      { ...childPending, pending_candidate: { ...pendingChild, frontier_key: 'missing' } },
      { ...childPending, pending_candidate: childPendingWithoutEdge },
      { ...childPending, frontiers: [{ ...firstFrontier, status: 'accepted_edge' }] },
      { ...rootPending, status: 'completed' },
      { ...root, status: 'failed' },
      { ...root, status: 'ready_to_finalize' },
      { ...completedBase, status: 'active' },
    ]
    for (const workflow of corruptions) {
      expect(() => validateStage1Workflow(workflow, catalog)).toThrow(SupraMasDomainError)
    }
    expect(() => nextStage1Action({
      ...root,
      frontiers: [{ ...firstFrontier, limitation_id: 'missing' }],
    })).toThrow(SupraMasDomainError)
  })
})
