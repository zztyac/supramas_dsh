---
description: "面向 DSH 持久化运行控制、Stage 1 领域校验和证据工具的 SupraMAS 包。"
kind: "package-map"
---

# SupraMAS 包

[English](README.md) | 中文

本组包构成材料科学扩展接缝。`supramas-domain` 保存并校验 Stage 1 产物及 builder/reviewer 状态机，`supramas` 管理持久运行、证据与工作流状态，`tool-supramas` 暴露范围受控的模型工具。后续阶段通过扩展这些契约演进，不修改 DSH agent loop。

| 包 | 职责 |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.zh.md) | 策略树类型、确定性 builder/reviewer 编排、语义图校验和本地证据逐字检查 |
| [`@deepseek-ai/dsh-supramas`](supramas/README.zh.md) | 运行/证据/工作流原子持久化、重启恢复、CAS revision 与角色权限 |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.zh.md) | 运行、工作流、论文、文本块、产物读取和证据核验工具 |

## 已知限制与后续工作

持久目录会保存产物元数据和抽取文本，但声明的 `runs/<jobId>/papers/...` 路径目前是溯源标识，不是 PDF 自动导入流程。builder 已使用 DSH web search/fetch 与 skills；专用学术索引/PDF 导入 provider、API 接口和 Web UI 仍属于后续里程碑。
