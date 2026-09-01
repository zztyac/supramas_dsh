---
description: "Complete acquire, persist, parse, chunk, and durable evidence import transaction for SupraMAS papers."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-paper-ingest

English | [中文](README.zh.md)

## Summary

This service coordinates one safe paper import: resolve and acquire an opaque candidate, atomically cache its verified PDF, parse bounded page text, create deterministic `full_text` chunks, commit metadata, complete source provenance, and all chunks in one durable mutation, then materialize the compatibility JSON.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after the SupraMAS runtime, artifacts service, literature service, and their selected providers.

```yaml
- name: '@deepseek-ai/dsh-supramas-paper-ingest'
  config:
    maxChunkChars: 12000
    overlapChars: 400
```

`importCandidate()` accepts a run ID, service-issued candidate ID, and source classification. It persists `full_text_source` with the canonical raw PDF path, SHA-256 digest, byte length, media type, and page count; every parsed chunk is marked `evidence_kind: full_text`.

## Model Experience

### Paper import result

#### What the model sees

Through `supramas_paper_import`, the model sees paper metadata, a SHA-256 digest, safe relative artifact references, and byte, page, and chunk counts. It never receives extracted whole-document text or an internal source path.

#### Token effect

The service adds no prompt or schema. The import result has fixed fields and bounded bibliographic strings, independent of PDF text length.

#### KV Cache effect

An import changes no static prefix; its compact result is appended once, while later evidence text requires explicit paginated reads.

## Known Limitations and Deferred Work

- A PDF cached before a later parse failure may remain as an unreferenced source file; no durable paper or compatibility JSON is committed.
- Re-importing an already imported candidate is rejected as duplicate provenance rather than silently overwriting it.
- The transaction covers durable evidence atomically; filesystem and durable storage are not one cross-resource database transaction.

### Dev Note

Keep `ctx.supramas.importPaper()` as the single durable commit. Do not restore loops of one metadata write followed by many chunk writes.
