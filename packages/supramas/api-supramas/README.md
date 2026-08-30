---
description: "Versioned Typert Remote control boundary for durable SupraMAS material-science tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-api-supramas

English | [中文](README.zh.md)

## Summary

This package exposes the durable SupraMAS runtime to trusted DSH browser clients through the versioned `supramas` Typert Remote namespace. It lists and reads tasks, creates and starts a Stage 1 workflow, resumes recoverable work, and cancels active work with compare-and-set revisions.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after `@deepseek-ai/dsh-supramas`. The shipped SupraMAS bundle already preserves that order and mounts the browser dashboard after this API.

The public V1 view contains task identity, lifecycle state, Stage 1 limits, aggregate progress, and the next durable action. Local run directories, task-file paths, evidence paths, and internal workflow payloads do not cross the browser boundary.

| Remote method | Purpose |
| --- | --- |
| `list()` | Return every durable material task in creation order. |
| `get(runId)` | Return one current task view. |
| `createStage1(request)` | Normalize input, create the run, approve the task, and enter Stage 1. |
| `resume(runId, revision)` | Resume a recoverable task under revision control. |
| `cancel(runId, revision)` | Cancel a non-terminal task under revision control. |

Caller-correctable failures use stable codes for malformed input, duplicate jobs, missing runs, stale revisions, and invalid lifecycle transitions.

## Understand the implementation

`SupraMasController` is the sole Host owner of the `supramas` namespace. It delegates every mutation to `ctx.supramas`, then projects the resulting durable snapshot into V1 wire types. The generated Remote client is mounted into `@deepseek-ai/dsh-api-remotes`, so browser plugins use the normal authenticated DSH transport rather than a bespoke route.

## Model Experience

None, as this Remote boundary registers no prompt, message, schema, or model-facing tool.

#### KV Cache effect

None; browser RPC calls never enter provider requests.

## Known Limitations and Deferred Work

- V1 is request/response only; the dashboard refreshes explicitly instead of receiving a task event stream.
- The API projects progress and next action, but does not yet expose final artifact download or evidence browsing.
- Only Stage 1 strategy-tree work is represented.

### Dev Note

Keep wire types self-contained for Typert generation. Never expose host filesystem paths or let the API duplicate Stage 1 transition rules.
