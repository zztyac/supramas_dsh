# Agent Note: SupraMAS durable run and evidence recovery

Status: implemented

English | [中文](2026-08-30-supramas-durable-run-recovery.zh.md)

## Problem

The initial SupraMAS capability kept lifecycle snapshots and evidence catalogs in process memory. A DSH restart therefore lost both the current revision and the provenance used to validate a strategy tree. Persisting lifecycle and evidence through separate writes would introduce a second failure mode: a run could advance while its cited paper chunks remained absent, or the chunks could commit while the visible run revision stayed stale.

Recovery also needs an explicit ownership boundary. Restarting a scientific workflow automatically can repeat model calls or external operations, while leaving active states untouched falsely reports work as still running.

## Decision

`@deepseek-ai/dsh-supramas` uses the official DSH storage stack and opens the versioned `supramas` storage domain. One row per run contains a stable creation sequence, the complete lifecycle snapshot, and all paper artifacts and evidence chunks. Every mutation constructs and validates the next full record, writes it through `KvTable.put()`, and only then publishes the corresponding in-memory catalog state.

Initialization validates every stored record and reconstructs its detached `EvidenceCatalog`. Rows in `running` or `validating` are atomically rewritten as `recoverable_failed`, with revision incremented and a retryable `process-restarted` failure. An operator or coordinator may resume only by submitting that new revision through the normal lifecycle transition.

Two model tools expose this contract. `supramas_run_list` discovers durable work in stable creation order, and `supramas_run_transition` performs an exact compare-and-set transition. Task setup can list/create/read runs; only the coordinator role receives transition authority.

## Alternatives considered

**Write run snapshots and evidence files independently.** This resembles the existing directory layout, but cannot guarantee that a visible revision and its evidence provenance commit together. Compensating rollback would add more states than the domain needs.

**Append a custom SupraMAS event log.** Replay is useful for audit history, but the current milestone needs the latest recoverable truth. Adding a second event framework beside DSH storage would duplicate migration, corruption, and compaction concerns before an audit requirement exists.

**Automatically continue `running` work during startup.** This minimizes operator interaction but can repeat non-idempotent model or filesystem work. Marking the run recoverable makes interruption explicit and preserves a CAS boundary before execution resumes.

## Consequences

- Lifecycle and evidence mutations have one durable publication boundary.
- Restarted active work cannot appear permanently running and cannot resume from a stale revision.
- The runtime stays backend-neutral; the base bundle currently supplies the JSON backend and another storage backend can implement the same domain.
- The record is a current-state snapshot, not a historical audit log.
- Canonical paper paths remain provenance identities; PDF acquisition and parsing still require a separate ingestion provider.

## Validation

Tests restart two independent Cordis contexts over the same JSON root and prove that run state, paper metadata, and evidence chunks survive. They verify active run recovery, revision conflicts, stable model envelopes, storage publication failure without partial in-memory state, role allowlists, and real Loader composition with the DSH storage stack.
