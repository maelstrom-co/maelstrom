# @maelstrom-co/react-voice

Voice extension for [`@maelstrom-co/react`](../react). Adds `useVoice()` and a `<VoiceOrb />` component to a Maelstrom instance via the `.with()` builder.

## Install

```bash
bun add @maelstrom-co/react @maelstrom-co/react-voice @maelstrom-co/voice
```

`@maelstrom-co/react`, `react`/`react-dom`, and `@maelstrom-co/voice` are peer dependencies. Install all three — voice is loaded via dynamic import, but the extension cannot function without it.

If `@maelstrom-co/voice` is absent (or installed but unusable), `useVoice()` invokes your `onError` callback with `VoiceDependencyError { code: 'DEPENDENCY_MISSING' | 'DEPENDENCY_BROKEN' }` (and flips `isVoiceSupported` to `false`). Wire `onError` so the failure is visible in your UI instead of a silently disabled session. The failure path is async, so React error boundaries do not catch it directly — if you need a boundary to handle it, store the error in component state from `onError` and re-throw during render.

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
    onError: (err) => console.error('voice failed', err),
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

## Testing

Test files named `*.test.isolated.tsx` install process-global mocks (e.g. `mock.module()` that throws on import) and must run in their own `bun test` invocation — Bun's `mock.module()` persists across test files in the same process, which would poison the happy-path suite. Bun's default test discovery skips `*.test.isolated.tsx` (the test marker `.test` is not at the file extension), so the bare `bun test` command runs only the non-isolated suite; each isolated file then runs in a separate `bun test ./path/to/file.test.isolated.tsx` invocation, which spawns its own child process. The nx `test` target chains these. When adding a new isolated test, append a `bun test ./src/lib/<file>.test.isolated.tsx` line to `nx.targets.test.options.commands` in `package.json`.
