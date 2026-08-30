---
description: "挂载持久 SupraMAS 运行时、API、模型工具和浏览器任务面板的 DSH profile 扩展。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

[English](README.md) | 中文

## 概述

这个静态 profile patch 按依赖顺序向 DSH profile 加入持久 SupraMAS 能力、兼容文件写入器、版本化浏览器 API、十四工具模型消费者和非技术型任务面板。它不改变 agent loop 行为，本身也不拥有运行时状态。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

把本 bundle 加在 base 和 Web profile bundle 之后。base profile 提供 SupraMAS 使用的 DSH storage 服务。选择内置 `supramas` agent preset，即可使用材料科学 persona、skills、用户提问和进程内委派控制。

从源码 checkout 试运行时，先构建一次，再把本 bundle 作为 overlay 启动普通 Web profile：

```powershell
pnpm run build
pnpm run build:web
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

<a id="understand-the-implementation"></a>

## 实现说明

`cordis.patch.yml` 依次插入运行时、工作区内的产物写入器、Typert API、模型工具和浏览器 UI。运行时打开带版本的 `supramas` 存储领域；产物写入器使用进程工作区作为根目录；静态 bundle 本身仍不提供服务。

<a id="model-experience"></a>

## 模型体验

### Profile 组合

#### 模型看到什么

carrier 本身不显示内容。插入的包贡献十四个 `supramas_*` 运行、证据、导出修复和 Stage 1 工作流工具；角色白名单决定哪些 schema 可见。

#### Token 影响

bundle 没有直接成本；可见工具 schema 和所选 preset 文本产生 token 成本。

#### KV Cache 影响

修改插入行或角色可见工具会改变组合后的模型界面，并可能使前缀缓存失效。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 本 bundle 尚未安装专用学术索引 provider、PDF 导入、实时任务事件或最终产物可视化。

<a id="dev-note"></a>

### 开发备注

base 存储 provider 和 SupraMAS 能力 provider 必须位于消费者之前。不要把材料科学 行为移入 DSH core loop。
