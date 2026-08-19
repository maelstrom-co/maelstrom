import type { MessageId } from './message.ts';
import type { MaelstromResponse } from './response.ts';
import type { SessionId } from './session.ts';

/**
 * Common metadata on every engine output. The `id` echoes the id of the input
 * message that produced this output, so callers can correlate
 * response-to-request without external bookkeeping.
 */
export interface EngineOutputBase {
  readonly sessionId: SessionId;
  readonly id: MessageId;
}

/**
 * The engine's response to a {@link ChartRequestMessage}: layout decisions +
 * execution plan produced by the LLM, wrapped with the sessionId/id of the
 * originating request.
 */
export interface ChartResponseOutput extends EngineOutputBase {
  readonly type: 'chart_response';
  readonly response: MaelstromResponse;
}

/**
 * Result of an assistant_message submission. `outcome` tells the caller
 * whether this specific call wrote a new entry (`'inserted'`) or was a
 * dedup no-op against an existing entry with the same {@link MessageId}
 * (`'deduped'`). The history write itself is always idempotent; this field
 * only reports which branch happened so callers can instrument behavior.
 */
export interface AssistantMessageResultOutput extends EngineOutputBase {
  readonly type: 'assistant_message_result';
  readonly outcome: 'inserted' | 'deduped';
}

/**
 * Successful output discriminated by input: Chart requests produce
 * `chart_response`; assistant injections produce `assistant_message_result`.
 */
export type EngineOutput = ChartResponseOutput | AssistantMessageResultOutput;
