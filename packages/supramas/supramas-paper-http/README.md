---
description: "SSRF-resistant, address-pinned, bounded public HTTP acquisition for resolved scholarly PDFs."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-paper-http

English | [中文](README.zh.md)

## Summary

This provider downloads a resolved scholarly PDF through DSH public-network policy. It validates HTTP(S) URLs, blocks credentials and private destinations, pins the validated DNS answer set, follows only bounded same-origin redirects, and returns complete bytes or an error.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Mount it after `@deepseek-ai/dsh-supramas-literature`.

```yaml
- name: '@deepseek-ai/dsh-supramas-paper-http'
  config:
    timeoutMs: 30000
    maxRedirects: 5
```

The literature service supplies the byte limit and performs final PDF MIME, magic, and digest checks. This provider never accepts an output path.

## Model Experience

### Verified PDF acquisition

#### What the model sees

Indirectly through `supramas_paper_import`, the model sees a success or stable error plus safe digest and count metadata. It never sees PDF bytes, the resolved URL, a pinned address, or a local path.

#### Token effect

This provider adds no prompt or schema and contributes only a small bounded acquisition outcome to the import result.

#### KV Cache effect

The provider changes no static prefix; the eventual import result is append-only.

## Known Limitations and Deferred Work

- Cross-origin redirects are rejected and require a newly resolved candidate location.
- Authentication, cookies, browser state, and paywalled retrieval are intentionally unsupported.
- A source that omits or lies about `Content-Length` is still bounded while streaming.

### Dev Note

Never replace address pinning with validation followed by an independently resolving client; that would reopen DNS rebinding.
