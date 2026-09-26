import { describe, expect, test } from 'bun:test';
import {
  type PromptEntry,
  promptLabel,
  promptRoutes,
  sortPrompts,
} from '../prompt-presentation';

const records: PromptEntry[] = [
  {
    id: 'z-prompt',
    data: {
      metadata: {
        id: 'z-prompt',
        prompt_version: '2.1.0',
        compatibility: { sdk: { '@maelstrom-co/react': '^1.0.0' } },
      },
      body: 'Raw body.\n',
      filename: 'canonical-z.md',
    },
  },
  {
    id: 'a-prompt',
    data: {
      metadata: {
        id: 'a-prompt',
        prompt_version: '1.0.0',
        compatibility: { sdk: { '@maelstrom-co/react': '^1.0.0' } },
      },
      body: 'Another body.\n',
      filename: 'canonical-a.md',
    },
  },
];

describe('prompt presentation data', () => {
  test('sorts index entries by stable ID without changing canonical fields', () => {
    const sorted = sortPrompts(records);
    expect(sorted.map(({ id }) => id)).toEqual(['a-prompt', 'z-prompt']);
    expect(sorted[1].data.metadata.prompt_version).toBe('2.1.0');
    expect(sorted[1].data.body).toBe('Raw body.\n');
    expect(sorted[1].data.filename).toBe('canonical-z.md');
    expect(records[0].id).toBe('z-prompt');
  });

  test('creates one stable ID route per current prompt, with unchanged source data', () => {
    const routes = promptRoutes(records);
    expect(routes.map(({ params }) => params.id)).toEqual([
      'z-prompt',
      'a-prompt',
    ]);
    expect(routes[0].props.entry.data).toBe(records[0].data);
    expect(routes[0].props.entry.data.body).toBe('Raw body.\n');
  });

  test('uses UI labels only for presentation and falls back to the stable ID', () => {
    expect(promptLabel('maelstrom-debugging')).toBe('Debug a Maelstrom issue');
    expect(promptLabel('new-prompt')).toBe('new-prompt');
  });
});
