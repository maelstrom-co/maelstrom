# Turn-taking is provider-neutral

Deciding when a user's turn starts and ends is split three ways: the **detector** is provider-neutral (`@maelstrom-co/realtime-vad` — a `MediaStream` in, speech edges out, and it never acquires a microphone), the **policy** lives in the provider-neutral core (`TurnMode`, `TurnModeEvent`), and the **reaction** to a speech edge belongs to each adapter, because only the adapter knows what its transport does with idle audio. Running Silero over microphone audio is not provider-shaped, so leaving the detector inside the LiveKit adapter meant `TurnMode` was neutral in name while only one adapter could ever produce it.

Turn mode is a **runtime event, not a static provider capability**. Browser VAD can fail to initialise or fail mid-session and degrade to hold-to-talk, so an adapter reports its usable mode through `TurnModeEvent` on the same event stream it uses for everything else, and `RealtimeSession` exposes manual controls only while the retained mode is `manual`. Encoding it as a fixed per-provider flag could not express that degradation.

## Considered options

- **A static `turnTaking: 'server-vad' | 'push-to-talk'` discriminant on the adapter.** Rejected once browser VAD landed: a provider's turn mode is not fixed at build time, and a static flag would have made runtime degradation unrepresentable.
- **Normalise turn control across every provider**, giving speech-native adapters real `startTurn`/`endTurn` so the UI never branches. Deferred rather than rejected — it is a genuine improvement, but disabling OpenAI's tuned server-side turn detection in favour of local endpointing is a live-API question that cannot be settled from the codebase or with mocks.

## Consequences

Only LiveKit consumes the neutral detector today. OpenAI still relies entirely on its provider-side turn detection, so the neutrality is currently structural rather than demonstrated by two consumers. Wiring OpenAI to the neutral detector — and validating that local endpointing is not a regression against server-side detection — is tracked separately, and this ADR should be amended with the result.
