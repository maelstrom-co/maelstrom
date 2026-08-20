# @maelstrom-co/realtime

Framework-agnostic realtime voice foundation for Maelstrom.

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol`

## What it does

This package hosts the provider-neutral session logic that turns adapter events
into Maelstrom intents, waits for successful UI updates to render before
returning their result, and keeps structural grounding separate from Engine
planning. Provider transports ship as sibling packages such as
`@maelstrom-co/realtime-openai` and `@maelstrom-co/realtime-livekit`.

- **`@maelstrom-co/realtime`** — provider-neutral `RealtimeSession`, adapter contract, and typed fatal errors
- **`@maelstrom-co/realtime-openai`** — OpenAI Realtime browser adapter
- **`@maelstrom-co/realtime-livekit`** — LiveKit browser adapter

Application code supplies a `RealtimeProviderAdapter` to `RealtimeSession`, or passes an adapter factory to [`@maelstrom-co/react-realtime`](https://docs.maelstrom-ai.co/reference/react-realtime/readme/). Provider adapters may expose different turn controls and state progressions; the core does not define a universal retry sequence.

The core has a single entry point and carries no provider-specific code. Add a
provider through its own packages, never through a subpath here. See
[`docs/adr/0001-realtime-providers-come-in-two-kinds.md`](../../docs/adr/0001-realtime-providers-come-in-two-kinds.md).

## Docs

- Voice guide: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/

## License

MIT
