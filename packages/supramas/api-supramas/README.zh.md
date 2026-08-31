---
description: "面向持久 SupraMAS 材料科学任务的版本化 Typert Remote 控制边界。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-supramas

[English](README.md) | 中文

## 概述

本包通过版本化 `supramas` Typert Remote namespace，把持久 SupraMAS 运行时提供给受信任的 DSH 浏览器客户端。它可以列出和读取任务、投影经 reviewer 接受的策略树与论文证据、提供有界的标准成果内容、创建并启动 Stage 1 工作流、恢复可恢复任务，以及通过比较并交换 revision 取消活动任务。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

把本包挂载在 `@deepseek-ai/dsh-supramas` 之后。内置 SupraMAS bundle 已保证这一顺序，并把浏览器任务面板挂载在本 API 之后。

公开 V1 视图包含任务标识、生命周期状态、Stage 1 限制、汇总进度、下一项持久动作、已接受的策略树记录、不含正文的证据目录、有界证据切片和标准成果内容。本地运行目录、任务文件路径、证据路径、待审候选项和内部工作流载荷都不会跨越浏览器边界。

| Remote 方法 | 用途 |
| --- | --- |
| `list()` | 按创建顺序返回全部持久材料任务。 |
| `get(runId)` | 返回一项任务的当前视图。 |
| `tree(runId)` | 返回仅含 reviewer 已接受节点和边的浏览器安全策略树。 |
| `paper(runId, paperId)` | 返回已接受论文的元数据和不含正文的证据块目录。 |
| `evidence(runId, paperId, chunkId, start, maxCharacters)` | 返回一个有界证据文本切片，最多 8,000 字符。 |
| `artifacts(runId)` | 返回三项最终成果名称和就绪状态，不返回 Host 路径。 |
| `artifact(runId, name)` | 返回一项标准 UTF-8 成果，Remote 边界限制为 2 MiB。 |
| `createStage1(request)` | 规范化输入、创建运行、批准任务并进入 Stage 1。 |
| `resume(runId, revision)` | 在 revision 控制下恢复可恢复任务。 |
| `cancel(runId, revision)` | 在 revision 控制下取消非终态任务。 |

调用方可修正的错误使用稳定代码，覆盖格式错误、重复 job、运行或论文不存在、旧 revision、成果未就绪和非法生命周期转换。

<a id="understand-the-implementation"></a>

## 实现说明

`SupraMasController` 是 `supramas` namespace 唯一的 Host 所有者。每项修改都委托给 `ctx.supramas`，随后把持久快照投影成 V1 wire 类型。生成的 Remote client 接入 `@deepseek-ai/dsh-api-remotes`，因此浏览器插件复用 DSH 标准认证传输，不新增私有路由。

<a id="model-experience"></a>

## 模型体验

无，因为这个 Remote 边界不注册提示词、消息、schema 或面向模型的工具。

#### KV Cache 影响

无；浏览器 RPC 不会进入模型 provider 请求。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- V1 只有请求/响应；任务面板轮询活动任务详情，尚无任务事件流。
- 证据读取有意采用切片方式，标准成果读取也有明确大小上限。
- 当前只表示 Stage 1 策略树工作流。

<a id="dev-note"></a>

### 开发备注

Typert 生成使用的 wire 类型必须保持自包含。不要暴露 Host 文件系统路径，也不要在 API 中复制 Stage 1 转换规则。
