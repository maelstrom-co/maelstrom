# Realtime providers come in two kinds

A LiveKit voice integration needs four packages where an OpenAI one needs two, which reads as a lopsided integration. It isn't: OpenAI and Gemini Live are **speech-native** providers that own speech recognition, the model, speech synthesis, and turn detection behind a single connection, while LiveKit is a **cascade** provider — transport only, with no model in it, so the speech pipeline must be supplied and run as a server-side worker. We name both kinds rather than forcing one package count on them, and apply a single uniform rule underneath: every provider ships `realtime-<provider>` (browser adapter) and `realtime-<provider>-server` (credential minter), with a cascade provider additionally shipping `realtime-<provider>-agent` (the worker) and a wire contract shared by both ends.

The corollary rule is that **contracts are subpaths, implementations are packages**. A provider's wire contract — its credential shape, its room topics — is a zero-dependency subpath of `@maelstrom-co/realtime-protocol`. Its implementation is always its own package, so importing one provider never drags another's SDK weight along.

Provider packages are created when the adapter is written, never reserved in advance. The `@maelstrom-co` scope is owned, so there is no name to squat, and an empty published package reads as abandonware. This is why the previously reserved `@maelstrom-co/realtime/google` stub was deleted rather than promoted.

## Considered options

- **Force every provider to the same package count**, folding LiveKit's worker into its server package. Rejected: a long-lived STT/TTS worker process and a request-scoped token minter have genuinely different runtime shapes and dependency weight, and merging them would make "server" mean two unrelated things.
- **Keep adapters as subpaths of the core** (`@maelstrom-co/realtime/openai`, `/livekit`). Rejected: it relies on bundler subpath tree-shaking to keep a browser WebRTC SDK out of applications that never use it, and makes `peerDependencies` incoherent on a single package serving several providers.

## Consequences

The realtime family grows from six packages to eleven. That cost is accepted deliberately: the alternative is a smaller package count whose boundaries do not correspond to how the code actually runs. Adding a speech-native provider is a two-package operation; adding a cascade provider is four.
