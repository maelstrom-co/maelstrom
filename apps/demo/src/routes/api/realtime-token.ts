import { createFileRoute } from '@tanstack/react-router';
import { createOpenAIMintHandler } from '@maelstrom-co/realtime-server';

/**
 * Mints ephemeral OpenAI realtime client secrets on behalf of the browser.
 * OPENAI_API_KEY never leaves this server-only handler — see
 * createOpenAIMintHandler for the request/response contract.
 */
const mintHandler = createOpenAIMintHandler({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: 'gpt-realtime-2',
});

export const Route = createFileRoute('/api/realtime-token')({
  server: {
    handlers: {
      POST: ({ request }) => mintHandler(request),
    },
  },
});
