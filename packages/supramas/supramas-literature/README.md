---
description: "Bounded scholarly discovery, PDF acquisition, parser-provider selection, and stable page chunking for SupraMAS."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-literature

English | [中文](README.zh.md)

## Summary

This service owns the provider-neutral literature boundary for SupraMAS. It selects exactly one configured or unambiguous index, acquisition, and parser provider; bounds every query, PDF, page, and extracted-text result; issues opaque candidate IDs; and creates deterministic page-aware chunks.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount the service before its OpenAlex, HTTP, parser, ingestion, or tool consumers.

```yaml
- name: '@deepseek-ai/dsh-supramas-literature'
  config:
    indexProvider: openalex
    acquisitionProvider: http
    parserProvider: pypdf
```

Search returns metadata without a PDF URL. `acquire()` resolves the opaque candidate internally and verifies MIME, PDF magic, size, and SHA-256. `parseDocument()` accepts only an absolute internal path and revalidates provider output. `chunkParsedPages()` never crosses page boundaries.

## Model Experience

### Provider-neutral discovery and evidence boundary

#### What the model sees

Nothing directly. Through `@deepseek-ai/dsh-tool-supramas-literature`, the model receives opaque candidate IDs such as `openalex:W123`, bounded metadata, verified import counts, and page-scoped chunk slices; it never receives the resolved PDF URL or an internal absolute path.

#### Token effect

This service adds no prompt text or tool schema. Its consumer bounds candidate counts, abstract characters, chunk indexes, and each requested text slice.

#### KV Cache effect

Mounting or selecting a provider changes no static request prefix. Only later tool results are appended to the conversation.

## Known Limitations and Deferred Work

- Provider availability is local and cheap; remote health is known only when a request runs.
- Scanned image-only PDFs are rejected as no-text documents; OCR is not implemented.
- Candidate deduplication uses external ID, DOI, then normalized title and is not semantic citation clustering.

### Dev Note

Keep binary transport and parser implementations behind their registries. Never add caller-supplied URLs or output paths to model-facing operations.
