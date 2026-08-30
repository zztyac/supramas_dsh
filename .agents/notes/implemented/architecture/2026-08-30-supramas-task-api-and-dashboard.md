# Agent Note: SupraMAS task API and non-technical dashboard

Status: implemented

English | [中文](2026-08-30-supramas-task-api-and-dashboard.zh.md)

## Problem

The durable Stage 1 runtime and model-facing tools could execute the migrated workflow, but a user still had to know tool names and inspect raw session output. A browser UI also needed a safe boundary: copying the workflow into React would create two transition authorities, while returning raw runtime snapshots would leak local paths and internal evidence state.

## Decision

`@deepseek-ai/dsh-api-supramas` owns one versioned Typert Remote namespace. Its V1 projection contains task identity, lifecycle, limits, progress, the next durable action, and final-output readiness, while excluding run directories, task-file paths, evidence paths, and internal workflow payloads. Create, resume, and cancel delegate to the existing runtime and preserve compare-and-set revisions. Stable failure codes let the browser distinguish malformed input, duplicate jobs, missing runs, stale revisions, and illegal transitions.

`@deepseek-ai/dsh-client-ui-supramas` registers a root-scoped material-task entry in the Web sidebar. The panel accepts a research goal, material scope, target properties, and depth, then creates the durable task through the Remote boundary. It queues one bounded coordinator message through the current Session only after creation succeeds. Without an open session, the task remains durable and the UI explains how to dispatch it later.

The UI owns no workflow mirror. Every refresh reads the Host projection, and resume/cancel submit the last displayed revision. The profile bundle mounts the runtime, artifact writer, API, model tool, and browser UI in that order.

## Alternatives considered

**Call the runtime directly from the browser plugin.** Rejected because browser code must cross the authenticated DSH transport and must not import Host state or filesystem-bearing types.

**Store optimistic workflow state in React.** Rejected because a page reload or concurrent model action would diverge from the durable state machine and make the browser a second transition authority.

**Start a hidden session automatically.** Rejected because session creation, provider choice, and the selected SupraMAS preset are user-visible product decisions. The task is committed first and can be dispatched explicitly.

## Consequences

- Non-technical users can create, monitor, resume, cancel, and dispatch Stage 1 tasks from the normal DSH Web surface.
- Browser-visible task data is intentionally smaller than the durable runtime record.
- Model and human controls converge on the same revisioned state rather than synchronizing separate stores.
- Task progress currently updates through explicit refresh; live events and artifact visualization remain later UI work.
- The coordinator still owns builder/reviewer execution through the previously enforced Stage 1 tools.

## Validation

Contract tests cover the generated Remote method surface, safe V1 projection, defaults, lifecycle recovery, compare-and-set failures, browser slot and dictionary registration, current-session queueing, no-session guidance, structured Remote failures, focus and dismissal behavior, and invariant ownership. Host and browser TypeScript builds plus both tsdown faces validate the real package boundary.
