import type { OwnershipModel } from './types';

/**
 * The one claim the voice-architecture page exists to make: a voice model's
 * picture of the interface never reaches the Engine.
 *
 * Prose can assert an absence; a drawing can show it. The struck-through path
 * from the voice model to the Engine is the argument, and everything else on
 * the stage is there to give that strike something to contradict.
 *
 * The read path underneath is what keeps that strike from overclaiming. Without
 * it the drawing says the model is cut off, when what it is actually cut off
 * from is deciding.
 */
export const VOICE_BOUNDARY: OwnershipModel = {
  stage: { w: 1000, h: 440 },
  summary:
    'A voice model exchanges audio with the person and sends natural-language intent into the browser. The Maelstrom client attaches the current Chart snapshot and sends both to the Engine. Structure travels back out to the voice model as read-only summaries and snapshots. But the voice model has no path to the Engine: its transcripts, audio, and picture of the interface never become planning input.',
  bands: [
    {
      id: 'provider',
      label: 'Voice provider',
      tone: 'theirs',
      x: 0,
      width: 280,
    },
    { id: 'browser', label: 'Browser', tone: 'yours', x: 280, width: 500 },
    { id: 'server', label: 'Your server', tone: 'yours', x: 780, width: 220 },
  ],
  nodes: [
    {
      id: 'voice',
      label: 'Voice model',
      tone: 'theirs',
      detail: 'Speech in, speech out. Holds its own picture of the screen.',
      x: 145,
      y: 130,
      w: 240,
      h: 120,
    },
    {
      id: 'session',
      label: 'RealtimeSession',
      tone: 'yours',
      detail: 'Pushes structure out. Takes one thing back: an update_ui intent',
      x: 400,
      y: 310,
      w: 215,
      h: 115,
    },
    {
      id: 'client',
      label: 'Maelstrom client',
      tone: 'yours',
      detail: 'Builds the Chart snapshot: Instances, Variants, dimensions',
      x: 645,
      y: 310,
      w: 215,
      h: 115,
    },
    {
      id: 'engine',
      label: 'Engine',
      tone: 'yours',
      detail: 'Plans from the snapshot, and from nothing else',
      x: 890,
      y: 130,
      w: 200,
      h: 110,
    },
  ],
  edges: [
    {
      id: 'intent',
      from: 'voice',
      to: 'session',
      kind: 'intent',
      label: 'Natural-language intent',
      labelDx: -46,
      labelDy: 8,
    },
    {
      // Arced under the cards so it does not lie on top of the intent edge it
      // answers. The pair reads as one exchange with two unequal halves: a
      // sentence goes in, structure comes back, and only the sentence plans.
      id: 'read',
      from: 'session',
      to: 'voice',
      kind: 'context',
      label: 'Structure, read-only',
      arc: 470,
      labelDy: 12,
    },
    {
      // Unlabelled: 30 units of gap holds no text, and both cards already say
      // what passes between them.
      id: 'submit',
      from: 'session',
      to: 'client',
      kind: 'intent',
    },
    {
      id: 'plan',
      from: 'client',
      to: 'engine',
      kind: 'intent',
      label: 'Intent + Chart snapshot',
      direction: 'both',
      labelDx: -30,
      labelDy: -6,
    },
    {
      // The point of the whole drawing.
      id: 'grounding',
      from: 'voice',
      to: 'engine',
      kind: 'blocked',
      // Not "grounding": that is real, and flows the other way. Naming it here
      // would claim the model is starved of structure, when the page's actual
      // argument is that it is fed structure and still cannot plan with it.
      label: 'Transcripts, audio, model belief',
      labelDy: -34,
    },
  ],
};
