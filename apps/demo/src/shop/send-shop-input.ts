import type {
  AgentMessageSubmission,
  Orchestrator,
} from '@maelstrom-co/client';
import type { AgentInputSource } from '@maelstrom-co/protocol';

/** The single submit path for typed and voice `/shop` input. */
export function sendShopInput(
  send: Orchestrator['sendMessage'],
  text: string,
  source: AgentInputSource,
): AgentMessageSubmission {
  const trimmed = text.trim();
  if (trimmed === '') {
    throw new Error('Shop input is empty');
  }
  return send(trimmed, { source });
}
