/** Package-owned invariant companion for `@deepseek-ai/dsh-tool-supramas`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-tool-supramas'

export const name = 'tool-supramas-invariant'
export const inject = ['invariants']

// No runtime invariant: the adapter owns no state; the capability validates all lifecycle relations.
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
