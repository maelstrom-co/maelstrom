import { createFileRoute } from '@tanstack/react-router';
import { HomePage } from '../components/home-page';
import { isHosted } from '../lib/hosted-mode';

export const Route = createFileRoute('/')({
  // Hosted builds use the prerendered SPA shell and keep this route client-only.
  // Non-hosted Start builds render the route on the server.
  ssr: !isHosted(),
  head: () => ({
    meta: [
      { title: 'Dayline, powered by Maelstrom' },
      {
        name: 'description',
        content:
          'Dayline is a sample day planner with Maelstrom built in. Work with its calendar, tasks and journal by typing or speaking.',
      },
    ],
  }),
  component: HomePage,
});
