---
description: "SupraMAS run lifecycle, Stage 0/1 role authority, and per-run local evidence catalogs."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas

English | [中文](README.zh.md)

## Summary

This capability registers `ctx.supramas`, a deterministic material-science run
registry. Each run has a stable identity, compare-and-set revision, constrained
phase graph, canonical artifact paths, role allowlists, and an isolated Stage 1
evidence catalog supplied by `@deepseek-ai/dsh-supramas-domain`.

## Use this package

Mount the service before any SupraMAS tool consumer. Create a run with
canonical `runs/<jobId>` paths, retain its revision for transitions, then
register papers and evidence chunks under the returned run id. Reads and
verification always return detached values.

## Understand the implementation

`src/types.ts` defines lifecycle values, `src/roles.ts` owns role authority,
and `src/index.ts` validates transitions and delegates evidence semantics to
the domain package. M2 intentionally keeps both maps process-local; M3 replaces
storage behind the same capability methods.

## Model Experience

### Capability and role metadata

#### What the model sees

Nothing directly. Consumers turn `ROLE_SPECS` into scoped tool allowlists and expose capability methods through model-facing tools.

#### Token effect

None from this package itself; selected consumer schemas determine token cost.

#### KV Cache effect

No direct effect. Changing a role's visible tool list changes the request prefix and may invalidate reuse.

## Known Limitations and Deferred Work

- Run and evidence state do not survive restart until M3.
- M2 records canonical local paths but does not write files to disk.
- Literature retrieval and scientific review decisions remain separate roles.

### Dev Note

Do not broaden lifecycle transitions or role tool lists without tests. Keep
domain validation behind the existing capability seam so model tools remain
stable when persistence changes.
