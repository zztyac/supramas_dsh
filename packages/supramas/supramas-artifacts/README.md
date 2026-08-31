---
description: "Workspace-confined Stage 1 compatibility files and idempotent final-output export for SupraMAS runs."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-artifacts

English | [中文](README.zh.md)

## Summary

This package materializes a durable SupraMAS Stage 1 run as the canonical `runs/<jobId>` file layout used by the Codex-native workflow. It writes the approved task, stored paper metadata and chunks, restart state, final strategy tree, review log, and review report below one configured workspace root. It also serves bounded reads of the three canonical outputs to trusted Host consumers. Repeating an export replaces complete files atomically and produces the same bytes for unchanged durable state.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount it after `@deepseek-ai/dsh-supramas` and before the SupraMAS API or tool consumer.

```yaml
- name: '@deepseek-ai/dsh-supramas-artifacts'
  config:
    root: !!js process.cwd()
```

| Field | Default | Meaning |
|---|---|---|
| `root` | required | Absolute workspace directory that owns the generated `runs/` tree. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-supramas-artifacts) is the exhaustive source for accepted fields. `syncTask()` and `syncPaper()` update working files during execution; `syncCompleted()` writes the complete final contract; `outputStatus()` returns only stable output names and readiness; `readOutput()` accepts only those names and returns a complete UTF-8 file within the caller's bounded size limit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`SupraMasArtifacts` reads validated detached state from `ctx.supramas`, renders the specialized Stage 1 YAML/JSON/JSONL/Markdown forms, and confines every resolved path to the configured root. A serialized operation tail prevents concurrent exports from interleaving, while the shared atomic-write utility publishes complete files. Output reads use fixed names, bounded file handles, and a growth check so callers never receive a truncated file as if it were complete.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [SupraMAS runtime](../supramas/README.md) — durable source state and revision control.
- [SupraMAS tools](../tool-supramas/README.md) — automatic export and repair entry points.
- [SupraMAS subsystem](../../../docs/subsystems/supramas.md) — cross-package ownership and generated service API.

-----

<a id="model-experience"></a>
## Model Experience

None, as this Host-side filesystem projection registers no prompt, tool schema, or model-visible result.

#### KV Cache effect

None; this service adds no prompt or tool schema by itself.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The package exports stored metadata and text chunks; it does not acquire or parse PDFs.
- Final export requires every accepted paper to exist in the durable per-run evidence catalog.
- `readOutput()` rejects files beyond the requested limit instead of streaming or returning partial content.
- The renderer implements the SupraMAS Stage 1 contract and is not a generic YAML serialization service.

<a id="dev-note"></a>
### Dev Note

Keep durable state authoritative. A filesystem failure after durable completion is repaired through the idempotent sync operation; never roll the completed run backward to match partial files.
