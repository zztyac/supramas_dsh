# Agent Note: SupraMAS Stage 1 compatible artifacts

Status: implemented

English | [中文](2026-08-31-supramas-stage1-compatible-artifacts.zh.md)

## Problem

The durable SupraMAS runtime preserved run, evidence, and builder/reviewer state, but its `runs/<jobId>` paths were provenance identities rather than files. The Codex-native Stage 1 workflow and downstream material-science tooling consume an approved `input_task.yaml`, paper metadata and chunks, restart state, and three final outputs. Making those files authoritative would duplicate the revisioned state machine, while exporting only once at finalization would leave no recovery path if durable completion succeeded before a filesystem write failed.

## Decision

`@deepseek-ai/dsh-supramas-artifacts` is a separate Cordis service mounted after `ctx.supramas` and before API or tool consumers. It projects validated detached state into the canonical run layout below one required absolute workspace root. Path resolution rejects escapes, writes publish complete files through the shared atomic-write utility, and one serialized operation queue prevents concurrent exports from interleaving.

Stage 1 start writes `input_task.yaml`; paper registration and chunk extraction refresh the owning paper JSON; finalization writes the complete task, accepted papers, `tree_state.json`, `strategy_tree.json`, `node_review_log.jsonl`, and `review_report.md`. Unchanged durable state produces byte-identical repeated exports. `supramas_artifacts_sync` repairs task files during active work or the complete contract after durable completion, so the run never moves backward to match partial files.

The task renderer preserves evidence policy, include/exclude guidance, material scope, target properties, nullable width controls, and the original Stage 1 retry semantics. API defaults use depth three and three child attempts, matching the Codex-native task contract. The versioned Remote API exposes only the three final output names and readiness; absolute host paths remain private.

## Alternatives considered

**Store rendered files as the durable record.** Rejected because filesystem files do not provide the storage-domain compare-and-set revision, restart validation, or atomic workflow transition authority.

**Export only inside finalization with no repair operation.** Rejected because durable completion and multiple filesystem publications cannot form one transaction. A process or disk failure after the durable commit needs an idempotent recovery entry point.

**Roll back a completed run when export fails.** Rejected because it would discard a validated scientific decision to mirror a recoverable projection failure and could reopen already accepted builder/reviewer work.

**Add a general YAML serializer.** Rejected because the compatibility document has a small closed schema and the repository change does not need another runtime dependency. The specialized renderer quotes every string and owns the fixed Stage 1 field order.

## Consequences

- Existing Codex-native Stage 1 consumers can read the canonical run files while DSH durable state remains the only mutation authority.
- Export retries are safe and deterministic, including after a completed run is recovered from a partial filesystem publication.
- API and browser clients can report output readiness without learning the workspace root.
- The compatibility service writes stored paper metadata and chunks but does not acquire or parse PDFs.
- The bundle load order includes runtime, artifact writer, API, model tools, and browser UI.

## Validation

Artifact tests drive revise-to-accept orchestration, export the exact six-file golden contract twice, and compare every byte. Tool and API tests cover automatic synchronization, repair, browser-safe readiness, defaults, and missing-run failures. A real Loader composition mounts the service dependency, and keyless HTTP/SSE canaries prove both a model-issued SupraMAS tool call and isolated `supramas_builder` to `supramas_reviewer` handoff. A credential-gated canary exercises the same overlay against the official provider when `DEEPSEEK_API_KEY` is available.

## Related

- [Durable run recovery](2026-08-30-supramas-durable-run-recovery.md)
- [Stage 1 orchestration](2026-08-30-supramas-stage1-orchestration.md)
- [Task API and dashboard](2026-08-30-supramas-task-api-and-dashboard.md)
