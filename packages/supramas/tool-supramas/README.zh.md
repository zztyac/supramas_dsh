---
description: "具有可执行恢复信封的窄范围 SupraMAS 运行与证据模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

[English](README.md) | 中文

## 概述

本消费者在 `ctx.supramas` 上暴露八个工具：创建运行、列出持久运行、读取运行、 基于 CAS revision 迁移状态、登记论文、保存文本块、读取产物和逐字核验证据。 每个工具都会校验参数，并返回同一种稳定的成功或恢复信封。

## 使用方式

在 `@deepseek-ai/dsh-tools`、DSH 存储栈和 `@deepseek-ai/dsh-supramas` 之后组合本包。模型参数保持 snake-case。任务配置角色可以发现、创建和读取运行； 协调器负责状态迁移；builder 使用论文和文本块工具；reviewer 使用产物读取和证据 核验。角色白名单必须隐藏当前角色无权调用的工具。

## 实现说明

`src/index.ts` 管理八个 schema，并把运行时和领域失败映射为根因、安全重试与停止 条件。`supramas_run_transition` 要求使用 list/get 返回的精确 revision，防止旧调用 方覆盖恢复后的任务。领域失败仍作为成功的工具传输值返回，意外编程故障继续抛出。 Cordis disposer 会在 HMR 时移除全部工具。

## 模型体验

### 运行与证据工具

#### 模型看到什么

只看到所选角色允许的工具。`supramas_run_list` 用于重启后发现任务，`supramas_artifact_read` 返回一篇论文的已存文本块，核验工具返回精简证明。

#### Token 影响

可见 schema 带来固定成本。运行列表随持久任务数增长，产物读取随文本块内容增长，因此调用方应及时缩小读取范围。

#### KV Cache 影响

只要工具定义和角色可见性稳定，请求前缀即可稳定。增加或移除可见工具可能使缓存失效。

## 已知限制与后续工作

- `supramas_chunk_extract` 保存调用方提供并核实的文本；PDF 解析属于后续文件导入 provider。
- 文献检索和完整 Stage 1 编排尚未成为模型工具。

### 开发说明

模型参数保持 snake-case，能力类型保持 camel-case。不得绕过 revision 检查， 不得把证据不匹配变成成功，也不得隐藏意外异常。
