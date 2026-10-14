import {
  type DecisionsClientOptions,
  type JevCall,
  renderSelectStateAsProse,
  type StageName,
} from '@maelstrom-co/planner-jev/_internal';
import type { PlannerEvalPlugin } from '../../core/plugin.js';
import { registerStageEval } from '../../core/stage-eval.js';
import { jevPlugin, stagePluginWith } from '../jev/plugin.js';
import { selectModuleWith } from '../jev/stages/select.js';
import { decisionsArms } from './arms.js';
import { decisionsClientBuilder } from './client-builder.js';
import { decisionsSettings } from './decisions-settings.js';

/** What {@link decisionsPluginWith} takes: Decisions settings, for tests that script the transport. */
export interface DecisionsPluginOptions {
  /** Overrides for the Decisions client; `OPENAI_API_KEY` and the Decisions model fill the rest. */
  readonly decisions?: Partial<Omit<DecisionsClientOptions, 'onCall'>>;
}

/**
 * The stage-library planners on OpenAI Decisions as an eval plugin: the
 * arms of {@link decisionsArms} and the `decisions-select`,
 * `decisions-actions` and `decisions-layout` stage evals, plus
 * `decisions-select-prose`, which sends the select state as prose
 * (`renderSelectStateAsProse`). It has no default arms and no judge, so
 * `--grader` stays on the Jev plugin's judge, and it adds no report rows
 * when a Jev arm runs beside it, since the Jev plugin's rows cover its
 * columns.
 */
export function decisionsPluginWith(
  options: DecisionsPluginOptions = {},
): PlannerEvalPlugin<JevCall, StageName> {
  const client = decisionsClientBuilder(decisionsSettings(options.decisions));
  const proseClient = decisionsClientBuilder(
    decisionsSettings({
      ...options.decisions,
      render: renderSelectStateAsProse,
    }),
  );
  const arms = decisionsArms(client, proseClient);
  const plugin = stagePluginWith({
    name: 'decisions',
    client,
    arms,
    stageNames: {
      select: 'decisions-select',
      actions: 'decisions-actions',
      layout: 'decisions-layout',
    },
    spatialRecordsArms: {
      names: () => arms.map((arm) => arm.name),
      fallback: 'decisions-composed-pairs',
    },
    rowsDeferTo: jevPlugin,
  });
  return {
    ...plugin,
    stageModules: [
      ...(plugin.stageModules ?? []),
      registerStageEval(
        selectModuleWith({
          client: proseClient,
          name: 'decisions-select-prose',
        }),
      ),
    ],
  };
}

/** The Decisions plugin on the settings from the environment. */
export const decisionsPlugin: PlannerEvalPlugin<JevCall, StageName> =
  decisionsPluginWith();
