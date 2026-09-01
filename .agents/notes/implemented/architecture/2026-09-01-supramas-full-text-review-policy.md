# Agent Note: SupraMAS full-text and review policy

Status: implemented

English | [中文](2026-09-01-supramas-full-text-review-policy.zh.md)

## Problem

The first same-input comparison between the Codex-native SupraMAS workflow and DSH produced a structurally valid but scientifically weaker DSH tree. The session used the standard preset, imported no PDFs, stored search abstracts through legacy mutation tools, and accepted every candidate without a revision loop. The domain could verify literal substrings but could not distinguish abstract metadata from parsed full text, and child edge labels were accepted without a durable statement of how well the child satisfied its parent expectation.

Because evidence and workflow state survive process restarts, a prompt-only restriction was insufficient. A model could bypass the intended importer, and a previously accepted abstract-only workflow could later restore or finalize even after stronger runtime guidance was deployed.

## Decision

Persist full-text provenance as product state. Every evidence chunk carries `evidence_kind: abstract|full_text`; every successful complete import stores a canonical raw PDF descriptor containing path, media type, SHA-256, byte length, and page count. Omitted evidence kind is treated as `abstract`. The storage domain is version 2 so older rows are rejected rather than silently upgraded into trusted provenance.

When a Stage 1 task explicitly excludes `abstract-only evidence`, reviewer acceptance, durable restore, and finalization each require every accepted node to have a valid `full_text_source` and at least one cited `full_text` chunk. Compatibility export includes declared raw PDFs and fails when a declared source is missing.

Reviewer output schema v2 requires `expectation_satisfaction`. Root reviews use `not_applicable`; accepted child reviews map `full` to `direct`, `partial` to `transferable`, and `adjacent` to `exploratory`; `none` cannot be accepted. The domain revalidates this relationship from the accepted review log during restore and finalization.

Make builder and reviewer delegation atomic. In the shipped preset, the coordinator-facing submit tools accept only `run_id` and `revision`. Each tool starts one depth-one subagent with a closed output schema and a role-specific tool allowlist, then commits that exact structured result together with its child run id. Model-orchestrated workflows require those run ids during submission, restore, and finalization. An `accept` review must have empty critical issues, edge issues, and acceptance conditions; otherwise the reviewer must return `revise` or `reject`.

Bound and fail closed around unsuccessful handoffs. A builder receives a compact catalog of reusable imported full-text papers and loses discovery/import authority while that catalog is non-empty. Each builder or reviewer child is time-bounded to ten minutes by default. A failed child leaves durable revision and attempt counters untouched, then latches the run/revision/role in that process so coordinator retries return an explicit stop envelope without spawning more children. A fresh process may resume that unchanged revision once.

Remove model-facing legacy paper storage, manual chunk extraction, and whole-artifact read tools. Builders discover candidates through bounded search, treat abstracts as discovery metadata, and import complete PDFs through the dedicated ingestion pipeline before submitting nodes. Import failures direct the builder to another open-access candidate or a refined query and never authorize abstract fallback. The SupraMAS bundle no longer mounts model tools globally, and the browser queues orchestration only into a Session using the `supramas` preset.

Allow public cross-origin scholarly redirects only by validating and address-pinning every hop independently. Redirect limits, private-address rejection, credential rejection, streaming byte limits, and final PDF validation remain mandatory.

## Alternatives considered

**Strengthen only the agent prompt.** Rejected because the failed run already demonstrated that a standard agent can call globally mounted legacy tools and self-approve abstract evidence despite intended role guidance.

**Keep legacy mutation tools but hide them with role filters.** Rejected because global bundle composition and preset mistakes would still create a bypass surface. Evidence creation belongs only to the verified importer.

**Infer edge type from reviewer prose.** Rejected because free-form text is not durable machine-checkable state and cannot be reliably revalidated after restart.

**Let the coordinator call generic builder and reviewer tools.** Rejected because the same-input run showed the coordinator repairing malformed reviewer JSON and considering self-approval. Atomic structured delegation makes the child output, child identity, and state transition one auditable operation.

**Reject every cross-origin redirect.** Rejected because legitimate open-access PDF endpoints commonly redirect across public repository or CDN origins; per-hop public-network validation preserves those sources without weakening SSRF controls.

**Migrate old records by assuming existing chunks are full text.** Rejected because historical records do not contain evidence sufficient to establish that provenance. Fail-closed versioning is the only defensible upgrade.

## Consequences

Abstract-only candidates can no longer enter or survive a protected Stage 1 workflow, and edge semantics are deterministic across acceptance, restart, and finalization. The model-visible tool surface is smaller, generic role tools are absent, and preset mistakes are detected before UI queueing. Every accepted model-orchestrated handoff is attributable to a child run, while contradictory accept decisions are rejected. Successful exports now contain auditable raw PDFs as well as paper JSON and final outputs.

Imported full text is now reusable work rather than disposable child-session context. Provider failures and malformed structured outputs cannot create unbounded same-revision child loops inside one process; operators receive the exact safe resume revision instead.

Old SupraMAS durable rows require a fresh run under domain version 2. Some open-access candidates will still fail import because no public PDF exists or the document is unsupported; builders must continue searching rather than fabricate evidence. Scientific quality still depends on reviewer judgment, but runtime policy now prevents the two observed structural bypasses.
