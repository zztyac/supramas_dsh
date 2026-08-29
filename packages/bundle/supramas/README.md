---
description: "A DSH profile bundle that mounts the durable SupraMAS runtime before its model-facing tool consumer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

English | [中文](README.zh.md)

## Summary

This static profile patch adds the durable SupraMAS capability and eight-tool consumer to a DSH profile in dependency order. It changes no agent-loop behavior and owns no runtime state itself.

## Use this package

Add the bundle after the base profile bundle. The base profile supplies the DSH storage, JSON backend, and storage-domain services used by SupraMAS. Select the shipped `supramas` agent preset for the material-science persona, skills, user questions, and in-process delegation controls.

## Understand the implementation

`cordis.patch.yml` inserts `@deepseek-ai/dsh-supramas` before `@deepseek-ai/dsh-tool-supramas`. The runtime opens the versioned `supramas` storage domain; the static bundle itself still owns no service.

## Model Experience

### Profile composition

#### What the model sees

Nothing from the carrier itself. Inserted packages contribute four `supramas_run_*` tools and four evidence tools; role allowlists determine which schemas are visible.

#### Token effect

No direct bundle cost. Visible tool schemas and selected preset text own cost.

#### KV Cache effect

Changing inserted rows or role-visible tools changes the composed model surface and may invalidate prefix reuse.

## Known Limitations and Deferred Work

- The bundle does not yet install literature providers, API routes, PDF ingestion, or UI components.

### Dev Note

Keep the base storage providers and SupraMAS capability providers before their consumers. Do not move material-science behavior into the DSH core loop.
