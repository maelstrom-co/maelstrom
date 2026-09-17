import type { ChartRequest, MessageId } from '@maelstrom-co/protocol';
import {
  GridResponseSchema,
  isErr,
  sanitizeControlChars,
  TilingResponseSchema,
} from '@maelstrom-co/protocol';

import type { ActionParameterEnumSnapshot } from '../action-parameter-enum.js';
import type { EngineError } from '../errors.js';
import { parseError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { LLMOutput } from '../pipeline/call-llm.js';
import type { SkippedAction } from '../response/execution-plan/types.js';
import type { InternalResponse } from '../response/response-processor.js';
import { processResponse } from '../response/response-processor.js';
import type {
  DroppedLayoutEntry,
  LayoutWarning,
} from '../validation/llm-output/healed-layout.js';
import { formatDroppedEntry } from '../validation/llm-output/healed-layout.js';
import type {
  FinalizationIssue,
  FinalizationIssueLocation,
  FinalizationReport,
  PlannerActionCandidate,
  PlannerCandidate,
} from './contracts.js';

/** Canonical result of validating a planner candidate. */
export type FinalizationResult =
  | {
      readonly kind: 'exact' | 'healed';
      readonly response: InternalResponse;
      readonly report: FinalizationReport;
      readonly material: boolean;
    }
  | {
      readonly kind: 'unusable';
      readonly report: FinalizationReport;
      readonly error?: EngineError;
    };

const MAX_REPORT_ISSUES = 32;

/** Finalizes one untrusted proposal with the existing layout and action healers. */
export function finalizeCandidate(input: {
  /** Untrusted planner proposal. */
  readonly candidate: PlannerCandidate;
  /** Frozen chart request shared by the planning operation. */
  readonly request: ChartRequest;
  /** Existing normalized action parameter enum snapshot. */
  readonly enumSnapshot: ActionParameterEnumSnapshot;
  /** Correlation id for the canonical response. */
  readonly messageId: MessageId;
  /** Engine logger used by ordered action validation. */
  readonly logger: Logger;
}): FinalizationResult {
  const { candidate, request, enumSnapshot, messageId, logger } = input;
  try {
    const canonical = parseCandidate(candidate, request.context.layoutMode);
    if (!canonical.ok) return unusable(canonical.issues, canonical.error);
    const processed = processResponse({
      llmOutput: canonical.value,
      request,
      enumSnapshot,
      messageId,
      logger,
    });
    if (isErr(processed)) {
      return unusable([
        issue('candidate', 'response_rejected', processed.error.message),
      ]);
    }
    const diagnostics = processed.value.diagnostics;
    const issues = [
      ...diagnostics.droppedLayoutEntries.map(dropIssue),
      ...diagnostics.skippedActions.map((entry) =>
        actionIssue(entry, candidate.executionPlan),
      ),
      ...diagnostics.warnings.map(warningIssue),
    ];
    // Empty layouts, null-only space, and hidden retained instances are valid
    // canonical protocol states. Legacy retry recommendation stays separate.
    const renderable = true;
    const report = makeReport(
      issues,
      renderable,
      diagnostics.retryHint.recommend,
    );
    const material =
      diagnostics.droppedLayoutEntries.length > 0 ||
      diagnostics.skippedActions.length > 0 ||
      diagnostics.warnings.some(
        (warning) => warning.kind === 'split_weights_repaired',
      );
    return {
      kind: issues.length === 0 ? 'exact' : 'healed',
      response: processed.value,
      report,
      material,
    };
  } catch (error) {
    return unusable([
      issue(
        'candidate',
        'finalization_failed',
        error instanceof Error ? error.message : 'proposal finalization failed',
      ),
    ]);
  }
}

function parseCandidate(
  candidate: PlannerCandidate,
  mode: ChartRequest['context']['layoutMode'],
):
  | {
      readonly ok: true;
      readonly value: LLMOutput;
    }
  | {
      readonly ok: false;
      readonly issues: readonly FinalizationIssue[];
      readonly error?: EngineError;
    } {
  if (!isRecord(candidate.layout))
    return invalidCandidate(
      'proposal layout must be an object',
      'invalid_layout',
      { path: ['layout'] },
    );
  if (!Array.isArray(candidate.executionPlan))
    return invalidCandidate(
      'proposal execution plan must be an array',
      'invalid_execution_plan',
      { path: ['executionPlan'] },
    );
  if (
    typeof candidate.userMessage !== 'string' ||
    !candidate.userMessage.trim()
  ) {
    return {
      ok: false,
      issues: [
        issue(
          'text',
          'missing_user_message',
          'proposal is missing userMessage',
        ),
      ],
      error: parseError('LLM response missing userMessage', 'userMessage'),
    };
  }
  if (typeof candidate.rationale !== 'string') {
    return {
      ok: false,
      issues: [
        issue('text', 'missing_rationale', 'proposal is missing rationale'),
      ],
      error: parseError('LLM response missing rationale', 'rationale'),
    };
  }
  if ('type' in candidate.layout && candidate.layout.type !== mode) {
    return invalidCandidate(
      'proposal layout type does not match requested mode',
      'layout_mode_mismatch',
      { path: ['layout', 'type'] },
    );
  }
  if (candidate.executionPlan.length > 64) {
    return invalidCandidate(
      'proposal exceeds the maximum action count',
      'action_count_exceeded',
      { path: ['executionPlan'] },
    );
  }
  const actions = candidate.executionPlan.map(encodeAction);
  const malformedIndex = actions.findIndex((action) => !action.ok);
  const malformedAction = actions[malformedIndex];
  if (malformedAction !== undefined && !malformedAction.ok) {
    return invalidCandidate(malformedAction.message, malformedAction.code, {
      actionIndex: malformedIndex,
      path: [
        'executionPlan',
        malformedIndex,
        ...(malformedAction.code === 'invalid_parameters' ? ['params'] : []),
      ],
    });
  }
  const executionPlan = actions.map((action) =>
    action.ok ? action.value : undefined,
  );
  const raw = {
    userMessage: candidate.userMessage,
    rationale: candidate.rationale,
    executionPlan,
    layout: candidate.layout,
  };
  const schema = mode === 'grid' ? GridResponseSchema : TilingResponseSchema;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((entry) =>
        issue(
          'candidate',
          `schema_${entry.code}`,
          'proposal does not satisfy the canonical response schema',
          {
            path: entry.path.map((segment) =>
              typeof segment === 'number' ? segment : String(segment),
            ),
          },
        ),
      ),
    };
  }
  return { ok: true, value: parsed.data as LLMOutput };
}

function encodeAction(candidate: PlannerActionCandidate):
  | {
      readonly ok: true;
      readonly value: {
        readonly instanceId: unknown;
        readonly action: unknown;
        readonly paramsJson?: string;
      };
    }
  | {
      readonly ok: false;
      readonly code: 'invalid_action' | 'invalid_parameters';
      readonly message: string;
    } {
  if (
    !isRecord(candidate) ||
    !('instanceId' in candidate) ||
    !('action' in candidate)
  ) {
    return {
      ok: false,
      code: 'invalid_action',
      message: 'proposal action is malformed',
    };
  }
  if (!('params' in candidate)) {
    return {
      ok: true,
      value: { instanceId: candidate.instanceId, action: candidate.action },
    };
  }
  if (typeof candidate.params === 'string') {
    return {
      ok: true,
      value: {
        instanceId: candidate.instanceId,
        action: candidate.action,
        paramsJson: candidate.params,
      },
    };
  }
  try {
    const params = normalizeJsonObject(candidate.params);
    return {
      ok: true,
      value: {
        instanceId: candidate.instanceId,
        action: candidate.action,
        paramsJson: JSON.stringify(params),
      },
    };
  } catch (error) {
    return {
      ok: false,
      code: 'invalid_parameters',
      message:
        error instanceof Error
          ? error.message
          : 'proposal action params must be a JSON object',
    };
  }
}

function invalidCandidate(
  message: string,
  code = 'invalid_candidate',
  location?: FinalizationIssueLocation,
): {
  readonly ok: false;
  readonly issues: readonly FinalizationIssue[];
} {
  return {
    ok: false,
    issues: [issue('candidate', code, message, location)],
  };
}

function unusable(
  issues: readonly FinalizationIssue[],
  error?: EngineError,
): FinalizationResult {
  return {
    kind: 'unusable',
    report: makeReport(issues, false, false),
    ...(error !== undefined && { error }),
  };
}

function makeReport(
  issues: readonly FinalizationIssue[],
  renderable: boolean,
  retryRecommended: boolean,
): FinalizationReport {
  return Object.freeze({
    issues: Object.freeze(issues.slice(0, MAX_REPORT_ISSUES)),
    omittedIssueCount: Math.max(0, issues.length - MAX_REPORT_ISSUES),
    renderable,
    retryRecommended,
  });
}

function dropIssue(entry: DroppedLayoutEntry): FinalizationIssue {
  const location: FinalizationIssueLocation = {
    ...('instanceId' in entry && { instanceId: String(entry.instanceId) }),
    ...('atTokenIndex' in entry && { tokenIndex: entry.atTokenIndex }),
    ...('fromTokenIndex' in entry && { tokenIndex: entry.fromTokenIndex }),
  };
  return issue('layout', entry.reason, formatDroppedEntry(entry), location);
}

function warningIssue(entry: LayoutWarning): FinalizationIssue {
  return issue(
    'layout',
    entry.kind,
    `layout repaired: ${entry.kind}`,
    'atTokenIndex' in entry ? { tokenIndex: entry.atTokenIndex } : undefined,
  );
}

function actionIssue(
  entry: SkippedAction,
  _actions: readonly PlannerActionCandidate[],
): FinalizationIssue {
  const actionIndex = entry.index;
  return issue('action', entry.reason, actionMessage(entry.reason), {
    ...(actionIndex !== undefined && { actionIndex }),
    ...('instanceId' in entry && { instanceId: String(entry.instanceId) }),
    ...('action' in entry && { action: String(entry.action) }),
    ...('issues' in entry &&
      entry.issues[0] !== undefined &&
      'parameter' in entry.issues[0] && {
        parameter: entry.issues[0].parameter,
      }),
    ...('issues' in entry && {
      parameterIssueKinds: entry.issues.map((issue) => issue.kind),
    }),
  });
}

function actionMessage(reason: SkippedAction['reason']): string {
  switch (reason) {
    case 'params_parse_failed':
      return 'action had unparseable params';
    case 'params_validation_failed':
      return 'action params failed validation';
    case 'params_limits_exceeded':
      return 'action params exceeded validation limits';
    default:
      return `action rejected: ${reason}`;
  }
}

function issue(
  kind: FinalizationIssue['kind'],
  code: string,
  message: string,
  location?: FinalizationIssueLocation,
): FinalizationIssue {
  return Object.freeze({
    kind,
    code: code.slice(0, 80),
    message: sanitizeControlChars(message).slice(0, 240),
    ...(location !== undefined && { location: freezeLocation(location) }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_JSON_DEPTH = 32;
const MAX_JSON_WORK = 4096;
const MAX_LOCATION_TEXT = 160;

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    throw new Error('proposal action params must be a JSON object');
  const root: Record<string, unknown> = Object.create(null);
  const pending: {
    source: Record<string, unknown> | unknown[];
    target: Record<string, unknown> | unknown[];
    depth: number;
    ancestors: ReadonlySet<object>;
  }[] = [
    { source: value, target: root, depth: 0, ancestors: new Set([value]) },
  ];
  let work = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    if (current.depth > MAX_JSON_DEPTH)
      throw new Error('proposal action params exceed maximum depth');
    const source = current.source as Record<string, unknown>;
    const targetRecord = current.target as Record<string, unknown>;
    for (const key of Object.keys(source)) {
      work += 1;
      if (work > MAX_JSON_WORK)
        throw new Error('proposal action params exceed validation work limit');
      const child = source[key];
      if (
        child === null ||
        typeof child === 'string' ||
        typeof child === 'boolean'
      ) {
        targetRecord[key] = child;
      } else if (typeof child === 'number' && Number.isFinite(child)) {
        targetRecord[key] = child;
      } else if (Array.isArray(child) || isRecord(child)) {
        if (current.ancestors.has(child))
          throw new Error('proposal action params contain a cycle');
        const target: Record<string, unknown> | unknown[] = Array.isArray(child)
          ? []
          : Object.create(null);
        targetRecord[key] = target;
        pending.push({
          source: child,
          target,
          depth: current.depth + 1,
          ancestors: new Set([...current.ancestors, child]),
        });
      } else {
        throw new Error('proposal action params must contain JSON values');
      }
    }
  }
  return root;
}

function freezeLocation(
  location: FinalizationIssueLocation,
): Readonly<FinalizationIssueLocation> {
  const text = (value: string): string =>
    sanitizeControlChars(value).slice(0, MAX_LOCATION_TEXT);
  return Object.freeze({
    ...location,
    ...('instanceId' in location &&
      location.instanceId !== undefined && {
        instanceId: text(location.instanceId),
      }),
    ...('action' in location &&
      location.action !== undefined && { action: text(location.action) }),
    ...('parameter' in location &&
      location.parameter !== undefined && {
        parameter: text(location.parameter),
      }),
    ...(location.path !== undefined && {
      path: Object.freeze(
        location.path
          .slice(0, 16)
          .map((part) => (typeof part === 'string' ? text(part) : part)),
      ),
    }),
    ...(location.parameterIssueKinds !== undefined && {
      parameterIssueKinds: Object.freeze(
        location.parameterIssueKinds.slice(0, 16).map(text),
      ),
    }),
  });
}
