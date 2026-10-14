# Turn-taking is provider-neutral

Deciding when a user's turn starts and ends is split three ways: the **detector** is provider-neutral (`@maelstrom-co/realtime-vad` — a `MediaStream` in, speech edges out, and it never acquires a microphone), the **policy** lives in the provider-neutral core (`TurnMode`, `TurnModeEvent`), and the **reaction** to a speech edge belongs to each adapter, because only the adapter knows what its transport does with idle audio. Running Silero over microphone audio is not provider-shaped, so leaving the detector inside the LiveKit adapter meant `TurnMode` was neutral in name while only one adapter could ever produce it.

Turn mode is a **runtime event, not a static provider capability**. Browser VAD can fail to initialise or fail mid-session and degrade to hold-to-talk, so an adapter reports its usable mode through `TurnModeEvent` on the same event stream it uses for everything else, and `RealtimeSession` exposes manual controls only while the retained mode is `manual`. Encoding it as a fixed per-provider flag could not express that degradation.

## Considered options

- **A static `turnTaking: 'server-vad' | 'push-to-talk'` discriminant on the adapter.** Rejected once browser VAD landed: a provider's turn mode is not fixed at build time, and a static flag would have made runtime degradation unrepresentable.
- **Normalise turn control across every provider**, giving speech-native adapters real `startTurn`/`endTurn` so the UI never branches. Deferred rather than rejected — it is a genuine improvement, but disabling OpenAI's tuned server-side turn detection in favour of local endpointing is a live-API question that cannot be settled from the codebase or with mocks.

## Consequences

LiveKit uses the neutral detector for ordinary turns. OpenAI Realtime also consumes it through the optional, default-off `greetingInterruption` capability: local VAD can accept one interruption during fixed-greeting playback, with bounded pre-roll. The demo enables this experiment. After the greeting settles, OpenAI server VAD still owns ordinary turn detection and responses; the option adds neither manual `turnControl` nor LiveKit-style endpointing. Two adapters now reuse the detector, but general OpenAI browser-owned endpointing and real-device acoustic effectiveness are not established. See the [OpenAI greeting-interruption guide](https://docs.maelstrom-ai.co/guides/voice/openai-realtime/#configure-experimental-greeting-interruption).
