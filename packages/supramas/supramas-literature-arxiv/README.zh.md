---
description: "为 SupraMAS 学术发现与预印本解析提供免密钥的 arXiv Atom 提供器。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-literature-arxiv

[English](README.md) | 中文

## 概述

本包把 arXiv Atom API 映射进 SupraMAS 文献接缝。检索暴露有界的预印本书目信息；候选解析暴露 arXiv PDF 地址并附带无版本号的回退地址。与 OpenAlex 提供器一起使用即可恢复多源学术发现：文献服务会向所有已配置的索引提供器并行发起检索，并对跨源候选去重。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 `ctx.web` 和 `ctx.supramasLiterature` 之后、与 `@deepseek-ai/dsh-supramas-literature-openalex` 并列挂载。

```yaml
- name: '@deepseek-ai/dsh-supramas-literature'
  config:
    indexProviders:
      - openalex
      - arxiv
- name: '@deepseek-ai/dsh-supramas-literature-openalex'
- name: '@deepseek-ai/dsh-supramas-literature-arxiv'
```

新增或移除任何 workspace 包之后，需要重新生成一次 tsconfig 包别名（`pnpm run gen-tsconfig-paths`）；profile 启动时 loader 对 `@deepseek-ai/*` 名称的导入依赖这些别名解析，未重新生成前新包对 `dsh web` 不可见。

提供器使用 `search_query`、`max_results` 和 `sortBy=relevance` 查询 `/api/query`。条目映射为稀疏安全的候选：id、折叠空白后的标题、作者、发表年份、DOI（存在时）、venue `arXiv`、摘要和 `openAccess: true`。解析返回条目的 PDF 链接，并附带无版本号的 `arxiv.org/pdf/<id>` 回退地址。

<a id="model-experience"></a>

## 模型体验

### arXiv 候选投影

#### 模型看到什么

模型通过 `supramas_literature_search` 间接看到书目字段和 `arxiv:<文章id>` 形式的不透明候选 ID，与其他已配置来源的结果合并去重。提供器解析得到的 PDF URL 永远不会投影到检索结果中。

#### Token 影响

提供器不增加提示词或 schema；检索条目数和摘要长度由文献工具限制。

#### KV Cache 影响

不影响静态前缀；每个有界检索响应作为工具结果追加。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- arXiv 要求客户端控制请求节奏（约每三秒一次检索）并执行上游限流；服务会联邦多个来源，但不做客户端节流。
- arXiv 不提供引用计数，因此本提供器的候选不带 `citedByCount`。
- 候选 id 保留 arXiv 版本后缀（例如 `2310.12345v2`）；解析始终回退到无版本号的 PDF 地址。
- 本提供器不下载或解析文档；获取与解析仍由共享的获取与解析提供器负责。

<a id="dev-note"></a>

### 开发备注

保持 Atom 解析严格、条目字段列表显式。检索结果永远不得暴露内部 PDF 地址。
