import { createFileRoute } from '@tanstack/react-router';
import { createOpenAiMintHandler } from '@maelstrom-co/realtime-server';

/**
 * Mints ephemeral OpenAI realtime client secrets on behalf of the browser.
 * OPENAI_API_KEY never leaves this server-only handler — see
 * createOpenAiMintHandler for the request/response contract.
 */
const mintHandler = createOpenAiMintHandler({
  apiKey: process.env.OPENAI_API_KEY ?? '',
  model: 'gpt-realtime-1.5',
});

export const Route = createFileRoute('/api/realtime-token')({
  server: {
    handlers: {
      POST: ({ request }) => mintHandler(request),
    },
  },
});
