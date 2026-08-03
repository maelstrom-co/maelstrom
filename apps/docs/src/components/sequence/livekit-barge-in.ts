import type { SequenceModel } from './types';

/**
 * What happens when someone talks over the assistant.
 *
 * The order is the argument. Every step that stops something happens in the
 * browser first, and the message asking the worker to stop goes out after the
 * browser has already gone quiet — so a cancellation that is slow, or lost,
 * costs nothing the user can hear. Drawn in the wrong order this would claim
 * the opposite: that the user waits on a network round trip to be heard.
 *
 * Grounded in `#startTransportTurn` and `#endTransportTurn` in
 * `packages/realtime-livekit/src/livekit-adapter.ts`.
 */
export const LIVEKIT_BARGE_IN: SequenceModel = {
  summary:
    'A user speaks over the assistant. Browser voice activity detection accepts the speech and tells the adapter. The adapter mutes assistant playback locally, invalidates the utterance it was playing, and only then asks the worker to cancel speech synthesis, which is best effort. It resumes upstream audio, sends the retained pre-roll, and live audio continues to the worker. At speech end the adapter pauses upstream audio and asks the worker to finalize recognition, which returns one final transcript.',
  participants: [
    { id: 'user', label: 'User', tone: 'yours' },
    { id: 'vad', label: 'Browser VAD', tone: 'yours' },
    { id: 'adapter', label: 'LiveKitAdapter', tone: 'yours' },
    { id: 'playback', label: 'Browser playback', tone: 'yours' },
    // `yours`: the cascade's worker is a process the application deploys and
    // credentials, and the ownership diagrams already put it in a "Your worker"
    // band. A dashed card here would contradict them on the same page.
    { id: 'worker', label: 'STT/TTS worker', tone: 'yours' },
  ],
  steps: [
    {
      id: 'speak',
      from: 'user',
      to: 'vad',
      kind: 'media',
      label: 'Starts speaking',
    },
    {
      id: 'accept',
      from: 'vad',
      to: 'adapter',
      kind: 'intent',
      label: 'Speech accepted',
    },
    {
      // First, and local. Everything that follows can be slow without the user
      // hearing the assistant talk over them.
      id: 'mute',
      from: 'adapter',
      to: 'playback',
      kind: 'halt',
      label: 'Mute assistant audio',
    },
    {
      // Before the cancel goes out, not after: the worker may report the old
      // utterance complete anyway, and this is what makes that report ignorable.
      id: 'invalidate',
      from: 'adapter',
      to: 'adapter',
      kind: 'halt',
      label: 'Drop the utterance id',
      withPrevious: true,
    },
    {
      // Deliberately not grouped with the two local steps. They are synchronous
      // browser work; this is a publish the adapter awaits afterwards. Sharing
      // their number would erase the ordering this whole drawing exists to show.
      id: 'cancel',
      from: 'adapter',
      to: 'worker',
      kind: 'halt',
      label: 'Cancel speech, best effort',
    },
    {
      id: 'preroll',
      from: 'adapter',
      to: 'worker',
      kind: 'media',
      label: 'Open upstream, send retained pre-roll',
    },
    {
      id: 'live',
      from: 'user',
      to: 'worker',
      kind: 'media',
      label: 'Live turn audio',
    },
    {
      id: 'end',
      from: 'vad',
      to: 'adapter',
      kind: 'intent',
      label: 'Speech end',
    },
    {
      id: 'flush',
      from: 'adapter',
      to: 'worker',
      kind: 'intent',
      label: 'Pause upstream, finalize recognition',
    },
    {
      id: 'transcript',
      from: 'worker',
      to: 'adapter',
      kind: 'intent',
      label: 'One final transcript',
    },
  ],
};
