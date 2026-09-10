import { defineVessel } from '@maelstrom-co/protocol';

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
        {
          name: 'openEntry',
          idempotent: true,
          description:
            'Open an existing journal entry by title so it becomes visible in all entry-variant tiles. Matches case-insensitively; falls back to substring match if no exact title matches.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description:
                'Title of the entry to open. Matched case-insensitively, with substring fallback.',
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
          name: 'createEntry',
          description: 'Create a new journal entry and open it for writing',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: 'Title of the entry',
            },
          ],
        },
        {
          name: 'openEntry',
          idempotent: true,
          description:
            'Open an existing journal entry by title so it becomes visible in all entry-variant tiles. Matches case-insensitively; falls back to substring match if no exact title matches.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description:
                'Title of the entry to open. Matched case-insensitively, with substring fallback.',
            },
          ],
        },
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
          idempotent: true,
          description: 'Return to the journal entries list',
          transitionsTo: 'list',
        },
      ],
    },
  },
});
