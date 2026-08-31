/** Package-owned invariant companion for `@deepseek-ai/dsh-supramas-literature`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-literature'

export const name = 'supramas-literature-invariant'
export const inject = ['invariants']

// No runtime invariant: registry identity, selection, and result bounds are enforced synchronously by the service.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
