---
description: "持久化 SupraMAS 运行生命周期、Stage 0/1 角色权限和逐运行证据目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas

[English](README.md) | 中文

## 概述

本能力注册由 DSH storage-domain 服务支持的确定性材料科学运行目录 `ctx.supramas`。每次运行都有稳定标识、CAS revision、受约束的阶段图、规范产物 路径、角色白名单，以及由 `@deepseek-ai/dsh-supramas-domain` 提供的隔离 Stage 1 证据目录。

## 使用方式

在任何 SupraMAS 工具消费者之前挂载 DSH 存储栈和本服务。使用规范 `runs/<jobId>` 路径创建运行，保留返回的 revision 供状态迁移，再在该运行标识下 登记论文和证据文本块。读取和核验始终返回隔离副本。重启后使用 `list()` 发现 持久任务，再用当前 revision 将 `recoverable_failed` 运行迁回 `running`。

## 实现说明

`src/types.ts` 定义生命周期值，`src/roles.ts` 管理角色权限，`src/spec.ts` 定义 带版本的 `supramas/runs` 存储领域，`src/index.ts` 校验状态迁移并把证据语义委托 给领域包。一条存储记录包含完整运行快照和全部论文文本块。只有持久写入成功后 才发布新的内存状态，因此写入失败不会暴露部分生命周期或证据变更。

服务初始化时，`running` 和 `validating` 记录会被改写为 `recoverable_failed`，revision 递增，并附带可重试的 `process-restarted` 失败。 稳定 sequence 可在时间戳相同时保持创建顺序。

## 模型体验

### 能力与角色元数据

#### 模型看到什么

本包不直接向模型显示内容。消费者把 `ROLE_SPECS` 转换为有范围的工具白名单，并通过面向模型的工具暴露能力方法。

#### Token 影响

本包本身没有 token 成本；实际成本由所选消费者 schema 决定。

#### KV Cache 影响

没有直接影响。修改角色可见工具列表会改变请求前缀，并可能使缓存失效。

## 已知限制与后续工作

- 持久记录包含论文元数据和抽取文本块，但本包不抓取或解析 PDF。
- `local_path` 作为规范溯源路径校验；独立文件导入 provider 负责物化源文件。
- 文献检索和科学审查决策仍由独立角色负责。

### 开发说明

每次运行保持一条原子存储记录。禁止在持久写入成功前发布内存变更；没有测试时 不要扩大生命周期迁移；不得削弱 CAS revision 检查。
