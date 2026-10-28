import type { Planner } from '@maelstrom-co/engine';
import { ActionName, ok, type TilingResponse } from '@maelstrom-co/protocol';
import { notesId, tasksId, workspaceLayout } from './src/workspace';

export const localPlanner: Planner = async ({ request }) => {
  const intent = request.context.updateReasons.find(
    (reason) => reason.type === 'user_intent',
  );
  let expanded = request.instances.some(
    (instance) =>
      instance.instanceId === notesId && instance.variant === 'editor',
  );
  let userMessage =
    'The layout now fits this window. Your tasks and note are unchanged.';
  const executionPlan: TilingResponse['executionPlan'] = [];
  if (
    !intent &&
    request.layout.type === 'tiling' &&
    request.layout.tree.length
  ) {
    const tree = [...request.layout.tree];
    const root = tree[0];
    if (root && /^[HV](?::|$)/.test(root))
      tree[0] =
        `${request.context.chartDimensions.columns < 8 ? 'H' : 'V'}${root.slice(1)}` as typeof root;
    return ok({
      userMessage,
      rationale:
        'Resize retains the current components, views, and proportions.',
      executionPlan,
      layout: { tree, instances: [...request.instances] },
    });
  }
  if (intent?.type === 'user_intent') {
    const text = intent.intent.trim();
    if (/^give my notes more room[.!]?$/i.test(text)) {
      expanded = true;
      userMessage = 'Your note has more room. You can edit it directly.';
    } else if (/^show tasks and notes[.!]?$/i.test(text)) {
      expanded = false;
      userMessage = 'Tasks and notes are in view. Your changes are still here.';
    } else {
      const added = /^add\s+["“]([^"”]+)["”]\s+to my tasks[.!]?$/i.exec(text);
      const title = added?.[1].trim();
      if (title && title.length <= 120) {
        executionPlan.push({
          instanceId: tasksId,
          action: ActionName('addTask'),
          paramsJson: JSON.stringify({ title }),
        });
        userMessage = `Added “${title}” to your tasks.`;
      } else {
        userMessage =
          'Local mode follows the example requests below. Connect a model to use other requests.';
      }
    }
  }
  const layout = workspaceLayout(
    request.context.chartDimensions.columns,
    expanded,
  );
  return ok({
    userMessage,
    rationale:
      'The local walkthrough uses predefined requests and application-owned components.',
    executionPlan,
    layout: { tree: [...layout.tree], instances: [...layout.instances] },
  });
};
