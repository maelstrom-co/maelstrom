import { createFileRoute } from '@tanstack/react-router';

import { isHosted } from '../lib/hosted-mode';
import { TalkingPointsPage } from '../talking-points/talking-points-page';

export const Route = createFileRoute('/talking-points')({
  ssr: !isHosted(),
  component: TalkingPointsPage,
  head: () => ({
    meta: [
      { title: 'Talking Points, powered by Maelstrom' },
      {
        name: 'description',
        content:
          'Prepare an ordered speaking outline by voice or text, then reuse it next time.',
      },
    ],
  }),
});
