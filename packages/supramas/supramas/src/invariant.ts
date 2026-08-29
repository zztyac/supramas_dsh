/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-supramas`.
 * @module @deepseek-ai/dsh-supramas/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas'

/** Cordis companion plugin name. */
export const name = 'supramas-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: M1 deliberately owns only process-local state. Persistence invariants arrive
// with the durable run store in M3, where there is an event stream to inspect.
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
