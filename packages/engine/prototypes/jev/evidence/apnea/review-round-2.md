---
status: done
verdict: CHANGES_REQUIRED
---

## Findings

### High — Retry ownership is still contradictory

The operation loop and route configuration make `route.maxRepairAttempts` the explicit planner arm's repair limit, while adapter shorthand maps its legacy `maxRetries` to that limit (plan lines 191–195, 229–237, and 413). That is implementable if `createLlmPlanner.invoke()` performs exactly one `chat()` call and owns no retry loop.

However, line 197 says existing “retry” options remain valid inside `createLlmPlanner`. The only existing retry option is `maxRetries`. Allowing it there creates two nested retry owners, breaks the route limit, and makes call-budget sizing ambiguous. State explicitly that:

- adapter-arm `maxRetries` is compatibility sugar translated to route repair attempts;
- explicit `route.maxRepairAttempts` is the sole repair/retry count;
- `createLlmPlanner` accepts prompt/adapter/model options but not `maxRetries`, and performs one claimed adapter call per invocation.

### Medium — Provider-call accounting needs one precise unit and an outward exhaustion mapping

The plan now defines when `claim()` occurs and correctly counts each Jev stage (lines 89–115). It does not say whether one call means a planner-visible adapter/fetch invocation or every underlying HTTP attempt. A generic `AnyTextAdapter` may hide transport retries that the engine cannot claim individually. Define the unit explicitly and state whether built-in adapters must disable hidden retries. Claims should not be refunded after a started attempt fails.

The plan also lists `budget_exhausted` as a distinct `PlannerFailure` and promises observable distinction, but line 242 names outward `EngineError`/wire mappings only for deferral, provider, cancellation, and timeout. Add the budget-exhaustion error tag/code, or identify an existing distinct mapping. This affects the public closed error contract and fallback behavior, so it should not be deferred to implementation details.

## Verified round-1 resolutions

The revised plan otherwise resolves the seven prior findings:

- Engine finalization can now feed bounded reports into repair and can trigger engine-owned fallback for third-party planners.
- Adapter shorthand preserves current heal-and-ship behavior; strict finalization is explicit.
- Timeout, route repair, fallback, and adapter compatibility defaults are specified.
- Trusted local Jev and hosted BYOK lifecycles are separated coherently.
- Structured history has an independent budget while existing `deriveLLMContext` and `maxChars` semantics remain intact.
- Optional text migration covers protocol schemas, HTTP/WebSocket consumers, `www`, demo rendering, history, and both voice paths.
- Existing Nx project names are correct, installation and Vale prerequisites are stated, and the offline target must be created before use.

The audit commands also match the repository scripts. `--declarations`, `--packed-consumer`, and `--typedoc` are valid audit flags. `audit:strip-internal` accepts `--report=tmp/strip-internal.json`, and its JSON shape is `{ results: [{ result: { status } }] }`, so the follow-up `v.result.status === "drift-rejected"` check uses the correct path.
