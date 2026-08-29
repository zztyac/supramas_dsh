---
description: "Strict Stage 1 strategy-tree wire types, semantic validation, and run-local evidence resolution."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-domain

English | [中文](README.zh.md)

## Summary

This pure domain package preserves the current SupraMAS `strategy_tree.json`
wire shape while validating facts JSON Schema cannot relate. It enforces one
paper per node, stable ids, parent levels, record references, expectation-to-
edge agreement, and literal evidence quotes that resolve to run-local chunks.

## Use this package

Create one `EvidenceCatalog` per job, register each canonical
`runs/<jobId>/papers/<paperId>.json` artifact, and add its page-aware chunks.
Pass untrusted tree data through `validateStrategyTree`, or incrementally add
nodes and edges to `StrategyTreeAssembler` and call `build()`.

## Understand the implementation

`src/types.ts` owns the closed Stage 1 vocabulary and snake-case artifact
types. `src/index.ts` performs strict shape parsing before semantic and evidence
checks. Every returned artifact is detached, and failures use stable
`SupraMasDomainError` codes.

## Model Experience

### Domain validation

#### What the model sees

Nothing directly. Model-facing tools use `validateStrategyTree` and related validators, then return compact success or recovery envelopes.

#### Token effect

None from this package itself. Tool schemas and returned artifacts determine the visible token cost.

#### KV Cache effect

No direct request-prefix effect. Changing a consuming tool's schema or role visibility may invalidate reuse.

## Known Limitations and Deferred Work

- The evidence catalog is process-local until M3 persistence lands.
- M2 registers verified text chunks but does not parse PDF files itself.
- Schema validation does not decide scientific acceptance; the reviewer role
  still owns accept, revise, or reject decisions.

### Dev Note

Keep wire fields snake-case and preserve the five tuning dimensions. Do not
weaken literal quote checks or allow one paper to appear in multiple nodes.
