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

## Packages

| Package | Description |
| --- | --- |
| [`@maelstrom-co/protocol`](./packages/protocol) | Core types and message contract |
| [`@maelstrom-co/client`](./packages/client) | Framework-agnostic client |
| [`@maelstrom-co/react`](./packages/react) | React bindings and components |
| [`@maelstrom-co/engine`](./packages/engine) | LLM decision engine |

## Contributing

Contributions are welcome — see the [contributing guide](https://docs.maelstrom-ai.co/community/contributing/).

## License

MIT — see [LICENSE](./LICENSE).
