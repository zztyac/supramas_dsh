---
description: "Source-delivered DSH profile for durable, evidence-grounded SupraMAS material research."
kind: "package-bundle"
---

# @deepseek-ai/dsh-supramas-bundle

English | [中文](README.zh.md)

## Summary

This static profile patch adds the durable SupraMAS capability, compatibility-file writer, scholarly discovery and PDF-ingestion providers, versioned browser API, eighteen-tool model consumer, and live non-technical research workspace to a DSH profile in dependency order. It changes no agent-loop behavior and owns no runtime state itself.

## Table of Contents

- [Use this package](#use-this-package)
- [Install and run the source fork](#install-and-run-the-source-fork)
- [Upgrade a source checkout](#upgrade-a-source-checkout)
- [Release boundary](#release-boundary)
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

## Install and run the source fork

Use Node.js `^22.19.0` or `>=24.0.0`, pnpm `11.7.0`, and Python with `pypdf` for full-text PDF extraction.

```powershell
git clone --branch feat/supramas-platform https://github.com/zztyac/supramas_dsh.git
cd supramas_dsh
corepack enable
pnpm install --frozen-lockfile
python -m pip install pypdf
pnpm run build
pnpm run build:web
pnpm run test:supramas
pnpm dsh web --patch packages/bundle/supramas/cordis.patch.yml
```

Open `http://127.0.0.1:3080`, select the **SupraMAS** preset, and use **Material tasks**. `pnpm run verify:supramas` is the slower pre-release check that regenerates Host contracts, typechecks the browser face, and runs the complete SupraMAS package suite.

## Upgrade a source checkout

Keep the same working directory so the artifact root and existing `runs/` tree stay stable. Preserve the configured DSH storage and do not remove `runs/` during an upgrade.

```powershell
git switch feat/supramas-platform
git pull --ff-only origin feat/supramas-platform
corepack enable
pnpm install --frozen-lockfile
python -m pip install --upgrade pypdf
pnpm run build
pnpm run build:web
pnpm run verify:supramas
```

Restart the Web command after the checks pass. Durable workflow state remains authoritative; completed compatibility outputs can be regenerated idempotently.

## Release boundary

This fork is currently delivered from source. Package names and versions still follow the upstream `@deepseek-ai` release family, so a personal fork must not run `release:publish` until it adopts an owned npm scope and a coordinated package-name migration.

The non-publishing release checks remain useful:

```powershell
pnpm run build:official
pnpm run release:verify --family dsh
pnpm run release:pack --family dsh --out dist/npm --concurrency 4
```

The bundle release-contract test verifies that the packed entry files are declared, every mounted provider is an install dependency, and the dependency closure reaches every SupraMAS workspace package.

## Understand the implementation

`cordis.patch.yml` inserts the runtime, workspace-confined artifact writer, literature registry, OpenAlex provider, bounded HTTP acquisition, managed `pypdf` parser, paper-ingestion coordinator, Typert API, model tools, and browser UI in dependency order. The runtime opens the versioned `supramas` storage domain; the artifact writer uses the process workspace as its root; the static bundle itself still owns no service.

## Model Experience

### Profile composition

#### What the model sees

Nothing from the carrier itself. Inserted packages contribute eighteen `supramas_*` run, literature, ingestion, evidence, export-repair, and Stage 1 workflow tools; role allowlists determine which schemas are visible.

#### Token effect

No direct bundle cost. Visible tool schemas and selected preset text own cost.

#### KV Cache effect

Changing inserted rows or role-visible tools changes the composed model surface and may invalidate prefix reuse.

## Known Limitations and Deferred Work

- OpenAlex availability and rate limits apply to scholarly discovery.
- Full-text extraction requires `pypdf`; image-only PDFs are not OCR'd.
- Active browser progress uses bounded polling rather than a live server event stream.
- The fork is source-delivered until package ownership moves from the upstream npm scope.

### Dev Note

Keep the base storage providers and SupraMAS capability providers before their consumers. Do not move material-science behavior into the DSH core loop.
