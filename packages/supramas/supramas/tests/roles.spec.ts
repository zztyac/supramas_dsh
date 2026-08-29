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
      'supramas_run_get',
    ])
    expect(role.outputSchema).toBe('supramas.task-setup.v1')
  })

  it('separates builder mutation tools from reviewer read-only tools', () => {
    const builder = resolveRole('strategy-builder')
    const reviewer = resolveRole('strategy-reviewer')
    expect(builder.tools).toContain('supramas_paper_store')
    expect(builder.tools).not.toContain('supramas_review_record')
    expect(reviewer.tools).toEqual([
      'supramas_artifact_read',
      'supramas_evidence_verify',
    ])
  })

  it('fails loud for an unknown role', () => {
    expect(() => resolveRole('unknown' as never)).toThrow('unknown SupraMAS role')
  })
})
