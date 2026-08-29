---
description: "SupraMAS packages for DSH run control, Stage 1 domain validation, and evidence tools."
kind: "package-map"
---

# SupraMAS packages

English | [中文](README.zh.md)

This group contains the material-science extension seam. `domain` preserves
and validates Stage 1 artifacts, `supramas` owns run and evidence state, and
`tool-supramas` exposes narrow model controls. Higher stages extend these
contracts without modifying the DSH agent loop.

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.md) | Strategy-tree wire types, semantic graph validation, and literal local evidence checks |
| [`@deepseek-ai/dsh-supramas`](supramas/README.md) | Run lifecycle, compare-and-set revisions, role authority, and per-run evidence catalogs |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.md) | Run, paper, chunk, artifact-read, and evidence-verification tools with actionable envelopes |

## Known Limitations and Deferred Work

M2 state and evidence catalogs remain process-local. Durable recovery,
filesystem-backed paper storage, Stage 1 orchestration, API surfaces, and the
Web UI arrive in later validated milestones.
