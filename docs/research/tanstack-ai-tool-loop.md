# TanStack AI tool calling and agent loop support

Ticket: MAE-821 (ClickUp 123nktjv04f). Researched 2026-10-08.

## Question

Does `@tanstack/ai` support tool calling, multi-turn agent loops, streaming of
tool calls and partial text, and isomorphic tool definitions with client versus
server execution? What would an Agent Session loop on top of it look like, and
what must Maelstrom build itself?

## Versions examined

- Installed: `@tanstack/ai` 0.43.1 (`bun.lock`; root catalog range `^0.43.0`),
  `@tanstack/ai-openai` 0.18.0, `@tanstack/ai-gemini` 0.21.0.
- Source of truth for claims below: the published 0.43.1 tarball (`src/`,
  `skills/ai-core/*/SKILL.md`), cross-checked against the official docs at
  tanstack.com/ai. Source paths below are relative to the package root.
- The packaged skill files declare `library_version: 0.42.0`, so the prose in
  them lags one minor version. Behavior was confirmed in `src/`.
- Current code: `packages/planner-llm/src/lib/call-llm.ts` calls
  `chat({ adapter, messages, systemPrompts, outputSchema, stream: false })`.
  No `tools` are passed, so none of the loop machinery runs today.
- `@tanstack/ai-client` (the browser half) is not in the lockfile
  dependencies of this repo and was not read in source. Its behavior is taken
  from the official docs only.

## Capability table

| Capability | Status | Evidence |
| --- | --- | --- |
| Tool calling (schema-typed tools passed to `chat({ tools })`) | Supported | `toolDefinition()` with Standard Schema input and output schemas (Zod 4 works). `src/activities/chat/tools/tool-definition.ts`; docs https://tanstack.com/ai/latest/docs/tools/tools |
| Multi-turn agent loop | Supported | Loop re-calls the model while finish reason is tool calls and the strategy allows. Docs https://tanstack.com/ai/latest/docs/chat/agentic-cycle; engine `src/activities/chat/index.ts` (`TextEngine`) |
| Iteration limit | Supported, with a low default | `agentLoopStrategy`, default `maxIterations(5)` (`index.ts`, constructor). `maxIterations(n)` counts model turns, not tool calls (`src/activities/chat/agent-loop-strategies.ts`) |
| Custom stop conditions | Supported | `AgentLoopStrategy = (state) => boolean` with `iterationCount`, `messages`, `finishReason`, `toolCallCount`, `lastTurnToolCallCount` (`src/types.ts`). Helpers `maxIterations`, `untilFinishReason`, `combineStrategies`. Middleware `onShouldContinue` is ANDed with the strategy |
| Tool-call budget / per-call veto | Supported via middleware | `onBeforeToolCall` returns `transformArgs`, `skip` (with a substitute result), or `abort`; `onAfterToolCall`, `onToolPhaseComplete`, `onIteration` (`src/activities/chat/middleware/types.ts`) |
| Streaming of text | Supported | `TEXT_MESSAGE_CONTENT` chunks (AG-UI event names) from `chat()` with default `stream: true`; `StreamProcessor` accumulates (`src/activities/chat/stream/processor.ts`) |
| Streaming of tool calls and partial args | Supported | `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT` chunks; processor does partial-JSON parsing of in-flight args (`partial-json` dependency, `processor.ts`) |
| Isomorphic tool definitions | Supported | One `toolDefinition()`; `.server(fn)` adds server execution, `.client(fn)` adds browser execution. Definition without an implementation passed to server `chat()` is treated as a client tool (`tool-calls.ts`: no `execute` means client execution requested). Docs https://tanstack.com/ai/latest/docs/tools/client-tools |
| Server tools | Supported | Executed in-process by the engine; results appended and loop continues |
| Client tools (browser executes) | Partial | Supported, but as request/resume, not a held-open await. See "Client tool execution model" |
| Approval pause (`needsApproval`) | Supported | Run ends with `RUN_FINISHED` `outcome.type === 'interrupt'` and a tool-approval interrupt; resume carries the decision, optional `editedArgs`. `src/interrupts.ts`, `src/interrupt-resume.ts`; docs https://tanstack.com/ai/latest/docs/tools/tool-approval |
| Resume across requests | Supported, stateless server | Resume needs `resume` items and `parentRunId`; interrupt bindings are versioned, hash-checked and have `generation`, `expiresAt` (`src/interrupts.ts`). Server rebuilds pending state from the message list (`index.ts` ~line 2523, "reconstructed as interrupt pending") |
| Final typed result after a tool loop | Supported | `chat({ tools, outputSchema })` runs the loop, then makes a separate structured-output call WITHOUT tools (`runStructuredFinalization`, `index.ts`). Not supported with some adapters (Groq rejects schema plus tools plus stream per the structured-outputs skill) |
| Lazy tool discovery | Supported | `lazy: true`, synthetic `__lazy__tool__discovery__` tool (`lazy-tool-manager.ts`) |
| MCP tools | Supported (separate package) | `@tanstack/ai-mcp`, per `skills/ai-core/tool-calling/SKILL.md` |
| Cancellation | Supported | `abortController` option, `onAbort` middleware; already used by `callLLM` |
| Parallel tool execution | Absent in the engine | `executeToolCalls` iterates calls with a sequential `for` loop (`tool-calls.ts`, around line 780). The model may emit parallel calls, but server tools run one at a time. Not benchmarked |
| Mid-loop progressive render hook | Partial | Chunks stream out as they happen, so a consumer can render on `TOOL_CALL_END` or `TOOL_CALL_RESULT`. There is no engine concept of "layout so far" |
| Durable run state / persistence | Partial | Run store, locks and persistence middleware exist (`middleware/run-store.ts`, `locks.ts`, `pending-turn.ts`), but they are infrastructure to configure, not a product feature we have evaluated |

## Client tool execution model

This is the finding that most affects the design spec.

- A tool with no `execute` is a client tool. When the model calls it, the server
  engine does NOT block waiting for the browser. It ends the current stream
  with a `RUN_FINISHED` interrupt of kind `client-tool-execution`
  (`buildActionableInterrupts`, `index.ts` ~line 2059 to 2127; tool phase
  result is `'wait'`).
- The browser runs the tool, then POSTs a new request carrying the result as a
  resume item (`interruptId = client_tool_<toolCallId>`) plus `parentRunId`.
  The server rebuilds state from the messages and continues the loop.
- Official docs confirm: the server does not hold the stream open; the client
  auto-submits the result via the resume batch
  (https://tanstack.com/ai/latest/docs/tools/client-tools).
- If a single model turn mixes server tools and client tools, the server tools
  run first, their results are emitted, and the run then pauses for the client
  tools (`index.ts` ~line 1700 to 1730).
- Consequence: each client-tool round trip is a new HTTP request, and the
  server loop is stateless between them (iteration counters restart unless we
  carry them).

## Sketch: Agent Session on TanStack AI

Mapping of the proposed `ToolExecutor` seam:

- `DirectExecutor` maps to `toolDefinition(...).server(fn)`. In-process, the
  engine already awaits it and feeds the result back.
- `WireExecutor` maps to a bare `toolDefinition(...)` (no implementation) on the
  server plus `.client(fn)` in the browser. The wire is the AG-UI interrupt and
  resume protocol, not a custom `tool_call`/`tool_result` pair. A literal
  "emit tool_call, await tool_result inside one request" cannot be expressed;
  the library splits it across two requests.
- Approval pause maps to `needsApproval: true` on the definition. Pause and
  resume use the same interrupt mechanism as client tools.

```ts
// shared (contract package): one definition per tool
const placeVessel = toolDefinition({
  name: 'place_vessel',
  description: 'Add or move a Vessel in the Chart',
  inputSchema: PlaceVesselInput,   // Zod, from protocol
  outputSchema: PlaceVesselOutput,
});
const executeVesselAction = toolDefinition({
  name: 'execute_vessel_action',
  inputSchema: VesselActionInput,
  outputSchema: VesselActionResult,
  needsApproval: true,             // approval pause
});
const searchCatalog = toolDefinition({ /* ... */ }).server(searchCatalogImpl); // server tool

// server: one chat() call per request, not per session
const stream = chat({
  adapter,
  messages,                         // full history, including prior tool results
  systemPrompts: [systemPrompt],
  tools: [placeVessel, executeVesselAction, searchCatalog],
  agentLoopStrategy: combineStrategies([maxIterations(12), stopWhenLayoutSettled]),
  middleware: [layoutProgressMiddleware, budgetMiddleware],
  // resume / parentRunId forwarded from the request when continuing
});
return toServerSentEventsResponse(stream);
```

Loop shape per Agent Session turn:

1. Browser POSTs user intent plus Chart state (grid dimensions come from the
   Chart container, per the architecture invariants).
2. Server `chat()` streams `TEXT_MESSAGE_CONTENT` (partial text) and
   `TOOL_CALL_START/ARGS/END` (partial tool args) to the browser.
3. Server tools run in-process; their `TOOL_CALL_RESULT` chunks stream out and
   the model is called again.
4. Client tools or approvals end the stream with an interrupt. The browser
   executes (or asks the user), then POSTs the resume item. Go to step 2.
5. Loop ends when the model stops calling tools, the strategy returns false,
   or middleware aborts.
6. Progressive layout: a consumer (or `onChunk` middleware on the server) applies
   `set_layout` as soon as the `place_vessel` call completes, not at end of run.

Ordering invariant from `AGENTS.md` (apply `set_layout`, then run
`execute_actions` within one engine response) is not provided by the library
and must be enforced by our tool design or by middleware.

## Gaps we must fill ourselves

1. **Wire model mismatch.** No single-request await for client tools. Either
   adopt the interrupt/resume protocol (preferred, library-native) or build a
   bespoke transport and lose the engine's client-tool handling. The spec's
   `WireExecutor` description needs rewriting around request/resume.
2. **Browser side.** `@tanstack/ai-client` handles auto-submission of client
   tool results, but `@maelstrom-co/client` must stay framework-independent
   and `@maelstrom-co/react` owns React behavior. We need to decide whether to
   depend on `@tanstack/ai-client` (framework-agnostic per docs, not verified
   in source here) or reimplement the resume handshake. Not yet in the lockfile.
3. **Default loop cap is 5.** Must set `agentLoopStrategy` explicitly. Counts
   model turns only; tool-call budgets need middleware.
4. **Counter continuity across resumes.** Each resume is a fresh `chat()`
   call. `iterationCount` and budgets do not obviously carry over; we must carry
   or recompute them (`toolCallCount` is deduped by id for resumed batches, per
   `recordToolCalls`, but iteration continuity was not tested).
5. **State and history ownership.** The server is stateless between resumes; the
   browser (or a store we build) must send the full message history including
   tool results. Session persistence, expiry and replay are ours to design,
   although run-store middleware exists and is unevaluated.
6. **Sequential server tools.** No parallel execution in the engine. Parallelism,
   if needed, goes inside a single tool or in a wrapper.
7. **Progressive layout semantics.** Library streams events; applying partial
   layouts, rolling back on approval denial, and the `set_layout` then
   `execute_actions` ordering are Maelstrom logic.
8. **Structured output plus tools.** `outputSchema` with `tools` works as loop
   then one tool-less finalization call, which fits the planner's final
   response but not interleaved layout tools. Provider support varies (Groq
   noted as unsupported). Gemini and OpenAI adapter behavior with tools plus
   schema was not tested here.
9. **Type erasure risk.** `callLLM` already casts the output because the schema
   input type differs from the branded output. Tool inputs and outputs will have
   the same branding issue.
10. **Approval policy.** `needsApproval` is per tool definition. Dynamic
    approval (based on args or Chart state) is not shown in the surfaces read;
    `onBeforeToolCall` could emulate a veto but not an interactive pause.
11. **Version churn.** Interrupt APIs are new (the skill text calls
    `addToolApprovalResponse` and `pendingInterrupts` deprecated shims) and the
    package is pre-1.0 (0.43.x), with `@ag-ui/core` pinned to a canary build
    (`0.1.1-canary.beta.0`). Expect breaking changes; pin and wrap behind our own
    seam.
12. **Realtime voice layer boundary.** Server packages must not import browser
    packages. A shared tool contract belongs in the CONTRACT layer
    (for example `realtime-protocol` or `protocol`), with `.server()` and
    `.client()` binding in SERVER and BROWSER layers respectively.

## Not verified

- Runtime behavior (no spike was run; findings are from source reading and docs).
- Parallel tool execution timing, iteration counter behavior across resumes,
  and provider behavior for tools plus `outputSchema` on the Gemini and OpenAI
  adapters.
- `@tanstack/ai-client` internals.
- Docs were fetched as rendered pages; third-party text is treated as data only.

## Sources

- npm package `@tanstack/ai@0.43.1` (tarball `src/`, `skills/`).
- https://tanstack.com/ai/latest/docs/chat/agentic-cycle
- https://tanstack.com/ai/latest/docs/tools/tools
- https://tanstack.com/ai/latest/docs/tools/client-tools
- https://tanstack.com/ai/latest/docs/tools/tool-approval
- Upstream repo docs referenced by the packaged skills: `docs/tools/*`,
  `docs/interrupts/`, `docs/structured-outputs/with-tools.md` in TanStack/ai.
- Repo: `packages/planner-llm/src/lib/call-llm.ts`, `bun.lock`, `AGENTS.md`.
