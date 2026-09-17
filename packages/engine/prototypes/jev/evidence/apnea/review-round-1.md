---
status: done
verdict: CHANGES_REQUIRED
---

## Findings

### High — The planner contract cannot support the promised finalization-aware repair or fallback

`Planner.plan()` returns one terminal `PlanningDecision` (plan lines 54–60), while the engine-owned finalizer runs after every planner (lines 109–119). A planner therefore cannot receive finalizer diagnostics for an implementation-local repair attempt. More importantly, `createFallbackPlanner` sees a primary `planned` result and returns it before the outer engine discovers that it is invalid. The promised fallback eligibility for `invalid final plan` (lines 126–127) and Phase 3's repair opportunity (line 314) are impossible through this interface.

Redesign the invocation seam so engine finalization can feed a bounded repair attempt and fallback decision. The same path must also work for third-party planners, not only `createLlmPlanner` importing an internal validator.

### High — Mandatory strict finalization changes the default LLM product policy without a compatibility decision

The current engine deliberately heals invalid layout entries and actions, retries when recommended, then ships the final renderable subset when retries are exhausted (`packages/engine/src/lib/pipeline/retry.ts:29-32,71-77`). Phase 1 promises unchanged adapter behavior, but Phase 3 makes all planner paths reject every healed subset and changes existing adapter users from a successful degraded UI to deferral or failure (plan lines 119, 194, 217, and 329).

This change is not required to isolate Jev behind a strict planner contract. Decide whether adapter-based legacy configuration preserves heal-and-ship by default, whether strictness is opt-in, or whether this is an intentional breaking default with a release and migration policy. Documentation alone is not a compatibility policy.

### High — Operation-policy and fallback defaults are not implementable as written

`planningPolicy` is optional (line 136), but every invocation is supposed to receive an absolute deadline and shared call budget. No default `timeoutMs`, `maxProviderCalls`, disabled-timeout behavior, or derivation from the existing `maxRetries` default is specified. The unchanged adapter example supplies no policy, while the demo currently uses `maxRetries: 2`, requiring up to three LLM calls. Phase 1 also introduces `PlanningContext` before Phase 3 introduces the policy that creates it.

The fallback API is inconsistent too: its declared form requires `createFallbackPlanner(primary, fallback, policy)` (line 126), but the published example passes only two planners (lines 178–184). Define the exact defaults, validation rules, and precedence between retry, deadline, provider-call, and fallback policies.

### High — The demo switch ignores the existing BYOK handshake and engine lifecycle

The demo is not currently a simple environment-selected composition root. Local WebSocket dispatch considers the connection authenticated only when `OPENAI_API_KEY` exists, otherwise it requires `playground.hello` and builds an engine from the browser key (`apps/demo/src/server/ws-server.ts:89-98,123-145,190`). The hosted Durable Object likewise caches engines by the visitor key, and `EngineFactory.make(apiKey)` always constructs the OpenAI adapter (`apps/demo/src/worker/session/engine-factory.ts:37-63`).

A server-held Jev key therefore does not by itself let either transport process requests. The plan must decide whether Jev bypasses hello/rehello, what the key drawer shows, how hosted engine caching is keyed, and where an optional LLM fallback obtains its OpenAI key. Listing these files and adding `MAELSTROM_PLANNER` is insufficient.

### Medium — Structured-history retention leaves existing public hook semantics unresolved

Today `HistoryConfig.maxChars` measures the output of the public `deriveLLMContext` hook, and an omitted cap means infinity (`packages/engine/src/lib/history/history-manager.ts:44-73,154-163,190-220`). The plan instead makes a deterministic structured layout/action serialization consume the budget (line 105). That changes retention for existing prose turns and can conflict with a custom projection that intentionally emits different or empty context.

Specify whether `deriveLLMContext` remains supported, whether structural cost is added independently of that hook, and whether `maxChars` is redefined or a separate planning-history budget is introduced. Add compatibility tests for custom projections, text-free turns, oversized structural summaries, dedup replay, and omitted caps.

### Medium — Text-free migration and reverse-consumer verification are incomplete

The runtime analysis is mostly correct: the client already dispatches layout before actions, the demo response component already hides absent text, and realtime already carries a structural summary with LiveKit preferring `userMessage ?? summary`. However, making `MaelstromResponse.userMessage`, `rationale`, and history `assistantMessage` optional is a source-level break for consumers that read them as strings, not only a decoder coordination concern.

Document that TypeScript migration explicitly. Include the private reverse consumer `@maelstrom-co/www` in typecheck/build coverage, and update `packages/protocol/README.md`, which currently documents both response fields as required. Tests should cover absent fields through both HTTP and WebSocket history/response decoders, React state, the demo, and both voice adapters.

### Medium — Verification names are correct, but the verification gate omits required setup and one audit does not gate failure

The listed existing Nx project names match their manifests; `@maelstrom-co/engine-jev` will be valid once its proposed manifest defines that name. The commands still need these corrections:

- State the fresh-clone prerequisite `bun install`; Nx cannot load the workspace plugins without installed dependencies.
- State the Vale 3.18.0 prerequisite for `bun run docs:lint` (`CONTRIBUTING.md:150-169,191-200`).
- Do not treat `bun run audit:strip-internal` alone as a pass/fail gate. It deliberately exits zero for `drift-rejected`; verification must parse its JSON and reject that status (`CONTRIBUTING.md:221-225`).
- Phase 6 must add the `evaluate-offline` Nx target to the new package configuration before invoking it, rather than leaving the target definition implicit.
