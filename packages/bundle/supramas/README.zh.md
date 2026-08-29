---
description: "按顺序挂载 SupraMAS 运行时和模型工具消费者的 DSH Profile bundle。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

[English](README.md) | 中文

## 概述

该静态 Profile 补丁按依赖顺序把 SupraMAS 能力和工具消费者加入 DSH Profile。它不改变智能体循环行为，也不拥有运行时状态。

## 使用本包

在基础 Profile bundle 之后加入本 bundle。选择内置 `supramas` 智能体预设即可获得材料科学人格、本地 skills、用户提问和进程内委派工具。

## 理解实现

`cordis.patch.yml` 先插入 `@deepseek-ai/dsh-supramas`，再插入 `@deepseek-ai/dsh-tool-supramas`。TypeScript 入口仅为静态包载体；生命周期和不变量由插入的包负责。

## 模型体验

### Profile 组合

#### 模型看到的内容

模型不会直接看到静态 bundle 载体。`cordis.patch.yml` 中的行贡献两个 M1 工具 schema；单独选择的预设贡献材料科学人格和委派表面。

#### Token 影响

bundle 没有直接开销。开销属于插入的工具 schema 和所选预设文本。

#### KV Cache 影响

bundle 自身不增加请求内容。修改插入行会改变组合后的模型表面，并可能使前缀复用失效。

## 已知限制与延期工作

- 本 bundle 尚未安装持久化、文献提供者、API 路由或 UI 组件。它们会在后续里程碑中以独立且经过测试的 bundle 加入。

### 开发备注

补丁中能力提供者必须位于消费者之前。不要把材料科学行为移入 DSH 核心循环。
