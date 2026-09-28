import type { Deferred, StageContext } from '@maelstrom-co/engine';
import { deferred } from '@maelstrom-co/engine';
import { err, type Result } from '@maelstrom-co/protocol';

/** The stages of the Jev composition, in pipeline order. */
export const STAGE_NAMES = [
  'jevSelect',
  'jevActions',
  'jevLayout',
  'llmComplete',
] as const;

/** A stage of the Jev composition, used as the prefix of every deferral reason. */
export type StageName = (typeof STAGE_NAMES)[number];

/**
 * Defers from `stage` with reason `<stage>/<code>` and logs
 * `{ stage, reason, question }` at info, so the fallback log and the eval
 * can attribute every deferral to the stage and question that caused it.
 */
export function deferAt(
  ctx: StageContext,
  stage: StageName,
  code: string,
  question?: string,
): Result<never, Deferred> {
  const reason = `${stage}/${code}`;
  ctx.logger.info('jev.defer', { stage, reason, question });
  return err(deferred(reason));
}
