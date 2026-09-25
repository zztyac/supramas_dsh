---
description: "Keyless arXiv Atom provider for bounded SupraMAS scholarly discovery and preprint resolution."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-literature-arxiv

English | [中文](README.zh.md)

## Summary

This package maps the arXiv Atom API into the SupraMAS literature seam. Search exposes bounded bibliographic metadata for preprints; candidate resolution exposes the arXiv PDF URL with an ordered unversioned fallback. Together with the OpenAlex provider it restores multi-source scholarly discovery: the literature service fans out to every configured index provider and deduplicates candidates across sources.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after `ctx.web` and `ctx.supramasLiterature`, next to `@deepseek-ai/dsh-supramas-literature-openalex`.

```yaml
- name: '@deepseek-ai/dsh-supramas-literature'
  config:
    indexProviders:
      - openalex
      - arxiv
- name: '@deepseek-ai/dsh-supramas-literature-openalex'
- name: '@deepseek-ai/dsh-supramas-literature-arxiv'
```

After adding or removing any workspace package, regenerate the tsconfig package aliases once (`pnpm run gen-tsconfig-paths`); profile-launch loader imports resolve `@deepseek-ai/*` names through those aliases, so a new package is invisible to `dsh web` until they are regenerated.

The provider queries `/api/query` with `search_query`, `max_results`, and `sortBy=relevance`. Entries map to sparse-safe candidates: id, collapsed title, authors, publication year, DOI when present, venue `arXiv`, abstract, and `openAccess: true`. Resolution returns the entry's PDF link plus the unversioned `arxiv.org/pdf/<id>` fallback.

## Model Experience

### arXiv candidate projection

#### What the model sees

Indirectly through `supramas_literature_search`, the model sees bibliographic fields and an opaque `arxiv:<article-id>` candidate ID merged and deduplicated with the other configured sources. The provider's resolved PDF URL is never projected into a search result.

#### Token effect

The provider contributes no prompt or schema. Search result count and abstract length are bounded by the literature tool.

#### KV Cache effect

There is no static-prefix effect; each bounded search response is an append-only tool result.

## Known Limitations and Deferred Work

- arXiv asks clients to pace requests (roughly one search every three seconds) and applies upstream rate limits; the service federates sources but adds no client-side throttling.
- arXiv exposes no citation count, so candidates from this provider carry no `citedByCount`.
- Candidate ids keep the arXiv version suffix (for example `2310.12345v2`); resolution always falls back to the unversioned PDF location.
- This provider does not download or parse documents; acquisition and parsing stay with the shared acquisition and parser providers.

### Dev Note

Keep the Atom parser strict and the entry field list explicit. Search results must never reveal the internal PDF URL.
