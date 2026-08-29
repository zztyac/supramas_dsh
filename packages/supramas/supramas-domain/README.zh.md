---
description: "严格的 Stage 1 策略树 wire 类型、语义校验和运行内本地证据解析。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

[English](README.md) | 中文

## 概述

这个纯领域包保留当前 SupraMAS `strategy_tree.json` wire 结构，同时校验
JSON Schema 无法关联的事实。它强制每篇论文只对应一个节点、标识稳定、
父子层级正确、记录引用有效、边与父限制期望一致，并要求证据原文能够解析
到运行内的本地文本块。

## 使用本包

为每个任务创建一个 `EvidenceCatalog`，登记规范的
`runs/<jobId>/papers/<paperId>.json` 产物，再加入带页码的文本块。把不可信
策略树交给 `validateStrategyTree`；也可以逐步向 `StrategyTreeAssembler`
加入节点和边，最后调用 `build()`。

## 理解实现

`src/types.ts` 管理封闭的 Stage 1 词汇和蛇形 artifact 类型。
`src/index.ts` 先严格解析结构，再检查语义与证据。所有返回产物都是隔离
副本，失败使用稳定的 `SupraMasDomainError` 代码。

## 模型体验

### 领域校验

#### 模型看到的内容

模型不会直接看到本包。面向模型的工具调用 `validateStrategyTree` 等校验器，并返回紧凑的成功或恢复信封。

#### Token 影响

本包自身没有 token 开销；可见成本由工具 schema 和返回产物决定。

#### KV Cache 影响

本包不会直接改变请求前缀。消费工具的 schema 或角色可见性变化可能使缓存复用失效。

## 已知限制与延期工作

- 证据目录在 M3 持久化完成前只存在于当前进程。
- M2 登记已验证文本块，但不自行解析 PDF 文件。
- 结构校验不决定科学接受；接受、修改或拒绝仍由 reviewer 角色负责。

### 开发备注

wire 字段保持蛇形，并保留五个调优维度。不要削弱原文字面匹配，也不要让
同一篇论文出现在多个节点中。
