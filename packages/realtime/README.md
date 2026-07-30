# @maelstrom-co/realtime

[![npm](https://img.shields.io/npm/v/@maelstrom-co/realtime.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/realtime)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

Framework-agnostic realtime voice foundation for Maelstrom.

📚 **Full documentation:** <https://docs.maelstrom-ai.co>

## Install

```bash
bun add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/realtime @maelstrom-co/client @maelstrom-co/protocol`

## What it does

This package hosts the Maelstrom-shaped realtime voice logic that drives `VoiceSession` from
browser-side voice providers. It ships two entry points:

- **`@maelstrom-co/realtime`** — provider-agnostic core
- **`@maelstrom-co/realtime/openai`** — OpenAI Realtime adapter

A `/google` subpath is reserved for a Google Gemini Live adapter, but that adapter is not
implemented yet and the subpath currently resolves to an empty module.

The core is under active development; exports will land as the realtime voice foundation is built out.

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/

## License

MIT
