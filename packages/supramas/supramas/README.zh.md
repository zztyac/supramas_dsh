---
description: "持久化 SupraMAS 运行生命周期、Stage 0/1 角色权限和逐运行证据目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas

[English](README.md) | 中文

## 概述

本能力注册由 DSH storage-domain 服务支持的确定性材料科学运行目录 `ctx.supramas`。每次运行都有稳定标识、CAS revision、受约束的阶段图、规范产物路径、角色白名单、按来源分类的隔离证据目录，以及可选的持久 Stage 1 工作流。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>

## 使用方式

在任何 SupraMAS 工具消费者之前挂载 DSH 存储栈和本服务。通过导入服务获取完整 PDF，使论文元数据带有 `full_text_source`，解析块带有 `evidence_kind: full_text`；手工文本块默认按 `abstract` 处理。创建运行并推进到 `task_ready` 后，必须使用每次返回的精确 revision 驱动 `startStage1()` 到 `finalizeStage1()`；恢复的工作流会在暴露待执行动作前重新校验。

<a id="understand-the-implementation"></a>

## 实现说明

`src/types.ts` 定义生命周期与工作流视图，`src/roles.ts` 管理角色权限，`src/spec.ts` 定义带版本的存储领域，`src/index.ts` 校验状态迁移并把工作流/证据语义委托给领域包。一条存储记录包含运行快照、全部论文文本块和工作流；每次工作流变更整体替换该记录并递增 revision。

服务初始化时，`running` 和 `validating` 记录会被改写为 `recoverable_failed`，revision 递增，并附带可重试的 `process-restarted` 失败。 稳定 sequence 可在时间戳相同时保持创建顺序。

<a id="model-experience"></a>

## 模型体验

### 能力与角色元数据

#### 模型看到什么

本包不直接向模型显示内容。消费者把 `ROLE_SPECS` 转换为有范围的工具白名单，并通过面向模型的工具暴露能力方法。

#### Token 影响

本包本身没有 token 成本；实际成本由所选消费者 schema 决定。

#### KV Cache 影响

没有直接影响。修改角色可见工具列表会改变请求前缀，并可能使缓存失效。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与后续工作

- 持久记录包含论文元数据、可用时的完整源文件描述，以及按来源分类的文本块，但本包不抓取或解析 PDF。
- 文件导入 provider 必须物化 `full_text_source.local_path` 指向的规范原始 PDF。
- 科学审查仍由独立、只读子智能体决策；运行时强制决策门和期望满足度/边类型映射。

<a id="dev-note"></a>

### 开发备注

每次运行保持一条原子存储记录。禁止在持久写入成功前发布内存变更；没有测试时 不要扩大生命周期迁移；不得削弱 CAS revision 检查。
