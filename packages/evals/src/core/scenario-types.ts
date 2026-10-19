import type { LLMContextMessage } from '@maelstrom-co/engine';
import type { ChartRequest } from '@maelstrom-co/protocol';
import type { Phase } from './plugin.js';
import type { ArrangementRule } from './predicates.js';

export type Suite = 'development' | 'holdout';

export interface ExpectedAction {
  readonly instanceId: string;
  readonly action: string;
  /** Omitted: the parameters are not scored. */
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface ExpectedAsk {
  readonly instanceId: string;
  readonly action: string;
  readonly parameter: string;
}

export interface Expectation {
  readonly status: 'planned' | 'deferred';
  /** For `deferred`: the phase that should defer (`select`, `actions`, `layout`), as each plugin maps it to a stage. Omitted: any stage. */
  readonly deferStage?: Phase;
  /**
   * For `deferred` at the `layout` phase: why the scenario expects the
   * layout to defer, for stage evals that check the reason.
   * `arrangement_not_stated` when the request asks for an arrangement that
   * the planner's own layout questions cannot express, so they leave the
   * board as it is. Omitted: no arrangement of the visible Instances fits
   * the Chart.
   */
  readonly deferCause?: 'arrangement_not_stated';
  readonly visible?: readonly string[];
  readonly retained?: readonly string[];
  /** A reference tree the arrangement rules accept; not scored. */
  readonly tree?: readonly (string | null)[];
  /** Rules the shipped tree must satisfy, whichever arm or fallback wrote it. */
  readonly arrangement?: readonly ArrangementRule[];
  readonly actions?: readonly ExpectedAction[];
  /** Values the POC should ask the user for, its actions dropped. */
  readonly asks?: readonly ExpectedAsk[];
  /**
   * Parameters whose value the request names so that no listed option
   * clearly matches it, or several could: a planner must not bind one to a
   * listed option on its own. Leaving it to a later stage, asking for it or
   * deferring all count.
   */
  readonly noListedMatch?: readonly ExpectedAsk[];
  /**
   * Gate name to the answer a gated select stage should give. Plugins
   * judge the gates they know and ignore the rest.
   */
  readonly expectedGates?: Readonly<Record<string, 'yes' | 'no'>>;
}

export interface Scenario {
  readonly id: string;
  readonly suite: Suite;
  readonly title: string;
  readonly request: ChartRequest;
  /** Prior conversation handed to the planner. */
  readonly history?: readonly LLMContextMessage[];
  readonly expected: Expectation;
  /**
   * Whether the request asks for an arrangement (`true`) or is a control
   * that should leave the arrangement alone (`false`), for counting a
   * spatial gate's false positives and negatives. Untagged scenarios are
   * not counted.
   */
  readonly spatial?: boolean;
}
