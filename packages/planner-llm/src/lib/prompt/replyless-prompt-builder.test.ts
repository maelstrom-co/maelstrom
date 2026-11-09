import { describe, expect, test } from 'bun:test';

import type { LayoutMode } from '@maelstrom-co/protocol';

import {
  buildReplylessSystemPrompt,
  buildSystemPrompt,
} from './prompt-builder.js';
import { SystemSection } from './sections.js';
import { getDefaultSystemSections } from './system-prompts.js';

const modes: readonly LayoutMode[] = ['grid', 'tiling'];

describe.each(modes)('buildReplylessSystemPrompt (%s)', (mode) => {
  test('never mentions userMessage or conversational replies', () => {
    const prompt = buildReplylessSystemPrompt(mode);
    expect(prompt).not.toContain('userMessage');
    expect(prompt.toLowerCase()).not.toContain('conversational');
    expect(prompt).not.toContain('friendly');
  });

  test('describes the clarification field and when to use it', () => {
    const prompt = buildReplylessSystemPrompt(mode);
    expect(prompt).toContain('clarification');
    expect(prompt).toContain('the target is ambiguous');
    expect(prompt).toContain('required configuration is missing');
    expect(prompt).toContain('no clear intended resulting state');
    expect(prompt).toContain('Do not ask solely because');
    expect(prompt).toContain('Never ask a clarification for resize');
  });

  test('unsupported capability returns a clarification naming the gap with partial changes', () => {
    const prompt = buildReplylessSystemPrompt(mode);
    expect(prompt).toContain('requested capability is unsupported');
    expect(prompt).toContain('names the gap');
    expect(prompt).toContain(
      'the question names the gap, the options offer the closest supported alternatives',
    );
    expect(prompt).toContain(
      'only for the parts of the request that are already clear',
    );
  });

  test('off-domain requests return a clarification instead of a silent no-op', () => {
    const prompt = buildReplylessSystemPrompt(mode);
    expect(prompt).toContain(
      'Fill the clarification field with a question that names the gap and offers supported alternatives, and keep the current state unchanged.',
    );
  });

  test('keeps the same section keys as the default prompt', () => {
    expect(
      Object.keys(getDefaultSystemSections(mode, 'without-reply')),
    ).toEqual(Object.keys(getDefaultSystemSections(mode)));
  });

  test('default sections stay the reply-bearing ones', () => {
    expect(buildSystemPrompt(mode)).toContain('userMessage');
    expect(getDefaultSystemSections(mode, 'with-reply')).toBe(
      getDefaultSystemSections(mode),
    );
  });

  test('interpolates vars', () => {
    expect(
      buildReplylessSystemPrompt(mode, { vars: { assistantName: 'Aria' } }),
    ).toContain('You are Aria,');
  });

  test('appends, replaces and removes sections', () => {
    expect(
      buildReplylessSystemPrompt(mode, {
        system: { rules: { append: 'EXTRA_RULE' } },
      }).endsWith('EXTRA_RULE'),
    ).toBe(true);
    const replaced = buildReplylessSystemPrompt(mode, {
      system: { [SystemSection.IDENTITY]: 'CUSTOM_IDENTITY' },
    });
    expect(replaced.startsWith('CUSTOM_IDENTITY')).toBe(true);
    const removed = buildReplylessSystemPrompt(mode, {
      system: { [SystemSection.ACTIONS]: null },
    });
    expect(removed).not.toContain('ACTION PARAMETERS');
  });

  test('function customizer transforms the replyless default', () => {
    const prompt = buildReplylessSystemPrompt(mode, {
      system: {
        rules: (defaults) => `${defaults}\nTAIL(${defaults.length > 0})`,
      },
    });
    expect(prompt).toContain('TAIL(true)');
    expect(prompt).toContain('Set `clarification` only when');
  });

  test('bad customizer reports the section key', () => {
    expect(() =>
      buildReplylessSystemPrompt(mode, {
        system: {
          custom: (defaults: string) => defaults,
        } as never,
      }),
    ).toThrow('Prompt section customizer for "custom" is a function');
    expect(() =>
      buildReplylessSystemPrompt(mode, {
        system: {
          rules: () => {
            throw new Error('boom');
          },
        },
      }),
    ).toThrow('Prompt section customizer for "rules" threw: boom');
  });
});

describe('tiling replyless no-op variant rule', () => {
  test('keeps state unchanged without acknowledging in a message', () => {
    const prompt = buildReplylessSystemPrompt('tiling');
    expect(prompt).toContain('do NOT execute a no-op action');
    expect(prompt).toContain('keep the state unchanged');
  });
});
