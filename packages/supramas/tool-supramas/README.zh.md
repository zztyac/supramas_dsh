---
description: "带参数校验和可执行结果信封的窄范围 SupraMAS 模型工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

[English](README.md) | 中文

## 概述

本消费者基于 `ctx.supramas` 暴露 `supramas_run_create` 和 `supramas_run_get`。两个工具都会在执行前校验参数，并返回包含 `status`、`summary`、`next_actions`、`artifacts` 以及 `data` 或结构化 `error` 的稳定信封。

## 使用本包

应在 `@deepseek-ai/dsh-tools` 和 `@deepseek-ai/dsh-supramas` 之后组合。创建调用使用蛇形模型参数和运行归属的规范路径。领域失败仍作为成功传输的工具值返回，使智能体可以执行 `next_actions`；未知编程错误继续抛出，供运维观察。

## 理解实现

`src/index.ts` 管理两个 schema，把已校验模型参数转换为能力请求，并把稳定领域错误映射为恢复指导。Cordis 注册释放器会在 HMR 时移除两个工具。真实 Loader 组合测试保护包解析和注入顺序。

## 模型体验

### 运行工具

#### 模型看到的内容

模型会看到固定的 `supramas_run_create` 和 `supramas_run_get` schema。结果是紧凑 JSON 信封；失败会明确根因、安全重试和停止条件。

#### Token 影响

工具可见时产生固定 schema 开销，并产生随数据量变化的紧凑 JSON 结果 token。

#### KV Cache 影响

只要工具定义和作用域可见性不变，请求前缀即可稳定复用。注册、移除或限制任一工具都可能使工具目录边界后的复用失效。

## 已知限制与延期工作

- M1 只暴露创建和读取；在编排契约完成前，转换仍属于协调器内部能力。
- 列表、证据、产物和审查工具由后续阶段加入。
- 工具可见性仍必须由所选角色白名单限制。

### 开发备注

模型参数保持蛇形，能力类型保持驼峰。可由调用方修正的 `SupraMasError` 转为信封；意外异常不得被隐藏。
