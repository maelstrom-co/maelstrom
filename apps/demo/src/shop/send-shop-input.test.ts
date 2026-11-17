import type {
  AgentMessageSubmission,
  Orchestrator,
  SettledAgentRun,
} from '@maelstrom-co/client';
import { MessageId } from '@maelstrom-co/protocol';
import { describe, expect, it, vi } from 'vitest';

import { sendShopInput } from './send-shop-input';

describe('sendShopInput', () => {
  it('sends trimmed typed text with the text source', () => {
    const send = vi.fn<Orchestrator['sendMessage']>(() =>
      submission('message-1'),
    );

    sendShopInput(send, '  show my last order  ', 'text');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('show my last order', { source: 'text' });
  });

  it('sends trimmed spoken text with the voice source', () => {
    const send = vi.fn<Orchestrator['sendMessage']>(() =>
      submission('message-1'),
    );

    sendShopInput(send, '\tshow my last order\n', 'voice');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('show my last order', {
      source: 'voice',
    });
  });

  it('returns the submission the send returned', () => {
    const sent = submission('message-7');
    const send = vi.fn<Orchestrator['sendMessage']>(() => sent);

    expect(sendShopInput(send, 'show my orders', 'text')).toBe(sent);
  });

  it.each(['', '   ', '\n\t '])(
    'throws on empty text %j without sending',
    (text) => {
      const send = vi.fn<Orchestrator['sendMessage']>(() =>
        submission('message-1'),
      );

      expect(() => sendShopInput(send, text, 'voice')).toThrow(
        'Shop input is empty',
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('passes a not submitted result through unchanged', async () => {
    const notSubmitted: SettledAgentRun = {
      inputId: MessageId('message-1'),
      status: 'not_submitted',
      error: { message: 'Orchestrator is not connected' },
      runId: null,
      disposition: null,
      ack: null,
      placeholder: null,
      reply: '',
      turnId: null,
      changes: [],
      changeErrors: [],
    };
    const send = vi.fn<Orchestrator['sendMessage']>(() => ({
      inputId: MessageId('message-1'),
      result: Promise.resolve(notSubmitted),
    }));

    await expect(
      sendShopInput(send, 'show my orders', 'text').result,
    ).resolves.toBe(notSubmitted);
  });
});

function submission(inputId: string): AgentMessageSubmission {
  return {
    inputId: MessageId(inputId),
    result: new Promise<SettledAgentRun>(() => undefined),
  };
}
