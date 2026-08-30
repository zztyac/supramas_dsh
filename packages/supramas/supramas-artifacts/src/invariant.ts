/** Package-owned invariant companion. @module @deepseek-ai/dsh-supramas-artifacts/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-artifacts'

/** Cordis companion plugin name. */
export const name = 'supramas-artifacts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

// No runtime invariant: atomic file replacement and complete file contents are proven by package IO tests.
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['supramasArtifacts'] })

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
