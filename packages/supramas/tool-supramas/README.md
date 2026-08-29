---
description: "Narrow model-facing SupraMAS run tools with validated arguments and actionable result envelopes."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas

English | [中文](README.zh.md)

## Summary

This consumer exposes `supramas_run_create` and `supramas_run_get` over `ctx.supramas`. Both tools validate arguments before execution and return one stable envelope with `status`, `summary`, `next_actions`, `artifacts`, and either `data` or a structured `error`.

## Use this package

Compose it after `@deepseek-ai/dsh-tools` and `@deepseek-ai/dsh-supramas`. Create calls use snake-case model arguments and canonical run-owned paths. Domain failures remain successful tool transport values so the agent can follow `next_actions`; unknown programming faults still throw and remain visible to operators.

## Understand the implementation

`src/index.ts` owns the two schemas, converts validated model arguments to capability requests, and maps stable domain errors to recovery guidance. The Cordis registration disposer removes both tools during HMR. A real Loader composition test protects package resolution and injection order.

## Model Experience

### Run tools

#### What the model sees

The model sees the fixed `supramas_run_create` and `supramas_run_get` schemas. Results are compact JSON envelopes; failures name the root cause, safe retry, and stop condition.

#### Token effect

Fixed schema cost whenever these tools are visible, plus data-dependent compact JSON result tokens.

#### KV Cache effect

Prefix-stable while tool definitions and scoped visibility remain unchanged. Registering, removing, or restricting either tool may invalidate reuse from the tool-catalog boundary.

## Known Limitations and Deferred Work

- M1 exposes creation and lookup only; transitions remain coordinator-internal until orchestration contracts land.
- Listing, evidence, artifact, and review tools are introduced by later stages.
- Tool visibility must still be restricted by the selected role allowlist.

### Dev Note

Keep model arguments snake-case and capability types camel-case. Caller-correctable `SupraMasError` values become envelopes; unexpected exceptions must not be hidden.
