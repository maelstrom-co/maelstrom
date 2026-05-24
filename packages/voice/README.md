# @maelstrom-co/voice

Browser voice runtime for Maelstrom. This package provides microphone capture, audio playback, and browser-side VAD (Voice Activity Detection) used by voice-enabled Maelstrom apps.

## Install

```bash
bun add @maelstrom-co/voice
```

For React apps, install the extension package as well:

```bash
bun add @maelstrom-co/react-voice @maelstrom-co/voice
```

For full end-to-end voice (STT + engine handoff + TTS), pair the browser package with `@maelstrom-co/voice-server` on your backend runtime.

## Docs

- Voice quickstart: https://docs.maelstrom-ai.co/tutorials/voice-control/
- Voice integration guide: https://docs.maelstrom-ai.co/guides/voice/voice-integration/
- Voice architecture: https://docs.maelstrom-ai.co/understanding/voice-architecture/
