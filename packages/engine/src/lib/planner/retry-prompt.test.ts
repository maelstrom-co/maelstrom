import { describe, expect, test } from 'bun:test';
import type { TilingSplitToken } from '@maelstrom-co/protocol';
import {
  ActionName,
  InstanceId,
  MessageId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import type { SkippedAction } from '../response/execution-plan/index.js';
import type {
  DiagnosticRecords,
  InternalResponse,
} from '../response/response-processor.js';
import { buildDiagnostics } from '../response/response-processor.js';
import type {
  DroppedLayoutEntry,
  LayoutWarning,
  RetryHint,
} from '../validation/llm-output/healed-layout.js';
import { deriveRetryHint } from '../validation/llm-output/retry-hint.js';

import { buildRetryPrompt } from './retry-prompt.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface DiagnosticsInput {
  skippedActions?: readonly SkippedAction[];
  droppedLayoutEntries?: readonly DroppedLayoutEntry[];
  warnings?: readonly LayoutWarning[];
  retryHint?: RetryHint;
}

const cleanHint: RetryHint = { severity: 'none', recommend: false };

const response = (input: DiagnosticsInput = {}): InternalResponse => ({
  type: 'maelstrom_response',
  requestId: MessageId('req-1'),
  userMessage: 'ok',
  rationale: 'because',
  executionPlan: [],
  layout: { type: 'grid', positions: [] },
  diagnostics: buildDiagnostics({
    skippedActions: input.skippedActions ?? [],
    droppedLayoutEntries: input.droppedLayoutEntries ?? [],
    warnings: input.warnings ?? [],
    retryHint: input.retryHint ?? cleanHint,
  }),
});

const recommendingResponse = (
  input: Omit<DiagnosticsInput, 'retryHint'> & {
    severity?: 'medium' | 'unrecoverable';
  } = {},
): InternalResponse => {
  const severity = input.severity ?? 'unrecoverable';
  const hint: RetryHint =
    severity === 'unrecoverable'
      ? { severity: 'unrecoverable', recommend: true }
      : { severity: 'medium', recommend: true };
  return response({ ...input, retryHint: hint });
};

const overflowDrop = (id: string): DroppedLayoutEntry => ({
  reason: 'position_overflow',
  instanceId: InstanceId(id),
  row: 10,
  column: 5,
  width: 4,
  height: 3,
  chartColumns: 12,
  chartRows: 8,
});

const paramsParseFailed = (id: string, action: string): SkippedAction => ({
  reason: 'params_parse_failed',
  instanceId: InstanceId(id),
  action: ActionName(action),
});

const stateDrift = (id: string, action: string): SkippedAction => ({
  reason: 'state_drift',
  instanceId: InstanceId(id),
  action: ActionName(action),
  vesselId: VesselId('v'),
  targetVariant: VariantName('gone'),
});

// ---------------------------------------------------------------------------
// buildRetryPrompt: diagnostic content per heal outcome
// ---------------------------------------------------------------------------

describe('buildRetryPrompt diagnostic content', () => {
  test('a recommended retry carries the drop and the original request', () => {
    const failed = recommendingResponse({
      droppedLayoutEntries: [overflowDrop('a')],
    });
    const prompt = buildRetryPrompt('do the thing', failed.diagnostics);

    expect(prompt).toContain('previous response had issues');
    expect(prompt).toContain('do the thing');
    expect(prompt).toContain(
      'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
    );
  });

  test('retry prompt reproduces the original user prompt verbatim', () => {
    const original =
      'Make the chart show three panels: \n  - top: orders\n  - middle: trades\n  - bottom: positions';
    const failed = recommendingResponse({
      droppedLayoutEntries: [overflowDrop('a')],
    });
    const prompt = buildRetryPrompt(original, failed.diagnostics);

    expect(prompt).toContain('Original request:');
    expect(prompt.endsWith(original)).toBe(true);
  });

  test('retry prompt suppresses state_drift skipped actions', () => {
    const failed = recommendingResponse({
      skippedActions: [paramsParseFailed('a', 'go'), stateDrift('b', 'wander')],
      severity: 'medium',
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain(
      'Action "go" on instance "a" had unparseable params',
    );
    expect(prompt).not.toContain('"b"');
    expect(prompt).not.toContain('wander');
  });

  test('retry prompt collapses every tree_* drop into a single advisory line', () => {
    const failed = recommendingResponse({
      droppedLayoutEntries: [
        { reason: 'tree_missing_child', atTokenIndex: 3 },
        {
          reason: 'tree_orphan_reference',
          atTokenIndex: 5,
          instanceId: InstanceId('lost'),
        },
        { reason: 'tree_extra_tokens', fromTokenIndex: 10, count: 2 },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain(
      'tiling tree was malformed and could not be fully parsed',
    );
    // Token-position fields must not leak — they mean nothing to the LLM.
    expect(prompt).not.toMatch(/atTokenIndex|fromTokenIndex|token index/);
    // No per-drop tree line should survive.
    const treeLines = prompt?.split('\n').filter((l) => /tiling tree/i.test(l));
    expect(treeLines).toHaveLength(1);
  });

  test('the tree advisory teaches the grammar the same request carries', () => {
    // The schema description shipped alongside this prompt teaches weighted
    // n-ary splits. An advisory telling the model to re-emit a binary tree
    // using only H/V contradicts it, and fires on retries that had nothing
    // to do with weights.
    const failed = recommendingResponse({
      droppedLayoutEntries: [{ reason: 'tree_missing_child', atTokenIndex: 3 }],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).not.toContain('binary');
    expect(prompt).toContain('as many subtrees as it declares weights');
  });

  test('a repeated leaf gets its own line naming the instance', () => {
    // Collapsing this into the malformed-tree advisory tells a model whose
    // tree parsed perfectly that it could not be parsed, and never names
    // the id it repeated.
    //
    // The repeat itself never asks for a retry — blanking it still leaves
    // a renderable layout — so the hint here is derived from the skip
    // beside it rather than asserted into existence.
    const skipped = paramsParseFailed('a', 'go');
    const retryHint = deriveRetryHint({
      healedLayoutSize: 1,
      requestInstanceCount: 2,
      proposedActionCount: 1,
      acceptedActionCount: 0,
      skippedActions: [skipped],
      droppedLayoutCount: 1,
      warningCount: 0,
    });
    expect(retryHint).toEqual({ severity: 'medium', recommend: true });

    const failed = response({
      skippedActions: [skipped],
      droppedLayoutEntries: [
        {
          reason: 'tree_duplicate_leaf',
          atTokenIndex: 3,
          instanceId: InstanceId('calendar-main'),
        },
      ],
      retryHint,
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('"calendar-main"');
    expect(prompt).toContain('at most once');
    expect(prompt).not.toContain('could not be fully parsed');
  });

  test('an over-wide split reports the count it declared', () => {
    const failed = recommendingResponse({
      droppedLayoutEntries: [
        {
          reason: 'tree_split_truncated',
          atTokenIndex: 0,
          declaredChildCount: 20,
          keptChildCount: 12,
        },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('declared 20 children');
    expect(prompt).toContain('at most 12');
  });

  test('a repaired weight suffix reaches the model verbatim', () => {
    // Repair-instead-of-reject is only safe if the repair is observable.
    const failed = recommendingResponse({
      warnings: [
        {
          kind: 'split_weights_repaired',
          atTokenIndex: 2,
          token: 'V:xyz',
          weights: [1, 1],
          repairReason: 'unreadable',
        },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('Layout repairs:');
    expect(prompt).toContain('"V:xyz"');
    expect(prompt).toContain('read as 2 children weighted 1,1');
  });

  test('an over-wide split is never reported as an unreadable suffix', () => {
    // A token whose only fault is declaring too many children still parses
    // as `repaired`, so the repair line must not contradict the truncation
    // drop line rendered from the same token.
    const failed = recommendingResponse({
      droppedLayoutEntries: [
        {
          reason: 'tree_split_truncated',
          atTokenIndex: 0,
          declaredChildCount: 14,
          keptChildCount: 12,
        },
      ],
      warnings: [
        {
          kind: 'split_weights_repaired',
          atTokenIndex: 0,
          token: 'V:1,1,1,1,1,1,1,1,1,1,1,1,1,1',
          weights: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
          repairReason: 'truncated',
        },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('declared 14 children');
    expect(prompt).not.toContain('unreadable weight suffix');
  });

  test('a one-weight split is reported as short, not as illegible', () => {
    // "V:5" spells its weight exactly as the grammar asks; the arity is the
    // only thing missing, so telling the model its suffix was unreadable
    // sends it after a defect the token does not have.
    const failed = recommendingResponse({
      warnings: [
        {
          kind: 'split_weights_repaired',
          atTokenIndex: 0,
          token: 'V:5',
          weights: [5, 1],
          repairReason: 'padded',
        },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain(
      'declared fewer than the two weights a split needs',
    );
    expect(prompt).not.toContain('unreadable weight suffix');
  });

  test('an omitted rationale is not filed under layout repairs', () => {
    // Nothing about the layout was rewritten, so filing it under repairs
    // teaches the model to go fix a tree that was fine.
    const failed = recommendingResponse({
      skippedActions: [paramsParseFailed('a', 'go')],
      warnings: [{ kind: 'missing_rationale' }],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('Response quality:');
    expect(prompt).not.toContain('Layout repairs:');
    expect(prompt).toContain('omitted its rationale');
  });

  test('a drop and a repair in one response render as two sections', () => {
    // Each section is covered alone elsewhere; this pins that neither one
    // swallows the other when both are non-empty, and that drops precede
    // repairs.
    const failed = recommendingResponse({
      droppedLayoutEntries: [
        {
          reason: 'tree_duplicate_leaf',
          atTokenIndex: 3,
          instanceId: InstanceId('calendar-main'),
        },
      ],
      warnings: [
        {
          kind: 'split_weights_repaired',
          atTokenIndex: 0,
          token: 'V:xyz',
          weights: [1, 1],
          repairReason: 'unreadable',
        },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('Layout drops:');
    expect(prompt).toContain('"calendar-main"');
    expect(prompt).toContain('Layout repairs:');
    expect(prompt).toContain('"V:xyz"');
    expect(prompt.indexOf('Layout drops:')).toBeLessThan(
      prompt.indexOf('Layout repairs:'),
    );
  });

  test('retry prompt mixes per-instance drops with the tree advisory', () => {
    // Mixed-drop coverage: a future refactor that early-returns on hitting
    // a tree drop would silently strip per-instance drops; this test would
    // fail on the missing per-instance line.
    const failed = recommendingResponse({
      droppedLayoutEntries: [
        overflowDrop('a'),
        { reason: 'tree_missing_child', atTokenIndex: 7 },
      ],
    });
    const prompt = buildRetryPrompt('p', failed.diagnostics);

    expect(prompt).toContain('exceeds chart bounds');
    expect(prompt).toContain(
      'tiling tree was malformed and could not be fully parsed',
    );
    const treeLines = prompt?.split('\n').filter((l) => /tiling tree/i.test(l));
    expect(treeLines).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// buildRetryPrompt — direct format pinning
// ---------------------------------------------------------------------------

const recommendUnrecoverable: RetryHint = {
  severity: 'unrecoverable',
  recommend: true,
};
const recommendMedium: RetryHint = { severity: 'medium', recommend: true };

describe('buildRetryPrompt', () => {
  test('no diagnostics → only the header + original prompt', () => {
    const out = retryPrompt('original', {
      skippedActions: [],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendUnrecoverable,
    });

    expect(out).toBe(
      [
        'The previous response had issues. Please re-issue the response addressing:',
        '',
        'Original request:',
        'original',
      ].join('\n'),
    );
  });

  test('layout drops and skipped actions appear in their own sections', () => {
    const malformedParams = '{"secret":"do-not-repeat"';
    const skipped = {
      ...paramsParseFailed('b', 'doIt'),
      // Runtime diagnostics may outlive their originating Engine version.
      paramsJson: malformedParams,
    } as unknown as SkippedAction;
    const out = retryPrompt('orig', {
      skippedActions: [skipped],
      droppedLayoutEntries: [overflowDrop('a')],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(out).toContain('Layout drops:');
    expect(out).toContain('Skipped actions:');
    expect(out).toContain(
      'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
    );
    expect(out).toContain(
      'Action "doIt" on instance "b" had unparseable params',
    );
    expect(out).not.toContain(malformedParams);
    expect(out).not.toContain('do-not-repeat');
    expect(out).toContain('orig');
  });

  // Pin every per-instance DroppedLayoutEntry formatter via the shared
  // formatDroppedEntry helper. Tree drops are tested separately above
  // (collapse to single advisory).
  test.each([
    [
      { reason: 'unknown_instance' as const, instanceId: InstanceId('ghost') },
      'instance "ghost" not in request',
    ],
    [
      {
        reason: 'unknown_vessel' as const,
        instanceId: InstanceId('orphan'),
        vesselId: VesselId('no-such'),
      },
      'instance "orphan" referenced unknown vessel "no-such"',
    ],
    [
      {
        reason: 'unknown_variant' as const,
        instanceId: InstanceId('wgt'),
        variant: VariantName('gone'),
      },
      'instance "wgt" referenced unknown variant "gone"',
    ],
    [
      {
        reason: 'position_overflow' as const,
        instanceId: InstanceId('a'),
        row: 10,
        column: 5,
        width: 4,
        height: 3,
        chartColumns: 12,
        chartRows: 8,
      },
      'instance "a" at (10,5) size 4x3 exceeds chart bounds (12x8)',
    ],
    [
      {
        reason: 'size_below_minimum' as const,
        instanceId: InstanceId('small'),
        width: 1,
        height: 1,
        minWidth: 4,
        minHeight: 3,
      },
      'instance "small" size 1x1 below variant minimum 4x3',
    ],
    [
      {
        reason: 'duplicate_instance_id' as const,
        instanceId: InstanceId('dupe'),
      },
      'instance "dupe" appeared multiple times in layout',
    ],
  ] satisfies Array<
    [DroppedLayoutEntry, string]
  >)('formats DroppedLayoutEntry %p', (drop, expected) => {
    const out = retryPrompt('orig', {
      skippedActions: [],
      droppedLayoutEntries: [drop],
      warnings: [],
      retryHint: recommendMedium,
    });
    expect(out).toContain(`- ${expected}`);
  });

  // Pin every non-state_drift SkippedAction formatter.
  test.each([
    [
      paramsParseFailed('a', 'go'),
      'Action "go" on instance "a" had unparseable params',
    ],
    [
      {
        reason: 'unknown_instance' as const,
        instanceId: InstanceId('ghost'),
        action: ActionName('tap'),
      },
      'Action "tap" referenced unknown instance "ghost"',
    ],
    [
      {
        reason: 'unknown_vessel' as const,
        instanceId: InstanceId('a'),
        action: ActionName('tap'),
        vesselId: VesselId('no-such'),
      },
      'Action "tap" on instance "a" referenced unknown vessel "no-such"',
    ],
    [
      {
        reason: 'no_simulated_variant' as const,
        instanceId: InstanceId('a'),
        action: ActionName('tap'),
      },
      'Action "tap" on instance "a" — no current variant to act on',
    ],
    [
      {
        reason: 'variant_not_on_vessel' as const,
        instanceId: InstanceId('a'),
        action: ActionName('tap'),
        vesselId: VesselId('v'),
        variant: VariantName('phantom'),
      },
      'variant "phantom" is not defined on vessel "v"',
    ],
    [
      {
        reason: 'action_not_valid' as const,
        instanceId: InstanceId('a'),
        action: ActionName('badAction'),
        vesselId: VesselId('v'),
        variant: VariantName('default'),
        validActions: [ActionName('x'), ActionName('y')],
      },
      'Action "badAction" is not valid on instance "a" in variant "default" — valid actions: "x", "y"',
    ],
    [
      {
        reason: 'self_transition_noop' as const,
        instanceId: InstanceId('cal-main'),
        action: ActionName('showWeek'),
        vesselId: VesselId('calendar'),
        currentVariant: VariantName('week'),
      },
      'Action "showWeek" on instance "cal-main" is already a no-op — instance "cal-main" is already in variant "week". Omit this specific (instance, action) pair from your next response. Other instances may still legitimately call "showWeek".',
    ],
    [
      {
        reason: 'non_idempotent_on_resize' as const,
        instanceId: InstanceId('tasks-main'),
        action: ActionName('addTask'),
        vesselId: VesselId('task-list'),
      },
      'Action "addTask" on instance "tasks-main" was refused: this update was triggered by a chart resize alone, so only actions declared idempotent and called with no parameters may run. Omit this specific (instance, action) pair from your next response.',
    ],
    [
      {
        reason: 'parameterized_on_resize' as const,
        instanceId: InstanceId('weather-main'),
        action: ActionName('setLocation'),
        vesselId: VesselId('weather'),
      },
      'Action "setLocation" on instance "weather-main" was refused: it carries parameters and this update was triggered by a chart resize alone, so only actions called with no parameters may run. Omit this specific (instance, action) pair from your next response.',
    ],
  ] satisfies Array<
    [SkippedAction, string]
  >)('formats SkippedAction %p', (skipped, expected) => {
    const out = retryPrompt('orig', {
      skippedActions: [skipped],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });
    expect(out).toContain(expected);
  });

  test('action_not_valid with empty validActions formats "(none)"', () => {
    const out = retryPrompt('orig', {
      skippedActions: [
        {
          reason: 'action_not_valid',
          instanceId: InstanceId('a'),
          action: ActionName('go'),
          vesselId: VesselId('v'),
          variant: VariantName('default'),
          validActions: [],
        },
      ],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(out).toContain('valid actions: (none)');
  });

  test('state_drift skipped actions are suppressed', () => {
    const out = retryPrompt('orig', {
      skippedActions: [stateDrift('a', 'go')],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(out).not.toContain('Skipped actions:');
    expect(out).not.toContain('"a"');
    expect(out).not.toContain('go');
  });

  test('resource and definition skips add no retry diagnostics', () => {
    const out = retryPrompt('original', {
      skippedActions: [
        { reason: 'params_limits_exceeded', limit: 'traversal_work' },
        { reason: 'invalid_action_definition' },
      ],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: { severity: 'medium', recommend: false },
    });

    expect(out).toBe(
      [
        'The previous response had issues. Please re-issue the response addressing:',
        '',
        'Original request:',
        'original',
      ].join('\n'),
    );
  });

  test('quotes and sanitizes every model-derived diagnostic identifier', () => {
    const injected =
      'line\ncarriage\rcontrol\u0000quote"slash\\ls\u2028ps\u2029';
    const id = (prefix: string) => `${prefix}-${injected}`;
    const out = retryPrompt('original\nrequest stays verbatim', {
      skippedActions: [
        {
          reason: 'params_validation_failed',
          instanceId: InstanceId(id('instance')),
          action: ActionName(id('action')),
          issues: [{ kind: 'unknown_parameter', parameter: id('parameter') }],
        },
        {
          reason: 'unknown_vessel',
          instanceId: InstanceId(id('instance-vessel')),
          action: ActionName(id('action-vessel')),
          vesselId: VesselId(id('vessel')),
        },
        {
          reason: 'action_not_valid',
          instanceId: InstanceId(id('instance-valid')),
          action: ActionName(id('action-invalid')),
          vesselId: VesselId(id('vessel-valid')),
          variant: VariantName(id('variant')),
          validActions: [ActionName(id('valid-action'))],
        },
      ],
      droppedLayoutEntries: [
        {
          reason: 'unknown_vessel',
          instanceId: InstanceId(id('layout-instance')),
          vesselId: VesselId(id('layout-vessel')),
        },
        {
          reason: 'unknown_variant',
          instanceId: InstanceId(id('layout-variant-instance')),
          variant: VariantName(id('layout-variant')),
        },
      ],
      warnings: [],
      retryHint: recommendMedium,
    });
    const diagnostics = retryDiagnosticSection(out);

    for (const prefix of [
      'instance',
      'action',
      'parameter',
      'vessel',
      'variant',
      'valid-action',
      'layout-instance',
      'layout-vessel',
      'layout-variant',
    ]) {
      const sanitized = id(prefix).replace(/[\p{Cc}\u2028\u2029]/gu, '\uFFFD');
      expect(diagnostics).toContain(JSON.stringify(sanitized));
    }
    for (const codePoint of [
      ...Array.from({ length: 32 }, (_, value) => value).filter(
        (value) => value !== 10,
      ),
      ...Array.from({ length: 33 }, (_, value) => value + 127),
      0x2028,
      0x2029,
    ]) {
      expect(diagnostics).not.toContain(String.fromCodePoint(codePoint));
    }
    expect(diagnostics).not.toContain('line\ncarriage');
    expect(out.endsWith('original\nrequest stays verbatim')).toBe(true);
  });

  test('accepts 128 identifier code points and truncates 129', () => {
    const atLimit = '😀'.repeat(128);
    const overLimit = `${atLimit}x`;
    const atLimitOutput = retryPrompt('original', {
      skippedActions: [paramsParseFailed('instance', atLimit)],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });
    const overLimitOutput = retryPrompt('original', {
      skippedActions: [paramsParseFailed('instance', overLimit)],
      droppedLayoutEntries: [],
      warnings: [],
      retryHint: recommendMedium,
    });

    expect(retryDiagnosticSection(atLimitOutput)).toContain(
      JSON.stringify(atLimit),
    );
    expect(retryDiagnosticSection(atLimitOutput)).not.toContain('[truncated]');
    expect(retryDiagnosticSection(overLimitOutput)).toContain(
      JSON.stringify(`${atLimit}…[truncated]`),
    );
    expect(retryDiagnosticSection(overLimitOutput)).not.toContain(overLimit);
  });

  test('renders 16 list identifiers and summarizes the seventeenth', () => {
    const makeOutput = (count: number) =>
      retryPrompt('original', {
        skippedActions: [
          {
            reason: 'action_not_valid',
            instanceId: InstanceId('instance'),
            action: ActionName('invalid'),
            vesselId: VesselId('vessel'),
            variant: VariantName('variant'),
            validActions: Array.from({ length: count }, (_, index) =>
              ActionName(`valid-${index}`),
            ),
          },
        ],
        droppedLayoutEntries: [],
        warnings: [],
        retryHint: recommendMedium,
      });
    const atLimit = retryDiagnosticSection(makeOutput(16));
    const overLimit = retryDiagnosticSection(makeOutput(17));

    for (let index = 0; index < 16; index += 1) {
      expect(atLimit).toContain(JSON.stringify(`valid-${index}`));
      expect(overLimit).toContain(JSON.stringify(`valid-${index}`));
    }
    expect(atLimit).not.toContain('identifier omitted');
    expect(overLimit).not.toContain(JSON.stringify('valid-16'));
    expect(overLimit).toContain('1 additional identifier omitted');
  });

  test('renders at most 32 diagnostic lines', () => {
    const makeOutput = (count: number) =>
      retryPrompt('original', {
        skippedActions: Array.from({ length: count }, (_, index) =>
          paramsParseFailed(`instance-${index}`, `action-${index}`),
        ),
        droppedLayoutEntries: [],
        warnings: [],
        retryHint: recommendMedium,
      });
    const atLimit = retryDiagnosticSection(makeOutput(32));
    const overLimit = retryDiagnosticSection(makeOutput(33));

    expect(diagnosticBulletLines(atLimit)).toHaveLength(32);
    expect(atLimit).toContain(JSON.stringify('action-31'));
    expect(atLimit).not.toContain('diagnostic lines omitted');
    expect(diagnosticBulletLines(overLimit)).toHaveLength(32);
    expect(overLimit).toContain(JSON.stringify('action-30'));
    expect(overLimit).not.toContain(JSON.stringify('action-31'));
    expect(overLimit).not.toContain(JSON.stringify('action-32'));
    expect(overLimit).toContain('2 diagnostic lines omitted');
  });

  test('caps the diagnostic section at 8192 UTF-8 bytes', () => {
    const makeOutput = (finalAsciiCount: number) =>
      retryPrompt('original', {
        skippedActions: [
          ...Array.from({ length: 14 }, (_, index) =>
            paramsParseFailed(`i-${index}`, '😀'.repeat(128)),
          ),
          paramsParseFailed(
            'last',
            `${'😀'.repeat(27)}${'x'.repeat(finalAsciiCount)}`,
          ),
        ],
        droppedLayoutEntries: [],
        warnings: [],
        retryHint: recommendMedium,
      });
    const atLimit = retryDiagnosticSection(makeOutput(100));
    const overLimit = retryDiagnosticSection(makeOutput(101));

    expect(new TextEncoder().encode(atLimit).byteLength).toBe(8_192);
    expect(atLimit).not.toContain('diagnostic text omitted');
    expect(new TextEncoder().encode(overLimit).byteLength).toBeLessThanOrEqual(
      8_192,
    );
    expect(overLimit).toContain('diagnostic text omitted');
    expect(overLimit).not.toContain(JSON.stringify('last'));
  });

  // The line ceiling used to be applied after every entry had been rendered,
  // so a response carrying hundreds of thousands of drops paid for hundreds
  // of thousands of interpolated strings to publish 32 of them. Each spy
  // counts reads of the one field its renderer interpolates.
  describe('formatting stops at the line ceiling', () => {
    test('skipped actions past the ceiling are counted, not rendered', () => {
      let rendered = 0;
      const skippedActions = Array.from(
        { length: 200 },
        (_, index): SkippedAction => ({
          reason: 'params_parse_failed',
          instanceId: InstanceId(`instance-${index}`),
          get action() {
            rendered += 1;
            return ActionName(`action-${index}`);
          },
        }),
      );

      const section = retryDiagnosticSection(
        retryPrompt('original', {
          skippedActions,
          droppedLayoutEntries: [],
          warnings: [],
          retryHint: recommendMedium,
        }),
      );

      expect(rendered).toBe(32);
      expect(section).toContain('169 diagnostic lines omitted');
    });

    test('layout drops past the ceiling are counted, not rendered', () => {
      let rendered = 0;
      const droppedLayoutEntries = Array.from(
        { length: 200 },
        (_, index): DroppedLayoutEntry => ({
          reason: 'position_overflow',
          row: 10,
          column: 5,
          width: 4,
          height: 3,
          chartColumns: 12,
          chartRows: 8,
          get instanceId() {
            rendered += 1;
            return InstanceId(`instance-${index}`);
          },
        }),
      );

      const section = retryDiagnosticSection(
        retryPrompt('original', {
          skippedActions: [],
          droppedLayoutEntries,
          warnings: [],
          retryHint: recommendMedium,
        }),
      );

      expect(rendered).toBe(32);
      expect(section).toContain('169 diagnostic lines omitted');
    });

    test('layout warnings past the ceiling are counted, not rendered', () => {
      let rendered = 0;
      const warnings = Array.from(
        { length: 200 },
        (): LayoutWarning => ({
          kind: 'split_weights_repaired',
          atTokenIndex: 2,
          weights: [1, 1],
          repairReason: 'unreadable',
          get token(): TilingSplitToken {
            rendered += 1;
            return 'V:xyz';
          },
        }),
      );

      const section = retryDiagnosticSection(
        retryPrompt('original', {
          skippedActions: [],
          droppedLayoutEntries: [],
          warnings,
          retryHint: recommendMedium,
        }),
      );

      expect(rendered).toBe(32);
      expect(section).toContain('169 diagnostic lines omitted');
    });
  });
});

const RETRY_HEADER =
  'The previous response had issues. Please re-issue the response addressing:\n\n';

function retryPrompt(original: string, records: DiagnosticRecords): string {
  return buildRetryPrompt(original, buildDiagnostics(records));
}

function retryDiagnosticSection(prompt: string): string {
  const end = prompt.indexOf('\n\nOriginal request:');
  if (!prompt.startsWith(RETRY_HEADER) || end < 0) return '';
  return prompt.slice(RETRY_HEADER.length, end);
}

function diagnosticBulletLines(section: string): string[] {
  return section.split('\n').filter((line) => line.startsWith('- '));
}
