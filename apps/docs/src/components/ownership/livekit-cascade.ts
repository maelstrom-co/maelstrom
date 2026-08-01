import type { OwnershipModel } from './types';

/**
 * Runtime ownership for the LiveKit cascade guide.
 *
 * Two claims drive the layout. The media arc leaves the browser for the LiveKit
 * room over the top of the server band, so audio visibly does not pass through
 * the application server. And nothing connects the worker to the Engine: every
 * transcript returns through the browser as ordinary intent, which is why the
 * Engine stays the only planning model.
 *
 * Four bands, because the worker is yours to deploy and sits on the far side of
 * a room you may not operate.
 */
export const LIVEKIT_CASCADE_OWNERSHIP: OwnershipModel = {
  stage: { w: 1000, h: 500 },
  summary:
    'Your server runs a mint route that holds the LiveKit API secret and returns a short-lived room grant to the browser. The browser then carries audio to a LiveKit room over the top of your server rather than through it, and a separately deployed worker does speech-to-text and text-to-speech against that room. The worker never reaches the Engine: transcripts return through the browser as ordinary intent.',
  bands: [
    { id: 'browser', label: 'Browser', tone: 'yours', x: 0, width: 240 },
    { id: 'server', label: 'Your server', tone: 'yours', x: 240, width: 305 },
    { id: 'livekit', label: 'LiveKit', tone: 'theirs', x: 545, width: 185 },
    { id: 'worker', label: 'Your worker', tone: 'yours', x: 730, width: 270 },
  ],
  nodes: [
    {
      id: 'browser',
      label: 'Voice session',
      tone: 'yours',
      detail: 'RealtimeSession, the LiveKit adapter, useVoice',
      lifetime: 'Lives with the page',
      x: 100,
      y: 270,
      w: 180,
      h: 136,
    },
    {
      id: 'route',
      label: 'Mint route',
      tone: 'yours',
      detail: 'Authenticates, scopes the room, signs',
      holds: 'LIVEKIT_API_SECRET',
      lifetime: 'Ends after each request',
      x: 420,
      y: 225,
      w: 235,
      h: 124,
    },
    {
      id: 'engine',
      label: 'Engine',
      tone: 'yours',
      detail: 'The only planning model',
      x: 410,
      y: 410,
      w: 230,
      h: 92,
    },
    {
      id: 'room',
      label: 'LiveKit room',
      tone: 'theirs',
      detail: 'Relays audio and transcripts',
      lifetime: 'Cloud or self-hosted',
      x: 637,
      y: 295,
      w: 175,
      h: 124,
    },
    {
      id: 'worker',
      label: 'Voice worker',
      tone: 'yours',
      detail: 'Deepgram STT, Cartesia TTS. No model, no UI grounding.',
      holds: 'Deepgram and Cartesia keys',
      lifetime: 'Long-running',
      x: 880,
      y: 295,
      w: 230,
      h: 148,
    },
  ],
  edges: [
    {
      id: 'grant',
      from: 'route',
      to: 'browser',
      kind: 'grant',
      label: 'Room grant',
    },
    {
      id: 'media',
      from: 'browser',
      to: 'room',
      kind: 'media',
      label: 'Audio and session data',
      direction: 'both',
      arc: -70,
    },
    {
      // Unlabelled: two neighbours with no room between them for text. What
      // crosses here is on both cards already.
      id: 'worker-media',
      from: 'room',
      to: 'worker',
      kind: 'media',
      direction: 'both',
    },
    {
      id: 'intent',
      from: 'browser',
      to: 'engine',
      kind: 'intent',
      label: 'Intent and plan',
      direction: 'both',
      labelDy: 8,
    },
  ],
};
