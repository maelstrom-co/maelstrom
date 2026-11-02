import { createFileRoute } from '@tanstack/react-router';

import { isHosted } from '../lib/hosted-mode';
import { TasklanePage } from '../tasklane/tasklane-page';

export const Route = createFileRoute('/tasks')({
  // Hosted builds use the prerendered SPA shell and keep this route client-only.
  // Non-hosted Start builds render the route on the server.
  ssr: !isHosted(),
  component: TasklanePage,
  head: () => ({
    meta: [
      { title: 'Tasklane, powered by Maelstrom' },
      {
        name: 'description',
        content:
          'Tasklane is a sample task app with Maelstrom built in. Turn product feedback into tasks by asking, or edit them by hand.',
      },
    ],
  }),
});
