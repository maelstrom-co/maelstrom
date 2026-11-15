import type {
  AgentUiChangeEvent,
  DiagnosticMetadata,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';

/**
 * Receives a diagnostic observation of Agent Session work that belongs to one
 * Agent Run, such as an accepted utterance or a finished run.
 *
 * @param runId - The Agent Run the observation belongs to.
 * @param inputId - The utterance that started that run.
 * @param kind - The diagnostic kind, such as `engine.agent.run.finished`.
 * @param metadata - Structural metadata only, never user text or payloads.
 * @param readContent - Reads the observation's content, called only when a subscriber asks for content.
 */
export type RunObserver = (
  runId: RunId,
  inputId: MessageId,
  kind: string,
  metadata: DiagnosticMetadata,
  readContent?: () => unknown,
) => void;

/**
 * Receives a diagnostic observation of Agent Session work that belongs to no
 * Agent Run, such as an ignored input or an acknowledgement for an unknown
 * change. The observation carries neither a run id nor a request id, and its
 * metadata is published unchanged.
 *
 * @param kind - The diagnostic kind, such as `engine.agent.input.ignored`.
 * @param metadata - Structural metadata only, never user text or payloads.
 * @param readContent - Reads the observation's content, called only when a subscriber asks for content.
 */
export type SessionObserver = (
  kind: string,
  metadata: DiagnosticMetadata,
  readContent?: () => unknown,
) => void;

/**
 * The diagnostic observers of one Agent Session, one per owner. Every
 * observation chooses its owner by the observer it calls.
 */
export interface DiagnosticObservers {
  /** Observations that belong to one Agent Run. */
  readonly run: RunObserver;
  /** Observations that belong to no run. */
  readonly session: SessionObserver;
}

/**
 * Observes `engine.agent.ui_change.emitted` for a change: run-owned when the
 * change belongs to an Agent Run, session-owned with the `inputId` in
 * metadata when its `runId` is null. Today every emitted change carries a
 * `runId`, so the session-owned arm is a guard for a future change outside
 * any run.
 */
export function observeUiChangeEmitted(
  event: AgentUiChangeEvent,
  inputId: MessageId,
  diagnostics: DiagnosticObservers,
  metadata: DiagnosticMetadata,
  readContent?: () => unknown,
): void {
  const kind = 'engine.agent.ui_change.emitted';
  if (event.runId === null)
    diagnostics.session(kind, { ...metadata, inputId }, readContent);
  else diagnostics.run(event.runId, inputId, kind, metadata, readContent);
}
