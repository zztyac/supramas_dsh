---
description: "Durable SupraMAS run lifecycle, Stage 0/1 role authority, and per-run evidence catalogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas

English | [中文](README.zh.md)

## Summary

This capability registers `ctx.supramas`, a deterministic material-science run registry backed by the DSH storage-domain service. Each run has a stable identity, compare-and-set revision, constrained phase graph, canonical artifact paths, role allowlists, an isolated provenance-classified evidence catalog, and an optional durable Stage 1 workflow.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the DSH storage stack and this service before any SupraMAS tool consumer. Import complete PDFs through the ingestion service so stored paper metadata carries `full_text_source` and parsed chunks carry `evidence_kind: full_text`; manual chunks default to `abstract`. Create a run, advance it to `task_ready`, and drive `startStage1()` through `finalizeStage1()` with the exact returned revisions. Restored workflows are revalidated before their pending action is exposed.

## Understand the implementation

`src/types.ts` defines lifecycle and workflow views, `src/roles.ts` owns role authority, `src/spec.ts` defines the versioned storage domain, and `src/index.ts` validates transitions and delegates workflow/evidence semantics to the domain package. One storage row contains the run snapshot, paper chunks, and workflow. Every workflow mutation replaces that complete row and increments the run revision.

During service initialization, `running` and `validating` rows are rewritten as `recoverable_failed` with a new revision and a retryable `process-restarted` failure. Stable sequence numbers preserve creation order even when timestamps match.

## Model Experience

### Capability and role metadata

#### What the model sees

Nothing directly. Consumers turn `ROLE_SPECS` into scoped tool allowlists and expose capability methods through model-facing tools.

#### Token effect

None from this package itself; selected consumer schemas determine token cost.

#### KV Cache effect

No direct effect. Changing a role's visible tool list changes the request prefix and may invalidate reuse.

## Known Limitations and Deferred Work

- Durable records contain paper metadata, a verified source descriptor when available, and provenance-classified chunks, but this package does not fetch or parse PDFs.
- A filesystem ingestion provider must materialize the canonical raw PDF referenced by `full_text_source.local_path`.
- Scientific review remains a separate, read-only subagent decision; the runtime enforces the decision gate and the declared expectation-satisfaction/edge-type mapping.

### Dev Note

Keep one atomic storage row per run. Do not publish in-memory mutations before the durable write succeeds, broaden lifecycle transitions without tests, or weaken compare-and-set revision checks.
