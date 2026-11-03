import { defineVessel } from '@maelstrom-co/protocol';

const ENTRY_REFERENCE =
  'Entry reference from the published list (id and title), for example "J-2 Architecture review"';

const EDIT_ENTRY_ACTION = {
  name: 'editEntry',
  description:
    'Replace the whole text of an existing journal entry. Use writeContent to append instead.',
  parameters: [
    { name: 'entry', type: 'string', description: ENTRY_REFERENCE },
    {
      name: 'content',
      type: 'string',
      description: 'The complete new text of the entry',
    },
  ],
} as const;

export const journalVessel = defineVessel({
  id: 'journal',
  name: 'Journal',
  description:
    'Personal journal for writing entries. List view shows recent entries, entry view enables scribe mode where the AI can dictate content. The user can open and edit entries directly, and the same edits can be made by request.',
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
            'Open an existing journal entry so it becomes visible in all entry-variant tiles.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: `${ENTRY_REFERENCE}. A plain title also works and is matched case-insensitively, with substring fallback.`,
            },
          ],
          transitionsTo: 'entry',
        },
        EDIT_ENTRY_ACTION,
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
            'Open an existing journal entry so it becomes visible in all entry-variant tiles.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              description: `${ENTRY_REFERENCE}. A plain title also works and is matched case-insensitively, with substring fallback.`,
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
        EDIT_ENTRY_ACTION,
      ],
    },
  },
});
