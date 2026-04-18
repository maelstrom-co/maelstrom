import { describe, expect, it } from 'bun:test';
import { MessageId, SessionId } from '@maelstrom-co/protocol';
import type {
  ChartRequest,
  GridResponse,
  LayoutMode,
} from '@maelstrom-co/protocol-old';

import { createEngine } from './engine.js';
import type { LLMProvider } from './types.js';

function createRequest(): ChartRequest {
  return {
    type: 'chart_request',
    id: MessageId('req-1'),
    context: {
      updateReasons: [{ type: 'user_intent', intent: 'Show my results' }],
      chartDimensions: {
        columns: 6,
        rows: 4,
      },
      timestamp: Date.now(),
      sessionId: SessionId('session-1'),
      layoutMode: 'grid',
    },
    instances: [],
    vessels: [],
    layout: {
      type: 'grid',
      positions: [],
    },
  };
}

function createResponse(): GridResponse {
  return {
    userMessage: 'Done',
    rationale: 'Test response',
    executionPlan: [],
    layout: {
      positions: [],
    },
  };
}

describe('createEngine assistantProfile integration', () => {
  it('passes the composed assistant profile system prompt to the provider', async () => {
    const capturedCalls: Array<{
      prompt: string;
      systemPrompt: string;
      layoutMode: LayoutMode;
    }> = [];

    const provider: LLMProvider = {
      async complete(prompt, systemPrompt, layoutMode) {
        capturedCalls.push({ prompt, systemPrompt, layoutMode });
        return createResponse();
      },
    };

    const engine = createEngine({
      provider,
      assistantProfile: {
        name: 'MAR',
        identity:
          'You are MAR, a health assistant that helps patients explore lab data without switching identities.',
      },
      systemPromptExtension:
        '\nADDITIONAL INSTRUCTIONS:\n- Keep at least one vessel visible',
    });

    await engine.process(createRequest());

    const capturedCall = capturedCalls[0];

    if (!capturedCall) {
      throw new Error('Provider was not called');
    }

    expect(capturedCall.layoutMode).toBe('grid');
    expect(capturedCall.prompt).toContain('## Registered Vessels');
    expect(capturedCall.systemPrompt).toContain('You are MAR');
    expect(capturedCall.systemPrompt).toContain('ASSISTANT PROFILE:');
    expect(capturedCall.systemPrompt).toContain(
      'Keep at least one vessel visible',
    );
  });
});
