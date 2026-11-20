---
editUrl: false
next: false
prev: false
title: "MINT_FAILURE_REASONS"
---

> `const` **MINT\_FAILURE\_REASONS**: readonly \[`"invalid-request"`, `"unsupported-provider"`, `"missing-api-key"`, `"invalid-config"`, `"upstream-failure"`\]

Defined in: packages/realtime-protocol/src/lib/mint.ts:30

Why a token-mint attempt failed. Provider-agnostic so every server-side
minter reports the same vocabulary; callers map each reason to their own
transport status — see [mintFailureHttpStatus](/reference/realtime-protocol/packages/realtime-protocol/src/functions/mintfailurehttpstatus/).

- `invalid-request` — the request body failed the minter's input schema.
- `unsupported-provider` — the request targeted a provider this minter
  does not handle.
- `missing-api-key` — the minter was constructed without provider
  credentials.
- `invalid-config` — a server-side configuration value (e.g. an env var)
  was present but invalid, so the minter refused to guess. Distinct from
  `missing-api-key`: the credential is there, another setting is wrong.
  An operator fault either way, never the caller's.
- `upstream-failure` — the provider was unreachable, rejected the request,
  or returned a response the minter could not validate.

This array is the single source of truth: [MintFailureReason](/reference/realtime-protocol/packages/realtime-protocol/src/type-aliases/mintfailurereason/) is
derived from it, so a new reason is one edit and every exhaustiveness check
that reads this array — including the one in the tests, which runs in CI
where `tsc` on spec files does not — sees it immediately.
