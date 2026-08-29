import { describe, expect, it } from 'vitest'
import {
  EvidenceCatalog,
  StrategyTreeAssembler,
  SupraMasDomainError,
  validateStrategyTree,
  type PaperNode,
  type StrategyTree,
} from '../src/index.ts'

function catalog(): EvidenceCatalog {
  const evidence = new EvidenceCatalog('demo')
  evidence.storePaper({
    paper_id: 'paper-1',
    paper_title: 'BZO pinning in REBCO',
    local_path: 'runs/demo/papers/paper-1.json',
    source_type: 'experimental',
  })
  evidence.addChunk('paper-1', {
    chunk_id: 'paper-1-p2-performance',
    page: 2,
    text: 'The BZO film retained high in-field Jc at 77 K and 5 T.',
  })
  return evidence
}

function rootNode(): PaperNode {
  return {
    node_id: 'N0',
    level: 0,
    parent_id: null,
    paper_id: 'paper-1',
    paper_title: 'BZO pinning in REBCO',
    year: 2024,
    doi: '10.1000/example',
    url: 'https://example.test/paper-1',
    source_type: 'experimental',
    notes: [],
    strategy_records: [{
      record_id: 'R1',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Add BZO artificial pinning centers.',
      tuning_effect: 'Improves in-field Jc at 77 K and 5 T.',
      evidence: {
        chunk_id: 'paper-1-p2-performance',
        page: 2,
        evidence_text: 'retained high in-field Jc at 77 K and 5 T',
      },
      confidence: 0.95,
    }],
    limitation_records: [{
      limitation_id: 'L1',
      limitation: 'Only one BZO loading was tested.',
      expectation: 'Compare multiple BZO loadings.',
      related_record_ids: ['R1'],
      evidence: {
        chunk_id: 'paper-1-p2-performance',
        page: 2,
        evidence_text: 'BZO film',
      },
      confidence: 0.8,
    }],
  }
}

function rootTree(): StrategyTree {
  return {
    job_id: 'demo',
    research_topic: 'BZO pinning in REBCO',
    material_scope: ['REBCO'],
    target_property: ['in-field Jc'],
    nodes: [rootNode()],
    edges: [],
  }
}

function domainCode(action: () => unknown): string {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(SupraMasDomainError)
    return (error as SupraMasDomainError).code
  }
  throw new Error('expected SupraMasDomainError')
}

describe('SupraMAS Stage 1 domain contract', () => {
  it('accepts the current Stage 1 wire shape when every evidence quote resolves locally', () => {
    const tree = rootTree()
    const validated = validateStrategyTree(tree, catalog())

    expect(validated).toEqual(tree)
    expect(validated).not.toBe(tree)
    expect(validated.nodes[0]).not.toBe(tree.nodes[0])
  })

  it('rejects evidence that is absent from or disagrees with its local chunk', () => {
    const missing = rootTree()
    missing.nodes[0].strategy_records[0].evidence.chunk_id = 'missing'
    expect(domainCode(() => validateStrategyTree(missing, catalog()))).toBe('SUPRAMAS_EVIDENCE_MISSING')

    const mismatch = rootTree()
    mismatch.nodes[0].strategy_records[0].evidence.evidence_text = 'invented measurement'
    expect(domainCode(() => validateStrategyTree(mismatch, catalog()))).toBe('SUPRAMAS_EVIDENCE_MISMATCH')
  })

  it('enforces one node per paper and unique node identities', () => {
    const duplicate = rootTree()
    duplicate.nodes.push({ ...rootNode(), node_id: 'N1', level: 1, parent_id: 'N0' })
    expect(domainCode(() => validateStrategyTree(duplicate, catalog()))).toBe('SUPRAMAS_DUPLICATE_ID')

    duplicate.nodes[1].paper_id = 'paper-2'
    duplicate.nodes[1].node_id = 'N0'
    expect(domainCode(() => validateStrategyTree(duplicate, catalog()))).toBe('SUPRAMAS_DUPLICATE_ID')
  })

  it('rejects record references and edge claims that do not match their source records', () => {
    const brokenRecord = rootTree()
    brokenRecord.nodes[0].limitation_records[0].related_record_ids = ['missing-record']
    expect(domainCode(() => validateStrategyTree(brokenRecord, catalog()))).toBe('SUPRAMAS_BROKEN_REFERENCE')

    const evidence = catalog()
    evidence.storePaper({
      paper_id: 'paper-2',
      paper_title: 'Follow-up BZO loading study',
      local_path: 'runs/demo/papers/paper-2.json',
      source_type: 'experimental',
    })
    evidence.addChunk('paper-2', { chunk_id: 'paper-2-p1', page: 1, text: 'Multiple BZO loadings were compared.' })
    const tree = rootTree()
    const child = rootNode()
    child.node_id = 'N1'
    child.level = 1
    child.parent_id = 'N0'
    child.paper_id = 'paper-2'
    child.paper_title = 'Follow-up BZO loading study'
    child.strategy_records[0].record_id = 'R2'
    child.strategy_records[0].tuning_effect = 'Multiple BZO loadings were compared.'
    child.strategy_records[0].evidence = { chunk_id: 'paper-2-p1', page: 1, evidence_text: 'Multiple BZO loadings' }
    child.limitation_records = []
    tree.nodes.push(child)
    tree.edges.push({
      edge_id: 'E1',
      parent_node_id: 'N0',
      parent_limitation_id: 'L1',
      parent_expectation: 'a different expectation',
      child_node_id: 'N1',
      child_record_id: 'R2',
      child_tuning_effect: 'Multiple BZO loadings were compared.',
      edge_type: 'direct',
      edge_rationale: 'The follow-up varies the requested loading.',
      confidence: 0.9,
    })
    expect(domainCode(() => validateStrategyTree(tree, evidence))).toBe('SUPRAMAS_BROKEN_REFERENCE')
  })

  it('assembles only trees that pass the same final validation boundary', () => {
    const evidence = catalog()
    const assembler = new StrategyTreeAssembler({
      job_id: 'demo',
      research_topic: 'BZO pinning in REBCO',
      material_scope: ['REBCO'],
      target_property: ['in-field Jc'],
    }, evidence)

    assembler.addNode(rootNode())

    expect(assembler.build()).toEqual(rootTree())
    expect(domainCode(() => assembler.addNode(rootNode()))).toBe('SUPRAMAS_DUPLICATE_ID')
  })
})
