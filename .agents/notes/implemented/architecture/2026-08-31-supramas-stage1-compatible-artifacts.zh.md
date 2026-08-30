# Agent Note: SupraMAS Stage 1 兼容产物

Status: implemented

[English](2026-08-31-supramas-stage1-compatible-artifacts.md) | 中文

## 问题

持久化 SupraMAS 运行时保存了运行、证据和 builder/reviewer 状态，但其 `runs/<jobId>` 路径只是溯源标识，不是真实文件。Codex 原生 Stage 1 流程和下游材料科学工具需要已批准的 `input_task.yaml`、论文元数据与文本块、重启状态和三项最终成果。让这些文件成为权威来源会复制带 revision 的状态机，而只在完成时导出一次，则无法处理持久完成成功但文件系统写入失败的情况。

## 决策

`@deepseek-ai/dsh-supramas-artifacts` 是独立 Cordis 服务，挂载在 `ctx.supramas` 之后、API 或工具消费者之前。它把经过校验的独立状态投影为一个必填绝对工作区根目录下的标准运行布局。路径解析拒绝目录逃逸，写入通过共享原子写工具发布完整文件，串行操作队列防止并发导出交错。

Stage 1 启动时写入 `input_task.yaml`；注册论文和抽取文本块时刷新所属论文 JSON；完成时写入完整任务、已接受论文、`tree_state.json`、`strategy_tree.json`、`node_review_log.jsonl` 和 `review_report.md`。未变化的持久状态在重复导出时生成完全相同的字节。`supramas_artifacts_sync` 在活动工作中修复任务文件，或在持久完成后修复完整契约，因此运行不会为了匹配部分文件而回退。

任务渲染器保留证据策略、include/exclude 指引、材料范围、目标属性、可空宽度控制和原始 Stage 1 重试语义。API 默认使用深度三和三次子节点尝试，与 Codex 原生任务契约一致。版本化 Remote API 只公开三项最终成果名称和就绪状态，绝对 Host 路径保持私有。

## 考虑过的替代方案

**把渲染文件作为持久记录。** 拒绝，因为文件系统文件不提供 storage-domain 的 compare-and-set revision、重启校验或原子工作流转换权限。

**只在完成操作中导出且不提供修复操作。** 拒绝，因为持久完成和多次文件发布无法组成同一事务。持久提交后的进程或磁盘失败需要幂等恢复入口。

**导出失败时回退已完成运行。** 拒绝，因为这会为了可恢复的投影失败而丢弃经过校验的科学决策，并可能重新打开已经接受的 builder/reviewer 工作。

**增加通用 YAML 序列化器。** 拒绝，因为兼容文档采用较小的闭合 schema，本次仓库变更不需要新增运行时依赖。专用渲染器对每个字符串加引号，并拥有固定 Stage 1 字段顺序。

## 影响

- 现有 Codex 原生 Stage 1 消费者可以读取标准运行文件，而 DSH 持久状态仍是唯一修改权限。
- 导出重试安全且确定，包括从部分文件发布中恢复已完成运行的场景。
- API 和浏览器客户端可以报告成果就绪状态，而不会获知工作区根目录。
- 兼容服务写入已存论文元数据和文本块，但不获取或解析 PDF。
- bundle 加载顺序包含运行时、产物写入器、API、模型工具和浏览器 UI。

## 验证

产物测试驱动 revise 到 accept 的编排，连续两次导出精确六文件黄金契约，并比较每个字节。工具和 API 测试覆盖自动同步、修复、浏览器安全就绪状态、默认值和运行不存在失败。真实 Loader 组合挂载服务依赖；无 Key 的 HTTP/SSE canary 证明模型发起 SupraMAS 工具调用，以及隔离 `supramas_builder` 到 `supramas_reviewer` 的交接。有 `DEEPSEEK_API_KEY` 时，凭据门控 canary 会在官方 provider 上执行同一 overlay。

## 相关记录

- [持久运行恢复](2026-08-30-supramas-durable-run-recovery.zh.md)
- [Stage 1 编排](2026-08-30-supramas-stage1-orchestration.zh.md)
- [任务 API 和面板](2026-08-30-supramas-task-api-and-dashboard.zh.md)
