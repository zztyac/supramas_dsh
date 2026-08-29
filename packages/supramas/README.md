---
description: "SupraMAS packages for durable DSH run control, Stage 1 domain validation, and evidence tools."
kind: "package-map"
---

# SupraMAS packages

English | [中文](README.zh.md)

This group contains the material-science extension seam. `supramas-domain` preserves and validates Stage 1 artifacts, `supramas` owns durable run and evidence state, and `tool-supramas` exposes narrow model controls. Higher stages extend these contracts without modifying the DSH agent loop.

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.md) | Strategy-tree wire types, semantic graph validation, and literal local evidence checks |
| [`@deepseek-ai/dsh-supramas`](supramas/README.md) | Atomic run/evidence persistence, restart recovery, compare-and-set lifecycle revisions, and role authority |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.md) | Run discovery/control plus paper, chunk, artifact-read, and evidence-verification tools with actionable envelopes |

## Known Limitations and Deferred Work

The durable catalog preserves artifact metadata and extracted text, while the declared `runs/<jobId>/papers/...` path remains a provenance identity rather than a PDF ingestion pipeline. Literature retrieval, Stage 1 orchestration, API surfaces, and the Web UI arrive in later validated milestones.
