---
description: "Durable SupraMAS run lifecycle, Stage 0/1 role authority, and per-run evidence catalogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas

English | [中文](README.zh.md)

## Summary

This capability registers `ctx.supramas`, a deterministic material-science run registry backed by the DSH storage-domain service. Each run has a stable identity, compare-and-set revision, constrained phase graph, canonical artifact paths, role allowlists, and an isolated Stage 1 evidence catalog supplied by `@deepseek-ai/dsh-supramas-domain`.

## Use this package

Mount the DSH storage stack and this service before any SupraMAS tool consumer. Create a run with canonical `runs/<jobId>` paths, retain its revision for transitions, then register papers and evidence chunks under the returned run id. Reads and verification always return detached values. Use `list()` after a restart to discover durable work, then transition a `recoverable_failed` run back to `running` with its current revision.

## Understand the implementation

`src/types.ts` defines lifecycle values, `src/roles.ts` owns role authority, `src/spec.ts` defines the versioned `supramas/runs` storage domain, and `src/index.ts` validates transitions and delegates evidence semantics to the domain package. One storage row contains the complete run snapshot and all paper chunks. Mutations publish new in-memory state only after the row is durable, so failed writes do not expose partial lifecycle or evidence changes.

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

- Durable records contain paper metadata and extracted chunks, but this package does not fetch or parse PDFs.
- `local_path` is validated as the canonical provenance path; a filesystem ingestion provider must materialize the referenced source separately.
- Literature retrieval and scientific review decisions remain separate roles.

### Dev Note

Keep one atomic storage row per run. Do not publish in-memory mutations before the durable write succeeds, broaden lifecycle transitions without tests, or weaken compare-and-set revision checks.
