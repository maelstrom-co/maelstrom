import type { Deferred, StageContext } from '@maelstrom-co/engine';
import { deferred } from '@maelstrom-co/engine';
import { err, type Result } from '@maelstrom-co/protocol';

/**
 * The name of each stage of the Jev composition, keyed by itself and
 * declared in pipeline order: the name a planner gives the stage with
 * `named` and an engine instrument sees.
 */
export const STAGE_NAME = {
  jevSelect: 'jevSelect',
  jevActions: 'jevActions',
  jevLayout: 'jevLayout',
  llmComplete: 'llmComplete',
} as const;

/** A stage of the Jev composition, used as the prefix of every deferral reason. */
export type StageName = (typeof STAGE_NAME)[keyof typeof STAGE_NAME];

/** The stages of the Jev composition, in pipeline order. */
export const STAGE_NAMES: readonly StageName[] = Object.values(STAGE_NAME);

/** Who asks Jev: a stage of the composition, or the eval's grader, which is not a stage. */
export type JevCaller = StageName | 'grader';

/**
 * Defers from `stage` with reason `<stage>/<code>` and logs
 * `{ stage, reason, question }` at info, so the fallback log and the eval
 * can attribute every deferral to the stage and question that caused it.
 */
export function deferAt(
  ctx: StageContext,
  stage: JevCaller,
  code: string,
  question?: string,
): Result<never, Deferred> {
  const reason = `${stage}/${code}`;
  ctx.logger.info('jev.defer', { stage, reason, question });
  return err(deferred(reason));
}
