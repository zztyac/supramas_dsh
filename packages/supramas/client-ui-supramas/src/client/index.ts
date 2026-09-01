/** Browser assembly for the SupraMAS task dashboard and Session dispatch. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  SupraMasArtifactContentV1,
  SupraMasArtifactsViewV1,
  SupraMasCreateStage1RequestV1,
  SupraMasEvidenceSliceViewV1,
  SupraMasOutputNameV1,
  SupraMasPaperEvidenceViewV1,
  SupraMasRunListV1,
  SupraMasRunViewV1,
  SupraMasStrategyTreeViewV1,
} from '@deepseek-ai/dsh-api-supramas/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { SupraMasTaskPanel, type SupraMasUiPort } from './SupraMasTaskPanel.tsx'
import { en, NS, zh, type SupraMasKey } from './locales.ts'

export type { SupraMasTaskPanelProps, SupraMasUiPort } from './SupraMasTaskPanel.tsx'
export type { SupraMasKey } from './locales.ts'

interface Result<T> {
  readonly ok: boolean
  readonly value?: T
  readonly error?: { readonly code: string; readonly message: string }
}

function unwrap<T>(result: Result<T>): T {
  if (result.ok && result.value !== undefined) return result.value
  const failure = result.error
  throw new Error(failure === undefined ? 'Remote operation returned no value' : `${failure.code}: ${failure.message}`)
}

function saveArtifact(artifact: SupraMasArtifactContentV1): void {
  const url = URL.createObjectURL(new Blob([artifact.content], { type: artifact.mediaType }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = artifact.name
    anchor.rel = 'noopener'
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Build the coordinator prompt queued after a UI task operation has committed.
 * @param view - Committed public task view containing stable run identity.
 * @returns one bounded instruction for the active SupraMAS session.
 */
export function coordinatorPrompt(view: SupraMasRunViewV1): string {
  return [
    '继续执行已创建的 SupraMAS Stage 1 材料科学任务。',
    `run_id=${view.run.id}`,
    `job_id=${view.run.jobId}`,
    '先调用 supramas_stage1_get 读取持久化 next_action。',
    '根据 next_action 使用 supramas_builder 与 supramas_reviewer 完成构建和独立审查闭环。',
    '每次结果都通过 SupraMAS Stage 1 工具写回；搜索摘要只能用于发现论文，不能作为证据。',
    '当 next_action=finalize 时调用 supramas_stage1_finalize；遇到可恢复失败时保留状态并说明下一步。',
  ].join('\n')
}

/** Required browser services: slot, locale, typed Remote assembly, and Sessions. */
export const inject = ['slots', 'locale', 'remote', 'remote.supramas', 'sessions']

/** Register dictionaries and the sidebar material-task entry. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-supramas: dictionaries')

  const warning = (key: SupraMasKey): string => ctx.locale.bind(NS)(key)
  const queue = async (view: SupraMasRunViewV1): Promise<{ queued: boolean; warning?: string }> => {
    const snapshot = ctx.sessions.list.getSnapshot()
    const current = snapshot.current
    if (current === undefined) return { queued: false, warning: warning('notice.noSession') }
    const session = ctx.sessions.binding(current)?.session
    if (session === undefined) return { queued: false, warning: warning('notice.noSession') }
    if (snapshot.byId[current]?.projectionValues?.agentPreset !== 'supramas') {
      return { queued: false, warning: warning('notice.wrongPreset') }
    }
    const result = await session.prompt([{ type: 'text', text: coordinatorPrompt(view) }], 'queue')
    return result.ok ? { queued: true } : { queued: false, warning: result.error.message }
  }

  const api: SupraMasUiPort = {
    list: async () => {
      const value = unwrap<SupraMasRunListV1>(await ctx.remote.supramas.list())
      return value.items
    },
    get: async runId => unwrap<SupraMasRunViewV1>(await ctx.remote.supramas.get(runId)),
    tree: async runId => unwrap<SupraMasStrategyTreeViewV1>(await ctx.remote.supramas.tree(runId)),
    paper: async (runId, paperId) =>
      unwrap<SupraMasPaperEvidenceViewV1>(await ctx.remote.supramas.paper(runId, paperId)),
    evidence: async (runId, paperId, chunkId, start, maxCharacters) =>
      unwrap<SupraMasEvidenceSliceViewV1>(
        await ctx.remote.supramas.evidence(runId, paperId, chunkId, start, maxCharacters),
      ),
    artifacts: async runId =>
      unwrap<SupraMasArtifactsViewV1>(await ctx.remote.supramas.artifacts(runId)),
    downloadArtifact: async (runId: string, name: SupraMasOutputNameV1) => {
      const artifact = unwrap<SupraMasArtifactContentV1>(await ctx.remote.supramas.artifact(runId, name))
      saveArtifact(artifact)
    },
    createAndQueue: async (request: SupraMasCreateStage1RequestV1) => {
      const view = unwrap<SupraMasRunViewV1>(await ctx.remote.supramas.createStage1(request))
      return { view, ...await queue(view) }
    },
    queue,
    resumeAndQueue: async (runId, revision) => {
      const view = unwrap<SupraMasRunViewV1>(await ctx.remote.supramas.resume(runId, revision))
      return { view, ...await queue(view) }
    },
    cancel: async (runId, revision) =>
      unwrap<SupraMasRunViewV1>(await ctx.remote.supramas.cancel(runId, revision)),
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'supramas-task-panel',
    order: 10,
    locale: NS,
    inject: () => ({ api }),
  }, SupraMasTaskPanel))
}
