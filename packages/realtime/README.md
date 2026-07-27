# @maelstrom-co/realtime

Framework-agnostic realtime voice foundation for Maelstrom.

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol`

## What it does

This package hosts the provider-neutral session logic that turns adapter events into Maelstrom intents, waits for successful UI updates to render before returning their result, and keeps structural grounding separate from Engine planning. It ships these entry points:

- **`@maelstrom-co/realtime`** — provider-neutral `RealtimeSession`, adapter contract, and typed fatal errors
- **`@maelstrom-co/realtime/openai`** — OpenAI Realtime adapter
- **`@maelstrom-co/realtime/google`** — reserved package subpath

`@maelstrom-co/realtime/google` is reserved but not implemented. Do not import it as a usable adapter.

Application code supplies a `RealtimeProviderAdapter` to `RealtimeSession`, or passes an adapter factory to [`@maelstrom-co/react-realtime`](https://docs.maelstrom-ai.co/reference/react-realtime/readme/). Provider adapters may expose different turn controls and state progressions; the core does not define a universal retry sequence.

## Docs

- Voice guide: https://docs.maelstrom-ai.co/guides/voice/overview/
- API reference: https://docs.maelstrom-ai.co/reference/realtime/readme/
- Architecture: https://docs.maelstrom-ai.co/understanding/architecture/

## License

MIT
