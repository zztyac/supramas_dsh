# Agent Note: SupraMAS durable Stage 1 orchestration

Status: implemented

English | [中文](2026-08-30-supramas-stage1-orchestration.zh.md)

## Problem

The Codex-native SupraMAS workflow depended on prompt convention for its most important scientific control: a builder proposed one paper, a reviewer accepted, revised, or rejected it, and the coordinator recursively expanded every accepted limitation. Copying those prompts into DSH would not prove that review happened, that a rejected candidate stayed outside the tree, that retries consumed a real budget, or that a restart resumed the exact pending handoff.

## Decision

`@deepseek-ai/dsh-supramas-domain` owns a pure Stage 1 state machine. It derives one legal `nextStage1Action` from durable state: build a root, build a child for one limitation frontier, review a candidate, revise the same paper, finalize, or report failure/completion. Only reviewer acceptance moves a pending candidate into the tree. The runtime assigns topology ids and copies the parent limitation expectation into the edge, so a builder cannot choose ancestry.

Every accepted limitation becomes a frontier. A frontier closes only through an accepted edge, exhausted real builder attempts, the configured depth or width limit, or the global child target. Finalization runs the strict strategy-tree and local-evidence validator again and is illegal while any frontier is open.

`@deepseek-ai/dsh-supramas` stores the workflow beside the run snapshot and evidence catalog in the same storage-domain row. Starting, builder submission, reviewer submission, and finalization are compare-and-set mutations that increment the run revision. Startup revalidates the workflow against reconstructed local evidence; interrupted work becomes `recoverable_failed` without losing its pending action.

The shipped preset replaces generic delegation with two foreground, one-shot tools. `supramas_builder` may use skills, DSH web search/fetch, and evidence-write tools. `supramas_reviewer` may only read local artifacts and verify quotes. The coordinator receives five `supramas_stage1_*` tools and submits each child result through the durable gate.

## Alternatives considered

**Keep orchestration only in the coordinator persona.** This is flexible but cannot prevent skipped review, stale writes, or premature finalization.

**Store accepted nodes only.** This loses pending reviewer feedback and retry accounting on restart, causing duplicate calls or unbounded retries.

**Use one generic subagent tool for both roles.** Prompt-only role selection leaves the reviewer able to mutate evidence and the builder able to claim acceptance. Separate configured tool instances enforce visibility and execution authority together.

## Consequences

- Builder and reviewer handoffs are deterministic, resumable, and CAS-protected.
- Pending candidates never appear in the accepted strategy tree.
- Recursive completion has explicit terminal reasons instead of silent truncation.
- The state machine preserves the existing snake-case paper-node and edge contracts.
- Child output remains model-produced JSON; invalid output is rejected by the durable domain boundary and must be corrected.
- DSH web search/fetch is available now, while dedicated scholarly-index and PDF-ingestion providers remain separate work.

## Validation

Tests cover revise-before-accept, recursive frontier closure, retry exhaustion, invalid edges, duplicate ancestor papers, early finalization, exact restart recovery, stale revisions, model-facing start/build/review/finalize tools, role allowlists, preset YAML, and Loader composition. Focused TypeScript compilation and the repository verification gates cover all modified packages.
