import { expect, it } from 'vitest';

import { createLiveTranscript } from './live-transcript.store';

it('retains text-free failed-part tombstones until clear without hiding displayed finals', () => {
  const transcript = createLiveTranscript();
  const identity = { itemId: 'a', contentIndex: 0, previousItemId: undefined };
  transcript.accept({ ...identity, transcript: 'Final' });
  transcript.accept(identity);
  transcript.accept({ ...identity, delta: 'Late' });
  expect(transcript.getSnapshot().map((part) => part.text)).toEqual(['Final']);
  transcript.accept({ ...identity, contentIndex: 1 });
  transcript.accept({ ...identity, contentIndex: 1, delta: 'Failed' });
  expect(transcript.getSnapshot()).toHaveLength(1);
  transcript.clear();
  transcript.accept({ ...identity, contentIndex: 1, delta: 'Fresh' });
  expect(transcript.getSnapshot().map((part) => part.text)).toEqual(['Fresh']);
});
