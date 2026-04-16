import { describe, expect, test } from 'bun:test';
import type { ChartRequest } from '@maelstrom-co/protocol-old';
import { buildPrompt, buildSystemPrompt } from './prompt-builder.js';
import { SystemSection, UserSection } from './sections.js';
import {
  makeGridRequest,
  makeTilingRequest,
} from '../__test-helpers__/fixtures.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  describe('grid mode', () => {
    test('produces system prompt with grid-specific content', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.systemPrompt).toContain('grid layout system');
      expect(result.systemPrompt).toContain('GRID LAYOUT SYSTEM');
      expect(result.systemPrompt).not.toContain('binary tree');
    });

    test('user prompt includes vessels section', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.userPrompt).toContain('## Registered Vessels');
      expect(result.userPrompt).toContain('calendar - Calendar');
      expect(result.userPrompt).toContain('month (default)');
    });

    test('user prompt includes grid chart state', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.userPrompt).toContain('Layout Mode: Grid');
      expect(result.userPrompt).toContain('12×8 cells');
      expect(result.userPrompt).toContain(
        'calendar-main: row=0, col=0, size=6×4',
      );
    });

    test('user prompt includes update triggers', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.userPrompt).toContain('User said: "Show me my calendar"');
    });

    test('serializes action with transition', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.userPrompt).toContain('showWeek');
      expect(result.userPrompt).toContain('→ week');
    });

    test('serializes action with parameters', () => {
      const request = makeGridRequest({
        vessels: [
          {
            id: 'orders',
            name: 'Orders',
            description: 'Order management',
            defaultVariant: 'list',
            variants: {
              list: {
                props: {},
                minSize: { width: 4, height: 4 },
                actions: [
                  {
                    name: 'selectOrder',
                    description: 'Select an order',
                    parameters: [
                      {
                        name: 'orderId',
                        type: 'string',
                        description: 'Order ID',
                      },
                    ],
                    transitionsTo: 'detail',
                  },
                ],
              },
              detail: {
                props: {},
                minSize: { width: 6, height: 4 },
                actions: [],
              },
            },
          },
        ],
      });
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('selectOrder(orderId: string)');
    });

    test('serializes action with enum parameter', () => {
      const request = makeGridRequest({
        vessels: [
          {
            id: 'table',
            name: 'Table',
            description: 'Data table',
            defaultVariant: 'default',
            variants: {
              default: {
                props: {},
                minSize: { width: 4, height: 4 },
                actions: [
                  {
                    name: 'sort',
                    description: 'Sort column',
                    parameters: [
                      {
                        name: 'direction',
                        type: 'string',
                        description: 'Sort direction',
                        enum: ['asc', 'desc'],
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      });
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('sort(direction: asc|desc)');
    });

    test('handles empty positions', () => {
      const request = makeGridRequest({
        layout: { type: 'grid', positions: [] },
        instances: [],
      });
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('No vessels currently positioned.');
    });
  });

  describe('tiling mode', () => {
    test('produces system prompt with tiling-specific content', () => {
      const result = buildPrompt(makeTilingRequest());
      expect(result.systemPrompt).toContain('tiling layout system');
      expect(result.systemPrompt).toContain('TILING LAYOUT SYSTEM');
      expect(result.systemPrompt).toContain('binary tree');
      expect(result.systemPrompt).not.toContain('GRID LAYOUT SYSTEM');
    });

    test('user prompt includes tiling chart state', () => {
      const result = buildPrompt(makeTilingRequest());
      expect(result.userPrompt).toContain('Layout Mode: Tiling (binary tree)');
      expect(result.userPrompt).toContain('Currently Visible:');
      expect(result.userPrompt).toContain(
        'calendar-main (calendar), variant: month',
      );
    });

    test('shows tiling tree preorder', () => {
      const result = buildPrompt(makeTilingRequest());
      expect(result.userPrompt).toContain('Preorder: ["calendar-main"]');
    });

    test('shows hidden instances separately from visible', () => {
      const request: ChartRequest = {
        ...makeTilingRequest(),
        instances: [
          {
            instanceId: 'calendar-main',
            vesselId: 'calendar',
            variant: 'month',
          },
          { instanceId: 'tasks-main', vesselId: 'calendar', variant: 'month' },
        ],
        layout: {
          type: 'tiling',
          tree: ['calendar-main'],
          instances: [
            {
              instanceId: 'calendar-main',
              vesselId: 'calendar',
              variant: 'month',
            },
            {
              instanceId: 'tasks-main',
              vesselId: 'calendar',
              variant: 'month',
            },
          ],
        },
      };
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('Currently Visible:');
      expect(result.userPrompt).toContain('Available (hidden):');
      expect(result.userPrompt).toContain('tasks-main');
    });

    test('handles tree with null, H, and V nodes', () => {
      const request: ChartRequest = {
        ...makeTilingRequest(),
        instances: [
          { instanceId: 'a', vesselId: 'calendar', variant: 'month' },
          { instanceId: 'b', vesselId: 'calendar', variant: 'month' },
        ],
        layout: {
          type: 'tiling',
          tree: ['V', 'a', 'H', 'b', null],
          instances: [
            { instanceId: 'a', vesselId: 'calendar', variant: 'month' },
            { instanceId: 'b', vesselId: 'calendar', variant: 'month' },
          ],
        },
      };
      const result = buildPrompt(request);
      // Both a and b are visible (leaf nodes in tree)
      expect(result.userPrompt).toContain('Currently Visible:');
      expect(result.userPrompt).toContain('- a (calendar)');
      expect(result.userPrompt).toContain('- b (calendar)');
      expect(result.userPrompt).toContain('Preorder: ["V","a","H","b",null]');
    });

    test('shows no vessels when tree is empty', () => {
      const request: ChartRequest = {
        ...makeTilingRequest(),
        instances: [],
        layout: { type: 'tiling', tree: [], instances: [] },
      };
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('No vessels currently visible.');
    });

    test('serializes actions for tiling instances', () => {
      const request = makeTilingRequest();
      request.vessels = [
        {
          ...request.vessels[0],
          variants: {
            month: {
              ...request.vessels[0]?.variants.month,
              actions: [
                {
                  name: 'showWeek',
                  description: 'Switch to week',
                  transitionsTo: 'week',
                },
              ],
            },
          },
        },
      ];
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('Available: showWeek');
    });
  });

  describe('update triggers', () => {
    test('handles chart resize reason', () => {
      const request = makeGridRequest({
        context: {
          ...makeGridRequest().context,
          updateReasons: [
            {
              type: 'chart_resize',
              previous: { columns: 8, rows: 6 },
              current: { columns: 12, rows: 8 },
            },
          ],
        },
      });
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('Chart resized: 8×6 → 12×8');
    });

    test('handles vessel mutation reason', () => {
      const request = makeGridRequest({
        context: {
          ...makeGridRequest().context,
          updateReasons: [
            {
              type: 'vessel_mutation',
              instanceId: 'calendar-main',
              changes: 'date range updated',
            },
          ],
        },
      });
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain(
        'Vessel "calendar-main" was modified: date range updated',
      );
    });

    test('handles no triggers', () => {
      const request = makeGridRequest({
        context: { ...makeGridRequest().context, updateReasons: [] },
      });
      const result = buildPrompt(request);
      expect(result.userPrompt).toContain('No specific trigger (system check)');
    });
  });

  describe('sections metadata', () => {
    test('returns system sections with correct keys', () => {
      const result = buildPrompt(makeGridRequest());
      const keys = result.sections.system.map((s) => s.key);
      expect(keys).toEqual([
        SystemSection.IDENTITY,
        SystemSection.TRIGGERS,
        SystemSection.LAYOUT,
        SystemSection.ACTIONS,
        SystemSection.RULES,
      ]);
    });

    test('returns user sections with correct keys', () => {
      const result = buildPrompt(makeGridRequest());
      const keys = result.sections.user.map((s) => s.key);
      expect(keys).toEqual([
        UserSection.VESSELS,
        UserSection.CHART_STATE,
        UserSection.UPDATE_TRIGGERS,
      ]);
    });
  });

  describe('section overrides', () => {
    test('replaces a system section with a string', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: { identity: 'You are a custom AI.' },
      });
      expect(result.systemPrompt).toContain('You are a custom AI.');
      expect(result.systemPrompt).not.toContain('You are Maelstrom');
    });

    test('transforms a system section with a function', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: {
          rules: (defaults) => `${defaults}\n\nAlways respond in Spanish.`,
        },
      });
      expect(result.systemPrompt).toContain('Always respond in Spanish.');
      expect(result.systemPrompt).toContain('userMessage');
    });

    test('removes a system section with null', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: { actions: null },
      });
      expect(result.systemPrompt).not.toContain('ACTION PARAMETERS');
      // Other sections still present
      expect(result.systemPrompt).toContain('GRID LAYOUT SYSTEM');
    });

    test('appends new custom sections', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: { domainContext: 'This is a healthcare application.' },
      });
      expect(result.systemPrompt).toContain(
        'This is a healthcare application.',
      );
      // Section is appended after defaults
      const idx = result.sections.system.findIndex(
        (s) => s.key === 'domainContext',
      );
      expect(idx).toBe(result.sections.system.length - 1);
    });

    test('throws when function customizer targets a new (unknown) key', () => {
      expect(() =>
        buildPrompt(makeGridRequest(), {
          system: { myNewSection: (prev) => `${prev} extra` },
        }),
      ).toThrow('is not a default section');
    });

    test('throws with section key context when customizer function throws', () => {
      expect(() =>
        buildPrompt(makeGridRequest(), {
          system: {
            rules: () => {
              throw new Error('boom');
            },
          },
        }),
      ).toThrow('customizer for "rules" threw: boom');
    });

    test('overrides user prompt sections', () => {
      const result = buildPrompt(makeGridRequest(), {
        user: {
          vessels: 'Custom vessel definitions here.',
        },
      });
      expect(result.userPrompt).toContain('Custom vessel definitions here.');
      expect(result.userPrompt).not.toContain('## Registered Vessels');
    });
  });

  describe('template variables', () => {
    test('substitutes assistantName in identity section', () => {
      const result = buildPrompt(makeGridRequest(), {
        vars: { assistantName: 'MAR' },
      });
      expect(result.systemPrompt).toContain('You are MAR,');
      expect(result.systemPrompt).not.toContain('Maelstrom');
    });

    test('defaults assistantName to Maelstrom', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.systemPrompt).toContain('You are Maelstrom,');
    });

    test('substitutes assistantName in tiling mode too', () => {
      const result = buildPrompt(makeTilingRequest(), {
        vars: { assistantName: 'Aria' },
      });
      expect(result.systemPrompt).toContain('You are Aria,');
    });
  });

  describe('prepend/append extensions', () => {
    test('appends to an existing section without knowing defaults', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: {
          identity: {
            append: 'ASSISTANT PROFILE:\nYou are a healthcare assistant.',
          },
        },
      });
      // Default content preserved
      expect(result.systemPrompt).toContain('orchestrates UI components');
      // Appended content present
      expect(result.systemPrompt).toContain('ASSISTANT PROFILE:');
    });

    test('prepends to an existing section', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: {
          rules: { prepend: 'DOMAIN RULES:\n- Always show biomarker panels' },
        },
      });
      const rulesSection = result.sections.system.find(
        (s) => s.key === 'rules',
      );
      expect(rulesSection?.content).toMatch(/^DOMAIN RULES:/);
      // Default rules still present after prepend
      expect(rulesSection?.content).toContain('Only invoke actions');
    });

    test('prepend and append together', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: {
          identity: {
            prepend: 'CONTEXT: Healthcare platform',
            append: 'PERSONA: Speak warmly and empathetically.',
          },
        },
      });
      const identitySection = result.sections.system.find(
        (s) => s.key === 'identity',
      );
      expect(identitySection?.content).toMatch(/^CONTEXT: Healthcare/);
      expect(identitySection?.content).toMatch(/empathetically\.$/);
      expect(identitySection?.content).toContain('orchestrates UI components');
    });

    test('extension on a new key creates a section at the end', () => {
      const result = buildPrompt(makeGridRequest(), {
        system: {
          domain: { append: 'This is a healthcare application.' },
        },
      });
      const domainSection = result.sections.system.find(
        (s) => s.key === 'domain',
      );
      expect(domainSection).toBeDefined();
      expect(domainSection?.content).toBe('This is a healthcare application.');
    });
  });

  describe('combined vars + extensions (PR #95 use case)', () => {
    test('assistant persona via vars + identity append', () => {
      const result = buildPrompt(makeGridRequest(), {
        vars: { assistantName: 'MAR' },
        system: {
          identity: {
            append:
              'ASSISTANT PROFILE:\nYou are MAR, a health assistant that helps patients explore lab data.',
          },
          rules: {
            append: '- Always keep at least one vessel visible',
          },
        },
      });
      expect(result.systemPrompt).toContain('You are MAR,');
      expect(result.systemPrompt).toContain('ASSISTANT PROFILE:');
      expect(result.systemPrompt).toContain(
        'Always keep at least one vessel visible',
      );
      expect(result.systemPrompt).not.toContain('Maelstrom');
    });
  });
});

describe('buildSystemPrompt', () => {
  test('builds grid system prompt', () => {
    const prompt = buildSystemPrompt('grid');
    expect(prompt).toContain('grid layout system');
    expect(prompt).not.toContain('binary tree');
  });

  test('builds tiling system prompt', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain('tiling layout system');
    expect(prompt).toContain('binary tree');
  });

  test('accepts section overrides', () => {
    const prompt = buildSystemPrompt('grid', {
      system: { identity: 'Custom identity.' },
    });
    expect(prompt).toContain('Custom identity.');
    expect(prompt).not.toContain('Maelstrom');
  });

  test('accepts vars', () => {
    const prompt = buildSystemPrompt('grid', {
      vars: { assistantName: 'TestBot' },
    });
    expect(prompt).toContain('You are TestBot,');
  });
});
