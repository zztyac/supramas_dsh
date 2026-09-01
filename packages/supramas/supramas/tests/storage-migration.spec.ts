import { describe, expect, it } from 'vitest'
import { migrateSupraMasStorageV1 } from '../src/storage-migration.ts'

function legacyDocument() {
  return {
    unit: { name: 'supramas', version: 1 },
    global: null,
    tables: {
      runs: {
        'supramas:legacy': {
          sequence: 0,
          snapshot: { jobId: 'legacy' },
          papers: {
            root: {
              paper_id: 'root',
              chunks: [{ chunk_id: 'root-abstract', text: 'legacy abstract' }],
            },
            child: {
              paper_id: 'child',
              chunks: [{ chunk_id: 'child-full', text: 'existing classification', evidence_kind: 'full_text' }],
            },
          },
          workflow: {
            status: 'completed',
            config: { jobId: 'legacy', exclude: [] as string[] },
            nodes: [
              { node_id: 'N0', paper_id: 'root' },
              { node_id: 'N1', paper_id: 'child' },
            ],
            edges: [{ child_node_id: 'N1', edge_type: 'transferable' }],
            frontiers: [],
            builder_attempts: [],
            review_log: [
              {
                decision: 'accept',
                scope: 'root',
                paper_id: 'root',
                summary: 'Legacy root review.',
                critical_issues: [] as unknown[],
                edge_issues: [] as unknown[],
                acceptance_conditions: ['Explore a child paper.'],
              },
              {
                decision: 'accept',
                scope: 'child',
                paper_id: 'child',
                summary: 'Legacy child review.',
                critical_issues: [] as unknown[],
                edge_issues: [] as unknown[],
                acceptance_conditions: [],
              },
            ],
          },
        },
      },
    },
  }
}

describe('SupraMAS storage v1 migration', () => {
  it('preserves legacy data while making provenance and review semantics explicit', () => {
    const result = migrateSupraMasStorageV1(legacyDocument())

    expect(result.stats).toEqual({
      runs: 1,
      papers: 2,
      chunks: 2,
      reviews: 2,
      archivedRecommendations: 1,
    })
    expect(result.document).toMatchObject({
      unit: { name: 'supramas', version: 2 },
      tables: {
        runs: {
          'supramas:legacy': {
            papers: {
              root: { chunks: [{ evidence_kind: 'abstract' }] },
              child: { chunks: [{ evidence_kind: 'full_text' }] },
            },
            workflow: {
              config: { requireAgentHandoffs: false },
              review_log: [
                {
                  expectation_satisfaction: 'not_applicable',
                  acceptance_conditions: [],
                },
                {
                  expectation_satisfaction: 'partial',
                  acceptance_conditions: [],
                },
              ],
            },
          },
        },
      },
    })
    expect(JSON.stringify(result.document)).toContain('Legacy v1 follow-up recommendations')
  })

  it('rejects unsafe policy conflicts and malformed accepted reviews', () => {
    const excluded = legacyDocument()
    excluded.tables.runs['supramas:legacy'].workflow.config = {
      jobId: 'legacy',
      exclude: ['abstract-only evidence'],
    }
    expect(() => migrateSupraMasStorageV1(excluded)).toThrow(/cannot be migrated safely/)

    const unresolved = legacyDocument()
    unresolved.tables.runs['supramas:legacy'].workflow.review_log[0]?.critical_issues.push({ issue: 'open' })
    expect(() => migrateSupraMasStorageV1(unresolved)).toThrow(/still contains unresolved/)
  })

  it('refuses foreign units and versions other than one', () => {
    expect(() => migrateSupraMasStorageV1({ unit: { name: 'other', version: 1 }, tables: { runs: {} } }))
      .toThrow(/name must be supramas/)
    expect(() => migrateSupraMasStorageV1({ unit: { name: 'supramas', version: 2 }, tables: { runs: {} } }))
      .toThrow(/version must be 1/)
  })
})
