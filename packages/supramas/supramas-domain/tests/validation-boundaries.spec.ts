import { describe, expect, it } from 'vitest'
import {
  EvidenceCatalog,
  StrategyTreeAssembler,
  SupraMasDomainError,
  validateStrategyTree,
  type PaperNode,
  type StrategyEdge,
  type StrategyTree,
  type SupraMasDomainErrorCode,
} from '../src/index.ts'

type UnknownObject = Record<string, unknown>

function fixtureAt<T>(values: readonly T[], index: number, label: string): T {
  const value = values[index]
  if (value === undefined) throw new Error(`missing ${label} fixture at index ${index}`)
  return value
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
    notes: ['root'],
    strategy_records: [{
      record_id: 'R1',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Add BZO artificial pinning centers.',
      tuning_effect: 'Improves in-field Jc.',
      evidence: { chunk_id: 'paper-1-p2', page: 2, evidence_text: 'high in-field Jc' },
      confidence: 0.95,
    }],
    limitation_records: [{
      limitation_id: 'L1',
      limitation: 'Only one loading was tested.',
      expectation: 'Compare multiple BZO loadings.',
      related_record_ids: ['R1'],
      evidence: { chunk_id: 'paper-1-p2', page: 2, evidence_text: 'BZO film' },
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

function catalog(): EvidenceCatalog {
  const evidence = new EvidenceCatalog('demo')
  evidence.storePaper({
    paper_id: 'paper-1',
    paper_title: 'BZO pinning in REBCO',
    local_path: 'runs/demo/papers/paper-1.json',
    source_type: 'experimental',
  })
  evidence.addChunk('paper-1', {
    chunk_id: 'paper-1-p2',
    page: 2,
    text: 'The BZO film retained high in-field Jc.',
  })
  return evidence
}

function connected(): { evidence: EvidenceCatalog; tree: StrategyTree } {
  const evidence = catalog()
  evidence.storePaper({
    paper_id: 'paper-2',
    paper_title: 'BZO loading series',
    local_path: 'runs/demo/papers/paper-2.json',
    source_type: 'experimental',
  })
  evidence.addChunk('paper-2', {
    chunk_id: 'paper-2-p1',
    page: 1,
    text: 'Multiple BZO loadings improved the measured response.',
  })
  const child: PaperNode = {
    node_id: 'N1',
    level: 1,
    parent_id: 'N0',
    paper_id: 'paper-2',
    paper_title: 'BZO loading series',
    strategy_records: [{
      record_id: 'R2',
      tuning_dimension: 'Composition tuning',
      tuning_strategy: 'Compare multiple BZO loadings.',
      tuning_effect: 'Multiple BZO loadings improved the measured response.',
      evidence: { chunk_id: 'paper-2-p1', evidence_text: 'Multiple BZO loadings' },
      confidence: 1,
    }],
    limitation_records: [],
  }
  const edge: StrategyEdge = {
    edge_id: 'E1',
    parent_node_id: 'N0',
    parent_limitation_id: 'L1',
    child_node_id: 'N1',
    child_record_id: 'R2',
    parent_expectation: 'Compare multiple BZO loadings.',
    child_tuning_effect: 'Multiple BZO loadings improved the measured response.',
    edge_type: 'direct',
    edge_rationale: 'The child varies the requested loading.',
    confidence: 0,
  }
  const tree = rootTree()
  tree.nodes.push(child)
  tree.edges.push(edge)
  return { evidence, tree }
}

function expectCode(action: () => unknown, code: SupraMasDomainErrorCode): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(SupraMasDomainError)
    expect((error as SupraMasDomainError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

function changed(mutator: (tree: UnknownObject) => void): unknown {
  const tree = structuredClone(rootTree()) as unknown as UnknownObject
  mutator(tree)
  return tree
}

function firstNode(tree: UnknownObject): UnknownObject {
  return fixtureAt(tree.nodes as UnknownObject[], 0, 'node')
}

function firstStrategy(tree: UnknownObject): UnknownObject {
  return fixtureAt(firstNode(tree).strategy_records as UnknownObject[], 0, 'strategy record')
}

function firstLimitation(tree: UnknownObject): UnknownObject {
  return fixtureAt(firstNode(tree).limitation_records as UnknownObject[], 0, 'limitation record')
}

describe('Stage 1 parser boundaries', () => {
  it('accepts omitted and explicitly null optional fields', () => {
    const evidence = new EvidenceCatalog('minimal')
    evidence.storePaper({
      paper_id: 'p',
      paper_title: 'Minimal paper',
      local_path: 'runs/minimal/papers/p.json',
      source_type: 'review',
    })
    evidence.addChunk('p', { chunk_id: 'c', page: null, text: 'literal evidence' })
    const tree = {
      job_id: 'minimal',
      research_topic: 'Minimal contract',
      nodes: [{
        node_id: 'n',
        level: 0,
        paper_id: 'p',
        paper_title: 'Minimal paper',
        year: null,
        doi: null,
        url: null,
        strategy_records: [{
          record_id: 'r',
          tuning_dimension: 'Interface tuning',
          tuning_strategy: 'Tune an interface.',
          tuning_effect: 'Produces literal evidence.',
          evidence: { chunk_id: 'c', page: null, evidence_text: 'literal evidence' },
          confidence: 0,
        }],
        limitation_records: [{
          limitation_id: 'l',
          limitation: 'Scope is minimal.',
          expectation: 'Expand the scope.',
          evidence: { chunk_id: 'c', evidence_text: 'literal evidence' },
          confidence: 1,
        }],
      }],
      edges: [],
    }

    expect(validateStrategyTree(tree, evidence)).toEqual(tree)
    expect(evidence.getPaper('missing')).toBeUndefined()
  })

  it('rejects malformed top-level and node values', () => {
    const invalid: unknown[] = [
      null,
      [],
      changed((tree) => { tree.extra = true }),
      changed((tree) => { tree.job_id = '' }),
      changed((tree) => { tree.job_id = '/bad' }),
      changed((tree) => { tree.research_topic = 1 }),
      changed((tree) => { tree.research_topic = ' ' }),
      changed((tree) => { tree.material_scope = 'REBCO' }),
      changed((tree) => { tree.material_scope = [''] }),
      changed((tree) => { tree.target_property = [1] }),
      changed((tree) => { tree.nodes = 'bad' }),
      changed((tree) => { tree.nodes = [] }),
      changed((tree) => { tree.edges = {} }),
      changed((tree) => { (tree.nodes as unknown[])[0] = [] }),
      changed((tree) => { firstNode(tree).extra = true }),
      changed((tree) => { firstNode(tree).node_id = '/bad' }),
      changed((tree) => { firstNode(tree).level = 0.5 }),
      changed((tree) => { firstNode(tree).level = -1 }),
      changed((tree) => { firstNode(tree).parent_id = 1 }),
      changed((tree) => { firstNode(tree).paper_title = '' }),
      changed((tree) => { firstNode(tree).year = 2024.5 }),
      changed((tree) => { firstNode(tree).doi = 1 }),
      changed((tree) => { firstNode(tree).url = 1 }),
      changed((tree) => { firstNode(tree).source_type = 1 }),
      changed((tree) => { firstNode(tree).source_type = 'unsupported' }),
      changed((tree) => { firstNode(tree).notes = 'note' }),
      changed((tree) => { firstNode(tree).notes = [''] }),
      changed((tree) => { firstNode(tree).strategy_records = {} }),
      changed((tree) => { firstNode(tree).strategy_records = [] }),
      changed((tree) => { firstNode(tree).limitation_records = {} }),
    ]

    invalid.forEach((value, index) => {
      try {
        expectCode(() => validateStrategyTree(value, catalog()), 'SUPRAMAS_DOMAIN_INVALID')
      } catch (error) {
        throw new Error(`top-level invalid case ${index} was accepted`, { cause: error })
      }
    })
  })

  it('rejects malformed records, evidence, edges, and numeric boundaries', () => {
    const invalid: unknown[] = [
      changed((tree) => { (firstNode(tree).strategy_records as unknown[])[0] = null }),
      changed((tree) => { firstStrategy(tree).extra = true }),
      changed((tree) => { firstStrategy(tree).record_id = '' }),
      changed((tree) => { firstStrategy(tree).tuning_dimension = 'Unknown tuning' }),
      changed((tree) => { firstStrategy(tree).tuning_strategy = '' }),
      changed((tree) => { firstStrategy(tree).tuning_effect = 1 }),
      changed((tree) => { firstStrategy(tree).evidence = [] }),
      changed((tree) => { (firstStrategy(tree).evidence as UnknownObject).extra = true }),
      changed((tree) => { (firstStrategy(tree).evidence as UnknownObject).chunk_id = '/bad' }),
      changed((tree) => { (firstStrategy(tree).evidence as UnknownObject).page = 0 }),
      changed((tree) => { (firstStrategy(tree).evidence as UnknownObject).evidence_text = '' }),
      changed((tree) => { firstStrategy(tree).confidence = 'high' }),
      changed((tree) => { firstStrategy(tree).confidence = Number.NaN }),
      changed((tree) => { firstStrategy(tree).confidence = -0.1 }),
      changed((tree) => { firstStrategy(tree).confidence = 1.1 }),
      changed((tree) => { (firstNode(tree).limitation_records as unknown[])[0] = [] }),
      changed((tree) => { firstLimitation(tree).extra = true }),
      changed((tree) => { firstLimitation(tree).limitation_id = '' }),
      changed((tree) => { firstLimitation(tree).limitation = '' }),
      changed((tree) => { firstLimitation(tree).expectation = 1 }),
      changed((tree) => { firstLimitation(tree).related_record_ids = 'R1' }),
      changed((tree) => { firstLimitation(tree).related_record_ids = [1] }),
      changed((tree) => { firstLimitation(tree).confidence = 2 }),
      changed((tree) => { (tree.edges as unknown[]).push(null) }),
      changed((tree) => { (tree.edges as unknown[]).push({ extra: true }) }),
    ]

    for (const value of invalid) {
      expectCode(() => validateStrategyTree(value, catalog()), 'SUPRAMAS_DOMAIN_INVALID')
    }
  })
})

describe('EvidenceCatalog boundaries', () => {
  it('rejects malformed papers and canonical-path violations', () => {
    expectCode(() => new EvidenceCatalog('/bad'), 'SUPRAMAS_DOMAIN_INVALID')
    const evidence = new EvidenceCatalog('demo')
    const invalid: unknown[] = [
      null,
      [],
      { paper_id: 'p', paper_title: 'P', local_path: 'runs/demo/papers/p.json', source_type: 'review', extra: true },
      { paper_id: '', paper_title: 'P', local_path: 'runs/demo/papers/p.json', source_type: 'review' },
      { paper_id: '/bad', paper_title: 'P', local_path: 'runs/demo/papers/p.json', source_type: 'review' },
      { paper_id: 'p', paper_title: '', local_path: 'runs/demo/papers/p.json', source_type: 'review' },
      { paper_id: 'p', paper_title: 'P', local_path: 'wrong', source_type: 'review' },
      { paper_id: 'p', paper_title: 'P', local_path: 'runs/demo/papers/p.json', source_type: 'unsupported' },
    ]
    invalid.forEach((value, index) => {
      try {
        expectCode(
          () => evidence.storePaper(value as Parameters<EvidenceCatalog['storePaper']>[0]),
          'SUPRAMAS_DOMAIN_INVALID',
        )
      } catch (error) {
        throw new Error(`paper invalid case ${index} was accepted`, { cause: error })
      }
    })

    const stored = evidence.storePaper({
      paper_id: 'p', paper_title: 'P', local_path: 'runs/demo/papers/p.json', source_type: 'review',
    })
    stored.paper_title = 'detached'
    expect(evidence.getPaper('p')?.paper_title).toBe('P')
    expectCode(() => evidence.storePaper({
      paper_id: 'p', paper_title: 'P', local_path: 'runs/demo/papers/p.json', source_type: 'review',
    }), 'SUPRAMAS_DUPLICATE_ID')
  })

  it('rejects malformed, duplicate, missing, and mismatched chunks', () => {
    const evidence = new EvidenceCatalog('demo')
    evidence.storePaper({
      paper_id: 'p1', paper_title: 'P1', local_path: 'runs/demo/papers/p1.json', source_type: 'review',
    })
    evidence.storePaper({
      paper_id: 'p2', paper_title: 'P2', local_path: 'runs/demo/papers/p2.json', source_type: 'theory',
    })
    expectCode(() => evidence.addChunk('missing', { chunk_id: 'c', text: 'x' }), 'SUPRAMAS_EVIDENCE_MISSING')

    const invalid: unknown[] = [
      null,
      [],
      { chunk_id: 'c', text: 'x', extra: true },
      { chunk_id: '', text: 'x' },
      { chunk_id: '/bad', text: 'x' },
      { chunk_id: 'c', page: 0, text: 'x' },
      { chunk_id: 'c', page: 1.5, text: 'x' },
      { chunk_id: 'c', text: '' },
    ]
    for (const value of invalid) {
      expectCode(
        () => evidence.addChunk('p1', value as Parameters<EvidenceCatalog['addChunk']>[1]),
        'SUPRAMAS_DOMAIN_INVALID',
      )
    }

    const chunk = evidence.addChunk('p1', { chunk_id: 'c1', text: '  literal quote  ' })
    chunk.text = 'detached'
    evidence.addChunk('p1', { chunk_id: 'c2', page: null, text: 'second quote' })
    expect(fixtureAt(evidence.getPaper('p1')?.chunks ?? [], 0, 'evidence chunk').text).toContain('literal')
    expectCode(() => evidence.addChunk('p1', { chunk_id: 'c1', text: 'duplicate' }), 'SUPRAMAS_DUPLICATE_ID')
    expectCode(() => evidence.verify('missing', { chunk_id: 'c1', evidence_text: 'literal' }), 'SUPRAMAS_EVIDENCE_MISSING')
    expectCode(() => evidence.verify('p2', { chunk_id: 'c1', evidence_text: 'literal' }), 'SUPRAMAS_EVIDENCE_MISSING')
    expectCode(() => evidence.verify('p1', { chunk_id: 'c1', page: 2, evidence_text: 'literal' }), 'SUPRAMAS_EVIDENCE_MISMATCH')
    expectCode(() => evidence.verify('p1', { chunk_id: 'c1', evidence_text: 'absent' }), 'SUPRAMAS_EVIDENCE_MISMATCH')
    expect(evidence.verify('p1', { chunk_id: 'c1', evidence_text: ' literal quote ' }).verified).toBe(true)
    expect(evidence.verify('p1', { chunk_id: 'c2', page: null, evidence_text: 'second' }).verified).toBe(true)

    const internals = evidence as unknown as {
      papers: Map<string, { chunks: unknown[] }>
      chunkOwners: Map<string, string>
    }
    internals.papers.get('p1')?.chunks.pop()
    expectCode(() => evidence.verify('p1', { chunk_id: 'c2', evidence_text: 'second' }), 'SUPRAMAS_EVIDENCE_MISSING')
  })
})

describe('Strategy-tree relationship boundaries', () => {
  it('accepts connected trees and edges with omitted optional ids', () => {
    const { evidence, tree } = connected()
    expect(validateStrategyTree(tree, evidence)).toEqual(tree)

    const withoutClaims = structuredClone(tree)
    withoutClaims.edges[0] = {
      parent_node_id: 'N0',
      parent_limitation_id: 'L1',
      child_node_id: 'N1',
      parent_expectation: 'Compare multiple BZO loadings.',
      edge_type: 'transferable',
      edge_rationale: 'The child remains relevant.',
      confidence: 0.5,
    }
    expect(validateStrategyTree(withoutClaims, evidence)).toEqual(withoutClaims)
  })

  it('rejects broken tree roots, parents, papers, records, and limitations', () => {
    const cases: Array<() => { tree: StrategyTree; evidence: EvidenceCatalog }> = [
      () => ({ tree: { ...rootTree(), job_id: 'other' }, evidence: catalog() }),
      () => {
        const tree = rootTree(); tree.nodes.push({ ...rootNode(), node_id: 'N1' }); return { tree, evidence: catalog() }
      },
      () => {
        const tree = rootTree(); const node = fixtureAt(tree.nodes, 0, 'root node'); node.level = 1; node.parent_id = null; return { tree, evidence: catalog() }
      },
      () => {
        const tree = rootTree(); fixtureAt(tree.nodes, 0, 'root node').parent_id = 'N0'; return { tree, evidence: catalog() }
      },
      () => {
        const pair = connected(); fixtureAt(pair.tree.nodes, 1, 'child node').parent_id = 'missing'; return pair
      },
      () => {
        const pair = connected(); fixtureAt(pair.tree.nodes, 1, 'child node').parent_id = null; return pair
      },
      () => {
        const pair = connected(); fixtureAt(pair.tree.nodes, 1, 'child node').level = 2; return pair
      },
      () => {
        const tree = rootTree(); fixtureAt(tree.nodes, 0, 'root node').paper_id = 'missing'; return { tree, evidence: catalog() }
      },
      () => {
        const tree = rootTree(); fixtureAt(tree.nodes, 0, 'root node').paper_title = 'Wrong title'; return { tree, evidence: catalog() }
      },
      () => {
        const tree = rootTree()
        const node = fixtureAt(tree.nodes, 0, 'root node')
        node.strategy_records.push(structuredClone(fixtureAt(node.strategy_records, 0, 'strategy record')))
        return { tree, evidence: catalog() }
      },
      () => {
        const tree = rootTree()
        const node = fixtureAt(tree.nodes, 0, 'root node')
        node.limitation_records.push(structuredClone(fixtureAt(node.limitation_records, 0, 'limitation record')))
        return { tree, evidence: catalog() }
      },
      () => {
        const tree = rootTree(); const node = fixtureAt(tree.nodes, 0, 'root node'); fixtureAt(node.limitation_records, 0, 'limitation record').related_record_ids = ['missing']; return { tree, evidence: catalog() }
      },
    ]
    const expected: SupraMasDomainErrorCode[] = [
      'SUPRAMAS_DOMAIN_INVALID',
      'SUPRAMAS_DUPLICATE_ID',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_EVIDENCE_MISSING',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_DUPLICATE_ID',
      'SUPRAMAS_DUPLICATE_ID',
      'SUPRAMAS_BROKEN_REFERENCE',
    ]
    cases.forEach((make, index) => {
      const { tree, evidence } = make()
      expectCode(() => validateStrategyTree(tree, evidence), fixtureAt(expected, index, 'expected error code'))
    })
  })

  it('rejects broken edge identities, endpoints, claims, and incoming counts', () => {
    const mutations: Array<(tree: StrategyTree) => void> = [
      (tree) => { tree.edges.push({ ...fixtureAt(tree.edges, 0, 'edge') }) },
      (tree) => { fixtureAt(tree.edges, 0, 'edge').parent_node_id = 'missing' },
      (tree) => { fixtureAt(tree.edges, 0, 'edge').child_node_id = 'missing' },
      (tree) => { fixtureAt(tree.nodes, 1, 'child node').parent_id = 'N1' },
      (tree) => { fixtureAt(tree.nodes, 1, 'child node').level = 0 },
      (tree) => { fixtureAt(tree.edges, 0, 'edge').parent_limitation_id = 'missing' },
      (tree) => { fixtureAt(tree.edges, 0, 'edge').parent_expectation = 'wrong' },
      (tree) => { fixtureAt(tree.edges, 0, 'edge').child_record_id = 'missing' },
      (tree) => { fixtureAt(tree.edges, 0, 'edge').child_tuning_effect = 'wrong' },
      (tree) => { tree.edges = [] },
      (tree) => { tree.edges.push({ ...fixtureAt(tree.edges, 0, 'edge'), edge_id: 'E2' }) },
    ]
    const expected: SupraMasDomainErrorCode[] = [
      'SUPRAMAS_DUPLICATE_ID',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
      'SUPRAMAS_BROKEN_REFERENCE',
    ]
    mutations.forEach((mutate, index) => {
      const { evidence, tree } = connected()
      mutate(tree)
      expectCode(() => validateStrategyTree(tree, evidence), fixtureAt(expected, index, 'expected error code'))
    })
  })

  it('enforces assembler node, paper, and edge uniqueness', () => {
    const { evidence, tree } = connected()
    const assembler = new StrategyTreeAssembler({
      job_id: 'demo', research_topic: 'BZO pinning in REBCO',
    }, evidence)
    assembler.addNode(fixtureAt(tree.nodes, 0, 'root node'))
    const duplicatePaper = { ...fixtureAt(tree.nodes, 1, 'child node'), node_id: 'N2', paper_id: 'paper-1' }
    expectCode(() => {
      assembler.addNode(duplicatePaper)
    }, 'SUPRAMAS_DUPLICATE_ID')
    assembler.addNode(fixtureAt(tree.nodes, 1, 'child node'))
    assembler.addEdge(fixtureAt(tree.edges, 0, 'edge'))
    expect(assembler.build()).toEqual({
      job_id: 'demo', research_topic: 'BZO pinning in REBCO', nodes: tree.nodes, edges: tree.edges,
    })
    expectCode(() => {
      assembler.addEdge(fixtureAt(tree.edges, 0, 'edge'))
    }, 'SUPRAMAS_DUPLICATE_ID')
  })
})
