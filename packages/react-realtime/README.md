# @maelstrom-co/react-realtime

[![npm](https://img.shields.io/npm/v/@maelstrom-co/react-realtime.svg?style=flat-square)](https://www.npmjs.com/package/@maelstrom-co/react-realtime)
[![license](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](https://github.com/maelstrom-co/maelstrom/blob/main/LICENSE)

React bindings for Maelstrom realtime voice.

📚 **Full documentation:** <https://docs.maelstrom-ai.co>

## Install

```bash
bun add @maelstrom-co/react-realtime @maelstrom-co/react @maelstrom-co/realtime
```

Or: `npm install` / `pnpm add` / `yarn add @maelstrom-co/react-realtime @maelstrom-co/react @maelstrom-co/realtime`

## What it does

Adds voice to an existing Maelstrom instance through the `.with()` extension builder. The
provider transport itself is not bundled here — you supply it via `createAdapter`, so this
package stays provider-agnostic and pulls in neither `openai` nor `livekit-client`.

- **`maelstromRealtime(options)`** — the extension. `createAdapter` builds the provider
  transport once per session and receives the orchestrator's `sessionId`, so per-session
  server resources (an ephemeral token mint, a room name) can be scoped to it.
- **`m.useVoice()`** — the hook the extension adds. Returns session `state`, `error`, the
  latest `userTranscript` / `assistantTranscript`, `connect` / `disconnect`, the underlying
  `session` escape hatch, and `turnControl` — present only when the adapter is a
  push-to-talk cascade, so `turnControl !== undefined` is the signal to render
  hold-to-talk controls instead of an always-on listening orb.
- **`m.VoiceOrb`** — a drop-in status orb. Takes `size` and `className`, and exposes
  `data-state` for per-state styling.
- **`createLevelMeter(stream)`** — standalone audio metering for custom waveforms.
  `read()` returns `0..1`; call `dispose()` when done.

## Quick example

```tsx
import { createMaelstrom } from '@maelstrom-co/react';
import { maelstromRealtime } from '@maelstrom-co/react-realtime';

const m = createMaelstrom({ vessels }).with(
  maelstromRealtime({
    createAdapter: ({ sessionId }) => createMyProviderAdapter({ sessionId }),
  }),
);

function VoiceButton() {
  const { state, connect, disconnect } = m.useVoice();
  return (
    <button onClick={state === 'idle' ? connect : disconnect}>
      <m.VoiceOrb size={48} />
      {state}
    </button>
  );
}
```

## Docs

- Quick start: https://docs.maelstrom-ai.co/getting-started/quick-start/
- Core concepts: https://docs.maelstrom-ai.co/getting-started/core-concepts/

## License

MIT
