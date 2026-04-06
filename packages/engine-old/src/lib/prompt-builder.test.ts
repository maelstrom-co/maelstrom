import { describe, expect, it } from 'bun:test';
import type { ChartRequest } from '@maelstrom-co/protocol-old';

import { buildPrompt, getDefaultSystemPrompt } from './prompt-builder.js';

function createRequest(layoutMode: 'grid' | 'tiling' = 'grid'): ChartRequest {
  return {
    type: 'chart_request',
    id: 'req-1',
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'Show my dashboard' }],
      chartDimensions: {
        columns: 6,
        rows: 4,
      },
      timestamp: Date.now(),
      sessionId: 'session-1',
      layoutMode,
    },
    instances: [],
    vessels: [],
    layout:
      layoutMode === 'grid'
        ? {
            type: 'grid',
            positions: [],
          }
        : {
            type: 'tiling',
            tree: [],
            instances: [],
          },
  };
}

describe('prompt-builder assistantProfile', () => {
  it('keeps the Maelstrom default when no assistant profile is provided', () => {
    const systemPrompt = getDefaultSystemPrompt('grid');

    expect(systemPrompt).toContain('You are Maelstrom');
    expect(systemPrompt).not.toContain('ASSISTANT PROFILE:');
  });

  it('injects assistant name and identity into the default system prompt', () => {
    const systemPrompt = getDefaultSystemPrompt('grid', {
      name: 'MAR',
      identity:
        'You are MAR, a health assistant that helps patients understand their lab data and chart layout. Speak as MAR consistently across every turn.',
    });

    expect(systemPrompt).toContain('You are MAR');
    expect(systemPrompt).toContain('ASSISTANT PROFILE:');
    expect(systemPrompt).toContain(
      'Speak as MAR consistently across every turn.',
    );
  });

  it('preserves systemPrompt override precedence over assistantProfile and extensions', () => {
    const { systemPrompt } = buildPrompt(
      createRequest(),
      'custom system prompt',
      '\nEXTRA',
      {
        name: 'MAR',
        identity: 'You are MAR.',
      },
    );

    expect(systemPrompt).toBe('custom system prompt');
  });

  it('appends assistantProfile before systemPromptExtension in composed prompts', () => {
    const { systemPrompt } = buildPrompt(
      createRequest(),
      undefined,
      '\nADDITIONAL INSTRUCTIONS:\n- Keep charts visible',
      {
        name: 'MAR',
        identity: 'You are MAR, the patient-facing health assistant.',
      },
    );

    const profileIndex = systemPrompt.indexOf('ASSISTANT PROFILE:');
    const extensionIndex = systemPrompt.indexOf('ADDITIONAL INSTRUCTIONS:');

    expect(profileIndex).toBeGreaterThan(-1);
    expect(extensionIndex).toBeGreaterThan(profileIndex);
  });
});
