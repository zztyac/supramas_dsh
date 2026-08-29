---
description: "The SupraMAS material-science run lifecycle and closed Stage 0/1 role authority contracts."
kind: "package-reference"
---

# @deepseek-ai/dsh-supramas

English | [中文](README.zh.md)

## Summary

This capability registers `ctx.supramas`, a deterministic run registry for material-science jobs. Each run has a stable `supramas:<jobId>` identity, a compare-and-set revision, a constrained phase graph, owned artifact paths, and structured failure details. The package also defines the four Stage 0/1 roles and their exact tool allowlists.

## Use this package

Mount the service before any SupraMAS tool consumer. Create a run with canonical `runs/<jobId>` paths, retain the returned revision, and use that revision for every transition. A stale writer, invalid transition, duplicate job, or malformed failure record raises a stable `SupraMasError` code.

## Understand the implementation

`src/types.ts` defines the public lifecycle values, `src/roles.ts` owns role authority, and `src/index.ts` validates requests and transitions. Returned snapshots are detached copies. M1 intentionally uses a process-local map; M3 replaces storage behind the same capability seam.

## Model Experience

### Role authority metadata

#### What the model sees

Nothing directly. Consumers use `ROLE_SPECS` as allowlists when constructing the tool catalog for a coordinator or child agent.

#### Token effect

None from this package itself; the selected consumer tools determine schema tokens.

#### KV Cache effect

No direct effect. A consumer changing a role's visible tool list changes that agent's request prefix and may invalidate reuse.

## Known Limitations and Deferred Work

- State does not survive process restart in M1.
- Role schemas are identities only; structured result validators arrive with the Stage 1 domain package.
- Literature retrieval and evidence persistence are outside this package.

### Dev Note

Do not broaden the transition graph or role tool lists without updating contract tests. Terminal states are intentionally immutable, and recoverable failures are the only failed state allowed to resume.
