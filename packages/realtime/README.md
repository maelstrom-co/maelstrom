# @maelstrom-co/realtime

Framework-agnostic realtime voice foundation for Maelstrom.

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol`

## What it does

This package hosts the Maelstrom-shaped realtime voice logic that drives `VoiceSession` from
browser-side voice providers. It ships three entry points:

- **`@maelstrom-co/realtime`** — provider-agnostic core
- **`@maelstrom-co/realtime/openai`** — OpenAI Realtime adapter
- **`@maelstrom-co/realtime/google`** — Google Gemini Live adapter

The core is under active development; exports will land as the realtime voice foundation is built out.

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/

## License

MIT
