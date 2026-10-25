# Run the AG-UI workspace prototype

This private, throwaway example proves a complete workspace round trip with
TanStack AI 1.0.0 and AG-UI core 1.0.0. It uses the real Maelstrom Engine and
client. All model decisions and the local business store are scripted.

## Run

Use Bun 1.4.3 and Node.js 24 from the repository root:

```sh
bun install --frozen-lockfile --ignore-scripts
bun run --cwd apps/agui-workspace-poc demo
```

The command prints JSON lines. The final line contains `record-73`, version `1`,
as both the created and focused record. It also prints the structural Chart
snapshot and `set_layout, execute_actions, set_layout, execute_actions`.
No provider key, paid inference, browser, or external service is required.

The trace labels parent wire events, frontend acknowledgments, and raw child
runtime events. Timestamps and TanStack-generated message IDs vary between runs.
The application decisions and assertions are deterministic.

## Verify

The browser check uses Playwright Chromium in an isolated profile. Install its
browser binary once if it is absent: `bunx playwright install chromium`.

```sh
bunx nx run-many --projects=@maelstrom-co/agui-workspace-poc --targets=typecheck,test,check --skip-nx-cache --skip-sync --output-style=static
```

`--skip-sync` keeps Nx's workspace-reference generator from editing unrelated
project configuration. The explicit typecheck target reads built dependency
declarations. Nx builds those dependencies first. The tests include a complete
three-run exchange over loopback HTTP on an ephemeral port. The test target also
starts a fresh browser server, checks the real React Chart, and stops that server.

## Run the browser experiment

```sh
bun run --cwd apps/agui-workspace-poc browser
```

Open `http://127.0.0.1:4318` and select **Run one goal**. The page ends with
**Complete** and **Focused exact ID and version**. It prints the structural
snapshot and command order. Restart the server before running another goal.

The automated browser check writes screenshots and measured evidence under
`tmp/research/agui-browser-*`. It uses a 960×640 Chart inside a 1200×1100 viewport
to distinguish container measurement from viewport measurement.

## Pause a child inside the workspace goal

```sh
APPROVAL=1 bun run --cwd apps/agui-workspace-poc browser
```

Select **Run one goal**. The note appears before the approval controls. Select
**Allow read** to resume the same child, read the canonical ID/version, and focus
the record. Select **Deny read** to stop after create. Denial leaves that record
intact. Restart the server between scenarios.

Run the same flow without a browser to inspect every wire event:

```sh
bun --conditions=@maelstrom-co/source apps/agui-workspace-poc/src/approval-demo.ts
bun --conditions=@maelstrom-co/source apps/agui-workspace-poc/src/approval-demo.ts --deny
```

Approval completes in four runs. The paused checkpoint has one create and zero
child reads. The final approved checkpoint has one read and matching record and
focus values. Denial has zero reads and no focus. The test target checks all
three browser modes: baseline, approval, and denial.

Read [the walkthrough](./WALKTHROUGH.md) for the change and its benefit, and
[the proof and its limits](./PROOF.md) before reusing this example.
