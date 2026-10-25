# Run the experimental AG-UI mode

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

The Planner uses `createDemoOpenaiChat`, including the existing `ENGINE_MODEL` override. Live inference has not been verified. The journey remains a fixed two-step state machine in both modes; the live option invokes the model-backed Planner for workspace decisions.

## Inspect the result

In browser developer tools, inspect POST requests to `/api/experimental-agui`. A successful task has two planning runs and two acknowledgment runs. Automatic Chart updates can add further pairs.

Each planning run ends with `RUN_FINISHED` before application acknowledgment. The next write requires the matching application result and authoritative Chart snapshot. Only the final acknowledged Journal content completes the goal.

The demo-private `demo:workspace` and `demo:state` custom events use AG-UI 1.0.0. TanStack AI 1.0.0 serializes the SSE response. These payloads are experimental adapters, not public SDK contracts. The Journal read adapter uses the application store because declared Vessel Queries are not shipped. Reads require no approval.

Every workspace response passes through a stateless Planner, Engine validation, and the existing Orchestrator. Automatic resize and mutation requests share its FIFO and acknowledgment gate. Neither Vessel Actions nor layout changes are exposed as loop tools. The normal voice provider adapters retain their native transport.

Sessions last at most ten minutes and accept one goal. A disconnect, rejected result, changed Journal selection, or uncertain application stops continuation. Inspect the existing entry before starting another session; a new session is not reconciliation. Durability, restart recovery, general-purpose task planning, and experimental voice delivery are outside this proof.

## Run the checks

From the repository root:

```bash
bunx nx run-many --projects=@maelstrom-co/demo --targets=typecheck,test,check --skip-nx-cache --skip-sync --output-style=static
```

Focused session and transport tests live in `src/lib/agui-session.test.ts` and `src/server/agui-handler.test.ts`. The separate [headless AG-UI proof](../agui-workspace-poc/PROOF.md) remains available.
