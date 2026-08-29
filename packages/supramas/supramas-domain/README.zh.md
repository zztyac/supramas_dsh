---
description: "严格的 Stage 1 策略树 wire 类型、语义校验和逐运行本地证据解析。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

[English](README.md) | 中文

## 概述

这个纯领域包保存现有 SupraMAS `strategy_tree.json` wire 结构，并校验 JSON Schema 无法关联的事实。它强制每篇论文只对应一个节点、标识稳定、父子层级正确、 记录引用有效、期望与边文本一致，而且证据原文必须解析到运行内本地文本块。

## 使用方式

为每个任务创建一个 `EvidenceCatalog`，登记规范的 `runs/<jobId>/papers/<paperId>.json` 产物并加入带页码的文本块。通过 `validateStrategyTree` 校验不可信树数据，或逐步向 `StrategyTreeAssembler` 加入 节点和边后调用 `build()`。SupraMAS 运行时会把完整目录序列化进持久运行记录。

## 实现说明

`src/types.ts` 管理封闭的 Stage 1 词汇和 snake-case 产物类型。`src/index.ts` 先执行严格结构解析，再做语义和证据检查。所有返回产物都是隔离副本，失败使用 稳定的 `SupraMasDomainError` code。`EvidenceCatalog` 本身仍是纯内存值对象； 持久化由消费它的运行时负责。

## 模型体验

### 领域校验

#### 模型看到什么

本包不直接显示内容。面向模型的工具调用 `validateStrategyTree` 等校验器，再返回精简的成功或恢复信封。

#### Token 影响

本包本身没有 token 成本；工具 schema 与返回产物决定可见成本。

#### KV Cache 影响

没有直接请求前缀影响。修改消费工具的 schema 或角色可见性可能使缓存失效。

## 已知限制与后续工作

- 本包校验调用方提供的产物和文本块，但不自行解析 PDF。
- Schema 校验不决定科学上的接受与否；reviewer 角色仍负责 accept、revise 或 reject。

### 开发说明

保持 wire 字段使用 snake-case，并保留五个调优维度。不得削弱逐字引文检查， 也不得允许同一论文出现在多个节点中。
