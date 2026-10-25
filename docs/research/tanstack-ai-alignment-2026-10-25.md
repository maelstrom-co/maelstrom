# Where Maelstrom should reuse TanStack AI

Research date: 2026-10-25. This explanation is for maintainers deciding which
runtime responsibilities to delegate, without changing the current streaming
work. The production baseline is Maelstrom commit
`7ad0d55ef07fb75b664aa696fdc3df8afcea1a9d`, not the streaming feature branch.
Source references below pin that baseline or the TanStack 1.0.0 release.
[Baseline][m-lock] · [Streaming context][p-stream]

## Executive decision

Use TanStack's `chat()` and `toolDefinition().server()` for the future model/tool
cycle. Keep Maelstrom's Engine validation, Chart application, authorization,
request admission, acknowledgement, and recovery policy outside that cycle.
TanStack already supplies the provider loop and tool lifecycle; it does not
establish that a browser applied a Maelstrom Execution Plan.
[Loop][d-cycle] · [Tool execution][t-tools] · [Application order][m-arch]

Do not replace the wire protocol or adopt a second conversation store as part of
this reuse. Evaluate client and AG-UI adoption separately through the existing
prototype. Start with offline evidence and policy design. Integrate the loop
only after the streaming boundary and required wire expansion are stable.
[Prototype][p-agui] · [Streaming boundary][p-stream] · [Wire contract][m-wire]

The dependency upgrade, cache telemetry, and tiling retention changes are already
merged. They are prerequisites, not new work. The streaming and pet-shop changes
remain separate workstreams. This report proposes no changes to their files.
[Upgrade][p-upgrade] · [Cache telemetry][p-cache] · [Retention][p-retain] ·
[Streaming][p-stream] · [Pet-shop Vessels][p-shop] · [Pet-shop page][p-shop-page]

## Version and evidence boundary

The lockfile selects `@tanstack/ai`, `@tanstack/ai-openai`, and
`@tanstack/ai-gemini` at 1.0.0. It also selects `@tanstack/openai-base@1.0.0`.
Initial package inspection used the source checkout read-only. Final verification
used a clone-only `bun install --frozen-lockfile`; the lockfile did not change.
No packages were upgraded. The three npm package integrities match their lockfile
entries.
[Lockfile][m-lock] · [Core npm metadata][n-core] ·
[OpenAI npm metadata][n-openai] · [Gemini npm metadata][n-gemini]

All three 1.0.0 release tags resolve to commit
`5651e07e3181745984155ad88b65b86b8528844e`. Six installed source files were
compared byte-for-byte with that commit: core chat, tool calls, middleware types,
core types, OpenAI text, and Gemini text. All matched. TanStack `main`, observed
at `98055ca01af9e449d039f61e380b0d3c158acbb1`, is one commit ahead and changes
maintainer scripts only. No newer runtime feature is needed for the core reuse
recommended here. These comparisons are research observations, not runtime tests.
[Core tag][tag-core] · [OpenAI tag][tag-openai] · [Gemini tag][tag-gemini] ·
[Release-to-main comparison][t-compare]

Official documentation was retrieved through Context7 (`/tanstack/ai`) in three
queries covering the loop, structured output, and continuation. Source inspection
resolved two conflicting retrieved claims:

- `threadId` is required in 1.0.0. The older AG-UI migration page still describes
  automatic IDs and a deprecated `conversationId` alias. Do not copy that advice.
  [1.0 migration][d-v1] · [Entry-point check][t-chat] · [Stale page][d-stale-id]
- `chat({ outputSchema, stream: true })` has a streaming path in 1.0.0. The
  Vercel migration page says the stream flag is ignored. The release source,
  rather than that paragraph, defines the installed behavior.
  [Entry-point branches][t-chat] · [Stale paragraph][d-stale-schema]

Availability has three different meanings:

| Capability | Installed 1.0.0 status | Decision |
| --- | --- | --- |
| Server executors, sequential tool execution, middleware, streamed structured output | Present in core. [Types][t-types] · [Tools][t-tools] | Reuse behind a Maelstrom-owned policy boundary. |
| Bound tool approvals and client-tool waits | Present in core, but not represented by Maelstrom's current agent inputs. [Interrupts][d-interrupt] · [Wire][m-wire] | Defer public integration. |
| `withPersistence`, `ChatClient`, framework chat hooks | Separate packages; absent from this lockfile. [Persistence][d-persist] · [Lockfile][m-lock] | Treat adoption as an explicit dependency and ownership decision. |
| Automatic thread IDs, `addToolApprovalResponse`, old approval custom events | Removed in 1.0.0. [Release notes][t-release] | Do not design against 0.x examples. |
| A built-in cumulative `maxToolCalls` policy | Not supplied by core; the official recipe uses application middleware. [Budget recipe][d-cycle] | Keep limits as Maelstrom policy. |

## What main already delegates

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `planner-llm` | One structured `chat()` call per attempt; history and origin session ID supplied explicitly; caller abort forwarded. JSON Schema goes to TanStack, then the original schema parses locally. [Call boundary][m-call] | Keep the current planner narrow. An agent loop belongs above or beside it, not inside every planning attempt. |
| `planner-jev` completion | Uses the same structured-output and cancellation pattern, with recent history and its own usage middleware. [Completion][m-jev] | Share evidence and policy, not necessarily a new cross-package abstraction. |
| `planner-jev` typed decisions | Custom transports sit behind `createProviderCall`, which owns timeouts, option limits, validation, deferral, and instrumentation. TanStack wire types do not replace that flow. [Provider call][m-provider] · [Replacement contract][m-arch] | Audit adapter parity before proposing a transport replacement. |
| Evaluation usage | `withUsage` wraps each adapter method, retains its `this`, and leaves absent methods absent. Role-labelled reports use this sink instead of planner events. [Wrapper][m-eval] | Preserve provider-call accounting and avoid duplicate totals. |
| Planner usage | Middleware observes terminal chunks, resets the per-call latch in `onConfig`, and sums reported fields. Missing values stay absent. [Planner][m-planner] · [Completion][m-jev] | Extend the existing contract for multi-turn runs; do not replace it with `onFinish.usage`. |
| Telemetry | The normalizer preserves explicit zeros, rejects invalid counters, and does not add cache tokens to input totals. Applications own bounded sink delivery. [Normalizer][m-usage] · [Telemetry boundary][m-arch] | TanStack hooks can supply evidence, but do not replace the operational allowlist or sink ownership. |
| Engine request/reply | The Engine validates input, loads history, invokes and validates the planner, requires a reply, and returns a complete response. History-enabled duplicate request handling is process-local. [Engine][m-engine] | Preserve `Result` errors, validation, history ownership, and request identity. TanStack run completion is not Engine success. |

The current history projection contains only `role` and `content`, not a complete
tool transcript. Reusing it unchanged for pending tools would lose required
continuation evidence. Keep ordinary planner history separate from any future
agent transcript until the ownership and projection rules are explicit.
[History shape][m-history] · [Client-tool continuation][d-client-tools]

## Responsibility split

### Delegate mechanics, retain policy

TanStack should own model invocation, provider message conversion, tool-call
assembly, executor dispatch, result replay to the model, and lifecycle hook
delivery. Shared `toolDefinition` schemas can type both server and client tools.
Standard Schema output validation is available for executed tool results. A plain
JSON Schema tool output does not take that Standard Schema validation branch.
[Definitions][t-definition] · [Execution and output check][t-tools]

Maelstrom must still choose the allowed tools from trusted application policy.
The model's tool selection is not authorization. Keep identity, current Variant,
Action parameters, layout healing, and application plan requirements under the
existing Engine contract. Keep layout-before-Actions application atomic. A model
tool must not become an independent workspace writer that bypasses that path.
[Engine validation][m-engine] · [Application invariants][m-arch]

Keep grid measurements tied to the Chart container. A whole-cell resize starts a
new request; do not add inline layout reconciliation to the tool cycle. Keep the
client framework-independent, React hooks in their binding package, and provider
secrets outside browser packages. Preserve the provider-independent Engine seam;
the runtime task must choose the server integration boundary for TanStack.
[Package and application boundaries][m-arch]

The existing runtime-loop work item should own the eventual `chat()` integration.
The recommendations below refine its acceptance criteria; they do not propose a
second runtime implementation. The public streaming change explicitly excludes
the model/tool loop, so it is not evidence that this integration already exists.
[Streaming scope][p-stream] · [Current Engine][m-engine]

### Budget and cancellation policy

The release source supports the previously supplied characterization findings:

- Server tools run in parallel by default. Sequential mode preserves execution
  order; parallel mode also returns results in call order, not completion order.
  [Batch execution][t-tools]
- `maxIterations(0)` is not an admission guard. The loop enters with `do`, and
  continuation is checked later. The tool half-cycle runs after model output,
  before the next-model decision. Stopping continuation therefore does not cancel
  tools already emitted by that turn. [Loop entry and continuation][t-chat] ·
  [Strategy][t-strategy]
- `onUsage` receives reported model-call usage. The terminal hook rebuilds
  `onFinish.usage` from the stored final event, not a cumulative ledger. This
  supports the supplied two-turn observation; it is not a run-total contract.
  [Usage dispatch and terminal hook][t-chat] · [Hook contract][t-hooks]
- A tool receives the abort signal, and an unstarted server tool checks it before
  execution. An already running executor must cooperate. A tool without an
  executor enters client execution instead of completing server-side.
  [Tool dispatch][t-tools] · [Cancellation checks][t-chat]

The original characterization artifact was not available in this research clone.
Its tests were not rerun. No new ticket should recreate that baseline. The
remaining evidence concerns Maelstrom policy, provider behavior, and composed
middleware, not whether the basic loop exists.

Recommended policy for the existing runtime-loop task:

| Limit | Enforcement point | Proof needed |
| --- | --- | --- |
| Zero budget or cancelled input | Host admission, before `chat()` | No initial model call or tool dispatch. [Loop entry][t-chat] |
| Model turns | Explicit `agentLoopStrategy`, with a host-owned count across continuations | The last allowed turn cannot authorize another model call. [Strategy][t-strategy] |
| Tool calls | Reserve capacity before dispatch; count attempted and executed calls separately | A single large batch cannot exceed the execution cap. Cover cached, skipped, resumed, and denied calls. `toolCallCount` counts emitted calls. [Counters][t-chat] · [Recipe][d-cycle] |
| Tokens | Aggregate reported usage per provider call; constrain the next call with provider-specific output limits | A missing counter stays unknown. A post-call limit is not a hard prepaid token ceiling. [Usage][t-chat] · [Provider options][t-openai-options] · [Gemini options][t-gemini-options] |
| Elapsed time | Host deadline plus a controller reaching provider and tools | Cooperative tools stop; a non-cooperative tool cannot commit a late result after run retirement. Do not claim JavaScript work is forcibly stopped. [Abort contract][t-types] · [Dispatch][t-tools] |
| Retries | One documented owner for transport retries and planner correction | Count SDK and core retries against the run budget. Core retries are separate from SDK retries and exclude structured finalization. [Retry options][t-types] · [Engine retry][m-engine] |

Use parallel execution only for independent reads or explicitly concurrency-safe
operations. Use sequential execution for ordered mutations. Provider
`parallel_tool_calls: false` changes model behavior; it is not a substitute for
the executor's `toolExecution` setting. Do not automatically retry a write whose
application outcome is unknown.
[Executor setting][t-types] · [OpenAI setting][t-openai-options] ·
[Existing recovery experiment][p-agui]

### A newly verified middleware-order limitation

The 1.0.0 hook comments say an earlier before-hook decision does not skip a guard.
The execution source is narrower: `transformArgs` continues through input checking
and the guard, while `skip` returns a result and bypasses both. The tool cache
returns `skip` on a hit. Its default key contains tool name and arguments, not
thread, principal, or workspace revision. This is a composition risk for protected
data, not proof of an exploit in current Maelstrom, which does not use this cache.
[Hook comments][t-hooks] · [Decision application][t-tools] · [Cache][t-cache]

A focused read-only probe of the installed public APIs verified this ordering.
It used `chat`, `toolDefinition`, and `fakeText`; `fetch` threw if called. It made
three cases and seven assertions, with zero network calls. It did not rerun the
earlier tool-loop characterization. The guard returned a denial in every case
where it ran. No executor ran.

| Before-hook decision | Guard calls | Tool result |
| --- | --- | --- |
| No decision | 1 | Denied |
| `transformArgs` | 1 | Denied |
| `skip` with a cached result | 0 | Cached result |

The following is the probe logic, using public imports in a workspace where the
locked dependencies already resolve. It is independent of a provider or API key.
[Public test adapter][t-fake] · [Observed implementation][t-tools]

```ts
import assert from 'node:assert/strict';
import { chat, maxIterations, toolDefinition } from '@tanstack/ai';
import { fakeText } from '@tanstack/ai/testing';

let network = 0;
globalThis.fetch = async () => {
  network++;
  throw new Error('network forbidden');
};

for (const mode of ['pass', 'transform', 'skip']) {
  let guards = 0;
  let executions = 0;
  const adapter = fakeText();
  adapter.setResponses([{ toolCalls: [{ name: 'private_read', input: {} }] }]);
  const tool = toolDefinition({
    name: 'private_read',
    description: 'Offline guard ordering probe',
  }).server(() => {
    executions++;
    return { private: true };
  });

  for await (const _chunk of chat({
    adapter,
    threadId: 'offline-guard',
    messages: [{ role: 'user', content: 'offline' }],
    tools: [tool],
    agentLoopStrategy: maxIterations(1),
    debug: false,
    middleware: [{
      onBeforeToolCall: () => mode === 'skip'
        ? { type: 'skip', result: { cached: true } }
        : mode === 'transform'
          ? { type: 'transformArgs', args: {} }
          : undefined,
      onGuardToolCall: () => {
        guards++;
        return { type: 'skip', result: { denied: true } };
      },
    }],
  })) {}

  assert.equal(guards, mode === 'skip' ? 0 : 1);
  assert.equal(executions, 0);
}
assert.equal(network, 0);
```

Do not enable shared tool-result caching by default. Require authorization before
cache disclosure, explicit read-only tool selection, a scoped cache instance or
key, and bounded freshness. Treat `skip` and `replaceResult` values as separate
validation boundaries. The normal executor output check cannot establish the
validity of a result that bypassed execution.
[Cache implementation][t-cache] · [Skip and output validation][t-tools] ·
[After-hook replacement][t-compose]

Input repair also needs an explicit decision. Core repairs common model mistakes
by default, then checks the result. For sensitive mutations, consider
`repairToolInput: false` so coercion cannot silently change the requested action.
Authorization must inspect the final accepted arguments, including approved edits.
[Repair option][t-types] · [Final input check][t-tools]

## Usage, structured output, and provider limits

Keep the post-drain local validation introduced by the upgrade. On a separate
structured stream, the core can reject `structured-output.complete` before it
reads the following usage event. Maelstrom sends equivalent JSON Schema, drains
the stream, then runs the original Zod schema. Existing offline coverage compares
combined, streamed-finalization, and direct-finalization paths, including
refinements, transforms, defaults, and optional fields.
[Core ordering][t-chat] · [Planner boundary][m-call] · [Existing regression][m-schema-test]

This boundary means TanStack can finish internally before Maelstrom rejects the
application result. A generic TanStack success span must not replace the outer
Engine outcome. Do not remove this distinction to shorten middleware code.
[Local parse][m-call] · [Completion outcome][m-jev] · [Engine validation][m-engine]

For a future loop, maintain a provider-call ledger that includes tool turns,
structured finalization, failures with reported usage, retries, and continuation
runs. `onUsage` is useful for per-call totals but rebuilds absent AG-UI numeric
fields as zeros. Current Maelstrom chunk collection deliberately preserves
presence before this normalization. Never add `onFinish.usage` to totals already
collected per turn. Retain the evaluation wrapper's independent role accounting.
[Usage rebuilding][t-usage] · [Planner collection][m-planner] ·
[Evaluation wrapper][m-eval]

TanStack's optional OTel middleware already creates chat, iteration, and tool
spans and accumulates root usage. It defaults content capture off, but records
exceptions and uses a different observation contract. Evaluate it only at an
application-owned integration point. Prove redaction, local-validation outcome,
and single-counted usage before adopting it. It does not replace Maelstrom's
bounded operational telemetry.
[OTel source][t-otel] · [Operational contract][m-arch]

| Adapter surface at 1.0.0 | Verified source capability | Constraint on reuse |
| --- | --- | --- |
| OpenAI Responses text | Native tools plus JSON Schema unless JSON-object mode is selected; structured streaming; provider option validation; request cancellation. [Text adapter][t-openai] · [Base adapter][t-base] | Let the adapter construct provider requests. Do not assume a compatible endpoint has every OpenAI capability. |
| OpenAI cache options | Core defaults to short retention with `threadId` as key. OpenAI maps this to supported host/model fields; explicit provider options take precedence. [Core resolution][t-chat] · [OpenAI mapping][t-openai-cache] | Audit request fields before exposing another cache option. Do not promise a cache hit or savings. |
| Gemini text | Structured streaming; combined tools/schema only for the adapter's declared model set; caller signal reaches the SDK. [Gemini adapter][t-gemini] | Gemini 2.x and the declared combined-capable models can take different provider-call paths. Count finalization separately. |
| Gemini cache | `cachedContent` is a provider option; the common automatic prompt-cache option is not mapped by this text adapter. [Options][t-gemini-options] · [Request mapping][t-gemini] | A common option does not imply uniform provider behavior. Do not create cache resources in this research workstream. |
| Cache usage | Both installed adapters omit zero cache-read counters before Maelstrom sees them. [OpenAI usage][t-base-usage] · [Gemini usage][t-gemini-usage] | Missing reporting is not a measured miss. Keep `n/a` distinct from reported zero; telemetry already does this. [Merged telemetry][p-cache] |
| OpenAI Decisions | `createOpenaiDecider` calls the Decisions API, forwards abort, and throws `EvaluateError` with usage and other answers on refusal. It converts answer arrays to records and score levels to labels. [Evaluate adapter][t-evaluate] | Useful adapter, not a proven replacement for Maelstrom's stricter transport contract. |

The installed Decisions adapter is not a drop-in replacement. It collapses
duplicate answer and probability names through `Object.fromEntries` before an
outer validator can inspect them. It also sends score criteria as labels, where
Maelstrom sends numeric labels plus separate descriptions. These are source-level
blockers, not questions for a paid benchmark. Retaining the current transport is
the safe decision unless another raw-response seam or upstream change closes them.
[Adapter conversion][t-evaluate] · [Required semantics][m-arch]

A future typed-decision bridge audit must cover
refused question identity, model echo, duplicate names before record conversion,
score label/description semantics, probability checks, raw replies, bounded body
reads, safe HTTP errors, timeout mapping, and disabled SDK retries. Call
`adapter.evaluate()` behind the existing transport seam if it can meet that
contract. Do not replace it with `decide()` and weaken validation. Any live parity
evaluation needs separate cost approval; this report makes no live-performance
claim.
[Replacement requirements][m-arch] · [Provider flow][m-provider] ·
[Adapter conversion][t-evaluate]

## Identity, caching, and stored waits

Keep the existing session-to-`threadId` mapping stable across planner retries.
Assign distinct run and tool-call identities for invocation and continuation;
do not use a shared provider thread to deduplicate Maelstrom requests. The
current Engine owns request deduplication and supplies history explicitly.
[Planner identity][m-planner] · [Engine identity][m-engine] · [1.0 contract][d-v1]

Separate four kinds of state: conversation history, provider prompt caching,
tool-result caching, and pending execution. They have different owners and keys.
A stable thread ID alone does not persist a transcript or prove a pending tool
is authorized. Prompt-prefix stability can be inspected offline, but provider
cache effectiveness needs approved measurements. Use the existing cache report
rather than adding another telemetry collector or redoing the retention prompt.
[Cache resolution][t-chat] · [Tool cache][t-cache] · [Persistence][d-persist] ·
[Existing measurement path][m-eval-readme] · [Retention change][p-retain]

TanStack supports client tools and bound approval interrupts. A client wait ends
the invocation; continuation uses a new run and the pending call's binding.
Ephemeral continuation can reconstruct from supplied messages. Durable
server-authoritative waits require a persistence integration and its stores;
core types alone do not provide storage or crash recovery.
[Client tools][d-client-tools] · [Interrupt lifecycle][d-interrupt] ·
[Persistence stores][d-persist]

Maelstrom's `ui_applied` is an application acknowledgement, not a general tool
result or approval answer. Maelstrom's `CallId` is distinct from a provider's
`ToolCallId`; keep their mapping explicit. A future stored wait must bind session,
run, application call, provider call, arguments/schema, and Chart revision. It must
reject duplicate, stale, cross-session, denied, and expired answers. Choose
explicit rules for disconnect, restart, supersession, and unknown write outcomes
before choosing a store. This is proposed policy, not a current implementation.
[Current input schema][m-wire] · [Acknowledgement experiment][p-stream] ·
[TanStack continuation model][d-interrupt]

## Streaming and AG-UI are separate decisions

Main has agent inputs `utterance` and `ui_applied`. Its event union contains
`placeholder`, `accepted`, `message`, `ui_change`, `finished`, and `error`.
It has no agent-event discriminators named `started`, `tool_call`, or
`tool_result`. Similarly named side-channel tool events do not extend this union.
Adding new union members or enum values requires a wire version bump; an optional
field alone does not.
[Agent wire][m-wire] · [Separate side channel][m-sidechannel]

The inspected streaming feature at `9ef57f54c4c888f63e489848944b124ecc114148`
changes the agent wire to v2 because UI-only requests now own runs and finish
after acknowledgement. It serializes planning through application confirmation,
bounds pending work, and cancels on close. It deliberately leaves the model/tool
loop and client migration out. Treat those semantics as branch context, not
merged behavior or work to redo independently.
[Feature source][m-stream-source] · [Feature wire change][m-stream-wire] ·
[Public scope][p-stream]

An internal TanStack stream can be projected into Maelstrom events without
adopting a TanStack browser client. An AG-UI client could instead reuse message
assembly, tool parts, approval UI, and continuation handling, at the cost of
another wire/state integration. Neither choice removes Chart revision checks,
atomic application, or the acknowledgement barrier. Compare these options using
the existing prototype, not a new parallel demo or a direct event rename.
[Client model][d-client-tools] · [Prototype][p-agui] · [Application invariants][m-arch]

## Priority matrix

Benefits below are expected engineering benefits, not measured latency, cost,
or reliability improvements.

### Safe offline work now

| Leverage | State | Next step | Needs | Overlap | Proof | Benefit |
| --- | --- | --- | --- | --- | --- | --- |
| P0: middleware safety | A cache `skip` bypasses the guard in the installed release. [Probe above](#a-newly-verified-middleware-order-limitation) | Record an offline policy test for authorization before cached-result disclosure and result validation. | Existing locked core and fake adapter. | Low in an isolated eval fixture; do not enable caching in runtime files. | Pass, transform, skip, cache-hit, denied, and altered-result cases. | Avoid unsafe reuse of otherwise useful hooks. |
| P1: multi-call usage | Merged collectors preserve presence; finish usage is not a run total. [Collectors][m-planner] · [Core][t-chat] | Specify one call ledger and add only missing composed-path regressions. | Existing usage and cache suites. | Low in evaluation tests; no collector refactor by default. | Tool turn plus finalization, usage on failure, missing/zero, retry and concurrent isolation. | Protect accounting when the loop grows. |
| P1: adapter reuse | The installed Decisions adapter loses duplicate evidence and changes score encoding. [Adapter][t-evaluate] · [Contract][m-arch] | Produce a pass/fail parity table using mocked provider responses. | Existing transport contract fixtures. | Low if report/test-only; no transport replacement. | Every contract row, especially refusal IDs, duplicates, score levels, retry and body limits. | Establish what blocks safe transport reuse. |
| P2: cache policy evidence | Session keys and measurement already exist. [Resolution][t-chat] · [Measurement][m-eval-readme] | Inspect serialized request fields and prefix changes offline; document provider differences. | Existing adapters and fixtures; live approval only for later measurement. | Medium if it changes prompt order; keep this step read-only. | Stable identity, retry stability, option precedence, no cross-session tool-cache reuse. | Avoid redundant options and unsupported cache claims. |

### Blocked on stable streaming or wire expansion

| Leverage | State | Next step | Needs | Overlap | Proof | Benefit |
| --- | --- | --- | --- | --- | --- | --- |
| P1: model/tool loop | Core supplies mechanics; the streaming change excludes the loop. [Cycle][d-cycle] · [Scope][p-stream] | Refine the existing runtime-loop task, then integrate one bounded `chat()` driver. | Stable connection lifecycle; explicit tools and budgets. | High in Engine session files; wait for the streaming owner. | Zero-budget admission, batch caps, cancellation, exactly one Maelstrom terminal outcome, no late writes. | Avoid a second handwritten provider loop. |
| P2: client tools and stored waits | Core waits exist; Maelstrom lacks general result/approval inputs and tool event members. [Interrupts][d-interrupt] · [Wire][m-wire] | Design a versioned continuation mapping before implementation. | Stable streaming; wire expansion; one transcript/wait authority. | High in protocol, client, and host files; design only until coordinated. | Wrong-session and stale answers, denial, restart, replay, expiry, UI acknowledgement, unknown outcomes. | Reuse continuation mechanics without weakening application safety. |
| P3: client/AG-UI and OTel adoption | Separate prototype and optional tracing middleware already exist. [Prototype][p-agui] · [OTel][t-otel] | Review existing evidence against named requirements; adopt only a measured simplification. | Client/state ownership decision; telemetry privacy review. | High if it replaces active demo/wire work. | Equivalent application settlement; no content leak or duplicate usage; recovery boundaries stated. | Potentially remove client plumbing, only if the tradeoff is favorable. |

## Follow-up tickets and scoped acceptance checks

These are proposed scopes, not created issues. Keep the first two independent of
streaming and pet-shop files. Extend the existing runtime-loop task for the third
scope; do not create a duplicate implementation or baseline-characterization task.

1. **Pin composed middleware and usage contracts offline.** Add only the missing
   guard/cache and multi-call accounting cases in an isolated evaluation fixture.
   Reuse existing characterization and usage coverage. Acceptance: `fetch` is
   forbidden; locked versions are recorded; cached-result disclosure requires an
   authorization decision; substituted results have an explicit validator;
   per-call totals preserve missing values and never add final usage twice.
   Document any unsupported combination rather than patching TanStack locally.
   [Existing usage tests][m-schema-test] · [Wrapper][m-eval] · [Composition][t-compose]
2. **Audit typed-decision adapter parity and cache request mapping.** Deliver a
   source-pinned pass/fail table and mocked request/reply fixtures, with no
   production switch. Acceptance: classify every transport requirement as
   supported, blocked, or unproven. Include fixtures for duplicate evidence loss
   and score encoding differences. Identify the raw-response seam needed to
   preserve refusal identity and validation evidence. Make SDK retries and body
   bounds explicit. Separately record OpenAI and Gemini cache fields and their
   precedence. A failed parity row blocks replacement. Live evaluation remains a
   separately approved gate, not acceptance for this offline ticket.
   [Transport requirements][m-arch] · [Evaluate adapter][t-evaluate] ·
   [OpenAI cache][t-openai-cache] · [Gemini mapping][t-gemini]
3. **Refine the existing runtime-loop task with a TanStack policy contract.**
   Acceptance before integration: named tool ownership, pre-call admission,
   cumulative execution reservations, sequential mutation policy, cooperative
   cancellation, sanitized errors, and per-call usage are specified. Acceptance
   after stable streaming: dependent tools see actual results; retired runs
   cannot publish late work; UI completion follows the matching acknowledgement;
   each admitted run has exactly one Maelstrom terminal outcome. Do not add
   client approvals or recovery storage in this increment.
   [Core mechanics][d-cycle] · [Tool semantics][t-tools] · [Streaming scope][p-stream]
4. **Design versioned continuation and stored-wait ownership.** Block
   implementation until streaming is stable. Acceptance: a small decision record
   maps Maelstrom and TanStack identities, distinguishes UI acknowledgements from
   tool results, lists new wire discriminators and the required version change,
   and chooses ephemeral versus durable waits. Specify duplicate, stale,
   cross-session, denied, expired, restarted, and unknown-outcome cases. Reuse
   the existing AG-UI prototype as comparison evidence; do not expand its demo.
   [Wire rules][m-wire] · [Stored waits][d-persist] · [Prototype][p-agui]

## Open questions and remaining evidence gaps

- Which operations are independent reads, ordered mutations, or UI changes?
  That classification determines parallelism, replay, and approval policy.
  The executor setting alone cannot infer it. [Execution settings][t-types]
- Is the future agent transcript distinct from planner history? Who stores the
  pending call and validates a continuation after restart? Do not select
  persistence before answering this. [History projection][m-history] ·
  [Persistence model][d-persist]
- Does the policy require a hard spending ceiling or a stop-after-observed-usage
  limit? The latter can overshoot during the current provider call. Missing
  usage needs an explicit policy rather than a zero. [Usage hook][t-hooks] ·
  [Provider limits][t-openai-options]
- Will the application expose original tool errors to the model? Core turns
  executor exceptions into error results containing the exception message.
  Prove sanitization before allowing tools with sensitive downstream errors.
  [Error result construction][t-tools]
- Can a raw-response seam preserve the evidence the Decisions adapter discards?
  Duplicate and refusal evidence need fixture-level proof; source inspection
  already blocks a drop-in replacement. [Conversion][t-evaluate] ·
  [Replacement contract][m-arch]
- Does AG-UI/client adoption remove enough local state to justify a second
  protocol integration? The existing prototype reports bounded journeys, not a
  general recovery guarantee. Keep this decision separate from server-loop reuse.
  [Prototype scope and limits][p-agui]

## Verification and limitations

Research and verification used source reads, public documentation and metadata,
the focused offline middleware probe, and the checks listed below. No provider
model calls, deployments, issue updates, pushes, or runtime code edits were made.
The prior characterization was not rerun. This report does not claim benchmarks,
production recovery, or complete adapter parity.

Verification results:

- Passed: the full `bun run docs:lint` script, including `vale --no-global sync`,
  with the verified Vale 3.18.0 directory prepended to `PATH`. It synced the
  Microsoft package into this clone's ignored style directory, then checked all
  78 authored documentation inputs. Zero errors; one existing warning at
  `packages/protocol/README.md:281`. Targeted Vale found no report warnings.
- Passed: `markdownlint docs/research/tanstack-ai-alignment-2026-10-25.md` and
  the VCS whitespace check.
- Passed: all 60 source targets returned HTTP 200 through raw source or official
  metadata endpoints. Line ranges and the local section anchor were checked.
  The three release-page URLs also returned HTTP 200 directly.
- Passed: the embedded probe executed against installed public entrypoints.
  Three cases, seven assertions, no stdout or stderr, and zero network calls.
- Passed: terminal rendering with `glow -s notty -w 180`, including tables,
  code, and reference links. Browser styling was not tested.
- Limited: targeted Biome checked zero files because the configured version does
  not process Markdown. The Markdown structure check above supplies the file check.

The final uncached root gate passed in this research clone:

```sh
NX_NO_CLOUD=true NX_DAEMON=false bunx nx run-many \
  -t typecheck,test,check -p @maelstrom-co/source --skip-nx-cache
```

It exited 0: all 25 tasks succeeded, including root typecheck, test, check, and
prerequisite builds. Nx confirmed that the task cache was skipped. The root
typecheck runs both TypeScript configurations; the test target runs the scripts
and GitHub Actions suites; check runs `biome check . --error-on-warnings`.
Nx also flagged `@maelstrom-co/protocol:build` and
`@maelstrom-co/realtime-livekit-agent:build` as flaky. Both succeeded in this run;
their sources were not changed to suppress the warning.

Initial shared-dependency attempts failed during graph loading for
`@tailwindcss/vite` and scripts-suite loading for `alchemy`. Adding 28 matching
workspace dependency symlinks restored lookup. A read-only sandbox then blocked
Vite's attempt to write a temporary configuration through a dependency link.
These were verification-layout failures, not demonstrated source regressions.

Only the 29 clone dependency symlinks were unlinked. Then
`bun install --frozen-lockfile` installed 1,944 packages in this clone without
changing the lockfile. No packages were upgraded. The sandbox denied source
checkout writes during installation and the final root gate. All dependency
directories now belong to the clone. No unrelated source was changed.

The six inspected TanStack source files also matched the final clone-local
installation byte-for-byte. The embedded probe passed again from `planner-llm`
using that installation. Earlier failure logs remain preserved outside the
repository, including `tanstack-research-nx-readonly-symlinks.log`. The frozen
installation log is `tanstack-research-frozen-install.log`; the final gate output
is `tanstack-research-nx-final.log`.

This is a standalone research note under `docs/research`, not a docs-site page,
so sidebar registration and a site build are not applicable.
[Authored-doc lint scope][m-doc-lint] · [Project checks][m-checks]

## Source ledger

Only first-party public code, official docs, release metadata, and this report's
explicitly described probe support the findings. Context7 supplied discovery;
the release-pinned sources below resolve API claims. Unmerged Maelstrom sources
are labelled as context, not baseline.

- **Maelstrom baseline:** [lockfile][m-lock], [Engine][m-engine],
  [architecture and transport requirements][m-arch], [history][m-history],
  [agent wire][m-wire], and [side channel][m-sidechannel], pinned to `7ad0d55e`.
- **Planner and measurement sites:** [LLM boundary][m-call],
  [planner middleware][m-planner], [Jev completion][m-jev],
  [typed provider flow][m-provider], [evaluation wrapper][m-eval],
  [usage normalizer][m-usage], [structured-output regression][m-schema-test],
  and [existing cache measurement instructions][m-eval-readme], at the same pin.
- **Merged work:** [upgrade][p-upgrade], [cache telemetry][p-cache], and
  [retention][p-retain]. Public pull request state was checked on the research date.
- **Concurrent work, context only:** [streaming][p-stream] with
  [connection source][m-stream-source] and [wire source][m-stream-wire] pinned to
  `9ef57f54`; [AG-UI prototype][p-agui]; [pet-shop Vessels][p-shop];
  [pet-shop page][p-shop-page]. No implementation work is proposed in those diffs.
- **TanStack release provenance:** [core tag][tag-core],
  [OpenAI tag][tag-openai], [Gemini tag][tag-gemini], [release notes][t-release],
  [core npm metadata][n-core], [OpenAI npm metadata][n-openai], and
  [Gemini npm metadata][n-gemini]. Tag source pin: `5651e07e`.
- **TanStack implementation:** [chat][t-chat], [strategies][t-strategy],
  [tool definitions][t-definition], [tool execution][t-tools],
  [middleware contract][t-hooks], [middleware composition][t-compose],
  [common options][t-types], [usage conversion][t-usage], [tool cache][t-cache],
  [OTel][t-otel], and [public fake adapter][t-fake], at the release pin.
  Key chat spans: 1525–1533 (finish usage), 1626–1691 (loop entry),
  2540–2563 (usage dispatch), 4512–4573 (continuation and counters),
  4922–4959 (validation before usage), and 6157–6202 (entry-point checks).
- **Provider implementation:** [OpenAI text][t-openai],
  [Responses base][t-base], [OpenAI options][t-openai-options],
  [OpenAI cache mapping][t-openai-cache], [OpenAI usage][t-base-usage],
  [Decisions evaluate][t-evaluate], [Gemini text][t-gemini],
  [Gemini options][t-gemini-options], and [Gemini usage][t-gemini-usage],
  at the release pin.
- **Official docs:** [agentic cycle][d-cycle], [1.0 migration][d-v1],
  [interrupts][d-interrupt], [client tools][d-client-tools],
  [persistence][d-persist], [older ID advice][d-stale-id], and
  [conflicting structured-output advice][d-stale-schema], pinned to the release.
- **Current-main distinction:** [release-to-main comparison][t-compare].
- **Verification configuration:** [documentation input discovery][m-doc-lint]
  and [root check targets][m-checks], pinned to the Maelstrom baseline.

[m-lock]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/bun.lock#L1901-L1915
[m-call]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-llm/src/lib/call-llm.ts#L18-L94
[m-planner]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-llm/src/lib/llm-planner.ts#L166-L237
[m-jev]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/llm-call.ts#L40-L153
[m-provider]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/planner-jev/src/lib/provider-call.ts
[m-eval]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/evals/src/core/usage-adapter.ts
[m-usage]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/telemetry/src/usage.ts
[m-engine]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/engine/src/lib/engine.ts
[m-history]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/engine/src/lib/history/history-manager.ts#L19-L26
[m-arch]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/docs/architecture.md
[m-wire]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/protocol/src/lib/agent-wire.ts
[m-sidechannel]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/protocol/src/lib/sidechannel-event.ts
[m-schema-test]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/evals/src/eval/structured-output-validation.test.ts
[m-eval-readme]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/packages/evals/README.md#measure-a-cache-baseline
[m-stream-source]: https://github.com/maelstrom-co/maelstrom/blob/9ef57f54c4c888f63e489848944b124ecc114148/packages/engine/src/lib/agent-session/connection.ts
[m-stream-wire]: https://github.com/maelstrom-co/maelstrom/blob/9ef57f54c4c888f63e489848944b124ecc114148/packages/protocol/src/lib/agent-wire.ts
[m-doc-lint]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/scripts/lib/vale-files.ts
[m-checks]: https://github.com/maelstrom-co/maelstrom/blob/7ad0d55e/package.json
[p-upgrade]: https://github.com/maelstrom-co/maelstrom/pull/334
[p-cache]: https://github.com/maelstrom-co/maelstrom/pull/335
[p-retain]: https://github.com/maelstrom-co/maelstrom/pull/342
[p-stream]: https://github.com/maelstrom-co/maelstrom/pull/346
[p-agui]: https://github.com/maelstrom-co/maelstrom/pull/344
[p-shop]: https://github.com/maelstrom-co/maelstrom/pull/312
[p-shop-page]: https://github.com/maelstrom-co/maelstrom/pull/313
[n-core]: https://registry.npmjs.org/@tanstack/ai/1.0.0
[n-openai]: https://registry.npmjs.org/@tanstack/ai-openai/1.0.0
[n-gemini]: https://registry.npmjs.org/@tanstack/ai-gemini/1.0.0
[tag-core]: https://github.com/TanStack/ai/releases/tag/%40tanstack%2Fai%401.0.0
[tag-openai]: https://github.com/TanStack/ai/releases/tag/%40tanstack%2Fai-openai%401.0.0
[tag-gemini]: https://github.com/TanStack/ai/releases/tag/%40tanstack%2Fai-gemini%401.0.0
[t-release]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/CHANGELOG.md#100
[t-compare]: https://github.com/TanStack/ai/compare/5651e07e3181745984155ad88b65b86b8528844e...98055ca01af9e449d039f61e380b0d3c158acbb1
[t-chat]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/index.ts
[t-strategy]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/agent-loop-strategies.ts#L3-L28
[t-tools]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/tools/tool-calls.ts
[t-definition]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/tools/tool-definition.ts
[t-hooks]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/middleware/types.ts#L769-L960
[t-compose]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/middleware/compose.ts#L507-L640
[t-types]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/types.ts#L1285-L1514
[t-usage]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/utilities/ag-ui-usage.ts#L162-L228
[t-otel]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/middlewares/otel.ts
[t-cache]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/activities/chat/middleware/tool-cache-middleware.ts
[t-fake]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai/src/testing/fake-text.ts
[t-openai]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/adapters/text.ts
[t-base]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/openai-base/src/adapters/responses-text.ts
[t-openai-options]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/text/text-provider-options.ts
[t-openai-cache]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/prompt-cache.ts
[t-base-usage]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/openai-base/src/usage.ts#L88-L138
[t-evaluate]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-openai/src/adapters/evaluate.ts
[t-gemini]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/adapters/text.ts
[t-gemini-options]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/text/text-provider-options.ts
[t-gemini-usage]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/packages/ai-gemini/src/usage.ts#L112-L204
[d-cycle]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/chat/agentic-cycle.md
[d-v1]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/migration/v1.md
[d-interrupt]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/interrupts/overview.md
[d-client-tools]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/tools/client-tools.md
[d-persist]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/persistence/chat-persistence.md
[d-stale-id]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/migration/ag-ui-compliance.md
[d-stale-schema]: https://github.com/TanStack/ai/blob/5651e07e3181745984155ad88b65b86b8528844e/docs/migration/migration-from-vercel-ai.md
