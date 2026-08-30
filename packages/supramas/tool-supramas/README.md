---
description: "Narrow model-facing SupraMAS run and evidence tools with actionable result envelopes."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

English | [中文](README.zh.md)

## Summary

This consumer exposes thirteen tools over `ctx.supramas`: four run controls, five durable Stage 1 workflow controls, and four evidence controls. Every tool validates arguments and returns the same stable success or recovery envelope; workflow responses include structured `workflow`, `next_action`, and final `tree` data.

## Use this package

Compose it after `@deepseek-ai/dsh-tools`, the DSH storage stack, and `@deepseek-ai/dsh-supramas`. Model arguments remain snake-case. The coordinator owns `supramas_stage1_*`; builders use paper/chunk tools; reviewers use artifact read/evidence verify. The shipped preset exposes separate foreground `supramas_builder` and `supramas_reviewer` subagents with enforced tool filters.

## Understand the implementation

`src/index.ts` owns all thirteen schemas and maps runtime and domain failures to root-cause, safe-retry, and stop-condition guidance. Every workflow mutation requires the exact revision returned by the preceding call. Domain failures remain successful tool transport values; unexpected programming faults still throw. The Cordis disposer removes all tools during HMR.

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
- The builder currently uses DSH web search/fetch and skills; scholarly-index connectors and PDF ingestion are still separate providers.

### Dev Note

Keep model arguments snake-case and capability types camel-case. Never bypass revision checks, turn an evidence mismatch into success, or hide an unexpected exception.
