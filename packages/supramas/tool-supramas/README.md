---
description: "Narrow model-facing SupraMAS run and evidence tools with actionable result envelopes."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

English | [中文](README.zh.md)

## Summary

This consumer exposes eleven orchestration-safe tools over the SupraMAS services: four run controls, five durable Stage 1 workflow controls, one compatibility-file repair control, and one literal evidence verifier. Legacy paper storage, manual chunk mutation, and whole-artifact read tools are intentionally absent so a model cannot bypass verified PDF ingestion.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Compose it after `@deepseek-ai/dsh-tools`, the DSH storage stack, `@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-supramas`, and `@deepseek-ai/dsh-supramas-artifacts`. Model arguments remain snake-case. In the default `orchestrated` mode, the coordinator supplies only `run_id` and the exact current `revision` to each builder or reviewer submit tool. The tool starts one isolated, schema-constrained subagent, applies its role-specific tool filter, and persists both the structured handoff and child run id atomically. The shipped `supramas` preset uses this mode and exposes no generic subagent tool.

One handoff is bounded to 600,000 ms by default. Before a builder starts, the tool lists reusable full-text papers already imported into the run. If any are available, discovery and import tools are removed from that child call so it reads one existing paper instead of downloading another copy.

## Understand the implementation

`src/index.ts` owns all eleven schemas and maps runtime and domain failures to root-cause, safe-retry, and stop-condition guidance. Evidence-policy and edge-semantic failures have dedicated stable codes. Builder and reviewer output schemas are closed, their child depth is one, and their tool allowlists are separately bounded. Builders must verify every proposed literal quote before returning; reviewers repeat that verification independently. Finalization exports the file contract, while `supramas_artifacts_sync` repairs an interrupted export from durable state. Every workflow mutation requires the exact revision returned by the preceding call. The `direct` mode exists only for trusted integration callers and tests; do not expose it in a model-facing preset.

An unsuccessful atomic handoff never increments the workflow revision or attempt counters. The first failure latches the handoff key for that run, revision, and role in the current process; repeated calls return `SUPRAMAS_SUBAGENT_HANDOFF_FAILED` without starting another expensive child. A later process may resume the exact revision and try once again.

## Model Experience

### Run and evidence tools

#### What the model sees

Only the eleven SupraMAS controls. The coordinator cannot supply, repair, or replace a builder/reviewer payload: both submit tools accept only run identity and revision, then delegate internally. `supramas_run_list` provides restart discovery, `supramas_artifacts_sync` repairs compatibility files, and `supramas_evidence_verify` returns a small proof including `evidence_kind`. Paper discovery, import, listing, and sliced reads are visible only inside the builder handoff; bounded reads and literal verification are visible only inside review.

#### Token effect

Fixed cost for visible schemas. Run-list output grows with durable jobs; evidence verification stays bounded.

#### KV Cache effect

Prefix-stable while tool definitions and scoped role visibility remain unchanged. Adding or removing a visible tool may invalidate reuse.

## Known Limitations and Deferred Work

- The package cannot create or alter evidence artifacts; that authority belongs to the verified literature-ingestion pipeline.
- Correct role isolation requires selecting the shipped `supramas` preset; the UI refuses to queue orchestration into another preset.
- The default mode requires a configured subagent provider. A provider failure leaves the Stage 1 revision unchanged, but the same submit call must not be retried in the same process; resume the exact revision once in a fresh process.

### Dev Note

Keep model arguments snake-case and capability types camel-case. Never bypass revision checks, turn an evidence mismatch into success, or hide an unexpected exception.
