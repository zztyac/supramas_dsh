---
description: "Managed-subprocess pypdf provider for bounded, page-aware SupraMAS full-text extraction."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-pdf-pypdf

English | [中文](README.zh.md)

## Summary

This provider extracts PDF text page by page with `pypdf` in a DSH-managed isolated Python process. The harness owns argv, environment, timeout, process-tree termination, output limits, and JSON validation; the child receives no model-authored code.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Install `pypdf` in the configured Python environment, then mount the provider after `ctx.subprocess` and `ctx.supramasLiterature`.

```yaml
- name: '@deepseek-ai/dsh-supramas-pdf-pypdf'
  config:
    pythonExecutable: python
    timeoutMs: 60000
```

The provider invokes Python with `-I`, forces UTF-8 streams inside the isolated script, enforces page and text caps before JSON output, and rejects truncated or malformed process output.

## Model Experience

### Page-aware extraction

#### What the model sees

Indirectly through `supramas_chunk_list` and `supramas_chunk_read`, the model sees page-aware chunk identifiers and one bounded text slice at a time. It cannot select the executable, script, local path, or process arguments.

#### Token effect

The provider adds no prompt or schema. Extracted whole-document text stays behind the service boundary; the tool consumer caps each visible slice.

#### KV Cache effect

Parsing changes no static prefix. Only explicitly requested chunk slices become append-only tool results.

## Known Limitations and Deferred Work

- The configured Python environment must provide `pypdf`.
- Image-only pages are not OCR'd and may produce a no-text rejection.
- PDF extraction quality follows `pypdf` for unusual fonts, layouts, and damaged files.

### Dev Note

Keep parsing in the managed subprocess and retain complete-output checks. Never fall back to partially collected stdout as evidence.
