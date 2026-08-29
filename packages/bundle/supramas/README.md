---
description: "A DSH profile bundle that mounts the SupraMAS runtime before its model-facing tool consumer."
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

English | [中文](README.zh.md)

## Summary

This static profile patch adds the SupraMAS capability and tool consumer to a DSH profile in dependency order. It changes no agent-loop behavior and owns no runtime state.

## Use this package

Add the bundle after the base profile bundle. Select the shipped `supramas` agent preset for the material-science persona, local skills, user questions, and in-process delegation tools.

## Understand the implementation

`cordis.patch.yml` inserts `@deepseek-ai/dsh-supramas` before `@deepseek-ai/dsh-tool-supramas`. The TypeScript entry is a static package carrier; inserted packages own lifecycle and invariants.

## Model Experience

### Profile composition

#### What the model sees

Nothing from the static bundle carrier itself. Rows in `cordis.patch.yml` contribute the two M1 tool schemas; the separately selected preset contributes the material-science persona and delegation surface.

#### Token effect

No direct cost from the bundle. Costs belong to the inserted tool schemas and selected preset text.

#### KV Cache effect

The bundle adds no request content by itself. Changing its inserted rows changes the composed model surface and may invalidate prefix reuse.

## Known Limitations and Deferred Work

- The bundle does not install persistence, literature providers, API routes, or UI components yet. Those are separate, test-gated bundles in later milestones.

### Dev Note

Keep capability providers before their consumers in the patch. Do not move material-science behavior into the DSH core loop.
