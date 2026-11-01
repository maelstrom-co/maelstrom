# Run the experimental AG-UI mode

For the normal hosted demo with typed input and voice, use **Workspace → AG-UI**. Its [WebSocket contract](../../packages/agui-protocol/CONTRACT.md) is separate from this bounded local experiment.

Create a Journal entry, read its generated application ID, then write that ID into the entry. This local experiment uses the real demo Chart and Journal renderer.

HTTP requests with SSE responses are a prototype-only transport deviation. Runtime v1 excludes plain-HTTP transport. AG-UI does not require HTTP/SSE or a change from WebSocket. The normal demo keeps its existing WebSocket path. This experiment does not establish an approved production transport architecture.

## Before you start

Use this branch with the workspace dependencies installed. The [demo prerequisites](./README.md#prerequisites) describe Bun and Node versions. The offline fixture needs no provider key. The experiment is unavailable in hosted mode.

## Start the experiment

1. Build from the repository root:

   ```bash
   bunx nx run @maelstrom-co/demo:build --skip-nx-cache --skip-sync
   ```

2. Start the built demo from `apps/demo`:

   ```bash
   bunx vite preview --host 127.0.0.1 --port 4318 --strictPort
   ```

3. Open `http://127.0.0.1:4318`. Dismiss the normal key drawer with **Cancel**, then select **Experimental AG-UI**.
4. Choose **Offline fixture · no model inference**, then **Start experimental session**.
5. Enter an entry title and select **Create and record generated ID**.
6. Confirm that the observed ID appears in the Journal content and the status says **Complete · dependent write observed in the application**.
7. Select **Return to normal demo**. This retires experimental work and starts a fresh normal UI lifetime. Journal data stays in browser memory.

The built preview is the verified browser path. A local Vite development run encountered a React Store `useSelector` export error. Use the built preview for this proof.

## Use a live Planner

Choose **Live model · browser-owned OpenAI key** before starting the experimental session. Supply a key in the password field. The local Engine holds it in memory for the session; it never falls back to the normal server key.

The Planner uses `createDemoOpenaiChat`, including the existing `ENGINE_MODEL` override. The narrow live-model journey passed in Chromium with a manually supplied browser-owned key: two planning runs, two acknowledgment runs, and no console or page errors. The journey remains a fixed two-step state machine in both modes; this does not establish general-purpose planning reliability.

The first live attempt proposed a Journal `list` layout and stopped before any Journal write because the demo requires `entry`. The prompt now states that requirement explicitly. Engine plan validation can request one candidate correction before delivery. This corrects an unexecuted plan; it never replays an application write. Exhausted planning requirements produce the private `DEMO_PLANNING_REJECTED` error code.

## Inspect the result

In browser developer tools, inspect POST requests to `/api/experimental-agui`. A successful task has two planning runs and two acknowledgment runs. Automatic Chart updates can add further pairs.

Each planning run ends with `RUN_FINISHED` before application acknowledgment. The next write requires the matching application result and authoritative Chart snapshot. Only the final acknowledged Journal content completes the goal.

The demo-private `demo:workspace` and `demo:state` custom events use AG-UI 1.0.0. TanStack AI 1.0.0 serializes the SSE response. These payloads are experimental adapters, not public SDK contracts. The Journal read adapter uses the application store because declared Vessel Queries are not shipped. Reads require no approval.

Every workspace response passes through a stateless Planner, Engine validation, and the existing Orchestrator. Automatic resize and mutation requests share its FIFO and acknowledgment gate. Neither Vessel Actions nor layout changes are exposed as loop tools. The normal voice provider adapters retain their native transport.

### Private ingress mapping

[AG-UI 1.0 frontend tools](https://docs.ag-ui.com/spec/1.0/events/tool-calls.md#frontend-tools) have no consumer-to-producer mid-run channel. Their results return as tool messages in the next `RunAgentInput`. Using WebSocket does not add standard input semantics.

This experiment uses a separate, private mapping. It sends empty `messages` and `tools` arrays and carries operations in `RunAgentInput.forwardedProps`:

- **Typed task:** `enqueueIntent` admits each task step through the existing FIFO. The next planning run carries `kind: 'plan'`, the Chart request, and the initial goal when applicable. The form accepts one goal and disables further submission; it does not demonstrate utterance ingress during active work.
- **Resize and mutations:** the existing Orchestrator buffers and coalesces local updates while work is active. They travel with a later Chart request. The connector waits for the preceding application acknowledgment before starting another planning run.
- **UI-applied result:** exact command settlement supplies Action outcomes, authoritative Chart state, and the private Journal read. A new run carries `kind: 'ack'` and the correlated result in `forwardedProps`. This is not a standard frontend-tool result message or mid-run input.
- **Mode exit and disconnect:** local abort and the private session DELETE endpoint retire work. These controls implement neither the planned interruption classifier nor AG-UI interrupt/resume.

The connector buffers each SSE response until completion and validates its terminal framing before applying a workspace response. The server rejects overlapping runs and planning while an application result is pending. Streaming output therefore proves neither active-run ingress nor non-blocking Planner/ack parity.

The normal WebSocket control/admission path remains intact. A production mapping for utterances, resize, mutations, and UI-applied ingress during active work remains a separate contract decision. This proof does not resolve that decision or implement the interruption classifier.

Sessions last at most ten minutes and accept one goal. A disconnect, rejected result, changed Journal selection, or uncertain application stops continuation. Inspect the existing entry before starting another session; a new session is not reconciliation. Durability, restart recovery, general-purpose task planning, and experimental voice delivery are outside this proof.

## Run the checks

From the repository root:

```bash
bunx nx run-many --projects=@maelstrom-co/demo --targets=typecheck,test,check --skip-nx-cache --skip-sync --output-style=static
```

Focused tests live in `src/lib/agui-session.test.ts`, `src/server/agui-handler.test.ts`, and `src/server/agui-engine.test.ts`. They cover session correlation, transport guards, and bounded candidate correction before delivery. The separate [headless AG-UI proof](../agui-workspace-poc/PROOF.md) remains available.
