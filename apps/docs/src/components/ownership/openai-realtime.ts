import type { OwnershipModel } from './types';

/**
 * Runtime ownership for the OpenAI Realtime guide.
 *
 * The whole point of the drawing is the media arc: audio leaves the browser for
 * OpenAI over the top of the server band, never through it. Coordinates are
 * tuned so that arc clears the mint route's card, and so no label lands on one.
 */
export const OPENAI_REALTIME_OWNERSHIP: OwnershipModel = {
  stage: { w: 1000, h: 470 },
  summary:
    'Your server runs a mint route that holds the OpenAI API key and returns a short-lived credential to the browser. The browser then carries audio and session data directly to a long-running OpenAI session, over the top of your server rather than through it, and sends ordinary intents to the Engine.',
  bands: [
    { id: 'browser', label: 'Browser', tone: 'yours', x: 0, width: 330 },
    { id: 'server', label: 'Your server', tone: 'yours', x: 330, width: 350 },
    { id: 'openai', label: 'OpenAI', tone: 'theirs', x: 680, width: 320 },
  ],
  nodes: [
    {
      id: 'browser',
      label: 'Voice session',
      tone: 'yours',
      detail: 'RealtimeSession, the OpenAI adapter, useVoice',
      lifetime: 'Lives with the page',
      x: 130,
      y: 270,
      w: 220,
      h: 124,
    },
    {
      id: 'route',
      label: 'Mint route',
      tone: 'yours',
      detail: 'Authenticates the caller, then mints',
      holds: 'OPENAI_API_KEY',
      lifetime: 'Ends after each request',
      x: 530,
      y: 190,
      w: 250,
      h: 124,
    },
    {
      id: 'engine',
      label: 'Engine',
      tone: 'yours',
      detail: 'Unchanged by voice',
      x: 520,
      y: 372,
      w: 250,
      h: 92,
    },
    {
      id: 'openai',
      label: 'Realtime session',
      tone: 'theirs',
      detail: 'Model inference and turn detection',
      lifetime: 'Runs for the whole call',
      x: 845,
      y: 270,
      w: 250,
      h: 124,
    },
  ],
  edges: [
    {
      id: 'grant',
      from: 'route',
      to: 'browser',
      kind: 'grant',
      // Kept short so it fits on its own line between the two cards. Offsetting
      // it upward would park it nearer the media arc than the path it names.
      // "Short-lived" is the prose's job, and the prose is directly below.
      label: 'Client credential',
    },
    {
      id: 'media',
      from: 'browser',
      to: 'openai',
      kind: 'media',
      label: 'WebRTC audio and session data',
      direction: 'both',
      arc: -50,
    },
    {
      id: 'intent',
      from: 'browser',
      to: 'engine',
      kind: 'intent',
      label: 'Intent and plan',
      direction: 'both',
    },
  ],
};
