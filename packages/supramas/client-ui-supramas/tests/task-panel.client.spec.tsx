// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type {
  SupraMasArtifactsViewV1,
  SupraMasEvidenceSliceViewV1,
  SupraMasPaperEvidenceViewV1,
  SupraMasRunViewV1,
  SupraMasStrategyTreeViewV1,
} from '@deepseek-ai/dsh-api-supramas/types'
import {
  SupraMasTaskPanel,
  type SupraMasTaskPanelProps,
  type SupraMasUiPort,
} from '../src/client/SupraMasTaskPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const running: SupraMasRunViewV1 = {
  apiVersion: 1,
  run: {
    id: 'supramas:ui-demo',
    jobId: 'ui-demo',
    revision: 3,
    phase: 'running',
    createdAt: 1,
    updatedAt: 2,
  },
  stage1: {
    status: 'active',
    researchTopic: 'REBCO 人工钉扎中心',
    materialScope: ['REBCO'],
    targetProperty: ['磁场下 Jc'],
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

const completed: SupraMasRunViewV1 = {
  ...running,
  run: { ...running.run, phase: 'completed', revision: 8, updatedAt: 8 },
  stage1: {
    ...running.stage1!,
    status: 'completed',
    progress: {
      acceptedPapers: 1,
      strategyLinks: 0,
      openLimitations: 0,
      builderAttempts: 1,
      reviews: 1,
    },
    nextAction: { kind: 'completed' },
  },
}

const tree: SupraMasStrategyTreeViewV1 = {
  apiVersion: 1,
  runId: completed.run.id,
  revision: completed.run.revision,
  status: 'completed',
  nodes: [{
    nodeId: 'N0',
    level: 0,
    parentId: null,
    paperId: 'paper-1',
    paperTitle: 'BZO pinning paper',
    year: 2024,
    doi: '10.0000/bzo-demo',
    url: 'https://example.invalid/paper-1',
    sourceType: 'experimental',
    notes: [],
    strategyRecords: [{
      recordId: 'R1',
      tuningDimension: 'Composition tuning',
      tuningStrategy: 'Add BZO artificial pinning centers.',
      tuningEffect: 'BZO additions improve in-field Jc.',
      evidence: { chunkId: 'paper-1-c1', page: 7, evidenceText: 'BZO additions improve in-field Jc' },
      confidence: 0.9,
    }],
    limitationRecords: [{
      limitationId: 'L1',
      limitation: 'Only one loading was measured.',
      expectation: 'Compare multiple BZO loadings.',
      relatedRecordIds: ['R1'],
      evidence: { chunkId: 'paper-1-c1', page: 7, evidenceText: 'only one loading was measured' },
      confidence: 0.8,
    }],
  }],
  edges: [],
}

const paper: SupraMasPaperEvidenceViewV1 = {
  apiVersion: 1,
  runId: completed.run.id,
  paperId: 'paper-1',
  paperTitle: 'BZO pinning paper',
  sourceType: 'experimental',
  chunks: [{ chunkId: 'paper-1-c1', page: 7, characters: 68 }],
}

const evidence: SupraMasEvidenceSliceViewV1 = {
  apiVersion: 1,
  runId: completed.run.id,
  paperId: 'paper-1',
  chunkId: 'paper-1-c1',
  page: 7,
  start: 0,
  end: 68,
  totalCharacters: 68,
  text: 'BZO additions improve in-field Jc, but only one loading was measured.',
}

const artifacts: SupraMasArtifactsViewV1 = {
  apiVersion: 1,
  runId: completed.run.id,
  ready: true,
  files: [
    { name: 'strategy_tree.json', ready: true },
    { name: 'node_review_log.jsonl', ready: true },
    { name: 'review_report.md', ready: true },
  ],
}

function port(overrides: Partial<SupraMasUiPort> = {}): SupraMasUiPort {
  return {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(completed),
    tree: vi.fn().mockResolvedValue(tree),
    paper: vi.fn().mockResolvedValue(paper),
    evidence: vi.fn().mockResolvedValue(evidence),
    artifacts: vi.fn().mockResolvedValue(artifacts),
    downloadArtifact: vi.fn().mockResolvedValue(undefined),
    createAndQueue: vi.fn().mockResolvedValue({ view: running, queued: true }),
    queue: vi.fn().mockResolvedValue({ queued: true }),
    resumeAndQueue: vi.fn().mockResolvedValue({ view: running, queued: true }),
    cancel: vi.fn().mockResolvedValue({ ...running, run: { ...running.run, phase: 'cancelled', revision: 4 } }),
    ...overrides,
  }
}

function props(api = port()): SupraMasTaskPanelProps {
  return { wide: true, api, t: makeTranslate(zh) } as SupraMasTaskPanelProps
}

async function openPanel(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: zh['trigger.label'] }))
  return screen.findByRole('dialog', { name: zh['panel.title'] })
}

describe('SupraMAS task panel shell', () => {
  it('loads into a clear empty state and closes on Escape with focus restored', async () => {
    render(<SupraMasTaskPanel {...props()} />)
    const trigger = screen.getByRole('button', { name: zh['trigger.label'] })
    const dialog = await openPanel()
    expect(await within(dialog).findByText(zh['tasks.empty'])).toBeDefined()
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: zh['action.close'] }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('shows a recoverable load failure and retries', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('暂时无法连接'))
      .mockResolvedValueOnce([])
    render(<SupraMasTaskPanel {...props(port({ list }))} />)
    const dialog = await openPanel()
    expect((await within(dialog).findByRole('alert')).textContent).toContain('暂时无法连接')

    fireEvent.click(within(dialog).getByRole('button', { name: zh['action.retry'] }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
    expect(await within(dialog).findByText(zh['tasks.empty'])).toBeDefined()
  })

  it('supports the compact rail, refresh, non-Escape keys, and tasks without Stage 1 detail', async () => {
    const finished: SupraMasRunViewV1 = {
      apiVersion: 1,
      run: {
        id: 'supramas:finished',
        jobId: 'finished',
        revision: 2,
        phase: 'completed',
        createdAt: 1,
        updatedAt: 2,
      },
    }
    const list = vi.fn().mockResolvedValue([finished])
    render(<SupraMasTaskPanel {...props(port({ list }))} wide={false} />)
    const dialog = await openPanel()
    const row = await within(dialog).findByRole('article', { name: finished.run.jobId })
    expect(within(row).getByText(finished.run.jobId)).toBeDefined()
    expect(within(row).queryByRole('button')).toBeNull()

    fireEvent.keyDown(document, { key: 'Enter' })
    expect(screen.getByRole('dialog')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: zh['action.refresh'] }))
    await waitFor(() => { expect(list).toHaveBeenCalledTimes(2) })
  })

  it('opens the accepted strategy tree, drills into local evidence, and downloads final outputs', async () => {
    const api = port({ list: vi.fn().mockResolvedValue([completed]) })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    const row = await within(dialog).findByRole('article', { name: completed.stage1!.researchTopic })

    fireEvent.click(within(row).getByRole('button', { name: zh['action.details'] }))
    const workspace = await within(dialog).findByRole('region', { name: zh['detail.title'] })
    expect(await within(workspace).findByRole('treeitem', { name: /BZO pinning paper/ })).toBeDefined()
    expect(within(workspace).getByText('Add BZO artificial pinning centers.')).toBeDefined()
    expect(api.tree).toHaveBeenCalledWith(completed.run.id)
    expect(api.paper).toHaveBeenCalledWith(completed.run.id, 'paper-1')

    fireEvent.click(within(workspace).getAllByRole('button', { name: zh['action.evidence'] })[0]!)
    expect(await within(workspace).findByText(evidence.text)).toBeDefined()
    expect(api.evidence).toHaveBeenCalledWith(completed.run.id, 'paper-1', 'paper-1-c1', 0, 4_000)

    fireEvent.click(within(workspace).getByRole('button', { name: /strategy_tree\.json/ }))
    await waitFor(() => {
      expect(api.downloadArtifact).toHaveBeenCalledWith(completed.run.id, 'strategy_tree.json')
    })
    fireEvent.click(within(workspace).getByRole('button', { name: zh['action.back'] }))
    expect(within(dialog).getByRole('heading', { name: zh['form.title'] })).toBeDefined()
  })

  it('refreshes an active detail view and stops polling after the task settles', async () => {
    const get = vi.fn()
      .mockResolvedValueOnce(running)
      .mockResolvedValue(completed)
    const activeTree: SupraMasStrategyTreeViewV1 = {
      apiVersion: 1,
      runId: running.run.id,
      revision: running.run.revision,
      status: 'active',
      nodes: [],
      edges: [],
    }
    const pendingArtifacts: SupraMasArtifactsViewV1 = {
      apiVersion: 1,
      runId: running.run.id,
      ready: false,
      files: artifacts.files.map(file => ({ ...file, ready: false })),
    }
    const api = port({
      list: vi.fn().mockResolvedValue([running]),
      get,
      tree: vi.fn().mockResolvedValue(activeTree),
      artifacts: vi.fn().mockResolvedValue(pendingArtifacts),
    })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    const row = await within(dialog).findByRole('article', { name: running.stage1!.researchTopic })
    fireEvent.click(within(row).getByRole('button', { name: zh['action.details'] }))
    await within(dialog).findByRole('region', { name: zh['detail.title'] })

    await waitFor(() => { expect(get).toHaveBeenCalledTimes(2) }, { timeout: 4_500 })
    await new Promise(resolve => window.setTimeout(resolve, 3_200))
    expect(get).toHaveBeenCalledTimes(2)
  }, 10_000)
})

describe('SupraMAS task actions', () => {
  it('creates from plain-language fields and reports automatic agent dispatch', async () => {
    const api = port()
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()

    fireEvent.change(within(dialog).getByLabelText(zh['form.topic']), {
      target: { value: ' REBCO 人工钉扎中心 ' },
    })
    fireEvent.change(within(dialog).getByLabelText(zh['form.materials']), {
      target: { value: 'REBCO, YBCO' },
    })
    fireEvent.change(within(dialog).getByLabelText(zh['form.properties']), {
      target: { value: '磁场下 Jc，角度依赖' },
    })
    fireEvent.change(within(dialog).getByLabelText(zh['form.depth']), { target: { value: '3' } })
    fireEvent.click(within(dialog).getByRole('button', { name: zh['action.create'] }))

    await waitFor(() => {
      expect(api.createAndQueue).toHaveBeenCalledWith({
        researchTopic: 'REBCO 人工钉扎中心',
        materialScope: ['REBCO', 'YBCO'],
        targetProperty: ['磁场下 Jc', '角度依赖'],
        maxDepth: 3,
      })
    })
    expect(await within(dialog).findByText(zh['notice.queued'])).toBeDefined()
    expect(within(dialog).getByText('REBCO 人工钉扎中心')).toBeDefined()
  })

  it('keeps a created task visible when no current session can execute it', async () => {
    const api = port({
      createAndQueue: vi.fn().mockResolvedValue({
        view: running,
        queued: false,
        warning: zh['notice.noSession'],
      }),
    })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    fireEvent.change(within(dialog).getByLabelText(zh['form.topic']), {
      target: { value: 'REBCO 人工钉扎中心' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: zh['action.create'] }))

    expect((await within(dialog).findByRole('status')).textContent).toContain(zh['notice.noSession'])
    expect(within(dialog).getByRole('button', { name: zh['action.execute'] })).toBeDefined()
  })

  it('resumes a recoverable task and cancels an active task', async () => {
    const recoverable: SupraMasRunViewV1 = {
      ...running,
      run: {
        ...running.run,
        phase: 'recoverable_failed',
        revision: 4,
        failure: { code: 'process-restarted', message: '进程已重启', retryable: true },
      },
    }
    const api = port({ list: vi.fn().mockResolvedValue([recoverable]) })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    const row = await within(dialog).findByRole('article', {
      name: recoverable.stage1?.researchTopic ?? recoverable.run.jobId,
    })

    fireEvent.click(within(row).getByRole('button', { name: zh['action.resume'] }))
    await waitFor(() => {
      expect(api.resumeAndQueue).toHaveBeenCalledWith(recoverable.run.id, recoverable.run.revision)
    })
    fireEvent.click(within(row).getByRole('button', { name: zh['action.cancel'] }))
    await waitFor(() => {
      expect(api.cancel).toHaveBeenCalledWith(running.run.id, running.run.revision)
    })
  })

  it('uses the generic error and ignores a second submission while the first action is busy', async () => {
    let rejectCreate: (reason?: unknown) => void = () => {}
    const createAndQueue = vi.fn(() => new Promise<never>((_resolve, reject) => {
      rejectCreate = reject
    }))
    const api = port({ createAndQueue })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    const form = within(dialog).getByRole('heading', { name: zh['form.title'] }).closest('form')!
    fireEvent.submit(form)
    expect(createAndQueue).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(zh['form.topic']), {
      target: { value: 'REBCO strain control' },
    })
    fireEvent.submit(form)
    await waitFor(() => { expect(createAndQueue).toHaveBeenCalledOnce() })
    fireEvent.submit(form)
    expect(createAndQueue).toHaveBeenCalledOnce()
    rejectCreate(undefined)
    expect((await within(dialog).findByRole('alert')).textContent).toContain(zh['error.generic'])
  })

  it('covers all dispatch outcomes and preserves sibling task rows on updates', async () => {
    const sibling: SupraMasRunViewV1 = {
      ...running,
      run: { ...running.run, id: 'supramas:sibling', jobId: 'sibling' },
      stage1: { ...running.stage1!, researchTopic: 'Sibling task' },
    }
    const queue = vi.fn()
      .mockResolvedValueOnce({ queued: false, warning: 'Choose a session' })
      .mockResolvedValueOnce({ queued: true })
      .mockResolvedValueOnce({ queued: false })
    const cancelled = { ...running, run: { ...running.run, phase: 'cancelled' as const, revision: 4 } }
    const api = port({
      list: vi.fn().mockResolvedValue([running, sibling]),
      queue,
      cancel: vi.fn().mockResolvedValue(cancelled),
    })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    const row = await within(dialog).findByRole('article', { name: running.stage1!.researchTopic })
    const execute = within(row).getByRole('button', { name: zh['action.execute'] })

    fireEvent.click(execute)
    expect((await within(dialog).findByRole('status')).textContent).toBe('Choose a session')
    fireEvent.click(execute)
    expect((await within(dialog).findByRole('status')).textContent).toBe(zh['notice.dispatched'])
    fireEvent.click(execute)
    expect((await within(dialog).findByRole('status')).textContent).toBe(zh['notice.noSession'])

    fireEvent.click(within(row).getByRole('button', { name: zh['action.cancel'] }))
    await waitFor(() => {
      expect(within(dialog).getByRole('article', { name: sibling.stage1!.researchTopic })).toBeDefined()
      expect(within(dialog).getByRole('status').textContent).toBe(zh['notice.cancelled'])
    })
  })

  it('reports no-session defaults for create and resume without custom warnings', async () => {
    const recoverable: SupraMasRunViewV1 = {
      ...running,
      run: { ...running.run, phase: 'recoverable_failed', revision: 4 },
    }
    const created: SupraMasRunViewV1 = {
      ...running,
      run: { ...running.run, id: 'supramas:new-task', jobId: 'new-task' },
      stage1: { ...running.stage1!, researchTopic: 'New task' },
    }
    const api = port({
      list: vi.fn().mockResolvedValue([recoverable]),
      createAndQueue: vi.fn().mockResolvedValue({ view: created, queued: false }),
      resumeAndQueue: vi.fn().mockResolvedValue({ view: running, queued: false }),
    })
    render(<SupraMasTaskPanel {...props(api)} />)
    const dialog = await openPanel()
    fireEvent.change(within(dialog).getByLabelText(zh['form.topic']), {
      target: { value: 'REBCO texture control' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: zh['action.create'] }))
    expect((await within(dialog).findByRole('status')).textContent).toBe(zh['notice.noSession'])

    const recoverableRow = within(dialog).getByRole('article', { name: recoverable.stage1!.researchTopic })
    fireEvent.click(within(recoverableRow).getByRole('button', { name: zh['action.resume'] }))
    await waitFor(() => {
      expect(api.resumeAndQueue).toHaveBeenCalledWith(recoverable.run.id, recoverable.run.revision)
      expect(within(dialog).getByRole('status').textContent).toBe(zh['notice.noSession'])
    })
  })
})
