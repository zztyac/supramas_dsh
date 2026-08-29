/** Package-owned invariant companion for the static SupraMAS bundle. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-bundle'
export const name = 'supramas-bundle-invariant'
export const inject = ['invariants']

// No runtime invariant: the YAML carrier owns no state; inserted packages own their invariants.
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
