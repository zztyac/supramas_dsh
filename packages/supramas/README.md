---
description: "SupraMAS packages for durable DSH run control, Stage 1 domain validation, and evidence tools."
kind: "package-group"
---

# SupraMAS packages

English | [中文](README.zh.md)

This group contains the material-science extension seam. `supramas-domain` validates Stage 1 artifacts and orchestration, `supramas` owns durable state, `supramas-artifacts` materializes the run file contract, `api-supramas` projects safe task views, `tool-supramas` exposes narrow model controls, and `client-ui-supramas` provides the browser task panel. Higher stages extend these contracts without modifying the DSH agent loop.

| Package | Responsibility |
|---|---|
| [`@deepseek-ai/dsh-supramas-domain`](supramas-domain/README.md) | Strategy-tree types, deterministic builder/reviewer orchestration, graph validation, and literal evidence checks |
| [`@deepseek-ai/dsh-supramas`](supramas/README.md) | Atomic run/evidence/workflow persistence, restart recovery, CAS revisions, and role authority |
| [`@deepseek-ai/dsh-supramas-artifacts`](supramas-artifacts/README.md) | Workspace-confined task, paper, state, tree, review-log, and report files |
| [`@deepseek-ai/dsh-api-supramas`](api-supramas/README.md) | Versioned browser-safe task control over the Typert Remote boundary |
| [`@deepseek-ai/dsh-tool-supramas`](tool-supramas/README.md) | Run, workflow, paper, chunk, artifact-read, and evidence-verification tools with actionable envelopes |
| [`@deepseek-ai/dsh-client-ui-supramas`](client-ui-supramas/README.md) | Non-technical task creation, dispatch, recovery, cancellation, and progress dashboard |

The [SupraMAS subsystem page](../../docs/subsystems/supramas.md) defines the end-to-end ownership boundary. Related platform contracts are documented in [storage](../../docs/subsystems/storage.md), [Typert](../../docs/subsystems/typert.md), [tools](../../docs/subsystems/tools.md), and [Web client](../../docs/subsystems/web-client.md).

## Known Limitations and Deferred Work

The compatibility layer materializes task, paper-metadata, state, and final-output files, but it does not acquire or parse PDFs. The builder uses DSH web search/fetch and skills; dedicated scholarly-index/PDF ingestion, live task events, evidence visualization, and browser downloads remain separate capabilities.
