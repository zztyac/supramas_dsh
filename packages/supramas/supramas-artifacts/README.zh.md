---
description: "在工作区内为 SupraMAS 运行生成 Stage 1 兼容文件，并以幂等方式导出最终成果。"
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-artifacts

[English](README.md) | 中文

## 概述

本包把持久化的 SupraMAS Stage 1 运行转换为 Codex 原生流程使用的标准 `runs/<jobId>` 文件布局。它在一个配置好的工作区根目录下写入已批准任务、原始 PDF、论文元数据与文本块、重启状态、最终策略树、审查日志和审查报告。完成同步会在发布清单前确认每个已声明原始 PDF 仍然存在。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

把本包挂载在 `@deepseek-ai/dsh-supramas` 之后、SupraMAS API 或工具消费者之前。

```yaml
- name: '@deepseek-ai/dsh-supramas-artifacts'
  config:
    root: !!js process.cwd()
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `root` | 必填 | 拥有生成后 `runs/` 目录树的绝对工作区路径。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-supramas-artifacts)是全部可接受字段的权威来源。`syncTask()` 和 `syncPaper()` 在执行中更新工作文件；`syncCompleted()` 写入完整最终契约；`outputStatus()` 只返回稳定成果名称和就绪状态；`readOutput()` 只接受这些标准名称，并在调用方指定的大小上限内返回完整 UTF-8 文件。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节 — 点击展开</summary>

`SupraMasArtifacts` 从 `ctx.supramas` 读取经过校验的独立状态，渲染专用 Stage 1 YAML/JSON/JSONL/Markdown 格式，并把每条解析后的路径限制在配置根目录内。串行操作队列防止并发导出交错，共享原子写入工具负责发布完整文件。成果读取使用固定名称、有界文件句柄和增长检查，因此不会把截断文件误当成完整内容返回。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [SupraMAS 运行时](../supramas/README.zh.md) — 持久状态来源和 revision 控制。
- [SupraMAS 工具](../tool-supramas/README.zh.md) — 自动导出与修复入口。
- [SupraMAS 子系统](../../../docs/subsystems/supramas.zh.md) — 跨包所有权与生成后的服务 API。

-----

<a id="model-experience"></a>
## 模型体验

本包不直接向模型暴露内容。`@deepseek-ai/dsh-tool-supramas` 提供面向模型的导出修复工具。

#### KV Cache 影响

无；本服务自身不增加提示词或工具 schema。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包持久化导入服务提供的字节，但不获取或解析 PDF。
- 最终导出要求每篇已接受论文存在于持久证据目录中，并且每个已声明原始 PDF 位于规范路径。
- `readOutput()` 会拒绝超过请求上限的文件，而不是流式返回或返回部分内容。
- 渲染器实现 SupraMAS Stage 1 契约，不是通用 YAML 序列化服务。

<a id="dev-note"></a>
### 开发备注

持久状态始终是权威来源。持久化完成后的文件系统失败通过幂等同步修复；不得为了匹配部分文件而回退已完成运行。
