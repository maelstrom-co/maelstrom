import type { OwnershipModel } from './types';

/**
 * Who decides where a turn begins, and what the transport is allowed to carry.
 *
 * The deployment picture is the cascade guide's diagram; this one zooms into the
 * browser, because the claim here is narrower and easier to get wrong. A local
 * stream feeds the detector continuously, and the publication to the room stays
 * paused until the detector accepts speech. The struck path is the point: an
 * idle microphone never reaches the transport at all, so "we only send audio
 * during a turn" is a property of the wire rather than a promise about
 * behaviour.
 */
export const LIVEKIT_TURN_OWNERSHIP: OwnershipModel = {
  stage: { w: 1000, h: 460 },
  summary:
    'A local microphone stream feeds browser voice activity detection continuously, and the detector decides what counts as a turn. Only accepted speech opens the publication to the LiveKit room, which carries it to the speech-to-text worker. Idle microphone audio has no path to the room: while no turn is open, the publication is paused, so nothing the detector has not accepted reaches the transport.',
  bands: [
    { id: 'browser', label: 'Browser', tone: 'yours', x: 0, width: 560 },
    { id: 'livekit', label: 'LiveKit', tone: 'theirs', x: 560, width: 200 },
    { id: 'worker', label: 'Your worker', tone: 'yours', x: 760, width: 240 },
  ],
  nodes: [
    {
      id: 'mic',
      label: 'Microphone',
      tone: 'yours',
      detail: 'One local stream, always available to the detector',
      x: 110,
      y: 140,
      w: 190,
      h: 110,
    },
    {
      id: 'gate',
      label: 'VAD and pre-roll',
      tone: 'yours',
      detail:
        'Decides what counts as a turn, and holds the publication paused until it does',
      x: 350,
      y: 140,
      w: 225,
      h: 130,
    },
    {
      id: 'room',
      label: 'LiveKit room',
      tone: 'theirs',
      detail: 'Carries accepted turn audio',
      x: 660,
      y: 340,
      w: 175,
      h: 115,
    },
    {
      id: 'worker',
      label: 'Speech-to-text',
      tone: 'yours',
      detail: 'Sees only what the browser admitted',
      x: 880,
      y: 340,
      w: 215,
      h: 125,
    },
  ],
  edges: [
    {
      // Unlabelled: 32 units of gap holds no text, and both cards already say
      // what passes between them.
      id: 'local',
      from: 'mic',
      to: 'gate',
      kind: 'media',
    },
    {
      id: 'accepted',
      from: 'gate',
      to: 'room',
      kind: 'media',
      label: 'Pre-roll, then the turn',
      labelDx: 74,
      labelDy: -8,
    },
    {
      // Unlabelled: the two cards already say what passes between them, and the
      // gap holds no text.
      id: 'relay',
      from: 'room',
      to: 'worker',
      kind: 'media',
    },
    {
      // The point of the drawing. Arced over the detector rather than through
      // it: a straight run would cross the very card that makes the claim true.
      id: 'idle',
      from: 'mic',
      to: 'room',
      kind: 'blocked',
      label: 'Idle microphone audio',
      arc: -140,
      labelDy: -8,
    },
  ],
};
