---
editUrl: false
next: false
prev: false
title: "default"
---

> **default**: `AgentDefinition`\<`Record`\<`string`, `unknown`\>\>

Defined in: packages/realtime-livekit-agent/src/agent.ts:537

Default export is the agent definition itself: LiveKit's worker re-imports the
file named in `ServerOptions.agent` and reads its default export, so this must
be the agent — `runVoiceAgent` points `agent` at this same compiled module.
