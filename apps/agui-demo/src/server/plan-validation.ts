import type { PlanValidator } from '@maelstrom-co/engine';
import { getVisibleInstanceIds } from '@maelstrom-co/protocol';

export const validateWorkspacePlan: PlanValidator = ({ request, response }) => {
  const retained = new Set(
    request.instances.map(({ instanceId }) => instanceId),
  );
  const visible = getVisibleInstanceIds(response.layout);
  const targets = new Set(
    response.executionPlan.map(({ instanceId }) => instanceId),
  );
  return [...targets]
    .filter((id) => !retained.has(id) && !visible.has(id))
    .map((id) => ({
      code: 'new_action_target_hidden',
      message: `Keep new Action target ${id} visible in the Layout so its handler can mount. Replace other panels if necessary.`,
    }));
};
