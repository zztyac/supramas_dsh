---
description: "Bounded model-facing literature search, complete paper import, chunk index, and sliced evidence read tools."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-supramas-literature

English | [中文](README.zh.md)

## Summary

This tool consumer exposes four bounded operations: structured literature search, complete candidate import, text-free chunk listing, and one sliced chunk read. It never returns PDF bytes, internal absolute paths, document download URLs, or an entire paper's text.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after `ctx.tools`, `ctx.supramas`, `ctx.supramasLiterature`, and `ctx.supramasPaperIngest`.

```yaml
- name: '@deepseek-ai/dsh-tool-supramas-literature'
  config:
    maxSearchResults: 10
    maxAbstractChars: 1200
    maxChunkReadChars: 20000
```

Builder roles receive `supramas_literature_search`, `supramas_paper_import`, `supramas_chunk_list`, and `supramas_chunk_read`. Reviewer roles receive only the list/read tools plus the separate literal evidence verifier. Search abstracts are discovery metadata only; a builder must successfully import a complete PDF before submitting a node. When the indexed document is blocked, `supramas_paper_import.document_url` may carry a public direct PDF found by web search for the same opaque candidate. The public-network transport still applies SSRF protection, and parsed DOI/title matching rejects a mismatched document.

## Model Experience

### Literature workflow tools

#### What the model sees

Four tools: `supramas_literature_search`, `supramas_paper_import`, `supramas_chunk_list`, and `supramas_chunk_read`. Results use stable success/error envelopes; candidates carry opaque IDs, imports return digests and counts, chunk lists omit text, and reads require one chunk ID with `offset`/`max_chars` pagination.

#### Token effect

Four compact tool definitions are added only to allowed agent scopes. Search count, abstract length, list size, and each text read are independently bounded by configuration.

#### KV Cache effect

The allowed tool definitions are stable and cacheable. Each invocation appends only its bounded result and does not rewrite prior context.

## Known Limitations and Deferred Work

- Search currently depends on the mounted structured-index provider set.
- Chunk pagination is character-based, not token-based.
- Import failures return recovery guidance to try a verified public PDF for the same candidate, select another open-access candidate, or refine the query; they never authorize abstract fallback.

### Dev Note

Do not weaken public-network validation or candidate identity matching for `document_url`. Keep output paths, executables, parser scripts, binary content, and whole-document text behind the service boundary.
