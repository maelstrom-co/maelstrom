# Maelstrom

**Maelstrom orchestrates the components you designed.**

It hands your model your stateful components and a live layout surface — to arrange them, resize them, and trigger their actions by intent, in real time. It never invents new ones.

Maelstrom is an open-source library for **AI-orchestrated UI**. You author your components as **Vessels** — typed state machines with variants and size hints — and a model arranges, resizes, and invokes them on a spatial layout surface, from the user's intent. It arranges the interface you designed; it never generates one.

## Documentation

**📖 [docs.maelstrom-ai.co](https://docs.maelstrom-ai.co)**

- [Introduction](https://docs.maelstrom-ai.co/getting-started/introduction/) — what Maelstrom is and why it exists
- [Quick start](https://docs.maelstrom-ai.co/getting-started/quick-start/) — your first Vessel
- [Core concepts](https://docs.maelstrom-ai.co/getting-started/core-concepts/) — Vessels, Chart, Engine
- [How Maelstrom compares](https://docs.maelstrom-ai.co/understanding/comparison/) — vs chat-UI libraries and agent frameworks
- [API reference](https://docs.maelstrom-ai.co/reference/)

## Voice

Start with the [voice overview](https://docs.maelstrom-ai.co/guides/voice/overview/) to choose an integration and understand the shared session contract.

- [OpenAI Realtime guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/) — direct browser-to-provider speech sessions
- [LiveKit cascade guide](https://docs.maelstrom-ai.co/guides/voice/livekit-cascade/) — browser, room, and worker setup
- [Generated voice API reference](https://docs.maelstrom-ai.co/reference/) — package entry points and public symbols
- [Realtime voice architecture](https://github.com/maelstrom-co/maelstrom/blob/main/docs/realtime-voice-architecture.md) — design constraints and decisions behind the integrations

## Packages

| Package | Description |
| --- | --- |
| [`@maelstrom-co/protocol`](./packages/protocol) | Core types and message contract |
| [`@maelstrom-co/client`](./packages/client) | Framework-agnostic client |
| [`@maelstrom-co/react`](./packages/react) | React bindings and components |
| [`@maelstrom-co/engine`](./packages/engine) | LLM decision engine |
| [`@maelstrom-co/realtime`](./packages/realtime) | Provider-neutral realtime voice session core |
| [`@maelstrom-co/react-realtime`](./packages/react-realtime) | React bindings for realtime voice sessions |
| [`@maelstrom-co/realtime-server`](./packages/realtime-server) | Server-side OpenAI ephemeral-token minter |
| [`@maelstrom-co/realtime-livekit`](./packages/realtime-livekit) | LiveKit cascade browser adapter and protocol |
| [`@maelstrom-co/realtime-livekit-server`](./packages/realtime-livekit-server) | Server-side LiveKit room-token minter |
| [`@maelstrom-co/realtime-livekit-agent`](./packages/realtime-livekit-agent) | LiveKit speech worker runtime |

## Running the demo

See [`apps/demo/README.md`](./apps/demo/README.md) for how to run the demo app locally, including optional LiveKit voice setup.

## Contributing

Contributions are welcome — see the [contributing guide](https://docs.maelstrom-ai.co/community/contributing/).

## License

MIT — see [LICENSE](./LICENSE).
