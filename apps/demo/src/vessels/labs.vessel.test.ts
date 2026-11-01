import { readFileSync } from 'node:fs';
import { VariantName, VesselSchema } from '@maelstrom-co/protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT } from '../lib/default-layout';
import { labsEntry, labsVessel } from './labs.vessel';

describe('Labs Vessel contract', () => {
  it('declares Chart-owned navigation and a required marker enum only in trends', () => {
    const parsed = VesselSchema.parse(labsVessel);
    expect(parsed.id).toBe('labs');
    expect(parsed.defaultVariant).toBe('trends');
    expect(Object.keys(parsed.variants)).toEqual(['list', 'trends']);
    expect(parsed.variants[VariantName('list')].actions).toMatchObject([
      { name: 'showTrends', transitionsTo: 'trends' },
    ]);
    expect(parsed.variants[VariantName('trends')].actions).toMatchObject([
      { name: 'showList', transitionsTo: 'list' },
      {
        name: 'selectMarker',
        parameters: [
          {
            name: 'markerSlug',
            type: 'string',
            required: true,
            enum: ['hemoglobin', 'platelets', 'glucose'],
          },
        ],
      },
    ]);
    expect(
      parsed.variants[VariantName('trends')].actions[1].transitionsTo,
    ).toBeUndefined();
    expect(parsed.description).toContain('No lab results or trend data');
    expect(parsed.description).toContain(
      'Use `labs-main` for the primary Instance ID; use a distinct ID for any additional Labs Instance',
    );
    expect(labsEntry.vessel).toBe(labsVessel);
  });

  it('offers an empty default view without retrieval, analysis or clinical claims', () => {
    const parsed = VesselSchema.parse(labsVessel);
    expect(parsed.defaultVariant).toBe('trends');
    expect(parsed.description).toContain(
      'Requests to open or add the Labs panel can display its empty default trends view',
    );
    expect(parsed.description).toContain(
      'No lab results or trend data are available; explain this limitation when opening the panel',
    );
    expect(parsed.description).toContain(
      'Opening the panel does not retrieve or analyze results',
    );
    expect(parsed.description).toContain(
      'never claim measurements, trends or medical advice',
    );
  });

  it('is registered for discovery without changing the default Chart', () => {
    const source = readFileSync(
      new URL('../lib/maelstrom.ts', import.meta.url),
      'utf8',
    );
    expect(source).toContain(
      "import { labsEntry } from '../vessels/labs.vessel'",
    );
    expect(source).toMatch(
      /const vessels = \[[\s\S]*?\blabsEntry,\s*\] as const/,
    );
    expect(
      DEFAULT_LAYOUT.instances.map(({ vesselId }) => vesselId),
    ).not.toContain('labs');
  });
});
