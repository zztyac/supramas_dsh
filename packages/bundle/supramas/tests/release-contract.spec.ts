import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

interface PackageManifest {
  readonly name: string
  readonly files?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly exports?: Readonly<Record<string, string | {
    readonly types?: string
    readonly default?: string
  }>>
  readonly dsh?: { readonly bundle?: { readonly patch?: string } }
}

function manifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

describe('SupraMAS source release contract', () => {
  it('resolves every concrete public export to a built file', () => {
    const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const packageRoot = resolve(workspaceRoot, 'packages/supramas')
    for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const currentRoot = resolve(packageRoot, entry.name)
      const current = manifest(resolve(currentRoot, 'package.json'))
      for (const [specifier, value] of Object.entries(current.exports ?? {})) {
        const targets = typeof value === 'string' ? [value] : [value.types, value.default]
        for (const target of targets) {
          if (target === undefined || target.includes('*')) continue
          expect(
            existsSync(resolve(currentRoot, target)),
            `${current.name} export ${specifier} must resolve ${target}`,
          ).toBe(true)
        }
      }
    }
  })

  it('ships a complete bundle payload and reaches every SupraMAS workspace package', () => {
    const workspaceRoot = fileURLToPath(new URL('../../../../', import.meta.url))
    const bundleRoot = resolve(workspaceRoot, 'packages/bundle/supramas')
    const bundle = manifest(resolve(bundleRoot, 'package.json'))
    expect(bundle.files).toEqual(expect.arrayContaining([
      'lib/index.js',
      'lib/invariant.js',
      'cordis.patch.yml',
      'lib/types/**/*.d.ts',
    ]))

    const patch = yaml.load(
      readFileSync(resolve(bundleRoot, bundle.dsh?.bundle?.patch ?? ''), 'utf8'),
      { schema: entryListSchema },
    ) as { readonly insert?: readonly { readonly name?: string }[] }[]
    const mountedPackages = patch
      .flatMap(entry => entry.insert ?? [])
      .map(entry => entry.name)
      .filter((name): name is string => name !== undefined)
    for (const packageName of mountedPackages) {
      expect(bundle.dependencies?.[packageName], `${packageName} must be installed with the bundle`).toBe('workspace:^')
    }

    const packageRoot = resolve(workspaceRoot, 'packages/supramas')
    const supraMasManifests = new Map<string, PackageManifest>()
    for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = manifest(resolve(packageRoot, entry.name, 'package.json'))
      supraMasManifests.set(candidate.name, candidate)
    }

    const reached = new Set<string>()
    const visit = (current: PackageManifest): void => {
      if (reached.has(current.name)) return
      reached.add(current.name)
      for (const dependency of Object.keys(current.dependencies ?? {})) {
        const next = supraMasManifests.get(dependency)
        if (next !== undefined) visit(next)
      }
    }
    visit(bundle)

    expect(
      [...supraMasManifests.keys()].filter(packageName => !reached.has(packageName)).sort(),
      'the published bundle dependency closure must include every SupraMAS package',
    ).toEqual([])
  })
})
