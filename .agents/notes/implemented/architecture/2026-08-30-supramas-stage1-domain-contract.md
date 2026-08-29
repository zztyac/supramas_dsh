# Agent Note: SupraMAS Stage 1 domain and evidence contract

Status: implemented

English | [中文](2026-08-30-supramas-stage1-domain-contract.zh.md)

## Problem

The Codex-native SupraMAS project already exports a useful Stage 1 `strategy_tree.json` shape, but JSON Schema validates fields independently. It cannot prove that one paper appears once, a limitation references records from its own node, an edge repeats its parent expectation exactly, or an evidence quote exists in the saved local chunk.

Moving only the JSON Schema into DSH would preserve syntax while losing the evidence discipline that makes a literature strategy tree trustworthy.

## Decision

`@deepseek-ai/dsh-supramas-domain` preserves the existing snake-case wire fields, closed source and edge types, and five tuning dimensions. It adds a strict parser followed by semantic graph checks and local evidence resolution.

An `EvidenceCatalog` belongs to one job and accepts only canonical `runs/<jobId>/papers/<paperId>.json` paths. Chunk ids are unique within the job, page claims must match, and every `evidence_text` must occur literally in the referenced chunk. `StrategyTreeAssembler.build()` crosses the same validation boundary as direct `validateStrategyTree()` calls.

The existing `ctx.supramas` capability owns one catalog per run. Four narrow tools register a paper, add a chunk, read an artifact, and verify a quote. They reuse the M1 result envelope and expose mismatches as caller-correctable domain errors without hiding programming faults.

## Alternatives considered

**Copy the JSON Schema and stop at structural validation.** This is closest to the old export command, but dangling record ids, contradictory edge text, and invented evidence would still pass. The migration would preserve a file format without preserving its scientific contract.

**Rename artifact fields to camel-case inside DSH.** This would match M1 run types but require a translation layer at every import, export, and UI boundary. The Stage 1 artifact is already an external contract, so it remains snake-case; only internal run lifecycle values use camel-case.

**Write papers and chunks to disk directly in M2.** Durable files are required, but coupling filesystem recovery to domain semantics would prevent isolated contract tests. M2 owns canonical paths and detached in-memory state; M3 puts a durable provider behind the same runtime methods.

## Consequences

- Existing strategy-tree artifacts can migrate without field renaming.
- A tree cannot finalize while local evidence or cross-record relationships are unresolved.
- Builder and reviewer tools now share one provenance source instead of passing unchecked quotes through prompts.
- Process restart still loses catalogs until M3; the limitation is explicit in package and tool documentation.
- PDF parsing and scientific accept/revise/reject judgment remain outside the domain package.

## Validation

Contract tests cover the current wire shape, missing and mismatched evidence, duplicate papers and ids, broken record and edge references, incremental assembly, all four tools, error envelopes, disposal, and real Loader composition.
