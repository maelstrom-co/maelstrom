import {
  isDeferred,
  type PlanningInput,
  parseError,
  providerError,
  type Stage,
} from '@maelstrom-co/engine';
import {
  type Ask,
  type GateAnswer,
  readGateAnswers,
  SELECTION_GATES,
  type SelectionGates,
  STAGE_NAME,
  selectGated,
} from '@maelstrom-co/planner-jev/_internal';
import { err, isErr, isOk, ok } from '@maelstrom-co/protocol';
import type { Scenario } from '../../../core/scenarios.js';
import type {
  Judgement,
  StageEvalModule,
  StageTurnRecord,
} from '../../../core/stage-eval.js';
import {
  askRecordingState,
  type ClientBuilder,
  typesafeClientBuilder,
} from '../client-builder.js';
import { expectedGateAnswers } from '../gold-inputs.js';
import { typesafeSettings } from '../typesafe-settings.js';

/** What the gated select stage decided on one turn: every gate answer, the visible instances it selected, and its deferral if it deferred. */
export interface GateReading {
  readonly gates: Required<SelectionGates>;
  /** The ids of the instances the selection leaves visible; absent when the stage deferred. */
  readonly visible?: readonly string[];
  /** The `<stage>/<code>` the stage deferred with after answering the gates; absent when it selected. */
  readonly deferral?: string;
}

/** The selected visible set of one turn against the scenario's expected visible set. */
export interface SelectionReading {
  /** The scenario's expected visible instance ids, sorted. */
  readonly expectedVisible: readonly string[];
  /** The selected visible instance ids, sorted; absent when the stage deferred. */
  readonly visible?: readonly string[];
  /** Whether the selected visible set equals the expected one. */
  readonly pass: boolean;
}

/** What the select stage eval records of one turn. */
export interface SelectTurnDetail {
  /** Every gate the stage asked, with its answer, probability and confidence. */
  readonly gates: Readonly<Record<string, GateAnswer>>;
  /** The expected answer of every judged gate. */
  readonly expected: Readonly<Record<string, 'yes' | 'no'>>;
  /** The stage's deferral reason, when it deferred after answering the gates. */
  readonly deferral?: string;
  /** The selected visible set, when the scenario expects one. */
  readonly selection?: SelectionReading;
}

/** What every select stage variant runs on: the provider client of the turn. */
export interface SelectDeps {
  readonly ask: Ask;
}

/**
 * The select stage variants the eval runs: `gated` is the composed pairs
 * planner's `selectGated`, read through `readGateAnswers` so the eval
 * judges exactly the gates the stage decides, including on turns where
 * the stage then defers.
 */
export const SELECT_VARIANTS: Readonly<
  Record<string, (deps: SelectDeps) => Stage<PlanningInput, GateReading>>
> = {
  gated: (deps) => gatedReading(deps.ask),
};

/** The select stage eval module. */
export type SelectModule = StageEvalModule<
  PlanningInput,
  GateReading,
  SelectTurnDetail,
  SelectDeps
>;

/** What {@link selectModuleWith} takes. */
export interface SelectModuleOptions {
  /** The provider client; TypeSafe on the environment's settings when absent. */
  readonly client?: ClientBuilder;
  /** The `--stage` name; `select` when absent. */
  readonly name?: string;
}

/**
 * The select stage's gates and selection on each scenario's own planning
 * input. A turn passes when every gate with an expected answer (see
 * `expectedGateAnswers`) answered it and, when the scenario expects a
 * visible set, the selection leaves exactly that set visible; a turn that
 * deferred has no selection, so it fails a scenario expecting one. Gates
 * the planner does not ask are ignored, and a scenario with no expected
 * answer for any asked gate is not applicable. A turn where the stage answered the gates and then
 * deferred is still judged and records the deferral reason; a deferral
 * whose reply carries no gate answers is recorded as that deferral,
 * unjudged. A provider failure, an over-cap question or a missing answer
 * is an error, never a deferral.
 */
export function selectModuleWith(
  options: SelectModuleOptions = {},
): SelectModule {
  const client = options.client ?? typesafeClientBuilder(typesafeSettings());
  return {
    name: options.name ?? 'select',
    stage: STAGE_NAME.jevSelect,
    provider: client.provider,
    requiredEnv: client.requiredEnv,
    variants: SELECT_VARIANTS,
    makeDeps: (onCall) => ({ ask: askRecordingState(client, onCall) }),
    configure: async () => ({
      module: selectModuleWith(options),
      meta: { ...client.meta(), inputs: 'scenario request' },
    }),
    prepare: async (scenario, ctx) =>
      Object.keys(judgedGates(scenario)).length === 0
        ? { applicable: false, reason: 'expects no answer for any gate' }
        : { applicable: true, input: ctx.origin, origin: ctx.origin },
    judge: judgeSelect,
    reportSections: (records, variants) => [
      renderGateErrorsSection(records, variants),
      renderSelectionSection(records, variants),
    ],
  };
}

/** {@link selectModuleWith} on TypeSafe with the environment's settings. */
export const selectModule: SelectModule = selectModuleWith();

/** Scores one turn's gate answers and selected visible set against `scenario` (see {@link selectModuleWith}). */
export function judgeSelect(
  scenario: Scenario,
  _input: PlanningInput,
  reading: GateReading,
): Judgement<SelectTurnDetail> {
  const expected = judgedGates(scenario);
  const gates: Readonly<Record<string, GateAnswer>> = reading.gates;
  const failures = Object.entries(expected).flatMap(([gate, answer]) => {
    const actual = gates[gate];
    if (actual?.answer === answer) return [];
    return [
      `${gate}: expected ${answer}, answered ${actual?.answer ?? 'nothing'} (p=${(actual?.probability ?? 0).toFixed(2)})`,
    ];
  });
  const selection = readSelection(scenario, reading);
  if (selection !== undefined && !selection.pass)
    failures.push(
      selection.visible === undefined
        ? `Selected visible: no selection, the stage deferred ${reading.deferral}`
        : `Selected visible: expected ${JSON.stringify(selection.expectedVisible)}, received ${JSON.stringify(selection.visible)}`,
    );
  return {
    outcome: failures.length === 0 ? 'pass' : 'fail',
    failures,
    detail: {
      gates,
      expected,
      ...(reading.deferral !== undefined && { deferral: reading.deferral }),
      ...(selection !== undefined && { selection }),
    },
  };
}

/**
 * Per variant, the judged turns whose scenario expects a visible set and
 * how many selected it, selected another or deferred; then every turn
 * that missed it, with both sets.
 */
export function renderSelectionSection(
  records: readonly StageTurnRecord<SelectTurnDetail>[],
  variants: readonly string[],
): string {
  const judged = records.filter(
    (record) => record.detail?.selection !== undefined,
  );
  const setOf = (ids: readonly string[]) => ids.join(', ');
  const misses = judged.filter((record) => !record.detail?.selection?.pass);
  const lines = [
    '## Selection',
    '',
    'Over the judged turns whose scenario expects a visible set: the turns whose selection left exactly that set visible, another set, or none because the stage deferred.',
    '',
    '| Variant | Turns | Right | Wrong | Deferred |',
    '| --- | --- | --- | --- | --- |',
    ...variants.map((variant) => {
      const own = judged.filter((record) => record.variant === variant);
      const right = own.filter((record) => record.detail?.selection?.pass);
      const deferred = own.filter(
        (record) => record.detail?.selection?.visible === undefined,
      );
      return `| ${variant} | ${own.length} | ${right.length} | ${own.length - right.length - deferred.length} | ${deferred.length} |`;
    }),
  ];
  if (misses.length > 0)
    lines.push(
      '',
      'Every turn that missed the expected visible set.',
      '',
      '| Scenario | Suite | Variant | Repeat | Expected visible | Selected visible |',
      '| --- | --- | --- | --- | --- | --- |',
      ...misses.map((record) => {
        const selection = record.detail?.selection;
        const selected =
          selection?.visible === undefined
            ? `deferred ${record.detail?.deferral}`
            : setOf(selection.visible);
        return `| ${record.scenarioId} | ${record.suite} | ${record.variant} | ${record.repeat} | ${setOf(selection?.expectedVisible ?? [])} | ${selected} |`;
      }),
    );
  return lines.join('\n');
}

/**
 * Per variant and gate, the judged turns and their false positives
 * (answered yes, expected no) and false negatives; then every miss with
 * its probability, so a threshold change can be read off.
 */
export function renderGateErrorsSection(
  records: readonly StageTurnRecord<SelectTurnDetail>[],
  variants: readonly string[],
): string {
  const judged = records.filter((record) => record.detail !== undefined);
  const misses = judged.flatMap((record) =>
    Object.entries(record.detail?.expected ?? {}).flatMap(
      ([gate, expected]) => {
        const actual = record.detail?.gates[gate];
        return actual === undefined || actual.answer === expected
          ? []
          : [{ record, gate, expected, probability: actual.probability }];
      },
    ),
  );
  const lines = [
    '## Gate errors',
    '',
    'Over the turns whose stage answered the gates, per gate with an expected answer. A false positive answered yes where no was expected.',
    '',
    '| Variant | Gate | Judged turns | False positives | False negatives |',
    '| --- | --- | --- | --- | --- |',
    ...variants.flatMap((variant) =>
      SELECTION_GATES.map((gate) => {
        const own = judged.filter(
          (record) =>
            record.variant === variant &&
            record.detail?.expected[gate] !== undefined,
        );
        const wrong = misses.filter(
          (miss) => miss.record.variant === variant && miss.gate === gate,
        );
        const positives = wrong.filter((miss) => miss.expected === 'no');
        return `| ${variant} | ${gate} | ${own.length} | ${positives.length} | ${wrong.length - positives.length} |`;
      }),
    ),
  ];
  if (misses.length > 0)
    lines.push(
      '',
      'Every miss, by gate, expected answer and probability of yes.',
      '',
      '| Scenario | Suite | Variant | Repeat | Gate | Expected | Probability |',
      '| --- | --- | --- | --- | --- | --- | --- |',
      ...[...misses]
        .sort(
          (a, b) =>
            a.gate.localeCompare(b.gate) ||
            a.expected.localeCompare(b.expected) ||
            a.probability - b.probability ||
            a.record.scenarioId.localeCompare(b.record.scenarioId),
        )
        .map(
          ({ record, gate, expected, probability }) =>
            `| ${record.scenarioId} | ${record.suite} | ${record.variant} | ${record.repeat} | ${gate} | ${expected} | ${probability.toFixed(2)} |`,
        ),
    );
  return lines.join('\n');
}

function gatedReading(ask: Ask): Stage<PlanningInput, GateReading> {
  return async (input, ctx) => {
    let reply: Parameters<typeof readGateAnswers>[0] | undefined;
    const keepReply: Ask = async (stage, evaluation, callCtx) => {
      const result = await ask(stage, evaluation, callCtx);
      if (isOk(result)) reply = result.value;
      return result;
    };
    const selected = await selectGated(keepReply)(input, ctx);
    if (isOk(selected))
      return ok({
        gates: selected.value.gates,
        visible: selected.value.instances
          .filter((instance) => instance.visible)
          .map((instance) => String(instance.instanceId)),
      });
    if (!isDeferred(selected.error)) return selected;
    const { reason } = selected.error;
    const code = reason.slice(reason.indexOf('/') + 1);
    if (code === 'answer_missing')
      return err(parseError(reason, JSON.stringify(reply ?? null)));
    if (code === 'option_cap' || code.startsWith('provider_'))
      return err(providerError(reason, undefined));
    if (reply === undefined) return selected;
    const gates = readGateAnswers(reply, ctx);
    if (isErr(gates)) return selected;
    return ok({ gates: gates.value, deferral: reason });
  };
}

function readSelection(
  scenario: Scenario,
  reading: GateReading,
): SelectionReading | undefined {
  if (scenario.expected.visible === undefined) return undefined;
  const expectedVisible = [...scenario.expected.visible].sort();
  if (reading.visible === undefined) return { expectedVisible, pass: false };
  const visible = [...reading.visible].sort();
  return {
    expectedVisible,
    visible,
    pass: JSON.stringify(visible) === JSON.stringify(expectedVisible),
  };
}

function judgedGates(
  scenario: Scenario,
): Readonly<Record<string, 'yes' | 'no'>> {
  const expected = expectedGateAnswers(scenario);
  return Object.fromEntries(
    SELECTION_GATES.flatMap((gate) =>
      expected[gate] === undefined ? [] : [[gate, expected[gate]]],
    ),
  );
}
