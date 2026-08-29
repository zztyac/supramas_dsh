---
description: "SupraMAS packages that add material-science run contracts and model-facing controls to DeepSeek Harness."
kind: "package-map"
---

# SupraMAS packages

English | [中文](README.zh.md)

This group contains the material-science extension seam. `supramas` owns run state and role authority; `tool-supramas` exposes narrow model-facing controls. Higher stages extend these contracts without modifying the DSH agent loop.

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-supramas`](supramas/README.md) | Run lifecycle, compare-and-set revisions, and Stage 0/1 role contracts |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.md) | Validated run creation and inspection tools with actionable envelopes |

## Known Limitations and Deferred Work

M1 state is process-local. Durable recovery, evidence storage, Stage 1 orchestration, API surfaces, and the Web UI are introduced by later validated milestones.
