---
description: "按顺序挂载 SupraMAS 运行时和模型工具消费者的 DSH Profile Bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

[English](README.md) | 中文

## 概述

该静态 Profile 补丁按依赖顺序把 SupraMAS 能力和六工具消费者加入 DSH
Profile。它不修改智能体循环，也不拥有运行时状态。

## 使用本包

在基础 Profile Bundle 之后加入本包。选择内置 `supramas` 智能体预设，
即可获得材料科学 Persona、skills、用户提问和进程内委派控制。

## 理解实现

`cordis.patch.yml` 先插入 `@deepseek-ai/dsh-supramas`，再插入
`@deepseek-ai/dsh-tool-supramas`。运行时依赖纯领域包；静态 Bundle 自身
仍不拥有服务。

## 模型体验

### Profile 组合

#### 模型看到的内容

模型不会直接看到载体。插入包贡献两个 `supramas_run_*` 工具和四个证据工具；角色白名单决定哪些 schema 可见。

#### Token 影响

Bundle 没有直接成本。可见工具 schema 和所选预设文本承担成本。

#### KV Cache 影响

修改插入行或角色可见工具会改变组合后的模型表面，并可能使前缀复用失效。

## 已知限制与延期工作

- 本 Bundle 尚未安装持久化、文献 provider、API 路由或 UI 组件。

### 开发备注

能力 provider 必须位于消费者之前。不要把材料科学行为移入 DSH 核心循环。
