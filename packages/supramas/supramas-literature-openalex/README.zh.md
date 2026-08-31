---
description: "用于 SupraMAS 有界学术检索与候选解析的免密钥 OpenAlex Works 提供器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-literature-openalex

[English](README.md) | 中文

## 概述

本包把当前 OpenAlex Works API 映射到 SupraMAS 文献服务。检索只公开有界书目信息；候选解析可为内部获取步骤补充最佳开放获取 PDF 地址。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 `ctx.web` 和 `ctx.supramasLiterature` 之后挂载。

```yaml
- name: '@deepseek-ai/dsh-supramas-literature-openalex'
```

提供器使用 `search`、当前 `per_page` 分页和固定 `select` 字段列表。它从倒排索引重建摘要，并保留稀疏记录，不补造缺失字段。

<a id="model-experience"></a>

## 模型体验

### OpenAlex 候选投影

#### 模型看到什么

模型通过 `supramas_literature_search` 间接看到筛选后的书目信息和 `openalex:<work-id>` 形式的不透明候选 ID。提供器解析得到的 PDF URL 永远不会投影到检索结果中。

#### Token 影响

提供器不增加提示词或 schema；检索条目数和重建摘要长度由文献工具限制。

#### KV Cache 影响

不影响静态前缀；每个有界检索响应作为工具结果追加。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 受 OpenAlex 限流和上游可用性影响。
- 候选解析只使用上游报告的最佳开放获取 PDF 位置。
- 本提供器不下载或解析文档。

<a id="dev-note"></a>

### 开发备注

OpenAlex 响应解析必须保持严格，选择字段必须显式。检索结果不得公开内部 PDF 地址。
