import { assertNever } from '../assert-never.js';
import type { SkippedAction } from '../response/execution-plan/index.js';
import type { InternalResponse } from '../response/response-processor.js';
import type {
  DroppedLayoutEntry,
  InstanceDroppedLayoutEntry,
} from '../validation/llm-output/healed-layout.js';
import {
  formatDroppedEntry,
  isTreeDrop,
} from '../validation/llm-output/healed-layout.js';

/**
 * The system prompt is unchanged on retry, so the LLM still has the full
 * vessel/variant catalogue and chart bounds — diagnostics cite fields by
 * name and trust the LLM to re-derive valid options from context.
 */
export function buildRetryPrompt(
  originalUserPrompt: string,
  diagnostics: InternalResponse['diagnostics'],
): string {
  const sections: string[] = [];

  const layoutLines = describeLayoutDrops(diagnostics.droppedLayoutEntries);
  if (layoutLines.length > 0) {
    sections.push(
      ['Layout drops:', ...layoutLines.map((l) => `- ${l}`)].join('\n'),
    );
  }

  const skipLines = describeSkippedActions(diagnostics.skippedActions);
  if (skipLines.length > 0) {
    sections.push(
      ['Skipped actions:', ...skipLines.map((l) => `- ${l}`)].join('\n'),
    );
  }

  const lines: string[] = [
    'The previous response had issues. Please re-issue the response addressing:',
    '',
  ];
  if (sections.length > 0) {
    lines.push(sections.join('\n\n'), '');
  }
  lines.push('Original request:', originalUserPrompt);
  return lines.join('\n');
}

function describeLayoutDrops(drops: readonly DroppedLayoutEntry[]): string[] {
  // Tree drops carry token-position fields the LLM never emitted; collapse
  // every tree_* drop to a single advisory line rather than citing useless
  // indices. Per-instance drops route through the shared formatter.
  const lines: string[] = [];
  let hasTreeDrop = false;
  const instanceDrops: InstanceDroppedLayoutEntry[] = [];
  for (const d of drops) {
    if (isTreeDrop(d)) {
      hasTreeDrop = true;
      continue;
    }
    instanceDrops.push(d);
  }
  for (const d of instanceDrops) {
    lines.push(formatDroppedEntry(d));
  }
  if (hasTreeDrop) {
    lines.push(
      'The tiling tree was malformed and could not be fully parsed. Re-emit a complete binary tree using only H/V splits and the requested instance IDs.',
    );
  }
  return lines;
}

function describeSkippedActions(skipped: readonly SkippedAction[]): string[] {
  // state_drift skips reflect engine-state mismatch (variant the LLM thought
  // it was acting on differs from current state). The LLM cannot fix this by
  // re-prompting; suppress them from the retry message rather than confuse
  // the model with feedback it cannot act on. self_transition_noop is also
  // a non-actionable diagnostic on its own — but on a mixed retry it helps
  // the LLM drop the redundant transition, so we emit a short hint.
  const lines: string[] = [];
  for (const s of skipped) {
    switch (s.reason) {
      case 'state_drift':
        continue;
      case 'self_transition_noop':
        // Anchor the directive to the (instanceId, action) pair and remind
        // the LLM that the same action name may legitimately apply to OTHER
        // instances on the next response — without that clause a weaker
        // model can drop unrelated correct calls in a mixed retry batch.
        lines.push(
          `Action "${s.action}" on instance "${s.instanceId}" is already a no-op — instance "${s.instanceId}" is already in variant "${s.currentVariant}". Omit this specific (instance, action) pair from your next response. Other instances may still legitimately call "${s.action}".`,
        );
        break;
      case 'params_parse_failed':
        lines.push(
          `Action "${s.action}" on instance "${s.instanceId}" had unparseable params: ${s.paramsJson}`,
        );
        break;
      case 'unknown_instance':
        lines.push(
          `Action "${s.action}" referenced unknown instance "${s.instanceId}"`,
        );
        break;
      case 'unknown_vessel':
        lines.push(
          `Action "${s.action}" on instance "${s.instanceId}" referenced unknown vessel "${s.vesselId}"`,
        );
        break;
      case 'no_simulated_variant':
        lines.push(
          `Action "${s.action}" on instance "${s.instanceId}" — no current variant to act on`,
        );
        break;
      case 'variant_not_on_vessel':
        lines.push(
          `Action "${s.action}" on instance "${s.instanceId}" — variant "${s.variant}" is not defined on vessel "${s.vesselId}"`,
        );
        break;
      case 'action_not_valid':
        lines.push(
          `Action "${s.action}" is not valid on instance "${s.instanceId}" in variant "${s.variant}" — valid actions: ${s.validActions.join(', ') || '(none)'}`,
        );
        break;
      default:
        return assertNever(s, 'describeSkippedActions');
    }
  }
  return lines;
}
