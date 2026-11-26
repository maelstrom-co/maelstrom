import type { Result } from '@maelstrom-co/protocol';

/**
 * Result returned by a vessel action handler.
 *
 * Domain alias over the protocol's generic `Result` that tightens the
 * error channel to `Error`. Vessel author handlers signal success with
 * `ok(value)` and failure with `err(new Error(...))` from
 * `@maelstrom-co/protocol`.
 *
 * The success value is an optional short note describing what the Action did,
 * such as `'12 tasks updated'`. It is reported as the Action's note in the
 * requesting operation's outcome. Return `ok(undefined)` when there is nothing
 * to say.
 *
 * @example
 * ```typescript
 * import { ok, err } from '@maelstrom-co/protocol';
 * import type { ActionResult } from '@maelstrom-co/client';
 *
 * const handler = async (params: { orderId: string }): Promise<ActionResult> => {
 *   if (!params.orderId) return err(new Error('orderId required'));
 *   return ok('order selected');
 * };
 * ```
 */
export type ActionResult = Result<string | undefined, Error>;
