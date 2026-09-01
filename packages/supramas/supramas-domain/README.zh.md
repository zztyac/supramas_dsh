---
description: "严格的 Stage 1 策略树 wire 类型、语义校验和逐运行本地证据解析。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

[English](README.md) | 中文

## 概述

这个纯领域包保存现有 SupraMAS `strategy_tree.json` wire 结构，并加入确定、可恢复的 builder/reviewer 状态机。它强制每篇论文只对应一个节点、标识稳定、父子层级正确、记录引用有效、证据原文可解析、全文来源可追溯，同时执行 reviewer 接收门、期望与边类型映射、真实尝试预算和递归 frontier 终止规则。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

为每个任务创建一个 `EvidenceCatalog`，登记规范产物，并把每个带页码文本块显式标记为 `abstract` 或 `full_text`。当 `constraints.exclude` 包含 `abstract-only evidence` 时，每个已接受节点都必须解析到规范本地 PDF，并至少引用一个 `full_text` 文本块。reviewer 声明 `expectation_satisfaction`；已接受子边把 `full`、`partial`、`adjacent` 分别映射为 `direct`、`transferable`、`exploratory`。`accept` 决策不得保留关键问题、边问题或接收条件。模型编排工作流应启用 `requireAgentHandoffs`，使每次 builder 尝试与已接受审查都带有来源子任务运行 ID。接收、恢复和最终完成都会复验这些策略。

<a id="understand-the-implementation"></a>

## 实现说明

`src/types.ts` 管理封闭的 Stage 1 词汇和 snake-case 产物类型。`src/index.ts` 执行严格产物与证据检查；`src/orchestration.ts` 管理纯工作流转换和持久状态复验。所有返回值都是隔离副本，失败使用稳定的 `SupraMasDomainError` code。

<a id="model-experience"></a>

## 模型体验

### 领域校验

#### 模型看到什么

本包不直接显示内容。面向模型的工具调用 `validateStrategyTree` 等校验器，再返回精简的成功或恢复信封。

#### Token 影响

本包本身没有 token 成本；工具 schema 与返回产物决定可见成本。

#### KV Cache 影响

没有直接请求前缀影响。修改消费工具的 schema 或角色可见性可能使缓存失效。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 本包校验调用方提供的产物和文本块；PDF 的获取、哈希、持久化与解析由导入 provider 承担。
- 状态机强制 reviewer 决策干净且可归属，但不替代 reviewer 模型的科学判断。

<a id="dev-note"></a>

### 开发备注

保持 wire 字段使用 snake-case，并保留五个调优维度。不得削弱逐字引文检查， 也不得允许同一论文出现在多个节点中。
