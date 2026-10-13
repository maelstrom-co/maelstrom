# Planner providers share one call flow

Both planner-jev providers, TypeSafe and OpenAI Decisions, run through one call flow, `createProviderCall` in `packages/planner-jev/src/lib/provider-call.ts`, with a fetch transport each. The flow owns everything the two clients used to duplicate: the option cap, the timeout combined with the caller's signal, the abort checks, the `jev.call` log, instrument event and `onCall` record, the mapping from failure to deferral code, the bounded body reads, `logReplies`, reply validation and the answer shapes the stages read. A transport only encodes the request, sends it and decodes the reply.

The transport seam mirrors TanStack AI's evaluate adapter, so a later switch is one bridge transport around `adapter.evaluate()`. A transport takes the model, the state and the questions keyed by id, and returns TanStack `WireAnswer`s keyed by question id plus the refused question ids, the usage, the raw reply and a typed failure. The input is a compatible superset of TanStack's `WireQuestion`. A choice option description may be structured text as well as a string, and the state is `unknown`. A bridge transport stringifies both before it calls `adapter.evaluate()`, as TanStack's OpenAI decider already does for objects.

## Considered options

- **`decide()` with the stock TanStack adapters.** Rejected for the gaps listed under Switch criteria. Its validation also only checks that each answer exists with the right type. It skips key sets, probability sums, the most probable choice check and the model echo, and its score value is the rounded score where ours is the most probable level.
- **The adapters' `evaluate()` called directly as transports.** Rejected for now. It has the same gaps apart from the validation one, and each gap would need its own shim.
- **A subclass of the OpenAI adapter that calls the SDK directly.** Rejected. It keeps only the SDK client and needs `@tanstack/ai-openai` 0.28 or later, which forces the four TanStack packages to move together and pulls in OpenAI SDK 7.

## Switch criteria

Each item is a gap that must close upstream before a bridge transport around `adapter.evaluate()` replaces a fetch transport.

1. A typed refusal that names the refused questions and keeps the other answers and the usage. Today the OpenAI decider throws a plain `Error`.
2. Usage reported on refusals and failures, not only on success.
3. The TypeSafe adapter honours its `timeout` option, or documents that the caller's abort signal is the only timeout.
4. HTTP failures expose the status as a field, with the error body bounded and not embedded in the message.
5. A response size cap.
6. Access to the raw provider reply.
7. The OpenAI decider sends score levels with a separate label and description, as our wire does, and does not collapse duplicate answer names before the caller can see them.
8. Network failures distinguishable by type in the TypeSafe adapter.
9. With the OpenAI SDK underneath, retries off by default or settable to zero per call.

The input type mismatch is not a gap to close upstream. A bridge transport stringifies structured option text and non-string state before it calls `adapter.evaluate()`, so that is bridge work rather than a switch criterion.

A bridge transport is accepted when it passes `packages/planner-jev/src/lib/provider-transport-contract.test.ts` unchanged and both provider eval arms stay inside the bands the switch to one call flow was measured against: cheap correct, cheap wrong and fallback rate within one percentage point, and cheap path median latency within 10%. `decide()` itself stays out even then, because its validation is weaker than ours and its score value differs.

Upstream issue links: pending

## Consequences

There is one call flow to maintain, and a contract suite that every transport passes, so a new provider or a bridge transport is measured against the same rows. No TanStack upgrade is tied to planner-jev, and a TanStack version bump stays independent of these clients because the flow imports TanStack AI for types only.
