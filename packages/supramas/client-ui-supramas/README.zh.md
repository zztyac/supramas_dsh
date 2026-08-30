---
description: "用于创建、派发、恢复和查看 SupraMAS 任务的非技术型浏览器面板。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-supramas

[English](README.md) | 中文

## 概述

本包在 DSH Web 左侧栏加入 **材料任务** 入口。非技术用户可以通过引导式 Stage 1 表单、易读进度卡片和操作按钮，创建、派发、恢复、取消或刷新持久 SupraMAS 任务。

## 目录

- [从当前源码直接试运行](#try-it-from-this-source-checkout)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="try-it-from-this-source-checkout"></a>

## 从当前源码直接试运行

在仓库根目录依次执行一次：

```powershell
pnpm run build
pnpm run build:web
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

然后打开 `http://127.0.0.1:3080`，使用 **SupraMAS** 预设新建或打开会话，点击左下角 **材料任务**，填写研究目标，再点击 **创建并启动**。

创建操作会先把任务提交到持久存储。如果已有打开的会话，面板会把协调指令加入该会话队列；如果没有会话，任务仍然安全保存，面板会提示用户打开 SupraMAS 会话，再点击 **在当前会话执行**。

<a id="understand-the-implementation"></a>

## 实现说明

浏览器插件在根作用域注册一个 `sidebar.footer.action`。它只通过 `ctx.remote.supramas` 读写任务，不在 React 中复制 Stage 1 状态机。会话派发复用现有 Sessions binding，并加入一条协调消息，要求 coordinator 在执行前先读取持久 `next_action`。

弹窗支持键盘关闭和焦点恢复，提供中英文词典，并覆盖加载、空状态、失败状态以及带 revision 的恢复操作。

<a id="model-experience"></a>

## 模型体验

间接影响来自一条用户主动触发的协调消息，它要求活动的 SupraMAS 会话继续执行持久任务。

#### KV Cache 影响

空闲时无成本。派发或恢复会新增一条用户消息，因此会开始新的请求前缀。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 当前需要点击 **刷新** 才能更新进度，尚未接入实时任务事件。
- 最终策略树可视化、证据下钻和产物下载属于下一 UI 里程碑。
- 表单有意只开放常用的研究目标、材料范围、目标性能和深度；高级重试及宽度限制继续使用安全的运行时默认值。

<a id="dev-note"></a>

### 开发备注

持久状态必须留在 `@deepseek-ai/dsh-supramas`。本包可以投影或派发任务，但不得在本地推断新的工作流转换。
