---
description: "面向模型的有界文献检索、完整论文导入、分块索引和分片证据读取工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas-literature

[English](README.md) | 中文

## 概述

本工具消费者提供四个有界操作：结构化文献检索、完整候选导入、不含正文的分块列表，以及单个分块的分片读取。它不返回 PDF 字节、内部绝对路径、文档下载地址或整篇论文文本。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 `ctx.tools`、`ctx.supramas`、`ctx.supramasLiterature` 和 `ctx.supramasPaperIngest` 之后挂载。

```yaml
- name: '@deepseek-ai/dsh-tool-supramas-literature'
  config:
    maxSearchResults: 10
    maxAbstractChars: 1200
    maxChunkReadChars: 20000
```

Builder 角色获得 `supramas_literature_search`、`supramas_paper_import`、`supramas_chunk_list` 和 `supramas_chunk_read`。Reviewer 角色只获得列表/读取工具及独立的字面证据验证器。检索摘要只用于发现；builder 必须成功导入完整 PDF 后才能提交节点。当索引文档被阻断时，`supramas_paper_import.document_url` 可以传入网页检索发现的同一不透明候选论文的公开 PDF 直链。公共网络传输仍执行 SSRF 防护，解析后的 DOI/标题匹配会拒绝错配文档。

<a id="model-experience"></a>

## 模型体验

### 文献工作流工具

#### 模型看到什么

四个工具：`supramas_literature_search`、`supramas_paper_import`、`supramas_chunk_list` 和 `supramas_chunk_read`。结果使用稳定成功/错误信封；候选携带不透明 ID，导入返回摘要和计数，分块列表不含正文，读取必须指定一个分块 ID 并使用 `offset`/`max_chars` 分页。

#### Token 影响

只在获准的智能体作用域中增加四个紧凑工具定义。检索数量、摘要长度、列表大小和每次文本读取分别受配置限制。

#### KV Cache 影响

允许的工具定义稳定且可缓存。每次调用只追加有界结果，不重写已有上下文。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 检索能力取决于已挂载的结构化索引提供器集合。
- 分块分页按字符计算，不按 token 计算。
- 导入失败会返回“尝试同一候选的已验证公开 PDF”“改选开放获取候选”或“细化检索”的恢复指引，绝不授权回退到摘要证据。

<a id="dev-note"></a>

### 开发备注

不得削弱 `document_url` 的公共网络校验或候选身份匹配。输出路径、解释器、解析脚本、二进制和整篇文档内容必须保留在服务边界之后。
