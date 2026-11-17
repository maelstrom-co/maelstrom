import type { Orchestrator } from '@maelstrom-co/client';
import { MessageId } from '@maelstrom-co/protocol';
import { describe, expect, it, vi } from 'vitest';

import { sendShopInput } from './send-shop-input';

describe('sendShopInput', () => {
  it('sends trimmed typed text with the text source', async () => {
    const send = vi.fn<Orchestrator['sendMessage']>(() =>
      Promise.resolve(MessageId('message-1')),
    );

    await sendShopInput(send, '  show my last order  ', 'text');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('show my last order', { source: 'text' });
  });

  it('sends trimmed spoken text with the voice source', async () => {
    const send = vi.fn<Orchestrator['sendMessage']>(() =>
      Promise.resolve(MessageId('message-1')),
    );

    await sendShopInput(send, '\tshow my last order\n', 'voice');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('show my last order', {
      source: 'voice',
    });
  });

  it('resolves with the message id the send resolved to', async () => {
    const send = vi.fn<Orchestrator['sendMessage']>(() =>
      Promise.resolve(MessageId('message-7')),
    );

    await expect(sendShopInput(send, 'show my orders', 'text')).resolves.toBe(
      MessageId('message-7'),
    );
  });

  it.each(['', '   ', '\n\t '])(
    'rejects empty text %j without sending',
    async (text) => {
      const send = vi.fn<Orchestrator['sendMessage']>(() =>
        Promise.resolve(MessageId('message-1')),
      );

      await expect(sendShopInput(send, text, 'voice')).rejects.toThrow(
        'Shop input is empty',
      );
      expect(send).not.toHaveBeenCalled();
    },
  );

  it('passes a send rejection through unchanged', async () => {
    const failure = new Error('Orchestrator is not connected');
    const send = vi.fn<Orchestrator['sendMessage']>(() =>
      Promise.reject(failure),
    );

    await expect(sendShopInput(send, 'show my orders', 'text')).rejects.toBe(
      failure,
    );
  });

  it('passes a synchronous send throw through as a rejection', async () => {
    const failure = new Error('Orchestrator is disposed');
    const send = vi.fn<Orchestrator['sendMessage']>(() => {
      throw failure;
    });

    await expect(sendShopInput(send, 'show my orders', 'text')).rejects.toBe(
      failure,
    );
  });
});
