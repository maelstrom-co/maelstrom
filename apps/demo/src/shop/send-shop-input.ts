import type { Orchestrator } from '@maelstrom-co/client';
import type { AgentInputSource, MessageId } from '@maelstrom-co/protocol';

/**
 * Hands one `/shop` input, typed or spoken, to the agent through `send`.
 * Sends the trimmed text with the given source and resolves with the
 * `MessageId` that `send` resolves to. Rejects without calling `send` when
 * the text is empty after trimming, and passes any `send` failure through
 * unchanged.
 */
export async function sendShopInput(
  send: Orchestrator['sendMessage'],
  text: string,
  source: AgentInputSource,
): Promise<MessageId> {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new Error('Shop input is empty');
  }
  return send(trimmed, { source });
}
