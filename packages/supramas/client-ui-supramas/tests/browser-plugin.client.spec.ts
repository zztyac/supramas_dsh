/** Browser assembly: slot registration, Remote bridge, Session queueing, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type {
  SupraMasCreateStage1RequestV1,
  SupraMasRunViewV1,
} from '@deepseek-ai/dsh-api-supramas/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, coordinatorPrompt, inject } from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import * as UiInvariant from '../src/invariant.ts'
import { en, NS, zh } from '../src/client/locales.ts'
import type { SupraMasUiPort } from '../src/client/SupraMasTaskPanel.tsx'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const request: SupraMasCreateStage1RequestV1 = {
  jobId: 'ui-bridge-demo',
  researchTopic: 'REBCO flux pinning',
  materialScope: ['REBCO'],
  targetProperty: ['in-field Jc'],
  maxDepth: 2,
}

const view: SupraMasRunViewV1 = {
  apiVersion: 1,
  run: {
    id: 'supramas:ui-bridge-demo',
    jobId: 'ui-bridge-demo',
    revision: 3,
    phase: 'running',
    createdAt: 1,
    updatedAt: 2,
  },
  stage1: {
    status: 'active',
    researchTopic: request.researchTopic,
    materialScope: ['REBCO'],
    targetProperty: ['in-field Jc'],
    limits: {
      maxDepth: 2,
      maxRootAttempts: 3,
      maxChildAttemptsPerLimitation: 2,
      maxBranchPerNode: null,
      targetChildNodes: null,
    },
    progress: {
      acceptedPapers: 0,
      strategyLinks: 0,
      openLimitations: 0,
      builderAttempts: 0,
      reviews: 0,
    },
    nextAction: { kind: 'build_root', attemptIndex: 1 },
  },
}

interface Bench {
  readonly ctx: Context
  readonly fiber: ReturnType<Context['plugin']>
  readonly api: SupraMasUiPort
  readonly prompt: ReturnType<typeof vi.fn>
  readonly remote: {
    readonly list: ReturnType<typeof vi.fn>
    readonly get: ReturnType<typeof vi.fn>
    readonly tree: ReturnType<typeof vi.fn>
    readonly paper: ReturnType<typeof vi.fn>
    readonly evidence: ReturnType<typeof vi.fn>
    readonly artifacts: ReturnType<typeof vi.fn>
    readonly artifact: ReturnType<typeof vi.fn>
    readonly createStage1: ReturnType<typeof vi.fn>
    readonly resume: ReturnType<typeof vi.fn>
    readonly cancel: ReturnType<typeof vi.fn>
  }
}

async function bench(withSession = true): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } },
  } as never, () => null)
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.locale.setLocale('zh')

  const prompt = vi.fn().mockResolvedValue({ ok: true })
  const sessions = {
    list: { getSnapshot: () => ({ current: withSession ? 'session-1' : undefined }) },
    binding: () => ({ session: { prompt } }),
  }
  const ok = <T>(value: T) => Promise.resolve({ ok: true, value })
  const remote = {
    list: vi.fn(() => ok({ apiVersion: 1, items: [view] })),
    get: vi.fn(() => ok(view)),
    tree: vi.fn(() => ok({ apiVersion: 1, runId: view.run.id, revision: view.run.revision, status: 'active', nodes: [], edges: [] })),
    paper: vi.fn(() => ok({ apiVersion: 1, runId: view.run.id, paperId: 'paper-1', paperTitle: 'Paper', sourceType: 'experimental', chunks: [] })),
    evidence: vi.fn(() => ok({ apiVersion: 1, runId: view.run.id, paperId: 'paper-1', chunkId: 'c1', page: 1, start: 0, end: 4, totalCharacters: 4, text: 'text' })),
    artifacts: vi.fn(() => ok({ apiVersion: 1, runId: view.run.id, ready: true, files: [{ name: 'strategy_tree.json', ready: true }] })),
    artifact: vi.fn(() => ok({ apiVersion: 1, runId: view.run.id, name: 'strategy_tree.json', mediaType: 'application/json', byteLength: 3, content: '{}\n' })),
    createStage1: vi.fn(() => ok(view)),
    resume: vi.fn(() => ok(view)),
    cancel: vi.fn(() => ok(view)),
  }
  ctx.provide('sessions', sessions as never)
  ctx.provide('remote', { supramas: remote } as never)
  ctx.provide('remote.supramas' as never, remote as never)

  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = ctx.slots.entries('sidebar.footer.action')[0]!
  const injected = (entry.inject as () => { api: SupraMasUiPort })()
  return { ctx, fiber, api: injected.api, prompt, remote }
}

describe('SupraMAS browser plugin', () => {
  it('declares every service used by the task dashboard', () => {
    expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.supramas', 'sessions'])
  })

  it('registers the sidebar action and bilingual dictionaries with fiber teardown', async () => {
    const b = await bench()
    expect(b.ctx.slots.entries('sidebar.footer.action')[0]).toMatchObject({
      options: { id: 'supramas-task-panel', order: 10 },
      locale: NS,
    })
    const translate = b.ctx.locale.bind(NS)
    expect(translate('panel.title')).toBe(zh['panel.title'])
    b.ctx.locale.setLocale('en')
    expect(translate('panel.title')).toBe(en['panel.title'])
    await b.fiber.dispose()
    expect(b.ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(translate('panel.title')).not.toBe(en['panel.title'])
  })

  it('bridges task operations to the typed Remote and queues the coordinator in the current session', async () => {
    const b = await bench()
    await expect(b.api.list()).resolves.toEqual([view])
    await expect(b.api.get(view.run.id)).resolves.toEqual(view)
    await expect(b.api.tree(view.run.id)).resolves.toMatchObject({ runId: view.run.id, nodes: [] })
    await expect(b.api.paper(view.run.id, 'paper-1')).resolves.toMatchObject({ paperId: 'paper-1' })
    await expect(b.api.evidence(view.run.id, 'paper-1', 'c1', 0, 4_000)).resolves.toMatchObject({ text: 'text' })
    await expect(b.api.artifacts(view.run.id)).resolves.toMatchObject({ ready: true })
    const created = await b.api.createAndQueue(request)
    expect(b.remote.createStage1).toHaveBeenCalledWith(request)
    expect(created).toEqual({ view, queued: true })
    expect(b.prompt).toHaveBeenCalledWith([
      { type: 'text', text: coordinatorPrompt(view) },
    ], 'queue')

    await expect(b.api.resumeAndQueue(view.run.id, view.run.revision)).resolves.toEqual({ view, queued: true })
    expect(b.remote.resume).toHaveBeenCalledWith(view.run.id, view.run.revision)
    await expect(b.api.cancel(view.run.id, view.run.revision)).resolves.toEqual(view)
    expect(b.remote.cancel).toHaveBeenCalledWith(view.run.id, view.run.revision)
    await b.fiber.dispose()
  })

  it('downloads a canonical output through the Remote payload without exposing Host paths', async () => {
    const b = await bench()
    const click = vi.fn()
    const anchor = { href: '', download: '', rel: '', click }
    const createObjectURL = vi.fn(() => 'blob:supramas-output')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor) })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    await b.api.downloadArtifact(view.run.id, 'strategy_tree.json')

    expect(b.remote.artifact).toHaveBeenCalledWith(view.run.id, 'strategy_tree.json')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:supramas-output')
    await b.fiber.dispose()
  })

  it('keeps a created task durable and explains how to continue when no session is open', async () => {
    const b = await bench(false)
    const created = await b.api.createAndQueue(request)
    expect(created.view).toEqual(view)
    expect(created.queued).toBe(false)
    expect(created.warning).toBe(zh['notice.noSession'])
    expect(b.prompt).not.toHaveBeenCalled()
    await b.fiber.dispose()
  })

  it('surfaces structured Remote failures instead of returning an empty task list', async () => {
    const b = await bench()
    b.remote.list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal', message: 'temporary failure' },
    })
    await expect(b.api.list()).rejects.toThrow('internal: temporary failure')
    b.remote.list.mockResolvedValueOnce({ ok: true })
    await expect(b.api.list()).rejects.toThrow('Remote operation returned no value')
    await b.fiber.dispose()
  })

  it('returns the Session queue failure as a user-facing warning', async () => {
    const b = await bench()
    b.prompt.mockResolvedValueOnce({ ok: false, error: { message: 'Session queue is unavailable' } })
    await expect(b.api.queue(view)).resolves.toEqual({
      queued: false,
      warning: 'Session queue is unavailable',
    })
    await b.fiber.dispose()
  })

  it('keeps dictionaries key-identical', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})

describe('SupraMAS UI package companions', () => {
  it('keeps the host half inert', () => {
    expect(applyNode).not.toThrow()
  })

  it('reserves package invariant ownership', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    const fiber = ctx.plugin(UiInvariant)
    await fiber.await()
    expect(UiInvariant.name).toBe('client-ui-supramas-invariant')
    expect(UiInvariant.inject).toEqual(['invariants'])
    await fiber.dispose()
  })
})
