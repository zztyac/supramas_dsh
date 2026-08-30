/** Browser assembly for the SupraMAS task dashboard and Session dispatch. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  SupraMasCreateStage1RequestV1,
  SupraMasRunListV1,
  SupraMasRunViewV1,
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
    '根据 next_action 使用 strategy-builder-agent 与 strategy-tree-reviewer 完成构建/审查闭环，',
    '每次结果都通过 SupraMAS Stage 1 工具写回；仅使用审查通过且有本地证据的论文节点。',
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
    const current = ctx.sessions.list.getSnapshot().current
    const session = current === undefined ? undefined : ctx.sessions.binding(current)?.session
    if (session === undefined) return { queued: false, warning: warning('notice.noSession') }
    const result = await session.prompt([{ type: 'text', text: coordinatorPrompt(view) }], 'queue')
    return result.ok ? { queued: true } : { queued: false, warning: result.error.message }
  }

  const api: SupraMasUiPort = {
    list: async () => {
      const value = unwrap<SupraMasRunListV1>(await ctx.remote.supramas.list())
      return value.items
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
