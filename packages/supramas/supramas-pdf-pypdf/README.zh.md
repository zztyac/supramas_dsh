---
description: "通过 DSH 托管子进程使用 pypdf，为 SupraMAS 提供有界分页全文提取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-pdf-pypdf

[English](README.md) | 中文

## 概述

本提供器在 DSH 托管的隔离 Python 进程中使用 `pypdf` 按页提取 PDF 文本。Harness 管理 argv、环境、超时、进程树终止、输出上限和 JSON 校验；子进程不接收模型编写的代码。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

先在指定 Python 环境安装 `pypdf`，再在 `ctx.subprocess` 和 `ctx.supramasLiterature` 之后挂载。

```yaml
- name: '@deepseek-ai/dsh-supramas-pdf-pypdf'
  config:
    pythonExecutable: python
    timeoutMs: 60000
```

提供器使用 `-I` 启动 Python，在隔离脚本内部强制 UTF-8，在输出 JSON 前限制页数和文本量，并拒绝截断或畸形的进程输出。

<a id="model-experience"></a>

## 模型体验

### 按页面提取

#### 模型看到什么

模型通过 `supramas_chunk_list` 和 `supramas_chunk_read` 间接看到按页面组织的分块 ID，并且每次只读取一个有界文本切片；不能选择解释器、脚本、本地路径或进程参数。

#### Token 影响

本提供器不增加提示词或 schema。整篇提取文本保留在服务边界内，工具消费者限制每个可见切片。

#### KV Cache 影响

解析不改变静态前缀，只有显式请求的分块切片会作为工具结果追加。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 配置的 Python 环境必须提供 `pypdf`。
- 纯图片页面不会执行 OCR，可能因无文本而被拒绝。
- 异常字体、版式和损坏文件的提取质量取决于 `pypdf`。

<a id="dev-note"></a>

### 开发备注

解析必须保留在托管子进程中，并保持完整输出校验。不得把部分 stdout 当作证据回退使用。
