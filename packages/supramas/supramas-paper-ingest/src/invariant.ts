/** Package-owned invariant companion for paper ingestion. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-supramas-paper-ingest'
export const name = 'supramas-paper-ingest-invariant'
export const inject = ['invariants']
// No runtime invariant: the ingestion transaction validates every boundary before durable import.
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
