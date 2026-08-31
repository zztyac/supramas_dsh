/** Package-owned invariant companion for bounded literature tools. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-tool-supramas-literature'
export const name = 'tool-supramas-literature-invariant'
export const inject = ['invariants']
// No runtime invariant: tool schemas and handlers enforce bounded model-facing reads.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
