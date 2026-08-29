---
description: "Narrow model-facing SupraMAS run and evidence tools with actionable result envelopes."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

English | [中文](README.zh.md)

## Summary

This consumer exposes eight tools over `ctx.supramas`: run creation, durable listing, lookup, compare-and-set transition, paper registration, chunk storage, artifact reading, and literal evidence verification. Every tool validates arguments and returns the same stable success or recovery envelope.

## Use this package

Compose it after `@deepseek-ai/dsh-tools`, the DSH storage stack, and `@deepseek-ai/dsh-supramas`. Model arguments remain snake-case. Task setup can discover, create, and read runs; the coordinator owns transitions; builders use paper and chunk tools; reviewers use artifact read and evidence verify. Role allowlists must hide tools the current role cannot invoke.

## Understand the implementation

`src/index.ts` owns all eight schemas and maps runtime and domain failures to root-cause, safe-retry, and stop-condition guidance. `supramas_run_transition` requires the exact revision returned by list/get, preventing stale callers from overwriting recovered work. Domain failures remain successful tool transport values; unexpected programming faults still throw. The Cordis disposer removes all tools during HMR.

## Model Experience

### Run and evidence tools

#### What the model sees

Only tools allowed for the selected role. `supramas_run_list` provides restart discovery, `supramas_artifact_read` returns one paper's stored chunks, and verification returns a small proof.

#### Token effect

Fixed cost for visible schemas. Run-list output grows with durable jobs and artifact-read output grows with stored chunk text, so callers should narrow reads promptly.

#### KV Cache effect

Prefix-stable while tool definitions and scoped role visibility remain unchanged. Adding or removing a visible tool may invalidate reuse.

## Known Limitations and Deferred Work

- `supramas_chunk_extract` stores supplied verified text; PDF parsing belongs to a later filesystem-backed ingestion provider.
- Literature search and full Stage 1 orchestration are not yet model tools.

### Dev Note

Keep model arguments snake-case and capability types camel-case. Never bypass revision checks, turn an evidence mismatch into success, or hide an unexpected exception.
