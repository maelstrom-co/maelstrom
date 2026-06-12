import { describe, expect, test } from 'bun:test';
import {
  buildPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt-builder.js';
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
  });

  describe('tiling mode', () => {
    test('produces system prompt with tiling-specific content', () => {
      const result = buildPrompt(makeTilingRequest());
      expect(result.systemPrompt).toContain('tiling layout system');
      expect(result.systemPrompt).toContain('TILING LAYOUT SYSTEM');
      expect(result.systemPrompt).toContain('binary tree');
      expect(result.systemPrompt).not.toContain('GRID LAYOUT SYSTEM');
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

    test('userPrompt carries serializer output end-to-end', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.userPrompt).toContain('## Registered Vessels');
      expect(result.userPrompt).toContain('Layout Mode: Grid');
      expect(result.userPrompt).toContain('## Update Triggers');
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
      expect(result.systemPrompt).toContain('orchestrates UI components');
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

  describe('combined vars + extensions', () => {
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

  // Regression lock for the LLM "two ways to change a variant" footgun.
  // The simulator validates each action against the instance's pre-action
  // variant; an LLM that both mutates layout.instances directly AND adds a
  // matching transition action causes the action to fail the no-op check
  // and the heal layer wastes the retry budget. Pin: the prompt explicitly
  // forbids mixing the two methods.
  test('tiling system prompt forbids mixing transition action with direct variant mutation', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain('exactly ONE method');
    expect(prompt).toContain('NEVER mix the two');
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

describe('buildUserPrompt', () => {
  test('builds grid user prompt with serializer output', () => {
    const prompt = buildUserPrompt(makeGridRequest());
    expect(prompt).toContain('## Registered Vessels');
    expect(prompt).toContain('Layout Mode: Grid');
    expect(prompt).toContain('## Update Triggers');
  });

  test('builds tiling user prompt with serializer output', () => {
    const prompt = buildUserPrompt(makeTilingRequest());
    expect(prompt).toContain('Layout Mode: Tiling');
  });

  test('replaces a user section with a string override', () => {
    const prompt = buildUserPrompt(makeGridRequest(), {
      user: { vessels: 'Custom vessel definitions here.' },
    });
    expect(prompt).toContain('Custom vessel definitions here.');
    expect(prompt).not.toContain('## Registered Vessels');
  });

  test('removes a user section with null', () => {
    const prompt = buildUserPrompt(makeGridRequest(), {
      user: { vessels: null },
    });
    expect(prompt).not.toContain('## Registered Vessels');
    expect(prompt).toContain('## Update Triggers');
  });

  test('transforms a user section with a function', () => {
    const prompt = buildUserPrompt(makeGridRequest(), {
      user: {
        vessels: (defaults) => `${defaults}\n\nEXTRA NOTE.`,
      },
    });
    expect(prompt).toContain('## Registered Vessels');
    expect(prompt).toContain('EXTRA NOTE.');
  });

  test('appends a new user section with prepend/append', () => {
    const prompt = buildUserPrompt(makeGridRequest(), {
      user: {
        domain: { append: 'Healthcare context.' },
      },
    });
    expect(prompt).toContain('Healthcare context.');
  });

  test('throws when function customizer targets a new (unknown) key', () => {
    expect(() =>
      buildUserPrompt(makeGridRequest(), {
        user: { unknownSection: (prev) => `${prev} extra` },
      }),
    ).toThrow('is not a default section');
  });

  test('throws with section key context when customizer function throws', () => {
    expect(() =>
      buildUserPrompt(makeGridRequest(), {
        user: {
          vessels: () => {
            throw new Error('bang');
          },
        },
      }),
    ).toThrow('customizer for "vessels" threw: bang');
  });
});
