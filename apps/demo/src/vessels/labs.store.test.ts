import { isErr, isOk } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { createLabsActionRunner, getLabsSelection } from './labs.store';

let serial = 0;
const id = () => `labs-store-test-${serial++}`;

describe('Labs selection handlers', () => {
  it('accepts each marker, is idempotent and isolates instance selections', () => {
    const first = id();
    const second = id();
    const runner = createLabsActionRunner(first);
    expect(getLabsSelection(first)).toBeNull();
    for (const markerSlug of ['hemoglobin', 'platelets', 'glucose']) {
      expect(isOk(runner.selectMarker({ markerSlug }))).toBe(true);
      expect(isOk(runner.selectMarker({ markerSlug }))).toBe(true);
      expect(getLabsSelection(first)).toBe(markerSlug);
      expect(getLabsSelection(second)).toBeNull();
    }
    expect(isOk(runner.showList())).toBe(true);
    expect(isOk(runner.showTrends())).toBe(true);
    expect(getLabsSelection(first)).toBe('glucose');
    expect(
      isOk(
        createLabsActionRunner(second).selectMarker({
          markerSlug: 'platelets',
        }),
      ),
    ).toBe(true);
    expect(getLabsSelection(first)).toBe('glucose');
    expect(getLabsSelection(second)).toBe('platelets');
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { markerSlug: 1 },
    { markerSlug: null },
    { markerSlug: 'unknown' },
    { markerSlug: 'Hemoglobin' },
    { markerSlug: 'hemoglobin ' },
    { markerSlug: ['hemoglobin'] },
    { markerSlug: 'hemoglobin', extra: true },
  ])('rejects invalid parameters without mutation %#', (params) => {
    const instanceId = id();
    const runner = createLabsActionRunner(instanceId);
    runner.selectMarker({ markerSlug: 'glucose' });
    expect(isErr(runner.selectMarker(params))).toBe(true);
    expect(getLabsSelection(instanceId)).toBe('glucose');
  });
});
