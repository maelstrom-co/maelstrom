import { createLiveSessionExchange } from '@maelstrom-co/realtime-openai-live-server';
import {
  LiveExchangeRequestSchema,
  type LiveSessionExchange,
} from '@maelstrom-co/realtime-protocol/openai-live';

import {
  voiceBackendInstructions,
  voiceInstructions,
  voiceTool,
} from '../voice-contract';

export class VoiceSessions {
  private active = false;
  private attempts = 0;

  constructor(
    private readonly createExchange: (apiKey: string) => LiveSessionExchange = (
      apiKey,
    ) => createLiveSessionExchange({ apiKey }),
  ) {}

  async exchange(value: unknown, key: string, signal: AbortSignal) {
    signal.throwIfAborted();
    if (this.active || this.attempts >= 10)
      throw new Error('Voice connection budget unavailable.');
    const input = LiveExchangeRequestSchema.parse(value);
    const offer = LiveExchangeRequestSchema.parse({
      transport: input.transport,
      session: {
        model: 'gpt-live-1',
        store: false,
        instructions: voiceInstructions,
        audio: { output: { voice: 'cedar' } },
        delegation: {
          type: 'responses',
          responses: {
            model: 'gpt-6-luna',
            instructions: voiceBackendInstructions,
            max_output_tokens: 2_000,
            parallel_tool_calls: false,
            tools: [
              {
                type: 'function',
                name: voiceTool.name,
                description: voiceTool.description,
                parameters: voiceTool.parametersJsonSchema,
                strict: true,
              },
            ],
          },
        },
      },
    });
    this.active = true;
    this.attempts++;
    try {
      const response = await this.createExchange(key)(offer, signal);
      signal.throwIfAborted();
      return response;
    } finally {
      this.active = false;
    }
  }
}
