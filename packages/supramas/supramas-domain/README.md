---
description: "Strict Stage 1 strategy-tree wire types, semantic validation, and run-local evidence resolution."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

English | [中文](README.zh.md)

## Summary

This pure domain package preserves the current SupraMAS `strategy_tree.json` wire shape and adds a deterministic, resumable builder/reviewer state machine. It enforces one paper per node, stable ids, parent levels, record references, literal evidence quotes, durable full-text provenance, reviewer acceptance gates, expectation-to-edge semantics, real attempt budgets, and terminal recursive frontiers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Create one `EvidenceCatalog` per job, register each canonical artifact, and classify every page-aware chunk as `abstract` or `full_text`. When `constraints.exclude` contains `abstract-only evidence`, every accepted node must resolve to a canonical local PDF plus at least one cited `full_text` chunk. Reviewers declare `expectation_satisfaction`; accepted child edges map `full` to `direct`, `partial` to `transferable`, and `adjacent` to `exploratory`. An `accept` decision must contain no critical issue, edge issue, or acceptance condition. Set `requireAgentHandoffs` for model-orchestrated workflows so every builder attempt and accepted review carries its originating child run id. These policies are rechecked during acceptance, restore, and finalization.

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

- This package validates supplied artifacts and chunks but relies on an ingestion provider to acquire, hash, persist, and parse PDF files.
- The state machine enforces clean, attributable reviewer decisions but does not replace the reviewer model's scientific judgment.

### Dev Note

Keep wire fields snake-case and preserve the five tuning dimensions. Do not weaken literal quote checks or allow one paper to appear in multiple nodes.
