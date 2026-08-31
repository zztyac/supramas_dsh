/** CSS-level visual regression for the tree, evidence, and output workspace. */
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(
  fileURLToPath(new URL('../src/client/SupraMasTaskPanel.module.css', import.meta.url)),
  'utf8',
)
const theme = readdirSync(fileURLToPath(new URL('../../../client/ui-theme/src/styles/', import.meta.url)))
  .filter(name => name.endsWith('.css'))
  .map(name => readFileSync(fileURLToPath(new URL(`../../../client/ui-theme/src/styles/${name}`, import.meta.url)), 'utf8'))
  .join('\n')

function block(selector: string): string {
  const escaped = selector.replace(/[.[\]():*+^$\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(css)
  if (match === null) throw new Error(`SupraMasTaskPanel.module.css has no ${selector} rule`)
  return match[1] ?? ''
}

describe('SupraMAS research workspace visual contract', () => {
  it('uses only declared shared theme variables for product colors and elevation', () => {
    const named = [...css.matchAll(/var\((--dsw-[a-z0-9-]+)/g)].map(match => match[1])
    expect(named.length).toBeGreaterThan(30)
    expect([...new Set(named)].filter(name => !theme.includes(`  ${String(name)}:`))).toEqual([])
  })

  it('keeps the desktop tree and paper evidence in separate scrollable columns', () => {
    expect(block('.workspaceGrid')).toMatch(/grid-template-columns:\s*minmax\(260px, 0\.72fr\) minmax\(0, 2fr\)/)
    expect(block('.workspaceGrid')).toMatch(/overflow:\s*hidden/)
    expect(block('.treePane,\n.paperPane')).toMatch(/overflow-y:\s*auto/)
    expect(block('.recordColumns')).toMatch(/grid-template-columns:\s*1fr 1fr/)
  })

  it('preserves hierarchy indentation without allowing deep levels to consume the row', () => {
    const node = block('.treeNode')
    expect(node).toContain('min(calc(var(--tree-level) * 14px), 56px)')
    expect(node).toMatch(/text-align:\s*left/)
    expect(block(".treeNode[aria-selected='true']")).toMatch(/border-color:\s*var\(--dsw-alias-state-business-primary\)/)
  })

  it('collapses to one scroll surface and one record column on narrow screens', () => {
    const mobile = css.slice(css.indexOf('@media (max-width: 760px)'))
    expect(mobile).toMatch(/\.workspaceGrid\s*\{[^}]*display:\s*block/s)
    expect(mobile).toMatch(/\.recordColumns\s*\{[^}]*grid-template-columns:\s*1fr/s)
    expect(mobile).toMatch(/\.treePane\s*\{[^}]*border-right:\s*0/s)
  })

  it('keeps every CSS rule closed so later evidence and output rules cannot be swallowed', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
    expect((bare.match(/\{/g) ?? []).length).toBe((bare.match(/\}/g) ?? []).length)
  })
})
