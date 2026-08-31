---
description: "为已解析学术 PDF 提供抗 SSRF、地址固定且有界的公共 HTTP 获取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-paper-http

[English](README.md) | 中文

## 概述

本提供器通过 DSH 公共网络策略下载已解析的学术 PDF。它校验 HTTP(S) URL，禁止凭据和私有目标，固定已校验的 DNS 答案，只跟随有界同源重定向，并且只返回完整字节或错误。

## 目录

- [使用方式](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在 `@deepseek-ai/dsh-supramas-literature` 之后挂载。

```yaml
- name: '@deepseek-ai/dsh-supramas-paper-http'
  config:
    timeoutMs: 30000
    maxRedirects: 5
```

字节上限由文献服务提供，最终 PDF MIME、文件头和摘要校验也由文献服务执行。本提供器从不接受输出路径。

<a id="model-experience"></a>

## 模型体验

### 已验证的 PDF 获取

#### 模型看到什么

模型通过 `supramas_paper_import` 间接看到成功结果或稳定错误，以及安全的摘要和计数元数据；不会看到 PDF 字节、解析后的 URL、固定地址或本地路径。

#### Token 影响

本提供器不增加提示词或 schema，只向导入结果贡献很小且有界的获取状态。

#### KV Cache 影响

提供器不改变静态前缀；最终导入结果只会追加到会话中。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 跨源重定向会被拒绝，需要重新解析候选位置。
- 有意不支持认证、Cookie、浏览器状态和付费墙获取。
- 即使来源省略或伪造 `Content-Length`，流式读取仍受字节上限保护。

<a id="dev-note"></a>

### 开发备注

不得把地址固定替换为“先校验、后由另一个客户端重新解析”，否则会重新引入 DNS rebinding。
