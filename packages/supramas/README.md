---
description: "SupraMAS packages for durable DSH run control, Stage 1 domain validation, and evidence tools."
kind: "package-map"
---

# SupraMAS packages

English | [中文](README.zh.md)

This group contains the material-science extension seam. `supramas-domain` preserves and validates Stage 1 artifacts and its builder/reviewer state machine, `supramas` owns durable run, evidence, and workflow state, and `tool-supramas` exposes narrow model controls. Higher stages extend these contracts without modifying the DSH agent loop.

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.md) | Strategy-tree types, deterministic builder/reviewer orchestration, graph validation, and literal evidence checks |
| [`@deepseek-ai/dsh-supramas`](supramas/README.md) | Atomic run/evidence/workflow persistence, restart recovery, CAS revisions, and role authority |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.md) | Run, workflow, paper, chunk, artifact-read, and evidence-verification tools with actionable envelopes |

## Known Limitations and Deferred Work

The durable catalog preserves artifact metadata and extracted text, while the declared `runs/<jobId>/papers/...` path remains a provenance identity rather than a PDF ingestion pipeline. The builder uses DSH web search/fetch and skills, but a dedicated scholarly-index/PDF ingestion provider, API surfaces, and the Web UI remain later validated milestones.
