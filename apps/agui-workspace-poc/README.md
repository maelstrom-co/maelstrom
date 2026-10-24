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

```sh
bunx nx run-many --projects=@maelstrom-co/agui-workspace-poc --targets=typecheck,test,check --skip-nx-cache --skip-sync --output-style=static
```

`--skip-sync` keeps Nx's workspace-reference generator from editing unrelated
project configuration. The explicit typecheck target reads built dependency
declarations. Nx builds those dependencies first. The tests include a complete
three-run exchange over loopback HTTP on an ephemeral port.

Read [the proof and its limits](./PROOF.md) before reusing this example.
