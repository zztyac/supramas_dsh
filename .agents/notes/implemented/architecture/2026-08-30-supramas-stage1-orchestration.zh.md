# Agent Note：SupraMAS 持久化 Stage 1 编排

Status: implemented

[English](2026-08-30-supramas-stage1-orchestration.md) | 中文

## 问题

Codex 原生 SupraMAS 工作流把最关键的科学控制交给提示约定：builder 提议一篇论文，reviewer 执行 accept、revise 或 reject，coordinator 再递归展开每条已接收 limitation。只把提示复制到 DSH，无法证明审查确实发生、被拒候选没有进入树、重试消耗了真实预算，或重启后恢复到精确的待处理交接。

## 决策

`@deepseek-ai/dsh-supramas-domain` 管理纯 Stage 1 状态机。它从持久状态推导唯一合法的 `nextStage1Action`：构建 root、为一条 limitation frontier 构建 child、审查候选、修改同一论文、最终化，或报告失败/完成。只有 reviewer 接收才能把待审候选移入策略树。运行时分配拓扑标识，并把父 limitation expectation 复制进 edge，因此 builder 无法自行决定祖先关系。

每条已接收 limitation 都成为 frontier。frontier 只能通过已接收 edge、真实 builder 尝试预算耗尽、配置的深度/宽度限制或全局 child 目标关闭。仍有开放 frontier 时禁止最终化；最终化会再次运行严格策略树与本地证据校验。

`@deepseek-ai/dsh-supramas` 把工作流、运行快照和证据目录保存在同一 storage-domain 行中。启动、builder 提交、reviewer 提交与最终化都是递增运行 revision 的 CAS 修改。启动时会用重建的本地证据重新校验工作流；被中断任务改为 `recoverable_failed`，但不会丢失待处理动作。

内置 preset 用两个前台 one-shot 工具替代通用委派。`supramas_builder` 可以使用 skills、DSH web search/fetch 和证据写入工具；`supramas_reviewer` 只能读取本地产物并核验引文。coordinator 获得五个 `supramas_stage1_*` 工具，并把每个子智能体结果提交到持久门。

## 考虑过的替代方案

**只在 coordinator persona 中编排。** 这种方式灵活，但无法阻止跳过审查、旧 revision 写入或过早最终化。

**只保存已接收节点。** 重启会丢失待处理 reviewer 反馈与重试计数，导致重复调用或无限重试。

**两个角色共用通用 subagent。** 只靠提示选择角色，会让 reviewer 仍有能力修改证据，也让 builder 有能力声称接收。两个独立配置工具会同时强制提示可见性和执行权限。

## 结果

- Builder/reviewer 交接具有确定性、可恢复性和 CAS 保护。
- 待审候选不会出现在已接收策略树中。
- 递归完成具有明确终止原因，不再静默截断。
- 状态机保留现有 snake-case paper-node 与 edge 契约。
- 子智能体输出仍是模型生成 JSON；无效输出会被持久领域边界拒绝，必须修正。
- 当前可使用 DSH web search/fetch；专用学术索引与 PDF 导入 provider 仍是独立后续工作。

## 验证

测试覆盖 revise 后才能 accept、递归 frontier 关闭、重试耗尽、无效 edge、重复祖先论文、过早最终化、精确重启恢复、旧 revision、面向模型的 start/build/review/finalize 工具、角色白名单、preset YAML 和 Loader 组合。聚焦 TypeScript 编译与仓库门禁覆盖所有修改包。
