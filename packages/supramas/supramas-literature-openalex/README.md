---
description: "Keyless OpenAlex works provider for bounded SupraMAS scholarly discovery and candidate resolution."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-literature-openalex

English | [中文](README.zh.md)

## Summary

This package maps the current OpenAlex Works API into the SupraMAS literature seam. Search exposes bounded bibliographic metadata; candidate resolution may add the best open-access PDF URL for internal acquisition.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after `ctx.web` and `ctx.supramasLiterature`.

```yaml
- name: '@deepseek-ai/dsh-supramas-literature-openalex'
```

The provider uses `search`, current `per_page` paging, and a fixed `select` list. It reconstructs abstracts from the inverted index and preserves sparse records without inventing missing values.

## Model Experience

### OpenAlex candidate projection

#### What the model sees

Indirectly through `supramas_literature_search`, the model sees selected bibliographic fields and an opaque `openalex:<work-id>` candidate ID. The provider's resolved PDF URL is never projected into a search result.

#### Token effect

The provider contributes no prompt or schema. Search result count and reconstructed abstract length are bounded by the literature tool.

#### KV Cache effect

There is no static-prefix effect; each bounded search response is an append-only tool result.

## Known Limitations and Deferred Work

- OpenAlex rate limits and upstream availability apply.
- Only the best reported open-access PDF location is used during resolution.
- This provider does not download or parse documents.

### Dev Note

Keep the OpenAlex response parser strict and the selected field list explicit. Search results must never reveal the internal PDF URL.
