---
description: "为 SupraMAS 提供有界学术检索、PDF 获取、解析器选择与稳定分页分块。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-literature

[English](README.md) | 中文

## 概述

本服务是 SupraMAS 与具体提供器无关的文献边界。它只选择一个已配置或无歧义的索引、获取和解析提供器；限制查询、PDF、页数与提取文本；签发不透明候选 ID；并生成确定性的分页证据块。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 OpenAlex、HTTP、解析、导入或工具消费者之前挂载本服务。

```yaml
- name: '@deepseek-ai/dsh-supramas-literature'
  config:
    indexProvider: openalex
    acquisitionProvider: http
    parserProvider: pypdf
```

检索结果不包含 PDF 地址。`acquire()` 在内部解析不透明候选，并校验 MIME、PDF 文件头、大小和 SHA-256。`parseDocument()` 只接受内部绝对路径，并再次校验提供器输出。`chunkParsedPages()` 永不跨页分块。

<a id="model-experience"></a>

## 模型体验

### 提供器无关的发现与证据边界

#### 模型看到什么

本服务不直接向模型暴露内容。模型通过 `@deepseek-ai/dsh-tool-supramas-literature` 只会收到 `openalex:W123` 形式的不透明候选 ID、有界元数据、已验证的导入计数和按页面限定的分块切片；不会收到解析后的 PDF URL 或内部绝对路径。

#### Token 影响

本服务不增加提示词或工具 schema。其消费者限制候选数量、摘要字符数、分块索引和每次文本切片的长度。

#### KV Cache 影响

挂载或选择提供器不会改变静态请求前缀，只有后续工具结果会追加到会话中。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 可用性检查只反映本地配置，远端健康状态要到请求执行时才能确定。
- 纯扫描图片 PDF 会作为无文本文件被拒绝；当前未实现 OCR。
- 候选去重依次使用外部 ID、DOI 和规范化标题，不等同于语义引文聚类。

<a id="dev-note"></a>

### 开发备注

二进制传输和解析实现必须保留在提供器注册表之后。模型侧操作不得增加调用方 URL 或输出路径。
