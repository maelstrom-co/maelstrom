// Boots the LiveKit voice agent as a standalone worker process alongside the
// app (see the `dev:agent` script). Kept as a thin entry so `--env-file` loads
// the LiveKit/Deepgram/Cartesia secrets before the worker registers.
import { runVoiceAgent } from '@maelstrom-co/realtime-livekit-agent';

runVoiceAgent();
