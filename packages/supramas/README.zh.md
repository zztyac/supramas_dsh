---
description: "面向 DSH 持久运行控制、Stage 1 领域校验和证据工具的 SupraMAS 包。"
kind: "package-group"
---

# SupraMAS 包

[English](README.md) | 中文

本组包构成材料科学扩展接缝。`supramas-domain` 校验 Stage 1 产物和编排，`supramas` 管理持久状态，`supramas-artifacts` 生成运行文件契约，`api-supramas` 投影安全任务视图，`tool-supramas` 暴露窄范围模型控制，`client-ui-supramas` 提供浏览器任务面板。后续阶段通过扩展这些契约演进，不修改 DSH agent loop。

| 包 | 职责 |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.zh.md) | 策略树类型、确定性 builder/reviewer 编排、图校验和逐字证据检查 |
| [`@deepseek-ai/dsh-supramas`](supramas/README.zh.md) | 运行/证据/工作流原子持久化、重启恢复、CAS revision 和角色权限 |
| [`@deepseek-ai/dsh-supramas-artifacts`](supramas-artifacts/README.zh.md) | 工作区内的任务、论文、状态、策略树、审查日志和报告文件 |
| [`@deepseek-ai/dsh-api-supramas`](api-supramas/README.zh.md) | 通过 Typert Remote 边界提供版本化、浏览器安全的任务控制 |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.zh.md) | 运行、工作流、论文、文本块、产物读取和证据校验工具 |
| [`@deepseek-ai/dsh-client-ui-supramas`](client-ui-supramas/README.zh.md) | 面向非技术用户的任务创建、调度、恢复、取消和进度面板 |

[SupraMAS 子系统页面](../../docs/subsystems/supramas.zh.md)定义端到端所有权边界。相关平台契约见[存储](../../docs/subsystems/storage.zh.md)、[Typert](../../docs/subsystems/typert.zh.md)、[工具](../../docs/subsystems/tools.zh.md)和 [Web 客户端](../../docs/subsystems/web-client.zh.md)。

## 已知限制与后续工作

兼容文件层会生成任务、论文元数据、状态和最终成果文件，但不获取或解析 PDF。builder 使用 DSH web search/fetch 和 skills；专用学术索引/PDF 导入、实时任务事件、证据可视化和浏览器下载仍是独立能力。
