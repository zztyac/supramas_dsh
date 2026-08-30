import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Storage from '@deepseek-ai/dsh-storage'
import {
  apply as storageJsonApply,
  Config as storageJsonConfig,
  inject as storageJsonInject,
  name as storageJsonName,
} from '@deepseek-ai/dsh-storage-json'
import {
  apply as storageDomainApply,
  Config as storageDomainConfig,
  inject as storageDomainInject,
  name as storageDomainName,
} from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SupraMasRuntime from '../../supramas/src/index.ts'
import * as ToolSupraMas from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  context = undefined
  root = undefined
})

describe('SupraMAS real Loader composition', () => {
  it('boots the runtime and tools from cordis.yml', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-supramas-loader-'))
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
      "- name: '@deepseek-ai/dsh-supramas'",
      "- name: '@deepseek-ai/dsh-tool-supramas'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@deepseek-ai/dsh-storage', Storage],
      ['@deepseek-ai/dsh-storage-json', {
        name: storageJsonName,
        inject: storageJsonInject,
        apply: storageJsonApply,
        Config: storageJsonConfig,
      }],
      ['@deepseek-ai/dsh-storage-domain', {
        name: storageDomainName,
        inject: storageDomainInject,
        apply: storageDomainApply,
        Config: storageDomainConfig,
      }],
      ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
      ['@deepseek-ai/dsh-tools', ToolRuntime],
      ['@deepseek-ai/dsh-supramas', SupraMasRuntime],
      ['@deepseek-ai/dsh-tool-supramas', ToolSupraMas],
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
    expect(ctx.tools.schemas().map(schema => schema.name)).toEqual([
      'supramas_run_create',
      'supramas_run_list',
      'supramas_run_get',
      'supramas_run_transition',
      'supramas_stage1_start',
      'supramas_stage1_get',
      'supramas_stage1_builder_submit',
      'supramas_stage1_reviewer_submit',
      'supramas_stage1_finalize',
      'supramas_paper_store',
      'supramas_chunk_extract',
      'supramas_artifact_read',
      'supramas_evidence_verify',
    ])
  }, 30_000)
})
