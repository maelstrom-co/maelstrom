import { expect, it } from 'vitest';

import { createSemanticEvidence } from './semantic-evidence';

it('waits for committed source order, then combines split final evidence without duplicating finals', () => {
  const evidence = createSemanticEvidence('take', 'connection');
  evidence.accept({
    type: 'committed',
    event: { itemId: 'a', previousItemId: null },
  });
  evidence.accept({
    type: 'committed',
    event: { itemId: 'b', previousItemId: 'a' },
  });
  const finalB = {
    type: 'completed' as const,
    event: {
      itemId: 'b',
      contentIndex: 0,
      previousItemId: 'a',
      transcript: 'That contains the impact, and we can roll back quickly.',
    },
  };
  evidence.accept(finalB);
  expect(evidence.getSnapshot().items).toMatchObject([
    { itemId: 'a', parts: [] },
    { itemId: 'b', parts: [{ transcript: finalB.event.transcript }] },
  ]);
  evidence.accept({
    type: 'completed',
    event: {
      itemId: 'a',
      contentIndex: 0,
      previousItemId: null,
      transcript: 'We will release to a small group first.',
    },
  });
  const snapshot = evidence.getSnapshot();
  expect(snapshot.items.map((item) => item.parts[0]?.transcript)).toEqual([
    'We will release to a small group first.',
    finalB.event.transcript,
  ]);
  evidence.accept(finalB);
  expect(evidence.getSnapshot()).toBe(snapshot);
});

it('evicts oldest whole speech items by source order and Unicode budget, never reviving late evicted finals', () => {
  const evidence = createSemanticEvidence('take', 'connection');
  for (let i = 0; i < 6; i++)
    evidence.accept({
      type: 'committed',
      event: { itemId: `${i}`, previousItemId: i ? `${i - 1}` : null },
    });
  evidence.accept({
    type: 'completed',
    event: {
      itemId: '0',
      contentIndex: 0,
      previousItemId: null,
      transcript: 'Late and evicted',
    },
  });
  expect(evidence.getSnapshot().items.map((item) => item.itemId)).toEqual([
    '2',
    '3',
    '4',
    '5',
  ]);
  evidence.accept({
    type: 'completed',
    event: {
      itemId: '4',
      contentIndex: 0,
      previousItemId: '3',
      transcript: '😀'.repeat(4000),
    },
  });
  evidence.accept({
    type: 'completed',
    event: {
      itemId: '5',
      contentIndex: 0,
      previousItemId: '4',
      transcript: '😀'.repeat(4000),
    },
  });
  expect(
    evidence
      .getSnapshot()
      .items.slice(-2)
      .every((item) => item.parts[0]?.transcript?.length === 8000),
  ).toBe(true);
  evidence.accept({
    type: 'completed',
    event: {
      itemId: '5',
      contentIndex: 1,
      previousItemId: '4',
      transcript: 'tail',
    },
  });
  expect(
    evidence.getSnapshot().items.find((item) => item.itemId === '4')?.parts,
  ).toEqual([]);
  evidence.accept({
    type: 'completed',
    event: {
      itemId: '4',
      contentIndex: 0,
      previousItemId: '3',
      transcript: 'Late re-delivery',
    },
  });
  expect(
    evidence.getSnapshot().items.find((item) => item.itemId === '4')?.parts,
  ).toEqual([]);
});

it('waits for metadata, preserves failed and changed-final gaps, and excludes oversized items without truncation', () => {
  const evidence = createSemanticEvidence('take', 'connection');
  const complete = (itemId: string, transcript: string, contentIndex = 0) =>
    evidence.accept({
      type: 'completed',
      event: { itemId, contentIndex, previousItemId: undefined, transcript },
    });
  complete('b', 'Rollback quickly');
  expect(evidence.getSnapshot().items).toEqual([]);
  evidence.accept({
    type: 'committed',
    event: { itemId: 'b', previousItemId: 'a' },
  });
  expect(evidence.getSnapshot().items).toEqual([]);
  evidence.accept({
    type: 'committed',
    event: { itemId: 'a', previousItemId: null },
  });
  complete('a', 'Release to a few people');
  complete('a', 'Conflicting revised final');
  expect(evidence.getSnapshot().items[0]?.parts).toEqual([
    { contentIndex: 0, status: 'uncertain' },
  ]);
  complete('a', 'Release to a few people');
  expect(evidence.getSnapshot().items[0]?.parts[0]?.status).toBe('uncertain');
  evidence.accept({
    type: 'committed',
    event: { itemId: 'c', previousItemId: 'b' },
  });
  evidence.accept({
    type: 'failed',
    event: { itemId: 'c', contentIndex: 0, previousItemId: 'b' },
  });
  complete('c', 'Cannot repair a failed source by contradictory completion');
  expect(evidence.getSnapshot().items[2]?.parts[0]?.transcript).toBeUndefined();
  evidence.accept({
    type: 'committed',
    event: { itemId: 'd', previousItemId: 'c' },
  });
  complete('d', 'x'.repeat(8001));
  expect(evidence.getSnapshot().items[3]?.parts).toEqual([]);
  complete('d', 'Oversized cannot revive');
  expect(evidence.getSnapshot().items[3]?.parts).toEqual([]);
});

it('retains distinct repeated utterances and isolates connection identities', () => {
  const first = createSemanticEvidence('take', 'one');
  const second = createSemanticEvidence('take', 'two');
  for (const [itemId, previousItemId] of [
    ['a', null],
    ['b', 'a'],
  ] as const) {
    first.accept({ type: 'committed', event: { itemId, previousItemId } });
    first.accept({
      type: 'completed',
      event: {
        itemId,
        previousItemId,
        contentIndex: 0,
        transcript: 'Small release first.',
      },
    });
  }
  expect(first.getSnapshot().items).toHaveLength(2);
  expect(second.getSnapshot()).toMatchObject({
    connectionId: 'two',
    items: [],
  });
});

it('bounds finals waiting for ordering metadata and never revives their conservatively excluded text', () => {
  const evidence = createSemanticEvidence('take', 'connection');
  for (let i = 0; i < 6; i++)
    evidence.accept({
      type: 'completed',
      event: {
        itemId: `${i}`,
        previousItemId: undefined,
        contentIndex: 0,
        transcript: `${i}`.repeat(4000),
      },
    });
  for (let i = 0; i < 6; i++)
    evidence.accept({
      type: 'committed',
      event: { itemId: `${i}`, previousItemId: i ? `${i - 1}` : null },
    });
  expect(
    evidence
      .getSnapshot()
      .items.map((item) => item.parts[0]?.transcript?.slice(0, 1)),
  ).toEqual([undefined, undefined, '4', '5']);
  evidence.accept({
    type: 'completed',
    event: {
      itemId: '2',
      previousItemId: '1',
      contentIndex: 0,
      transcript: 'Short late replacement',
    },
  });
  expect(evidence.getSnapshot().items[0]?.parts).toEqual([]);
});
