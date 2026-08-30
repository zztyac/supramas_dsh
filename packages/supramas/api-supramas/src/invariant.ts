/** Package-owned invariant companion. @module @deepseek-ai/dsh-api-supramas/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-supramas'

/** Cordis companion plugin name. */
export const name = 'api-supramas-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// No runtime invariant: the runtime owns state; this boundary only projects and classifies it.
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['supramasController'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
