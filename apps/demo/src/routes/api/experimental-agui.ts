import { createFileRoute } from '@tanstack/react-router';
import { handleAguiRequest } from '../../server/agui-handler';

export const Route = createFileRoute('/api/experimental-agui')({
  server: {
    handlers: {
      POST: ({ request }) => handleAguiRequest(request),
      DELETE: ({ request }) => handleAguiRequest(request),
    },
  },
});
