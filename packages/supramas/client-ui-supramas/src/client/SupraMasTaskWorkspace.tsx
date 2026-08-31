import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react'
import type {
  SupraMasArtifactsViewV1,
  SupraMasEvidenceSliceViewV1,
  SupraMasOutputNameV1,
  SupraMasPaperEvidenceViewV1,
  SupraMasRunViewV1,
  SupraMasStrategyTreeViewV1,
  SupraMasTreeNodeV1,
} from '@deepseek-ai/dsh-api-supramas/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SupraMasUiPort } from './SupraMasTaskPanel.tsx'
import { NS } from './locales.ts'
import css from './SupraMasTaskPanel.module.css'

const POLL_INTERVAL_MS = 3_000

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}

function terminal(view: SupraMasRunViewV1): boolean {
  return ['completed', 'failed', 'cancelled'].includes(view.run.phase)
}

interface Props extends PropsLocale<typeof NS> {
  readonly initial: SupraMasRunViewV1
  readonly api: SupraMasUiPort
  readonly onBack: () => void
  readonly onViewUpdate: (view: SupraMasRunViewV1) => void
}

/** Accepted-tree, evidence, and deliverable workspace for one durable material task. */
export function SupraMasTaskWorkspace({ initial, api, onBack, onViewUpdate, t }: Props) {
  const [view, setView] = useState(initial)
  const [tree, setTree] = useState<SupraMasStrategyTreeViewV1>()
  const [artifacts, setArtifacts] = useState<SupraMasArtifactsViewV1>()
  const [selectedNodeId, setSelectedNodeId] = useState<string>()
  const [paper, setPaper] = useState<SupraMasPaperEvidenceViewV1>()
  const [evidence, setEvidence] = useState<SupraMasEvidenceSliceViewV1>()
  const [loading, setLoading] = useState(true)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [busyOutput, setBusyOutput] = useState<SupraMasOutputNameV1>()
  const [error, setError] = useState<string>()

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(undefined)
    try {
      const [nextView, nextTree, nextArtifacts] = await Promise.all([
        api.get(initial.run.id),
        api.tree(initial.run.id),
        api.artifacts(initial.run.id),
      ])
      setView(nextView)
      setTree(nextTree)
      setArtifacts(nextArtifacts)
      setSelectedNodeId(current => current ?? nextTree.nodes[0]?.nodeId)
      onViewUpdate(nextView)
    } catch (loadError: unknown) {
      setError(messageOf(loadError, t('error.generic')))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [api, initial.run.id, onViewUpdate, t])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (terminal(view)) return
    const timer = window.setInterval(() => { void load(true) }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [load, view])

  const selectedNode = useMemo(
    () => tree?.nodes.find(node => node.nodeId === selectedNodeId),
    [selectedNodeId, tree],
  )

  useEffect(() => {
    if (selectedNode === undefined) {
      setPaper(undefined)
      setEvidence(undefined)
      return
    }
    let current = true
    setPaper(undefined)
    setEvidence(undefined)
    void api.paper(view.run.id, selectedNode.paperId).then((next) => {
      if (current) setPaper(next)
    }).catch((paperError: unknown) => {
      if (current) setError(messageOf(paperError, t('error.generic')))
    })
    return () => { current = false }
  }, [api, selectedNode, t, view.run.id])

  const readEvidence = (node: SupraMasTreeNodeV1, chunkId: string) => {
    if (evidenceLoading) return
    setEvidenceLoading(true)
    setError(undefined)
    void api.evidence(view.run.id, node.paperId, chunkId, 0, 4_000)
      .then(setEvidence)
      .catch((readError: unknown) => { setError(messageOf(readError, t('error.generic'))) })
      .finally(() => { setEvidenceLoading(false) })
  }

  const download = (name: SupraMasOutputNameV1) => {
    if (busyOutput !== undefined) return
    setBusyOutput(name)
    setError(undefined)
    void api.downloadArtifact(view.run.id, name)
      .catch((downloadError: unknown) => { setError(messageOf(downloadError, t('error.generic'))) })
      .finally(() => { setBusyOutput(undefined) })
  }

  const progress = view.stage1?.progress
  const incoming = selectedNode === undefined
    ? undefined
    : tree?.edges.find(edge => edge.childNodeId === selectedNode.nodeId)

  return (
    <section className={css.workspace} role="region" aria-label={t('detail.title')}>
      <header className={css.workspaceHeader}>
        <button type="button" className={css.backButton} onClick={onBack}>{t('action.back')}</button>
        <div className={css.workspaceHeading}>
          <div>
            <h3>{view.stage1?.researchTopic ?? view.run.jobId}</h3>
            <p>{t('detail.subtitle')}</p>
          </div>
          <span className={css.liveState} data-terminal={terminal(view)}>{terminal(view) ? t('detail.settled') : t('detail.live')}</span>
        </div>
        {progress !== undefined && (
          <div className={css.detailMetrics} aria-label={t('tasks.title')}>
            <span><strong>{progress.acceptedPapers}</strong>{t('detail.metricPapers')}</span>
            <span><strong>{progress.strategyLinks}</strong>{t('detail.metricLinks')}</span>
            <span><strong>{progress.openLimitations}</strong>{t('detail.metricOpen')}</span>
            <span><strong>{progress.reviews}</strong>{t('detail.metricReviews')}</span>
          </div>
        )}
      </header>

      {error !== undefined && (
        <div className={css.workspaceError} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => { void load() }}>{t('action.retry')}</button>
        </div>
      )}

      {loading && <p className={css.workspaceLoading}>{t('detail.loading')}</p>}
      {!loading && tree !== undefined && (
        <div className={css.workspaceGrid}>
          <section className={css.treePane} aria-labelledby="supramas-tree-heading">
            <div className={css.sectionHeading}>
              <h4 id="supramas-tree-heading">{t('detail.tree')}</h4>
              <span>{tree.nodes.length}</span>
            </div>
            {tree.nodes.length === 0 && <p className={css.workspaceEmpty}>{t('detail.treeEmpty')}</p>}
            <div className={css.treeList} role="tree">
              {tree.nodes.map(node => (
                <button
                  key={node.nodeId}
                  type="button"
                  role="treeitem"
                  aria-level={node.level + 1}
                  aria-selected={node.nodeId === selectedNodeId}
                  className={css.treeNode}
                  style={{ '--tree-level': node.level } as CSSProperties}
                  onClick={() => { setSelectedNodeId(node.nodeId) }}
                >
                  <span className={css.treeMarker}>{node.level + 1}</span>
                  <span>
                    <strong>{node.paperTitle}</strong>
                    <small>{[node.year, node.sourceType].filter(Boolean).join(' · ')}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={css.paperPane} aria-live="polite">
            {selectedNode === undefined && <p className={css.workspaceEmpty}>{t('detail.selectPaper')}</p>}
            {selectedNode !== undefined && (
              <>
                <div className={css.paperHeader}>
                  <div>
                    <span className={css.paperKicker}>{t('detail.paper')}</span>
                    <h4>{selectedNode.paperTitle}</h4>
                    <p>{[selectedNode.year, selectedNode.doi].filter(Boolean).join(' · ')}</p>
                  </div>
                  {selectedNode.url !== null && (
                    <a href={selectedNode.url} target="_blank" rel="noreferrer">{t('detail.source')}</a>
                  )}
                </div>

                {incoming !== undefined && (
                  <div className={css.bridge}>
                    <strong>{t('detail.bridge')}</strong>
                    <span>{incoming.parentExpectation}</span>
                    <p>{incoming.edgeRationale}</p>
                  </div>
                )}

                <div className={css.recordColumns}>
                  <section>
                    <h5>{t('detail.strategies')}</h5>
                    {selectedNode.strategyRecords.map(record => (
                      <article key={record.recordId} className={css.recordCard}>
                        <div className={css.recordMeta}>
                          <span>{record.tuningDimension}</span>
                          <span>{Math.round(record.confidence * 100)}%</span>
                        </div>
                        <strong>{record.tuningStrategy}</strong>
                        <p>{record.tuningEffect}</p>
                        <blockquote>{record.evidence.evidenceText}</blockquote>
                        <button
                          type="button"
                          disabled={evidenceLoading}
                          onClick={() => { readEvidence(selectedNode, record.evidence.chunkId) }}
                        >{t('action.evidence')}</button>
                      </article>
                    ))}
                  </section>
                  <section>
                    <h5>{t('detail.limitations')}</h5>
                    {selectedNode.limitationRecords.map(record => (
                      <article key={record.limitationId} className={`${css.recordCard} ${css.limitationCard}`}>
                        <div className={css.recordMeta}>
                          <span>{record.limitationId}</span>
                          <span>{Math.round(record.confidence * 100)}%</span>
                        </div>
                        <strong>{record.limitation}</strong>
                        <p>{record.expectation}</p>
                        <blockquote>{record.evidence.evidenceText}</blockquote>
                        <button
                          type="button"
                          disabled={evidenceLoading}
                          onClick={() => { readEvidence(selectedNode, record.evidence.chunkId) }}
                        >{t('action.evidence')}</button>
                      </article>
                    ))}
                  </section>
                </div>

                <section className={css.evidencePanel} aria-labelledby="supramas-evidence-heading">
                  <div className={css.sectionHeading}>
                    <h5 id="supramas-evidence-heading">{t('detail.evidence')}</h5>
                    <span>{paper?.chunks.length ?? 0}</span>
                  </div>
                  <div className={css.chunkList}>
                    {paper?.chunks.map(chunk => (
                      <button
                        key={chunk.chunkId}
                        type="button"
                        aria-pressed={evidence?.chunkId === chunk.chunkId}
                        onClick={() => { readEvidence(selectedNode, chunk.chunkId) }}
                      >{t('detail.chunk', { page: chunk.page ?? '—' })}</button>
                    ))}
                  </div>
                  {evidence === undefined
                    ? <p className={css.workspaceEmpty}>{t('detail.evidenceEmpty')}</p>
                    : (
                      <div className={css.evidenceText}>
                        <span>{t('detail.range', { start: evidence.start + 1, end: evidence.end, total: evidence.totalCharacters })}</span>
                        <p>{evidence.text}</p>
                      </div>
                    )}
                </section>

                <section className={css.outputs} aria-labelledby="supramas-outputs-heading">
                  <div className={css.sectionHeading}>
                    <h5 id="supramas-outputs-heading">{t('detail.outputs')}</h5>
                    <span>{artifacts?.files.filter(file => file.ready).length ?? 0}/3</span>
                  </div>
                  <div className={css.outputList}>
                    {artifacts?.files.map(file => (
                      <button
                        key={file.name}
                        type="button"
                        disabled={!file.ready || busyOutput !== undefined}
                        onClick={() => { download(file.name) }}
                      >
                        <span>{file.name}</span>
                        <small>{file.ready ? t('action.download') : t('detail.outputPending')}</small>
                      </button>
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  )
}
