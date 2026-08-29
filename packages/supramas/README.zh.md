---
description: "为 DeepSeek Harness 增加材料科学运行契约和模型工具的 SupraMAS 包组。"
kind: "package-map"
---

# SupraMAS 包组

[English](README.md) | 中文

本组是材料科学扩展边界。`supramas` 管理运行状态和角色权限，`tool-supramas` 提供窄而可验证的模型工具。后续阶段只扩展这些契约，不修改 DSH 智能体循环。

| 包 | 职责 |
|---|---|
| [`@deepseek-ai/dsh-supramas`](supramas/README.zh.md) | 运行生命周期、比较并交换版本和 Stage 0/1 角色契约 |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.zh.md) | 带可执行错误信封的运行创建与读取工具 |

## 已知限制与延期工作

M1 状态仅存在于当前进程。持久恢复、证据存储、Stage 1 编排、API 和 Web UI 将在后续经过验证的阶段加入。
