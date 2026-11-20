import { describe, expect, test } from 'bun:test';

import { vesselOnlyShows } from './vessel-only-shows.js';
import type { Vessel, VesselActionDefinition } from './vessel.js';
import { validateVessel } from './vessel.js';

describe('vesselOnlyShows', () => {
  test('is true when no Variant offers an Action', () => {
    expect(vesselOnlyShows(parse({ summary: [] }))).toBe(true);
  });

  test('is true when every Action has effect none', () => {
    expect(
      vesselOnlyShows(
        parse({
          summary: [showDetail],
          detail: [showSummary],
        }),
      ),
    ).toBe(true);
  });

  test('is false when one Action is idempotent', () => {
    expect(
      vesselOnlyShows(
        parse({
          summary: [
            showDetail,
            { name: 'refresh', description: 'Reload', effect: 'idempotent' },
          ],
          detail: [],
        }),
      ),
    ).toBe(false);
  });

  test('is false when one Action omits its effect, which parses to any', () => {
    expect(
      vesselOnlyShows(
        parse({
          summary: [{ name: 'addItem', description: 'Add an item' }],
        }),
      ),
    ).toBe(false);
  });

  test('checks Actions in every Variant, not only the default', () => {
    expect(
      vesselOnlyShows(
        parse({
          summary: [showDetail],
          detail: [
            showSummary,
            { name: 'buy', description: 'Buy it', effect: 'any' },
          ],
        }),
      ),
    ).toBe(false);
  });
});

const showDetail: VesselActionDefinition = {
  name: 'showDetail',
  description: 'Show the detail view',
  transitionsTo: 'detail',
  effect: 'none',
};

const showSummary: VesselActionDefinition = {
  name: 'showSummary',
  description: 'Show the summary view',
  transitionsTo: 'summary',
  effect: 'none',
};

function parse(
  actionsByVariant: Record<string, readonly VesselActionDefinition[]>,
): Vessel {
  const names = Object.keys(actionsByVariant);
  const variants = Object.fromEntries(
    ['summary', 'detail'].map((name) => [
      name,
      {
        props: {},
        minSize: { width: 1, height: 1 },
        actions: [...(actionsByVariant[name] ?? [])],
      },
    ]),
  );
  const result = validateVessel({
    id: 'item',
    name: 'Item',
    description: 'An item',
    defaultVariant: names[0] ?? 'summary',
    variants,
  });
  if (!result.valid) throw new Error(JSON.stringify(result.issues));
  return result.vessel;
}
