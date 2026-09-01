---
description: "具有可执行恢复信封的窄范围 SupraMAS 运行与证据模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

[English](README.md) | 中文

## 概述

本消费者在 SupraMAS 服务上暴露十一个编排安全工具：四个运行控制、五个持久 Stage 1 工作流控制、一个兼容文件修复控制，以及一个逐字证据核验器。旧论文写入、手工文本块变更和整篇产物读取工具已从模型侧移除，避免绕过已验证 PDF 导入。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 `@deepseek-ai/dsh-tools`、DSH 存储栈、`@deepseek-ai/dsh-subagent`、`@deepseek-ai/dsh-supramas` 和 `@deepseek-ai/dsh-supramas-artifacts` 之后组合本包。默认 `orchestrated` 模式下，coordinator 只向 builder 或 reviewer 提交工具提供 `run_id` 和精确的当前 `revision`。工具会启动一个隔离且受 schema 约束的子智能体，应用角色专属工具过滤器，并原子持久化结构化交接结果与子任务运行 ID。内置 `supramas` preset 使用该模式，不暴露通用子智能体工具。

每次交接默认最多运行 600,000 ms。Builder 启动前，工具会列出当前运行中已经导入且可复用的全文论文；只要存在可用论文，本次子调用就会移除检索与导入工具，要求它读取一篇已有论文，避免重复下载。否则，发现阶段会获得有界的结构化检索、网页检索和导入能力，使索引 PDF 被阻断时可以改用同一候选论文的公开 PDF 直链。

<a id="understand-the-implementation"></a>

## 实现说明

`src/index.ts` 管理十一个 schema，并把运行时和领域失败映射为根因、安全重试与停止条件。证据策略和边语义失败具有独立稳定 code。Builder 与 reviewer 的输出 schema 封闭、子任务深度为一，且工具白名单分别受限。Builder 返回前必须核验每条拟议逐字引文，reviewer 之后再独立重复核验。当引文只是片段或缺少声明的数值时，确定性证据审计会把模型的 `accept` 转换为 `revise`。完成操作导出文件契约，`supramas_artifacts_sync` 从持久状态修复中断的导出；每次工作流修改都要求使用上一调用返回的精确 revision。`direct` 模式仅供可信集成调用方和测试使用，不得在模型侧 preset 中暴露。

失败的原子交接不会增加工作流 revision 或尝试计数。当前进程第一次失败后，会按运行、revision 和角色锁定该交接键；重复调用只返回 `SUPRAMAS_SUBAGENT_HANDOFF_FAILED`，不会再启动高成本子任务。后续新进程可以从同一 revision 恢复并再尝试一次。

<a id="model-experience"></a>

## 模型体验

### 运行与证据工具

#### 模型看到什么

只看到十一个 SupraMAS 控制工具。Coordinator 不能提供、修复或替换 builder/reviewer 载荷：两个提交工具都只接受运行标识与 revision，再在内部完成委派。`supramas_run_list` 用于重启后发现任务，`supramas_artifacts_sync` 修复兼容文件，`supramas_evidence_verify` 返回含 `evidence_kind` 的精简证明。论文发现、导入、列表和分片读取只在 builder 交接中可见；有界读取与逐字核验只在审查中可见。

#### Token 影响

可见 schema 带来固定成本。运行列表随持久任务数增长，证据核验始终有界。

#### KV Cache 影响

只要工具定义和角色可见性稳定，请求前缀即可稳定。增加或移除可见工具可能使缓存失效。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 本包不能创建或修改证据产物；该权限只属于已验证的文献导入流水线。
- 正确角色隔离要求选择内置 `supramas` preset；UI 会拒绝把编排任务加入其他 preset。
- 默认模式要求配置子智能体 provider。Provider 失败时 Stage 1 revision 保持不变，但同一进程不得重复调用相同提交；应在新进程中从精确 revision 恢复并只重试一次。

<a id="dev-note"></a>

### 开发备注

模型参数保持 snake-case，能力类型保持 camel-case。不得绕过 revision 检查， 不得把证据不匹配变成成功，也不得隐藏意外异常。
