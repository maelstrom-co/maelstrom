import type { Orchestrator } from '@maelstrom-co/client';
import type { AgentInputSource, MessageId } from '@maelstrom-co/protocol';

/** The single submit path for typed and voice `/shop` input. */
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
