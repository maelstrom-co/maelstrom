---
editUrl: false
next: false
prev: false
title: "defineMaelstromVoiceAgent"
---

> **defineMaelstromVoiceAgent**(): `AgentDefinition`\<`Record`\<`string`, `unknown`\>\>

Defined in: packages/realtime-livekit-agent/src/agent.ts:528

Builds the Maelstrom voice agent definition (the LiveKit `defineAgent` job).
Kept as a factory so provider options (STT/TTS) can be threaded through later
without changing the module's default export.

## Returns

`AgentDefinition`\<`Record`\<`string`, `unknown`\>\>
