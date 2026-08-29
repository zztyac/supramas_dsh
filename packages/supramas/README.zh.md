---
description: "用于 DSH 运行控制、Stage 1 领域校验和证据工具的 SupraMAS 包组。"
kind: "package-map"
---

# SupraMAS 包组

[English](README.md) | 中文

本组是材料科学扩展边界。`domain` 保留并校验 Stage 1 artifact，
`supramas` 管理运行和证据状态，`tool-supramas` 暴露窄模型控制。后续阶段
只扩展这些契约，不修改 DSH 智能体循环。

| 包 | 职责 |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.zh.md) | 策略树 wire 类型、语义图校验和本地证据原文字面核验 |
| [`@deepseek-ai/dsh-supramas`](supramas/README.zh.md) | 运行生命周期、比较并交换版本、角色权限和每次运行的证据目录 |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.zh.md) | 带可执行信封的运行、论文、文本块、产物读取和证据核验工具 |

## 已知限制与延期工作

M2 状态和证据目录仍只存在于当前进程。持久化恢复、文件系统论文存储、
Stage 1 编排、API 和 Web UI 将在后续经过验证的里程碑加入。
