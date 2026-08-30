import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as ApiInvariant from '../src/invariant.ts'

describe('api-supramas invariant companion', () => {
  it('reserves package ownership and declares the runtime service it audits', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ApiInvariant)

    expect(ApiInvariant.name).toBe('api-supramas-invariant')
    expect(ApiInvariant.inject).toEqual(['invariants'])
    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-api-supramas', () => {})
    }).toThrow(/already registered/)
  })
})
