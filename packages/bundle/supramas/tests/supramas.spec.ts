import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-supramas bundle', () => {
  it('declares a parseable host Profile patch without leaking model tools to standard sessions', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    const parsed = yaml.load(
      readFileSync(resolve(root, manifest.dsh!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as { insert?: { id?: string; name?: string }[] }[]
    const rows = parsed.flatMap(patch => patch.insert ?? [])
    expect(rows).toEqual([
      { id: 'supramas-runtime', name: '@deepseek-ai/dsh-supramas' },
      {
        id: 'supramas-artifacts',
        name: '@deepseek-ai/dsh-supramas-artifacts',
        config: { root: { __jsExpr: 'process.cwd()' } },
      },
      { id: 'supramas-literature', name: '@deepseek-ai/dsh-supramas-literature' },
      { id: 'supramas-literature-openalex', name: '@deepseek-ai/dsh-supramas-literature-openalex' },
      { id: 'supramas-paper-http', name: '@deepseek-ai/dsh-supramas-paper-http' },
      { id: 'supramas-pdf-pypdf', name: '@deepseek-ai/dsh-supramas-pdf-pypdf' },
      { id: 'supramas-paper-ingest', name: '@deepseek-ai/dsh-supramas-paper-ingest' },
      { id: 'api-supramas', name: '@deepseek-ai/dsh-api-supramas' },
      { id: 'client-ui-supramas', name: '@deepseek-ai/dsh-client-ui-supramas' },
    ])
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-api-supramas': 'workspace:^',
      '@deepseek-ai/dsh-client-ui-supramas': 'workspace:^',
      '@deepseek-ai/dsh-supramas': 'workspace:^',
      '@deepseek-ai/dsh-supramas-artifacts': 'workspace:^',
      '@deepseek-ai/dsh-supramas-literature': 'workspace:^',
      '@deepseek-ai/dsh-supramas-literature-openalex': 'workspace:^',
      '@deepseek-ai/dsh-supramas-paper-http': 'workspace:^',
      '@deepseek-ai/dsh-supramas-paper-ingest': 'workspace:^',
      '@deepseek-ai/dsh-supramas-pdf-pypdf': 'workspace:^',
      '@deepseek-ai/dsh-tool-supramas': 'workspace:^',
      '@deepseek-ai/dsh-tool-supramas-literature': 'workspace:^',
      '@deepseek-ai/dsh-web-fetch-http': 'workspace:^',
    })
  })

  it('ships a selectable SupraMAS preset with atomic builder and reviewer delegation', () => {
    const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'preset', 'agent-presets', 'presets', 'supramas')
    expect(existsSync(resolve(root, 'preset.yml'))).toBe(true)
    const entries = yaml.load(readFileSync(resolve(root, 'agent.cordis.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as { id?: string; name?: string; config?: Record<string, unknown> }[]
    const persona = entries.find(entry => entry.id === 'persona')
    expect(persona).toMatchObject({ name: '@deepseek-ai/dsh-persona' })
    expect((persona?.config as { text?: string }).text).toContain('atomically delegates to its isolated subagent')
    expect(entries.find(entry => entry.id === 'tool-supramas')).toMatchObject({ name: '@deepseek-ai/dsh-tool-supramas' })
    expect(entries.find(entry => entry.id === 'tool-supramas-literature')).toMatchObject({ name: '@deepseek-ai/dsh-tool-supramas-literature' })
    expect(entries.find(entry => entry.id === 'tool-web')).toMatchObject({ name: '@deepseek-ai/dsh-tool-web' })
    expect(entries.find(entry => entry.id === 'tool-subagent')).toBeUndefined()
    expect(entries.find(entry => entry.id === 'tool-subagent-builder')).toBeUndefined()
    expect(entries.find(entry => entry.id === 'tool-subagent-reviewer')).toBeUndefined()
  })
})
