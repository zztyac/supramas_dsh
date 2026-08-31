/** Package-owned invariant companion for the stateless paper HTTP provider. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-paper-http'
export const name = 'supramas-paper-http-invariant'
export const inject = ['invariants']
// No runtime invariant: URL and response safety are enforced synchronously by the provider.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
