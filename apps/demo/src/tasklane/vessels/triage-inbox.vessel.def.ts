import { defineVessel } from '@maelstrom-co/protocol';

import { ASSIGN_TASK_ACTION } from './task-action.defs';

const TRIAGE_INBOX_DESCRIPTION =
  'Triage inbox: the open tasks (not done) that still need sorting, each tagged with why. "no owner" means nobody is assigned. "no parent" means a top-level task that has no subtasks and sits under no parent task. Each row has a quick assign control. Show it when the user asks to show the triage inbox, what needs triage, which tasks have no owner, or what is unassigned or loose. Use assignTask to give a task an owner. Group a loose task with setParent on the Tasks Vessel. It reads "Inbox clear" when nothing needs triage.';

export const triageInboxVessel = defineVessel({
  id: 'triage-inbox',
  name: 'Triage inbox',
  description: TRIAGE_INBOX_DESCRIPTION,
  defaultVariant: 'list',
  variants: {
    list: {
      description:
        'One row per task needing triage, with its reason tags and an assignee select.',
      props: {},
      minSize: { width: 4, height: 3 },
      actions: [ASSIGN_TASK_ACTION],
    },
  },
});
