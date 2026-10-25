# Maelstrom React starter

Run a local React application through the public Maelstrom 0.1.0 SDK.
This example uses a real Engine and HTTP Connector with a deterministic planner.
It shows the same greeting capability for any submitted intent. It does not call
a model or require credentials.

## Run

Install Bun. Select [Use this template](https://github.com/maelstrom-co/react-starter/generate)
to create your own repository, then clone it. To try the example directly:

```sh
git clone https://github.com/maelstrom-co/react-starter.git
cd react-starter
```

Run these commands from the starter directory:

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

This example is generated from `apps/docs/starters/react` in the
[Maelstrom repository](https://github.com/maelstrom-co/maelstrom).
`SOURCE.json` in the standalone repository records the source revision.
Report issues and propose changes in the main repository.

The dependency override selects Zod 4.6.6 for the 0.1.0 SDK dependencies.
This addresses [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
