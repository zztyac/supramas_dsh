import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import { apply as storageJsonApply, Config as storageJsonConfig, inject as storageJsonInject, name as storageJsonName } from '@deepseek-ai/dsh-storage-json'
import { apply as storageDomainApply, Config as storageDomainConfig, inject as storageDomainInject, name as storageDomainName } from '@deepseek-ai/dsh-storage-domain'
import { SubprocessRuntime, type SubprocessHandle, type SubprocessSpawnSpec, type SubprocessTerminalHandle, type SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import SupraMasRuntime from '../../supramas/src/index.ts'
import SupraMasArtifacts from '../../supramas-artifacts/src/index.ts'
import LiteratureRuntime from '../../supramas-literature/src/index.ts'
import * as OpenAlex from '../../supramas-literature-openalex/src/index.ts'
import * as PaperHttp from '../../supramas-paper-http/src/index.ts'
import * as PyPdf from '../../supramas-pdf-pypdf/src/index.ts'
import SupraMasPaperIngest from '../../supramas-paper-ingest/src/index.ts'
import * as ToolSupraMas from '../../tool-supramas/src/index.ts'
import * as ToolLiterature from '../src/index.ts'

class TestSubprocess extends SubprocessRuntime {
  resolveExecutable(): Promise<string> { return Promise.resolve('python') }
  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle { throw new Error('not invoked during Loader boot') }
  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> { throw new Error('not invoked during Loader boot') }
}

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  context = undefined
})

describe('SupraMAS literature real Loader composition', () => {
  it('boots every M7 provider and all run/literature tools from cordis.yml', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supramas-literature-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${JSON.stringify(join(root, 'storage'))}`,
      "- name: '@deepseek-ai/dsh-storage-domain'",
      '  config:',
      '    backend: json',
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-web'",
      "- name: '@test/subprocess'",
      "- name: '@deepseek-ai/dsh-supramas'",
      "- name: '@deepseek-ai/dsh-supramas-artifacts'",
      '  config:',
      `    root: ${JSON.stringify(root)}`,
      "- name: '@deepseek-ai/dsh-supramas-literature'",
      "- name: '@deepseek-ai/dsh-supramas-literature-openalex'",
      "- name: '@deepseek-ai/dsh-supramas-paper-http'",
      "- name: '@deepseek-ai/dsh-supramas-pdf-pypdf'",
      "- name: '@deepseek-ai/dsh-supramas-paper-ingest'",
      "- name: '@deepseek-ai/dsh-tool-supramas'",
      "- name: '@deepseek-ai/dsh-tool-supramas-literature'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', { name: storageJsonName, inject: storageJsonInject, apply: storageJsonApply, Config: storageJsonConfig }],
      ['@deepseek-ai/dsh-storage-domain', { name: storageDomainName, inject: storageDomainInject, apply: storageDomainApply, Config: storageDomainConfig }],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-web', WebRuntime],
      ['@test/subprocess', TestSubprocess],
      ['@deepseek-ai/dsh-supramas', SupraMasRuntime],
      ['@deepseek-ai/dsh-supramas-artifacts', SupraMasArtifacts],
      ['@deepseek-ai/dsh-supramas-literature', LiteratureRuntime],
      ['@deepseek-ai/dsh-supramas-literature-openalex', OpenAlex],
      ['@deepseek-ai/dsh-supramas-paper-http', PaperHttp],
      ['@deepseek-ai/dsh-supramas-pdf-pypdf', PyPdf],
      ['@deepseek-ai/dsh-supramas-paper-ingest', SupraMasPaperIngest],
      ['@deepseek-ai/dsh-tool-supramas', ToolSupraMas],
      ['@deepseek-ai/dsh-tool-supramas-literature', ToolLiterature],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()

    expect(ctx.supramas.list()).toEqual([])
    expect(ctx.tools.schemas()).toHaveLength(15)
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('supramas_literature_search')
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('supramas_paper_import')
    expect(ctx.supramasLiterature).toBeDefined()
    expect(ctx.supramasPaperIngest).toBeDefined()
  }, 30_000)
})
