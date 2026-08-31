/** Package-owned invariant companion for the stateless pypdf provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-pdf-pypdf'
export const name = 'supramas-pdf-pypdf-invariant'
export const inject = ['invariants']
// No runtime invariant: parser limits are enforced in both the managed child and provider.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
