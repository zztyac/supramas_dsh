---
description: "具有可执行恢复信封的窄范围 SupraMAS 运行与证据模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

[English](README.md) | 中文

## 概述

本消费者在 SupraMAS 服务上暴露十四个工具：四个运行控制、五个持久 Stage 1 工作流控制、一个兼容文件修复控制，以及四个证据控制。每个工具都会校验参数并返回统一信封；工作流响应包含结构化 `workflow`、`next_action` 和最终 `tree`。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 `@deepseek-ai/dsh-tools`、DSH 存储栈、`@deepseek-ai/dsh-supramas` 和 `@deepseek-ai/dsh-supramas-artifacts` 之后组合本包。模型参数保持 snake-case。coordinator 拥有 `supramas_stage1_*` 和 `supramas_artifacts_sync`；builder 使用论文/文本块工具；reviewer 使用产物读取/证据核验。内置 preset 暴露前台 `supramas_builder` 与 `supramas_reviewer` 子智能体，并强制执行各自 toolFilter。

<a id="understand-the-implementation"></a>

## 实现说明

`src/index.ts` 管理十四个 schema，并把运行时和领域失败映射为根因、安全重试与停止条件。完成操作会导出文件契约，`supramas_artifacts_sync` 则从持久状态修复中断的导出。每次工作流修改都要求使用上一调用返回的精确 revision。领域失败仍作为成功的工具传输值返回，意外编程故障继续抛出；Cordis disposer 会在 HMR 时移除全部工具。

<a id="model-experience"></a>

## 模型体验

### 运行与证据工具

#### 模型看到什么

只看到所选角色允许的工具。`supramas_run_list` 用于重启后发现任务，`supramas_artifacts_sync` 修复兼容文件，`supramas_artifact_read` 返回一篇论文的已存文本块，核验工具返回精简证明。

#### Token 影响

可见 schema 带来固定成本。运行列表随持久任务数增长，产物读取随文本块内容增长，因此调用方应及时缩小读取范围。

#### KV Cache 影响

只要工具定义和角色可见性稳定，请求前缀即可稳定。增加或移除可见工具可能使缓存失效。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- `supramas_chunk_extract` 保存调用方提供并核实的文本；PDF 解析属于后续文件导入 provider。
- builder 当前使用 DSH web search/fetch 与 skills；学术索引连接器和 PDF 导入仍由独立 provider 承担。

<a id="dev-note"></a>

### 开发备注

模型参数保持 snake-case，能力类型保持 camel-case。不得绕过 revision 检查， 不得把证据不匹配变成成功，也不得隐藏意外异常。
