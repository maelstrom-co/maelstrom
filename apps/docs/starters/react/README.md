# Maelstrom React starter

Run a small workspace with a task list and an editable note. Maelstrom changes
their arrangement and views, then invokes the actions you expose.

The default local walkthrough follows predefined requests. It uses a real Engine
and HTTP Connector, and makes no model calls.

## Run

Install Bun. Select [Use this template](https://github.com/maelstrom-co/react-starter/generate)
to create your own repository, then clone it. To try the example directly:

```sh
git clone https://github.com/maelstrom-co/react-starter.git
cd react-starter
bun install --frozen-lockfile
bun run typecheck
bun run dev
```

Open http://127.0.0.1:5173. Tasks and the launch note are already visible.
Try the three example buttons:

1. **Rearrange the workspace** gives the note more space and opens its editor.
   Edit the note directly.
2. **Run an action** adds **Prepare the launch** to the task list through its
   declared `addTask` handler. You can also add and complete tasks yourself.
3. **Restore the layout** returns to the note preview. Your edited note and tasks
   remain in the application.

Resize the window. Narrow containers stack the components. Resizing keeps your
data and does not repeat the add-task action.

Local mode accepts the example requests, including a different quoted title in
`Add "your task" to my tasks`. Other text returns setup guidance. Use a model
planner for other requests.

Stop both servers with Ctrl+C. React and CSS edits update in the browser.
Server edits restart the Engine.
The app keeps data in browser memory; reloading resets it. The Engine's local
history disappears when its server stops.

If a port is already used, run `MAELSTROM_API_PORT=4315 bun run dev -- 4316`
and open http://127.0.0.1:4316.

To check the built app, run `bun run start` and open http://127.0.0.1:3001.
Use `bun run start -- 4315` for a different preview port.

## Connect OpenAI

Live mode uses `gpt-6-luna`. It sends your request, recent conversation, and
workspace structure to OpenAI. Requests use your OpenAI account and can incur
API charges. Loading and resizing the workspace make no model calls.

1. Copy `.env.example` to `.env.local`.
2. Replace the placeholder with your OpenAI API key. Keep the key in this file;
   never use a `VITE_` prefix or put it in browser code.
3. Stop local mode, then run `bun run dev:live`.
4. Open http://127.0.0.1:5173. Confirm the **Live · OpenAI gpt-6-luna** label.
5. Ask `Make my note editable and give it more room`, or add a task by asking
   `Add a task called Review the launch checklist`.

The server makes one bounded model request per intent, with retries disabled.
Your React handlers enforce the task limit and accepted title length.
If a request fails, the current workspace remains usable. Check your key and
OpenAI account access, then try again. Provider errors and keys stay out of
browser responses.

For a built live preview, use `bun run start:live`. To return to the keyless
walkthrough, stop both servers and run `bun run dev`.

## Adapt the example

`src/workspace.ts` defines the components' available views, action, and initial
layout. `src/App.tsx` owns their React renderers and application data.
`local-planner.ts` selects among those declared capabilities for the walkthrough.
`planner.ts` selects the optional server-side model. `server.ts` hosts the Engine
and validates HTTP requests. `dev.ts` starts Vite and watches the server.

Start by changing one capability. Keep its data and business rules in the app.
Actions name the operations the model may request; your handlers still decide
what those operations can do.

The preview binds to loopback. Hosting it requires your application's
authentication, authorization, persistence, and operational policy.

## Check your changes

```sh
bun run check
bun run typecheck
bun run test
bunx --no-install playwright install chromium
bun run e2e
```

The server tests use a local OpenAI fixture. They make no paid provider calls.
The browser tests build the app and check the workflow on desktop and mobile.
CI runs the same checks from a frozen dependency install.

## Source and license

The SDK uses the [MIT license](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE).
This example is generated from `apps/docs/starters/react` in the
[Maelstrom repository](https://github.com/maelstrom-co/maelstrom).
`SOURCE.json` records its source revision. Report issues and propose changes in
the main repository.
