import { z } from 'zod';

import type { Mutable } from './_drift-guards.ts';

/**
 * A Planner result that asks the user a question instead of changing the
 * screen: it carries no layout and no execution plan.
 *
 * Only valid when the chart request set `skipReply: true`. A caller that
 * leaves `skipReply` unset expects a reply-bearing response, so the Engine
 * rejects this result on that path. Engine validation accepts it when the
 * flag is set, but `Engine.handle` currently refuses it even then with
 * `Err(ValidationError)` on field `skipReply`.
 */
export interface NeedsClarification {
  /** Discriminant that tells this result apart from a layout candidate. */
  readonly type: 'needs_clarification';
  /** The question the Planner needs answered before it can proceed. Never blank. */
  readonly question: string;
  /** Suggested answers the caller may offer the user. Each one is non-blank. */
  readonly options?: readonly string[];
}

/**
 * Wire-format Zod parser for {@link NeedsClarification}. Rejects a blank
 * `question` and any blank or non-string entry in `options`.
 */
export const NeedsClarificationSchema = z.object({
  type: z.literal('needs_clarification'),
  question: z.string().refine(isNonBlank, {
    message: 'question must not be blank',
  }),
  options: z
    .array(
      z.string().refine(isNonBlank, { message: 'options must not be blank' }),
    )
    .optional(),
});

type _InferredNeedsClarification = z.infer<typeof NeedsClarificationSchema>;
const _needsClarificationFwd: _InferredNeedsClarification extends Mutable<NeedsClarification>
  ? true
  : false = true;
const _needsClarificationBwd: Mutable<NeedsClarification> extends _InferredNeedsClarification
  ? true
  : false = true;
void [_needsClarificationFwd, _needsClarificationBwd];

function isNonBlank(value: string): boolean {
  return value.trim().length > 0;
}
