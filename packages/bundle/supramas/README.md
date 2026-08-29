---
description: "A DSH profile bundle that mounts the SupraMAS runtime before its model-facing tool consumer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

English | [中文](README.zh.md)

## Summary

This static profile patch adds the SupraMAS capability and six-tool consumer to
a DSH profile in dependency order. It changes no agent-loop behavior and owns
no runtime state.

## Use this package

Add the bundle after the base profile bundle. Select the shipped `supramas`
agent preset for the material-science persona, skills, user questions, and
in-process delegation controls.

## Understand the implementation

`cordis.patch.yml` inserts `@deepseek-ai/dsh-supramas` before
`@deepseek-ai/dsh-tool-supramas`. The runtime depends on the pure domain package;
the static bundle itself still owns no service.

## Model Experience

### Profile composition

#### What the model sees

Nothing from the carrier itself. Inserted packages contribute two `supramas_run_*` tools and four evidence tools; role allowlists determine which schemas are visible.

#### Token effect

No direct bundle cost. Visible tool schemas and selected preset text own cost.

#### KV Cache effect

Changing inserted rows or role-visible tools changes the composed model surface and may invalidate prefix reuse.

## Known Limitations and Deferred Work

- The bundle does not yet install durable persistence, literature providers,
  API routes, or UI components.

### Dev Note

Keep capability providers before consumers. Do not move material-science
behavior into the DSH core loop.
