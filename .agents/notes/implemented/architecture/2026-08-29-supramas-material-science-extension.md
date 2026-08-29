# Agent Note: SupraMAS material-science extension seam

Status: implemented

English | [中文](2026-08-29-supramas-material-science-extension.zh.md)

## Problem

SupraMAS must move its material-science multi-agent workflow onto DSH while
remaining able to consume upstream DSH changes. Putting domain state, role
authority, or workflow transitions inside the DSH agent loop would make that
loop a permanent fork. Keeping the old Codex orchestration only as prompt text
would leave run identity, lifecycle transitions, and tool authority impossible
to validate independently.

The first migration milestone therefore needs a stable extension boundary
before evidence persistence, scientific schemas, recovery, and UI work begin.

## Decision

SupraMAS is implemented as DSH plugins, a profile bundle, and a selectable
agent preset. The DSH agent loop, session model, loader, and subagent drivers
remain unchanged. A capability package owns material-science state and
authority; model-facing adapters expose narrow tools; later persistence,
domain, API, and UI packages depend on those seams.

The profile bundle composes the capability runtime before its tool consumer.
The shipped `supramas` preset selects that bundle and supplies the role-facing
instructions without granting every role every tool.

## M1 boundary

M1 establishes deterministic run identity, compare-and-set revisions, a
closed lifecycle graph, four Stage 0/1 role contracts, creation and lookup
tools, and real Loader composition. State is process-local so the contract can
be proven before a durable store is introduced. The tool error envelope always
includes an actionable retry and a stop condition.

## Alternatives considered

**Fork the DSH agent loop around the existing SupraMAS coordinator.** This
would make the first demo direct, but every upstream loop, session, and
subagent change would become a manual merge. It also puts scientific workflow
policy in a general-purpose execution core.

**Represent the migration only with personas and prompt instructions.** This
preserves upstream source but cannot enforce role-specific tool authority,
compare-and-set state changes, or machine-testable lifecycle rules. Prompts
remain part of the preset, but they do not own the runtime contract.

**Introduce durable storage in M1.** Persistence is necessary for restart
recovery, but choosing its schema before the run and role contracts are proven
would couple two decisions. M1 deliberately keeps a process-local registry;
the durable implementation replaces storage behind `ctx.supramas` in M3.

## Consequences

- Upstream DSH updates remain mergeable because material-science behavior does
  not fork the core loop.
- Role tool lists are enforceable authority boundaries, not prose
  recommendations.
- Durable recovery can replace storage behind `ctx.supramas` without changing
  model tools.
- The shipped preset may evolve independently of ordinary coding presets.
- A process restart loses M1 run state; callers receive this limitation
  explicitly until M3 supplies persistence and recovery.

## Validation

Each milestone starts with failing contract tests. It advances only after
focused tests, real composition smoke tests, package type checks, and the
relevant repository gates pass.
