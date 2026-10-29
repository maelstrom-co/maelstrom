import {
  defineVessel,
  InstanceId,
  type TilingLayout,
  tilingLeafToken,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';

export const tasksVessel = defineVessel({
  id: 'tasks',
  name: 'Tasks',
  description: 'A task list with checkboxes and an action for adding a task.',
  defaultVariant: 'list',
  variants: {
    list: {
      props: {},
      minSize: { width: 3, height: 3 },
      actions: [
        {
          name: 'addTask',
          description: 'Add a task with a title between 1 and 120 characters.',
          parameters: [
            {
              name: 'title',
              type: 'string',
              required: true,
              description: 'The task title.',
            },
          ],
        },
      ],
    },
  },
});

export const notesVessel = defineVessel({
  id: 'notes',
  name: 'Launch note',
  description: 'A note with a short preview and an editable full view.',
  defaultVariant: 'summary',
  variants: {
    summary: {
      description: 'Show the note preview.',
      props: {},
      minSize: { width: 3, height: 2 },
      actions: [],
    },
    editor: {
      description: 'Show the editable note.',
      props: {},
      minSize: { width: 3, height: 4 },
      actions: [],
    },
  },
});

export const tasksId = InstanceId('tasks-main');
export const notesId = InstanceId('notes-main');
export const examples = [
  { label: 'Rearrange the workspace', intent: 'Give my notes more room' },
  { label: 'Run an action', intent: 'Add "Prepare the launch" to my tasks' },
  { label: 'Restore the layout', intent: 'Show tasks and notes' },
] as const;

/** Keeps stable Instance identities while changing arrangement and note view. */
export function workspaceLayout(columns = 12, expanded = false): TilingLayout {
  return {
    type: 'tiling',
    tree: [
      columns < 8 ? (expanded ? 'H:1,2' : 'H') : expanded ? 'V:1,2' : 'V:3,2',
      tilingLeafToken(tasksId),
      tilingLeafToken(notesId),
    ],
    instances: [
      {
        instanceId: tasksId,
        vesselId: VesselId('tasks'),
        variant: VariantName('list'),
      },
      {
        instanceId: notesId,
        vesselId: VesselId('notes'),
        variant: VariantName(expanded ? 'editor' : 'summary'),
      },
    ],
  };
}
