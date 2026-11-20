---
editUrl: false
next: false
prev: false
title: "runVoiceAgent"
---

> **runVoiceAgent**(): `void`

Defined in: packages/realtime-livekit-agent/src/agent.ts:568

Boots the agent as a standalone worker process, separate from the application
server that mints browser room tokens.

Reads LiveKit connection config from the environment, so call it from a thin
entry that has already loaded `.env`. An invalid drain timeout or derived
pending-audio budget rejects before `cli.runApp`, so a worker can never start
with an unsafe cap and discover it mid-turn.

`ServerOptions.agent` is set to this module's own resolved path, because the
LiveKit CLI re-spawns the agent per job and needs a file it can import. That
makes the path an invariant rather than a detail: this module must remain
importable from disk at the location it was loaded from, which is why it is
derived from `import.meta.url` and not from the caller's entry file.

## Returns

`void`

## Example

```js
// voice-worker.mjs
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

runVoiceAgent();
```

Then start it with the LiveKit worker CLI verb:

```bash
node --env-file=.env voice-worker.mjs start
```
