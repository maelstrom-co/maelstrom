import { defineVessel } from '@maelstrom-co/protocol-old';
import { vessel } from '@maelstrom-co/react';
import { JournalSkeleton } from './journal.skeleton';

export const journalVessel = defineVessel({
  id: 'journal',
  name: 'Journal',
  description:
    'Personal journal for writing entries. List view shows recent entries, entry view enables scribe mode where the AI can dictate content.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'createEntry',
          description: 'Create a new journal entry and open it for writing',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the entry',
            },
          ],
          transitionsTo: 'entry',
        },
      ],
    },
    entry: {
      props: {},
      minSize: { width: 4, height: 4 },
      actions: [
        {
          name: 'writeContent',
          description:
            'Append text to the current journal entry. Works like a scribe taking dictation.',
          parameters: [
            {
              name: 'text',
              type: 'string',
              description: 'Text to append to the entry',
            },
          ],
        },
        {
          name: 'backToList',
          description: 'Return to the journal entries list',
          transitionsTo: 'list',
        },
      ],
    },
  },
});

export const journalEntry = vessel(
  journalVessel,
  () => import('./journal.component'),
  JournalSkeleton,
);
