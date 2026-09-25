/** Package-owned invariant companion for `@deepseek-ai/dsh-supramas-literature-arxiv`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-literature-arxiv'

export const name = 'supramas-literature-arxiv-invariant'
export const inject = ['invariants']

// No runtime invariant: provider parsing and response bounds fail before any candidate is returned.
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
