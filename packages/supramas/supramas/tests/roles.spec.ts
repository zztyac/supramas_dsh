import { describe, expect, it } from 'vitest'
import { ROLE_SPECS, resolveRole } from '../src/roles.ts'

describe('SupraMAS role contracts', () => {
  it('defines the four Stage 0/1 roles exactly once', () => {
    expect(ROLE_SPECS.map(role => role.id)).toEqual([
      'task-setup',
      'strategy-coordinator',
      'strategy-builder',
      'strategy-reviewer',
    ])
  })

  it('keeps task setup unable to search literature or build a tree', () => {
    const role = resolveRole('task-setup')
    expect(role.tools).toEqual([
      'ask_user_question',
      'supramas_run_create',
      'supramas_run_list',
      'supramas_run_get',
    ])
    expect(role.outputSchema).toBe('supramas.task-setup.v1')
  })

  it('lets the coordinator discover and compare-and-set durable runs', () => {
    const role = resolveRole('strategy-coordinator')
    expect(role.tools).toEqual([
      'supramas_run_list',
      'supramas_run_get',
      'supramas_run_transition',
      'supramas_stage1_start',
      'supramas_stage1_get',
      'supramas_stage1_builder_submit',
      'supramas_stage1_reviewer_submit',
      'supramas_stage1_finalize',
      'supramas_artifacts_sync',
      'supramas_builder',
      'supramas_reviewer',
    ])
  })

  it('separates builder mutation tools from reviewer read-only tools', () => {
    const builder = resolveRole('strategy-builder')
    const reviewer = resolveRole('strategy-reviewer')
    expect(builder.tools).toEqual([
      'skill',
      'web_search',
      'supramas_literature_search',
      'supramas_paper_import',
      'supramas_chunk_list',
      'supramas_chunk_read',
    ])
    expect(builder.tools).not.toContain('supramas_review_record')
    expect(reviewer.tools).toEqual([
      'supramas_chunk_list',
      'supramas_chunk_read',
      'supramas_evidence_verify',
    ])
  })

  it('fails loud for an unknown role', () => {
    expect(() => resolveRole('unknown' as never)).toThrow('unknown SupraMAS role')
  })
})
