---
description: "A DSH profile extension that mounts the durable SupraMAS runtime, API, model tools, and browser dashboard."
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

English | [中文](README.zh.md)

## Summary

This static profile patch adds the durable SupraMAS capability, versioned browser API, thirteen-tool model consumer, and non-technical task dashboard to a DSH profile in dependency order. It changes no agent-loop behavior and owns no runtime state itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Add the bundle after the base and Web profile bundles. The base profile supplies the DSH storage services used by SupraMAS. Select the shipped `supramas` agent preset for the material-science persona, skills, user questions, and in-process delegation controls.

From a source checkout, build once and launch the ordinary Web profile with this bundle as an overlay:

```powershell
pnpm run build
pnpm run build:web
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

## Understand the implementation

`cordis.patch.yml` inserts the runtime, Typert API, model tool, and browser UI in that order. The runtime opens the versioned `supramas` storage domain; the static bundle itself still owns no service.

## Model Experience

### Profile composition

#### What the model sees

Nothing from the carrier itself. Inserted packages contribute thirteen `supramas_*` run, evidence, and Stage 1 workflow tools; role allowlists determine which schemas are visible.

#### Token effect

No direct bundle cost. Visible tool schemas and selected preset text own cost.

#### KV Cache effect

Changing inserted rows or role-visible tools changes the composed model surface and may invalidate prefix reuse.

## Known Limitations and Deferred Work

- The bundle does not yet install dedicated scholarly-index providers, PDF ingestion, live task events, or final-artifact visualization.

### Dev Note

Keep the base storage providers and SupraMAS capability providers before their consumers. Do not move material-science behavior into the DSH core loop.
