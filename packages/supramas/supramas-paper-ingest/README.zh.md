---
description: "为 SupraMAS 论文提供获取、落盘、解析、分块和持久证据导入的完整事务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-paper-ingest

[English](README.md) | 中文

## 概述

本服务协调一次安全论文导入：解析并获取不透明候选，原子缓存已校验 PDF，解析有界分页文本，生成确定性的 `full_text` 分块，一次持久变更提交元数据、完整源文件溯源和全部分块，最后生成兼容 JSON。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 SupraMAS 运行时、文件服务、文献服务及其选定提供器之后挂载。

```yaml
- name: '@deepseek-ai/dsh-supramas-paper-ingest'
  config:
    maxChunkChars: 12000
    overlapChars: 400
```

`importCandidate()` 接受运行 ID、服务签发的候选 ID 和来源分类。它持久化 `full_text_source`，其中包括规范原始 PDF 路径、SHA-256、字节数、媒体类型和页数；每个解析块都标记为 `evidence_kind: full_text`。

<a id="model-experience"></a>

## 模型体验

### 论文导入结果

#### 模型看到什么

模型通过 `supramas_paper_import` 看到论文元数据、SHA-256 摘要、安全的相对产物引用以及字节、页和分块计数；不会收到整篇提取文本或内部源路径。

#### Token 影响

本服务不增加提示词或 schema。导入结果字段固定，书目字符串有界，不随 PDF 正文长度增长。

#### KV Cache 影响

导入不改变静态前缀；紧凑结果只追加一次，后续证据文本必须显式分页读取。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- PDF 缓存后若解析失败，可能保留未引用的源文件；不会提交持久论文或兼容 JSON。
- 重复导入同一候选会作为重复来源被拒绝，不会静默覆盖。
- 事务保证持久证据原子提交；文件系统与持久存储不是一个跨资源数据库事务。

<a id="dev-note"></a>

### 开发备注

必须以 `ctx.supramas.importPaper()` 作为唯一持久提交点，不得恢复“先写元数据、再循环写分块”的流程。
