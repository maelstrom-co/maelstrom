# Inject an application-authorized grant callback

Use this browser adapter only after selecting OpenAI speech-native voice. The
callback calls the application's secured minter; it never supplies a long-lived
OpenAI key to the browser.

```ts
import { OpenAIAdapter, type OpenAIAdapterOptions } from '@maelstrom-co/realtime-openai';

export function createOpenAIVoice(mintToken: OpenAIAdapterOptions['mintToken']) {
  return new OpenAIAdapter({ mintToken });
}
```

Verify the callback's Grant with the installed wire schema and server policy.
The adapter acquires transport resources during its connection lifecycle. Match
cleanup to that lifecycle and keep the Engine as the UI planner.

## Verify

Test mint rejection, connection cancellation, malformed grants, and cleanup.
Test provider-side turn detection separately from browser VAD. Record real
microphone, speech, interruption, and expiry tests separately from local mocks.

## Troubleshoot

`serverVad` configures provider-side detection, not LiveKit browser VAD. The
`transcript-confirmed` mode requires transcription. Optional greeting synthesis
returns WAV bytes; playback stays adapter-owned. Inspect installed declarations
before assuming an option exists in a different release.
