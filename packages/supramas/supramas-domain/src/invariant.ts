/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-supramas-domain`.
 * @module @deepseek-ai/dsh-supramas-domain/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-domain'

/** Cordis companion plugin name. */
export const name = 'supramas-domain-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: validation is synchronous and enforced before an artifact is returned.
// M3 adds runtime invariants after durable artifact events exist.
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
