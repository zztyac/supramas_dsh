---
description: "SupraMAS packages for durable DSH run control, Stage 1 domain validation, and evidence tools."
kind: "package-group"
---

# SupraMAS packages

English | [中文](README.zh.md)

This group contains the material-science extension seam. `supramas-domain` preserves and validates Stage 1 artifacts and its builder/reviewer state machine, `supramas` owns durable run, evidence, and workflow state, `api-supramas` projects safe task views, `tool-supramas` exposes narrow model controls, and `client-ui-supramas` provides the browser task panel. Higher stages extend these contracts without modifying the DSH agent loop.

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.md) | Strategy-tree types, deterministic builder/reviewer orchestration, graph validation, and literal evidence checks |
| [`@deepseek-ai/dsh-supramas`](supramas/README.md) | Atomic run/evidence/workflow persistence, restart recovery, CAS revisions, and role authority |
| [`@deepseek-ai/dsh-api-supramas`](api-supramas/README.md) | Versioned browser-safe task control over the Typert Remote boundary |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.md) | Run, workflow, paper, chunk, artifact-read, and evidence-verification tools with actionable envelopes |
| [`@deepseek-ai/dsh-client-ui-supramas`](client-ui-supramas/README.md) | Non-technical task creation, dispatch, recovery, cancellation, and progress dashboard |

The [SupraMAS subsystem page](../../docs/subsystems/supramas.md) defines the end-to-end ownership boundary. Related platform contracts are documented in [storage](../../docs/subsystems/storage.md), [Typert](../../docs/subsystems/typert.md), [tools](../../docs/subsystems/tools.md), and [Web client](../../docs/subsystems/web-client.md).

## Known Limitations and Deferred Work

The durable catalog preserves artifact metadata and extracted text, while the declared `runs/<jobId>/papers/...` path remains a provenance identity rather than a PDF ingestion pipeline. The builder uses DSH web search/fetch and skills, and the first browser API and task dashboard are available; dedicated scholarly-index/PDF ingestion, live task events, evidence visualization, and final artifact downloads remain later milestones.
