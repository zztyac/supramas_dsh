---
description: "严格的 Stage 1 策略树 wire 类型、语义校验和逐运行本地证据解析。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

[English](README.md) | 中文

## 概述

这个纯领域包保存现有 SupraMAS `strategy_tree.json` wire 结构，并加入确定、可恢复的 builder/reviewer 状态机。它强制每篇论文只对应一个节点、标识稳定、父子层级正确、记录引用有效、期望与边文本一致、证据原文可解析，同时执行 reviewer 接收门、真实尝试预算和递归 frontier 终止规则。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

为每个任务创建一个 `EvidenceCatalog`，登记规范产物并加入带页码的文本块。调用 `createStage1Workflow` 后读取 `nextStage1Action`，通过对应函数提交一次 builder 或 reviewer 结果，并仅在全部 frontier 终止后调用 `finalizeStage1Workflow`。运行时会把工作流与证据目录序列化到同一持久运行记录。

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

- 本包校验调用方提供的产物和文本块，但不自行解析 PDF。
- 状态机强制 reviewer 决策流程，但不替代 reviewer 模型的科学判断。

<a id="dev-note"></a>

### 开发备注

保持 wire 字段使用 snake-case，并保留五个调优维度。不得削弱逐字引文检查， 也不得允许同一论文出现在多个节点中。
