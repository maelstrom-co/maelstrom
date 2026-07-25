# @maelstrom-co/realtime-protocol

Dependency-free wire contracts for Maelstrom's realtime voice packages.

## Install

```bash
bun add @maelstrom-co/realtime-protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime-protocol`

## What it does

This package holds only types, zod schemas, and constants — zero runtime
behavior, no browser or Node APIs. It is the contract leaf both the
browser-side realtime packages (`@maelstrom-co/realtime`,
`@maelstrom-co/realtime-livekit`) and the server/worker-side ones
(`@maelstrom-co/realtime-server`, `@maelstrom-co/realtime-livekit-server`,
`@maelstrom-co/realtime-livekit-agent`) depend on, so a Node-only package can
declare the vocabulary it needs without pulling in a browser SDK.

It ships three entry points:

- **`@maelstrom-co/realtime-protocol`** — neutral mint vocabulary
  (`TokenGrant`, `UnixSeconds`, `MintFailure`, …)
- **`@maelstrom-co/realtime-protocol/openai`** — OpenAI wire contracts
- **`@maelstrom-co/realtime-protocol/livekit`** — LiveKit wire contracts

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/

## License

MIT
