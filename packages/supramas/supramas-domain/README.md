---
description: "Strict Stage 1 strategy-tree wire types, semantic validation, and run-local evidence resolution."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

English | [中文](README.zh.md)

## Summary

This pure domain package preserves the current SupraMAS `strategy_tree.json` wire shape and adds a deterministic, resumable builder/reviewer state machine. It enforces one paper per node, stable ids, parent levels, record references, expectation-to-edge agreement, literal evidence quotes, reviewer acceptance gates, real attempt budgets, and terminal recursive frontiers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Create one `EvidenceCatalog` per job, register each canonical artifact, and add its page-aware chunks. Use `createStage1Workflow`, inspect `nextStage1Action`, submit one builder or reviewer result through the matching function, and call `finalizeStage1Workflow` only when every frontier is terminal. The runtime serializes the workflow and catalog into one durable run record.

## Understand the implementation

`src/types.ts` owns the closed Stage 1 vocabulary and snake-case artifact types. `src/index.ts` performs strict artifact and evidence checks; `src/orchestration.ts` owns the pure workflow transitions and durable-state revalidation. Every returned value is detached, and failures use stable `SupraMasDomainError` codes.

## Model Experience

### Domain validation

#### What the model sees

Nothing directly. Model-facing tools use `validateStrategyTree` and related validators, then return compact success or recovery envelopes.

#### Token effect

None from this package itself. Tool schemas and returned artifacts determine the visible token cost.

#### KV Cache effect

No direct request-prefix effect. Changing a consuming tool's schema or role visibility may invalidate reuse.

## Known Limitations and Deferred Work

- This package validates supplied artifacts and chunks but does not parse PDF files itself.
- The state machine enforces reviewer decisions but does not replace the reviewer model's scientific judgment.

### Dev Note

Keep wire fields snake-case and preserve the five tuning dimensions. Do not weaken literal quote checks or allow one paper to appear in multiple nodes.
