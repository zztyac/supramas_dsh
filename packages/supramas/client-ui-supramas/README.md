---
description: "Non-technical browser workspace for running and inspecting evidence-grounded SupraMAS tasks."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-supramas

English | [中文](README.zh.md)

## Summary

This package adds a **Material tasks** entry to the DSH Web sidebar. It gives non-technical users a guided Stage 1 form, live progress, an accepted strategy-tree workspace, paper and evidence inspection, canonical output downloads, and actions to create, dispatch, resume, cancel, or refresh a durable SupraMAS task.

## Table of Contents

- [Try it from this source checkout](#try-it-from-this-source-checkout)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Try it from this source checkout

Run these commands once from the repository root:

```powershell
pnpm run build
pnpm run build:web
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

Then open `http://127.0.0.1:3080`, create or open a session with the **SupraMAS** preset, choose **Material tasks** in the lower-left sidebar, enter a research goal, and choose **Create and start**. Open **View research results** on a task to inspect accepted nodes, follow limitation-to-paper edges, open evidence chunks, and download ready outputs.

Creating a task commits it to durable storage first. If a session is open, the panel queues a coordinator instruction into that session. If no session is open, the task remains safe and the panel tells the user to open a SupraMAS session and choose **Run in current session**.

## Understand the implementation

The browser plugin registers one root-scoped `sidebar.footer.action`. It reads and mutates tasks only through `ctx.remote.supramas`; it does not mirror the Stage 1 state machine in React. Active details poll every three seconds and stop at a terminal phase. The research workspace renders only accepted tree projections and loads evidence text only after the user selects a chunk. Session dispatch uses the existing Sessions binding and queues a prompt that tells the coordinator to read the durable `next_action` before doing work.

The modal supports keyboard dismissal and focus restoration, Chinese and English dictionaries, loading/empty/error states, revision-aware recovery actions, accessible tree semantics, responsive tree/detail columns, and theme-aware research panels.

## Model Experience

Indirectly, through one user-triggered coordinator message that tells the active SupraMAS session to continue the durable run.

#### KV Cache effect

No idle cost. Dispatching or resuming adds one user message and therefore starts a new request prefix.

## Known Limitations and Deferred Work

- Active task details use polling; live server-sent task events are not wired yet.
- Large evidence chunks are read in bounded slices, and canonical downloads are limited by the API payload cap.
- The form intentionally exposes the common research goal, materials, target properties, and depth; advanced retry and width limits keep safe runtime defaults.

### Dev Note

Keep durable state in `@deepseek-ai/dsh-supramas`. This package may project or dispatch a task, but must not infer a new workflow transition locally.
