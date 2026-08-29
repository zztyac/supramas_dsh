import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

describe('dsh-supramas bundle', () => {
  it('declares a parseable Profile patch with the runtime before its tool consumer', () => {
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
      { id: 'tool-supramas', name: '@deepseek-ai/dsh-tool-supramas' },
    ])
    expect(manifest.dependencies).toMatchObject({
      '@deepseek-ai/dsh-supramas': 'workspace:^',
      '@deepseek-ai/dsh-tool-supramas': 'workspace:^',
    })
  })

  it('ships a selectable SupraMAS preset with delegation and the material-science persona', () => {
    const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'preset', 'agent-presets', 'presets', 'supramas')
    expect(existsSync(resolve(root, 'preset.yml'))).toBe(true)
    const entries = yaml.load(readFileSync(resolve(root, 'agent.cordis.yml'), 'utf8'), {
      schema: entryListSchema,
    }) as { id?: string; name?: string }[]
    expect(entries.find(entry => entry.id === 'persona')).toMatchObject({ name: '@deepseek-ai/dsh-persona' })
    expect(entries.find(entry => entry.id === 'tool-supramas')).toMatchObject({ name: '@deepseek-ai/dsh-tool-supramas' })
    expect(entries.find(entry => entry.id === 'tool-subagent')).toMatchObject({ name: '@deepseek-ai/dsh-tool-subagent' })
  })
})
