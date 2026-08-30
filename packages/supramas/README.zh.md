---
description: "面向 DSH 持久化运行控制、Stage 1 领域校验和证据工具的 SupraMAS 包。"
kind: "package-group"
---

# SupraMAS 包

[English](README.md) | 中文

本组包构成材料科学扩展接缝。`supramas-domain` 保存并校验 Stage 1 产物及 builder/reviewer 状态机，`supramas` 管理持久运行、证据与工作流状态，`api-supramas` 投影安全的任务视图，`tool-supramas` 暴露范围受控的模型工具，`client-ui-supramas` 提供浏览器任务面板。后续阶段通过扩展这些契约演进，不修改 DSH agent loop。

| 包 | 职责 |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.zh.md) | 策略树类型、确定性 builder/reviewer 编排、语义图校验和本地证据逐字检查 |
| [`@deepseek-ai/dsh-supramas`](supramas/README.zh.md) | 运行/证据/工作流原子持久化、重启恢复、CAS revision 与角色权限 |
| [`@deepseek-ai/dsh-api-supramas`](api-supramas/README.zh.md) | 通过 Typert Remote 边界提供版本化、浏览器安全的任务控制 |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.zh.md) | 运行、工作流、论文、文本块、产物读取和证据核验工具 |
| [`@deepseek-ai/dsh-client-ui-supramas`](client-ui-supramas/README.zh.md) | 面向非技术用户的任务创建、调度、恢复、取消与进度面板 |

[SupraMAS 子系统页面](../../docs/subsystems/supramas.zh.md)定义端到端所有权边界。相关平台契约见[存储](../../docs/subsystems/storage.zh.md)、[Typert](../../docs/subsystems/typert.zh.md)、[工具](../../docs/subsystems/tools.zh.md)和 [Web 客户端](../../docs/subsystems/web-client.zh.md)。

## 已知限制与后续工作

持久目录会保存产物元数据和抽取文本，但声明的 `runs/<jobId>/papers/...` 路径目前是溯源标识，不是 PDF 自动导入流程。builder 已使用 DSH web search/fetch 与 skills，首版浏览器 API 和任务面板也已可用；专用学术索引/PDF 导入、实时任务事件、证据可视化和最终产物下载仍属于后续里程碑。
