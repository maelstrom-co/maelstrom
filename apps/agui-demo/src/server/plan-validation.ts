import {
  finalVariants,
  type PlanValidationIssue,
  type PlanValidator,
} from '@maelstrom-co/engine';
import { getVisibleInstanceIds } from '@maelstrom-co/protocol';

export const validateWorkspacePlan: PlanValidator = ({ request, response }) => {
  const retained = new Set(
    request.instances.map(({ instanceId }) => instanceId),
  );
  const visible = getVisibleInstanceIds(response.layout);
  const targets = new Set(
    response.executionPlan.map(({ instanceId }) => instanceId),
  );
  const issues: PlanValidationIssue[] = [...targets]
    .filter((id) => !retained.has(id) && !visible.has(id))
    .map((id) => ({
      code: 'new_action_target_hidden',
      message: `Keep new Action target ${id} visible in the Layout so its handler can mount. Replace other panels if necessary.`,
    }));
  if (response.layout?.type !== 'tiling') return issues;
  const initial = new Map(
    response.layout.instances.map((instance) => [
      instance.instanceId,
      instance,
    ]),
  );
  const replay = finalVariants(
    [...initial.values()],
    response.executionPlan,
    request.vessels,
  );
  if (!replay.ok) {
    issues.push({
      code: 'action_transition_invalid',
      message: `Action ${replay.error.step.action} on ${replay.error.step.instanceId} cannot replay from the Layout Variant.`,
    });
    return issues;
  }
  return issues;
};
