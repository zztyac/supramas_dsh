import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import {
  IconCloseOutline16,
  IconDataOutline16,
  IconPlayOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SupraMasArtifactsViewV1,
  SupraMasCreateStage1RequestV1,
  SupraMasEvidenceSliceViewV1,
  SupraMasOutputNameV1,
  SupraMasPaperEvidenceViewV1,
  SupraMasRunViewV1,
  SupraMasStrategyTreeViewV1,
} from '@deepseek-ai/dsh-api-supramas/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS, type SupraMasKey } from './locales.ts'
import { SupraMasTaskWorkspace } from './SupraMasTaskWorkspace.tsx'
import css from './SupraMasTaskPanel.module.css'

/** UI-to-data seam; the component never reaches a Remote or Session directly. */
export interface SupraMasUiPort {
  readonly list: () => Promise<readonly SupraMasRunViewV1[]>
  readonly get: (runId: string) => Promise<SupraMasRunViewV1>
  readonly tree: (runId: string) => Promise<SupraMasStrategyTreeViewV1>
  readonly paper: (runId: string, paperId: string) => Promise<SupraMasPaperEvidenceViewV1>
  readonly evidence: (
    runId: string,
    paperId: string,
    chunkId: string,
    start: number,
    maxCharacters: number,
  ) => Promise<SupraMasEvidenceSliceViewV1>
  readonly artifacts: (runId: string) => Promise<SupraMasArtifactsViewV1>
  readonly downloadArtifact: (runId: string, name: SupraMasOutputNameV1) => Promise<void>
  readonly createAndQueue: (request: SupraMasCreateStage1RequestV1) => Promise<{
    readonly view: SupraMasRunViewV1
    readonly queued: boolean
    readonly warning?: string
  }>
  readonly queue: (view: SupraMasRunViewV1) => Promise<{ readonly queued: boolean; readonly warning?: string }>
  readonly resumeAndQueue: (runId: string, revision: number) => Promise<{
    readonly view: SupraMasRunViewV1
    readonly queued: boolean
    readonly warning?: string
  }>
  readonly cancel: (runId: string, revision: number) => Promise<SupraMasRunViewV1>
}

/** Full sidebar-footer panel props. */
export type SupraMasTaskPanelProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<typeof NS>
  & { readonly api: SupraMasUiPort }

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function entries(value: string): string[] {
  return value
    .split(/[,，;；\n]+/)
    .map(item => item.trim())
    .filter(item => item.length > 0)
}

function statusKey(phase: SupraMasRunViewV1['run']['phase']): SupraMasKey {
  return `status.${phase}`
}

function nextKey(view: SupraMasRunViewV1): SupraMasKey | undefined {
  return view.stage1 === undefined ? undefined : `next.${view.stage1.nextAction.kind}`
}

function replaceTask(
  tasks: readonly SupraMasRunViewV1[],
  task: SupraMasRunViewV1,
): SupraMasRunViewV1[] {
  const index = tasks.findIndex(candidate => candidate.run.id === task.run.id)
  if (index < 0) return [task, ...tasks]
  return tasks.map(candidate => candidate.run.id === task.run.id ? task : candidate)
}

/** Accessible material-task dashboard mounted from the sidebar footer. */
export function SupraMasTaskPanel({ wide, api, t }: SupraMasTaskPanelProps) {
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<readonly SupraMasRunViewV1[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [topic, setTopic] = useState('')
  const [materials, setMaterials] = useState('')
  const [properties, setProperties] = useState('')
  const [depth, setDepth] = useState(2)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(undefined)
    }
    try {
      setTasks(await api.list())
    } catch (loadError: unknown) {
      if (!silent) setError(messageOf(loadError, t('error.generic')))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [api, t])

  useEffect(() => {
    if (!open) return
    void load()
    closeRef.current?.focus()
  }, [load, open])

  const close = useCallback(() => {
    setOpen(false)
    setSelectedRunId(undefined)
    triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open || selectedRunId !== undefined || !tasks.some(task =>
      !['completed', 'failed', 'cancelled'].includes(task.run.phase))) return
    const timer = window.setInterval(() => { void load(true) }, 3_000)
    return () => { window.clearInterval(timer) }
  }, [load, open, selectedRunId, tasks])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [close, open])

  const act = useCallback(async (operation: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      await operation()
    } catch (actionError: unknown) {
      setError(messageOf(actionError, t('error.generic')))
    } finally {
      setBusy(false)
    }
  }, [busy, t])

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const researchTopic = topic.trim()
    if (researchTopic.length === 0) return
    void act(async () => {
      const result = await api.createAndQueue({
        researchTopic,
        materialScope: entries(materials),
        targetProperty: entries(properties),
        maxDepth: depth,
      })
      setTasks(current => replaceTask(current, result.view))
      setNotice(result.warning ?? (result.queued ? t('notice.queued') : t('notice.noSession')))
      setTopic('')
      setMaterials('')
      setProperties('')
    })
  }

  const queue = (task: SupraMasRunViewV1) => {
    void act(async () => {
      const result = await api.queue(task)
      setNotice(result.warning ?? (result.queued ? t('notice.dispatched') : t('notice.noSession')))
    })
  }

  const resume = (task: SupraMasRunViewV1) => {
    void act(async () => {
      const result = await api.resumeAndQueue(task.run.id, task.run.revision)
      setTasks(current => replaceTask(current, result.view))
      setNotice(result.warning ?? (result.queued ? t('notice.resumed') : t('notice.noSession')))
    })
  }

  const cancel = (task: SupraMasRunViewV1) => {
    void act(async () => {
      const updated = await api.cancel(task.run.id, task.run.revision)
      setTasks(current => replaceTask(current, updated))
      setNotice(t('notice.cancelled'))
    })
  }

  const updateTask = useCallback((updated: SupraMasRunViewV1) => {
    setTasks(current => replaceTask(current, updated))
  }, [])

  const selectedTask = tasks.find(task => task.run.id === selectedRunId)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`${css.trigger} ${wide ? '' : css.rail}`}
        aria-label={t('trigger.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(true) }}
      >
        <IconDataOutline16 size={wide ? 16 : 18} />
        {wide && <span>{t('trigger.label')}</span>}
      </button>
      {open && (
        <div className={css.overlay} role="presentation">
          <div className={css.mask} aria-hidden="true" onClick={close} />
          <section className={css.panel} role="dialog" aria-modal="true" aria-labelledby="supramas-panel-title">
            <header className={css.header}>
              <div>
                <h2 id="supramas-panel-title">{t('panel.title')}</h2>
                <p>{t('panel.subtitle')}</p>
              </div>
              <div className={css.headerActions}>
                <button type="button" className={css.iconButton} aria-label={t('action.refresh')} onClick={() => { void load() }}>
                  <IconRefreshOutline16 size={16} />
                </button>
                <button ref={closeRef} type="button" className={css.iconButton} aria-label={t('action.close')} onClick={close}>
                  <IconCloseOutline16 size={16} />
                </button>
              </div>
            </header>

            {selectedTask === undefined ? (
              <div className={css.content}>
                <form className={css.form} onSubmit={create}>
                  <h3>{t('form.title')}</h3>
                  <label>
                    <span>{t('form.topic')}</span>
                    <textarea
                      value={topic}
                      placeholder={t('form.topicPlaceholder')}
                      rows={3}
                      onChange={(event) => { setTopic(event.target.value) }}
                    />
                  </label>
                  <div className={css.formGrid}>
                    <label>
                      <span>{t('form.materials')}</span>
                      <input
                        value={materials}
                        placeholder={t('form.materialsPlaceholder')}
                        onChange={(event) => { setMaterials(event.target.value) }}
                      />
                    </label>
                    <label>
                      <span>{t('form.properties')}</span>
                      <input
                        value={properties}
                        placeholder={t('form.propertiesPlaceholder')}
                        onChange={(event) => { setProperties(event.target.value) }}
                      />
                    </label>
                  </div>
                  <div className={css.formFooter}>
                    <label>
                      <span>{t('form.depth')}</span>
                      <select value={depth} onChange={(event) => { setDepth(Number(event.target.value)) }}>
                        {[0, 1, 2, 3].map(value => (
                          <option key={value} value={value}>{t(`form.depth.${value}` as SupraMasKey)}</option>
                        ))}
                      </select>
                    </label>
                    <button className={css.primary} type="submit" disabled={busy || topic.trim().length === 0}>
                      <IconPlayOutline16 size={16} />
                      {t('action.create')}
                    </button>
                  </div>
                </form>

                <section className={css.tasks}>
                  <div className={css.tasksHeader}>
                    <h3>{t('tasks.title')}</h3>
                    <span>{tasks.length}</span>
                  </div>
                  {error !== undefined && (
                    <div className={css.error} role="alert">
                      <span>{error}</span>
                      <button type="button" onClick={() => { void load() }}>{t('action.retry')}</button>
                    </div>
                  )}
                  {notice !== undefined && <p className={css.notice} role="status">{notice}</p>}
                  {loading && <p className={css.empty}>{t('tasks.loading')}</p>}
                  {!loading && error === undefined && tasks.length === 0 && <p className={css.empty}>{t('tasks.empty')}</p>}
                  <div className={css.taskList}>
                    {tasks.map((task) => {
                      const next = nextKey(task)
                      const progress = task.stage1?.progress
                      const canCancel = !['completed', 'failed', 'cancelled'].includes(task.run.phase)
                      return (
                        <article key={task.run.id} className={css.task} aria-label={task.stage1?.researchTopic ?? task.run.jobId}>
                          <div className={css.taskTop}>
                            <div>
                              <h4>{task.stage1?.researchTopic ?? task.run.jobId}</h4>
                              {next !== undefined && <p>{t(next)}</p>}
                            </div>
                            <span className={css.status} data-phase={task.run.phase}>{t(statusKey(task.run.phase))}</span>
                          </div>
                          {progress !== undefined && (
                            <div className={css.metrics}>
                              <span>{t('progress.papers', { count: progress.acceptedPapers })}</span>
                              <span>{t('progress.links', { count: progress.strategyLinks })}</span>
                              <span>{t('progress.limitations', { count: progress.openLimitations })}</span>
                              <span>{t('progress.attempts', { count: progress.builderAttempts })}</span>
                              <span>{t('progress.reviews', { count: progress.reviews })}</span>
                            </div>
                          )}
                          {task.run.failure !== undefined && <p className={css.failure}>{task.run.failure.message}</p>}
                          <div className={css.taskActions}>
                            {task.stage1 !== undefined && (
                              <button type="button" disabled={busy} onClick={() => { setSelectedRunId(task.run.id) }}>
                                {t('action.details')}
                              </button>
                            )}
                            {task.run.phase === 'recoverable_failed' && (
                              <button type="button" disabled={busy} onClick={() => { resume(task) }}>{t('action.resume')}</button>
                            )}
                            {task.run.phase === 'running' && (
                              <button type="button" disabled={busy} onClick={() => { queue(task) }}>{t('action.execute')}</button>
                            )}
                            {canCancel && (
                              <button type="button" className={css.danger} disabled={busy} onClick={() => { cancel(task) }}>
                                {t('action.cancel')}
                              </button>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              </div>
            ) : (
              <SupraMasTaskWorkspace
                initial={selectedTask}
                api={api}
                t={t}
                onBack={() => { setSelectedRunId(undefined) }}
                onViewUpdate={updateTask}
              />
            )}
          </section>
        </div>
      )}
    </>
  )
}
