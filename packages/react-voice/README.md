# @maelstrom-co/react-voice

Voice extension for [`@maelstrom-co/react`](../react). Adds `useVoice()` and a `<VoiceOrb />` component to a Maelstrom instance via the `.with()` builder.

## Install

```bash
bun add @maelstrom-co/react @maelstrom-co/react-voice @maelstrom-co/voice
```

`@maelstrom-co/react`, `react`/`react-dom`, and `@maelstrom-co/voice` are peer dependencies. `@maelstrom-co/voice` is optional — it is loaded on demand and voice features degrade gracefully when it is absent.

## Usage

```tsx
import { createMaelstrom } from '@maelstrom-co/react';
import { maelstromVoice } from '@maelstrom-co/react-voice';

const m = createMaelstrom({ vessels }).with(maelstromVoice());

function App() {
  // Owner: pass options to create the session
  m.useVoice({
    autoAcquireMic: true,
    greeting: 'Hello, how can I help?',
  });

  return <m.VoiceOrb size={48} />;
}
```

Apply the extension once per `createMaelstrom(...)` call. Multiple components may call `m.useVoice()` without options to observe the shared session state.

## API

- `maelstromVoice()` — `MaelstromExtension<VoiceExtension>` factory
- `useVoice(options?)` — owner if `options` is passed, observer otherwise
- `<VoiceOrb size? disabled? className? />` — self-contained mic button driven by `useVoice()`

See the `UseVoiceOptions` and `UseVoiceReturn` JSDoc for the full options and return shape.
