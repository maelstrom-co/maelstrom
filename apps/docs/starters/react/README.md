# Maelstrom React starter

Run a local React application through the public Maelstrom 0.1.0 SDK.
This example uses a real Engine and HTTP Connector with a deterministic planner.
It shows the same greeting capability for any submitted intent. It does not call
a model or require credentials.

## Run

Install Bun, then run these commands from this extracted directory:

```sh
bun install
bun run typecheck
bun run start
```

Open http://127.0.0.1:3001. Submit **Show the greeting**. Expect a greeting card
inside the Chart and the status **Local preview complete. No model was called.**
Stop the server with Ctrl+C. After editing the app, rerun `bun run start` to
rebuild it. This example does not configure hot reload.

If port 3001 is already used, run `bun run start -- 4315` and open
`http://127.0.0.1:4315` instead.

## Adapt the example

`src/App.tsx` owns the React component, Vessel declaration, and intent form.
`server.ts` owns the Engine and local planner. The HTTP response crosses that
boundary; provider credentials never need to enter the browser.

To use a live model, replace the deterministic planner with a selected provider
planner. Follow https://docs.maelstrom-ai.co/guides/engine/custom-llm-providers/
and keep credentials server-side. Verify that model-backed path separately.

The preview binds to loopback and keeps session history in memory. It is a local
learning example. Hosting it requires your application's authentication,
authorization, persistence, and operational policy.

The Maelstrom SDK uses the MIT license. See
https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE for the license text.
