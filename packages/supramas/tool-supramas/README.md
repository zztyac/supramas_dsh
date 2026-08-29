---
description: "Narrow model-facing SupraMAS run and evidence tools with actionable result envelopes."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

English | [中文](README.zh.md)

## Summary

This consumer exposes six tools over `ctx.supramas`: run creation and lookup,
paper registration, chunk storage, artifact reading, and literal evidence
verification. Every tool validates arguments and returns the same stable
success or recovery envelope.

## Use this package

Compose it after `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-supramas`.
Model arguments remain snake-case. Builder roles use paper and chunk tools;
reviewers use artifact read and evidence verify. Role allowlists must hide tools
the current role cannot invoke.

## Understand the implementation

`src/index.ts` owns all six schemas and maps runtime and domain failures to
root-cause, safe-retry, and stop-condition guidance. Domain failures remain
successful tool transport values; unexpected programming faults still throw.
The Cordis disposer removes all tools during HMR.

## Model Experience

### Run and evidence tools

#### What the model sees

Only tools allowed for the selected role. `supramas_artifact_read` returns stored chunks in a compact JSON envelope, while verification returns a small proof.

#### Token effect

Fixed cost for visible schemas. Artifact-read output grows with stored chunk text, so callers should read one paper at a time.

#### KV Cache effect

Prefix-stable while tool definitions and scoped role visibility remain unchanged. Adding or removing a visible tool may invalidate reuse.

## Known Limitations and Deferred Work

- Evidence state is process-local and does not yet write the declared path.
- `supramas_chunk_extract` stores supplied verified text; PDF parsing arrives
  with the filesystem-backed provider.
- Literature search and run transitions remain coordinator integrations.

### Dev Note

Keep model arguments snake-case and capability types camel-case. Never turn an
evidence mismatch into success or hide an unexpected exception.
