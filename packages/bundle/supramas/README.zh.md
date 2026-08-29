---
description: "在模型工具消费者之前挂载持久 SupraMAS 运行时的 DSH profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

[English](README.md) | 中文

## 概述

这个静态 profile patch 按依赖顺序向 DSH profile 加入持久 SupraMAS 能力和八工具 消费者。它不改变 agent loop 行为，本身也不拥有运行时状态。

## 使用方式

把本 bundle 加在 base profile bundle 之后。base profile 提供 SupraMAS 使用的 DSH storage、JSON backend 和 storage-domain 服务。选择内置 `supramas` agent preset， 即可使用材料科学 persona、skills、用户提问和进程内委派控制。

## 实现说明

`cordis.patch.yml` 在 `@deepseek-ai/dsh-tool-supramas` 前插入 `@deepseek-ai/dsh-supramas`。运行时打开带版本的 `supramas` 存储领域；静态 bundle 本身仍不提供服务。

## 模型体验

### Profile 组合

#### 模型看到什么

carrier 本身不显示内容。插入的包贡献四个 `supramas_run_*` 工具和四个证据工具；角色白名单决定哪些 schema 可见。

#### Token 影响

bundle 没有直接成本；可见工具 schema 和所选 preset 文本产生 token 成本。

#### KV Cache 影响

修改插入行或角色可见工具会改变组合后的模型界面，并可能使前缀缓存失效。

## 已知限制与后续工作

- 本 bundle 尚未安装文献 provider、API 路由、PDF 导入或 UI 组件。

### 开发说明

base 存储 provider 和 SupraMAS 能力 provider 必须位于消费者之前。不要把材料科学 行为移入 DSH core loop。
