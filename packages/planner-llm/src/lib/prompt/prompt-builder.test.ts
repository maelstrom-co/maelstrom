import { describe, expect, test } from 'bun:test';
import {
  makeGridRequest,
  makeTilingRequest,
} from '@maelstrom-co/engine/_testing';
import { MAX_SPLIT_CHILDREN, MAX_SPLIT_WEIGHT } from '@maelstrom-co/protocol';
import {
  buildPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './prompt-builder.js';
import { SystemSection, UserSection } from './sections.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildPrompt', () => {
  describe('grid mode', () => {
    test('produces system prompt with grid-specific content', () => {
      const result = buildPrompt(makeGridRequest());
      expect(result.systemPrompt).toContain('grid layout system');
      expect(result.systemPrompt).toContain('GRID LAYOUT SYSTEM');
      expect(result.systemPrompt).not.toContain('split tree');
    });
  });

  describe('tiling mode', () => {
    test('produces system prompt with tiling-specific content', () => {
      const result = buildPrompt(makeTilingRequest());
      expect(result.systemPrompt).toContain('tiling layout system');
      expect(result.systemPrompt).toContain('TILING LAYOUT SYSTEM');
      expect(result.systemPrompt).toContain('split tree');
      expect(result.systemPrompt).not.toContain('GRID LAYOUT SYSTEM');
    });

    test('layout and visibility changes do not authorize unrelated deletions', () => {
      const { systemPrompt } = buildPrompt(makeTilingRequest());
      expect(systemPrompt).toContain(
        'Swapping, rearranging, resizing, showing, or hiding instances must not delete unrelated instances.',
      );
      expect(systemPrompt).toContain(
        'To HIDE an instance:\n- Include it in instances but not in the tree',
      );
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
    expect(prompt).not.toContain('split tree');
  });

  test('builds tiling system prompt', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain('tiling layout system');
    expect(prompt).toContain('split tree');
  });

  test('tiling retains visible and hidden instances unless the user requests deletion', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain(
      'Keep every existing instance, visible or hidden, in the instances array unless the user explicitly requests its deletion.',
    );
    expect(prompt).not.toContain('instances you want to keep');
  });

  test('tiling still deletes by omission, but only at the user request', () => {
    const prompt = buildSystemPrompt('tiling');
    const deletion = prompt
      .split('To DELETE an instance:')[1]
      ?.split('\n\n')[0];
    expect(deletion).toContain(
      'Only delete an instance when the user explicitly requests its deletion.',
    );
    expect(deletion).toContain(
      "Simply don't include it in the instances array",
    );
  });

  for (const mode of ['grid', 'tiling'] as const) {
    test(`${mode} prompt uses the catalog default for an omitted new-Instance Variant`, () => {
      const prompt = buildSystemPrompt(mode);
      expect(prompt).toContain(
        'When the user clearly requests adding/showing a registered Vessel as a new Instance and omits its Variant, use the catalog-declared defaultVariant (marked "(default)") as its initial Variant',
      );
      expect(prompt).toContain(
        "Do not ask solely because that new Instance's Variant was omitted",
      );
      expect(prompt).not.toContain(
        'If the user expresses an action but does not specify the intended resulting state',
      );
    });

    test(`${mode} prompt preserves explicit Variants and clarification beyond the creation default`, () => {
      const prompt = buildSystemPrompt(mode);
      expect(prompt).toContain(
        'An explicitly requested Variant takes precedence over the default',
      );
      expect(prompt).toContain(
        "This creation default does not choose a target or change an existing Instance's Variant",
      );
      expect(prompt).toContain(
        'Ask clarifying questions with userMessage instead of mutating when the target is ambiguous, the requested capability is unsupported, required configuration is missing, or a change to an existing Instance has no clear intended resulting state',
      );
      expect(prompt).toContain(
        'do not execute any actions and keep the current state unchanged until the user clarifies the intended change',
      );
    });

    // The client applies the layout before it runs the executionPlan in both
    // modes. The negative half is load-bearing: the old rule claimed the
    // reverse order, and a revert or merge resolution would bring it back.
    test(`${mode} prompt states that the layout applies before the actions run`, () => {
      const prompt = buildSystemPrompt(mode);
      expect(prompt).toContain(
        'The client applies the layout first, then runs the executionPlan actions in order. An action with a transition changes the instance variant when it runs.',
      );
      expect(prompt).toContain(
        'Only invoke actions that are available in the variant the instance has when the action runs: the variant it has before the executionPlan runs (in tiling mode, the variant declared for it in the layout instances array; in grid mode, its current variant), or the target of an earlier transition action on the same instance',
      );
      expect(prompt).not.toContain(
        'when the action runs: its current variant, or the target',
      );
      expect(prompt).not.toContain('Execute actions before layout');
    });
  }

  // The layout declares each instance's variant before the executionPlan
  // runs, and the transition action moves it. Declaring the target variant
  // and also adding the transition makes the action find the instance
  // already in its target, so it is skipped and the turn reports an
  // unconfirmed change. The negative assertions are load-bearing: the old
  // advice told the model to record the post-action variant, and a revert or
  // merge resolution would teach that pattern again.
  test('tiling system prompt keeps the current variant in the layout when a transition action drives the change', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain(
      "PREFERRED: keep the instance's current variant in the instances array and add the transition action",
    );
    expect(prompt).toContain(
      'DIRECT: only when no transition action exists for the change you want. Set the new variant in the instances array and add NO transition action.',
    );
    expect(prompt).toContain(
      'NEVER declare the target variant in the instances array AND add a transition action to it.',
    );
    expect(prompt).toContain(
      'each in the variant it has BEFORE the executionPlan runs',
    );
    expect(prompt).not.toContain('record the post-action variant');
    expect(prompt).not.toContain('just confirms the resulting state');
  });

  test('tiling system prompt treats a new instance variant as its starting variant', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain(
      'A transition action available on the starting variant may follow in executionPlan. It runs after the instance appears',
    );
    expect(prompt).toContain(
      'DO NOT add a transition action whose target equals the variant you just declared.',
    );
  });

  // Regression lock for the duplicate-instance-ID footgun. This prompt used
  // to tell the model that repeating an ID across leaves was how a vessel
  // claimed more space; weighted splits replace that exactly, and the client
  // now refuses a duplicate-bearing set_layout while a seed throws at
  // construction. The negative assertion is the load-bearing half: the
  // failure mode is the deleted advice coming back through a revert or a
  // merge resolution, which would teach the model to emit trees every client
  // gate rejects. Pin: the rule is taught, the old remedy is gone, and the
  // arity rule that replaces it is stated.
  test('tiling system prompt teaches one leaf per instance, never a repeated ID', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain('AT MOST ONCE');
    expect(prompt).not.toContain('include it multiple times');
    expect(prompt).toContain('as many children as it declares weights');
  });

  // The caps the model is told must be the caps the parser enforces, so pin
  // the interpolated constants rather than the numbers they hold today.
  test('tiling system prompt interpolates the split caps from the protocol', () => {
    const prompt = buildSystemPrompt('tiling');
    expect(prompt).toContain(`from 1 to ${MAX_SPLIT_WEIGHT}`);
    expect(prompt).toContain(`between 2 and ${MAX_SPLIT_CHILDREN} of them`);
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
