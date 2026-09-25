---
description: "SSRF-resistant, address-pinned, bounded public HTTP acquisition for resolved scholarly PDFs."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas-paper-http

English | [中文](README.zh.md)

## Summary

This provider downloads a resolved scholarly PDF through DSH public-network policy. It validates HTTP(S) URLs, blocks credentials and private destinations, pins the validated DNS answer set, and follows bounded redirects. Every redirect hop is independently URL-validated, DNS-checked, and address-pinned before a request is sent.

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
    retries: 2
    retryDelayMs: 500
    maxRetryDelayMs: 10000
```

Transient HTTP statuses (403, 408, 429, 5xx) are retried on the same URL with bounded backoff; a `Retry-After` header is honored and capped at `maxRetryDelayMs`. The default User-Agent is a desktop-browser string; override `userAgent` to identify a different client. The literature service supplies the byte limit and performs final PDF MIME, magic, and digest checks. This provider never accepts an output path.

## Model Experience

### Verified PDF acquisition

#### What the model sees

Indirectly through `supramas_paper_import`, the model sees a success or stable error plus safe digest and count metadata. It never sees PDF bytes, the resolved URL, a pinned address, or a local path.

#### Token effect

This provider adds no prompt or schema and contributes only a small bounded acquisition outcome to the import result.

#### KV Cache effect

The provider changes no static prefix; the eventual import result is append-only.

## Known Limitations and Deferred Work

- Public cross-origin redirects are supported; private, credentialed, malformed, or over-budget redirect targets are rejected.
- Authentication, cookies, browser state, and paywalled retrieval are intentionally unsupported.
- A source that omits or lies about `Content-Length` is still bounded while streaming.
- Same-URL retries cover transient HTTP statuses only; transport-level failures (DNS, TLS, timeout) still fail the attempt without retry.

### Dev Note

Never replace address pinning with validation followed by an independently resolving client; that would reopen DNS rebinding.
