import type { Brand, CallId, RunId } from '@maelstrom-co/protocol';
import type { ModelMessage } from '@tanstack/ai';

import { assertNever } from '../assert-never.js';
import type { AgentRunFinished } from './agent-run.js';

/**
 * Names one tool call across the whole session as `<runId>:<callId>`, so a
 * later run can point back at a call an earlier run made.
 */
export type ToolCallRef = Brand<string, 'ToolCallRef'>;

/** Builds the session-wide {@link ToolCallRef} of one call of one run. */
export function toolCallRef(runId: RunId, callId: CallId): ToolCallRef {
  return `${runId}:${callId}` as ToolCallRef;
}

/**
 * The in-memory record of what an Agent Session emitted, rendered into the
 * prior messages of each later run. It keeps tool summaries only, never full
 * tool results, and accepts no identity.
 */
export interface Transcript {
  /** Records the utterance that started a run. */
  recordUserInput(runId: RunId, text: string): void;
  /**
   * Records streamed reply text of one model turn. Consecutive fragments of
   * the same turn join into one reply, so text cut short by an abnormal
   * ending stays as it was sent.
   */
  recordMessage(runId: RunId, turnId: string, text: string): void;
  /** Records a tool call the model requested, with the arguments it sent. */
  recordToolCall(ref: ToolCallRef, name: string, args: unknown): void;
  /** Records how a tool call settled, by its user-safe summary. */
  recordToolResult(ref: ToolCallRef, ok: boolean, summary: string): void;
  /** Records the closing message a run sent when a budget ran out. */
  recordClosingMessage(runId: RunId, text: string): void;
  /**
   * Records how a run ended. A completed run adds nothing to the rendering.
   * Other endings render with their reason and user-safe fields, never with
   * a cancellation cause.
   */
  recordEnding(runId: RunId, finished: AgentRunFinished): void;
  /**
   * Renders everything recorded so far, oldest first. User inputs become
   * `user` messages. Reply text, tool calls, tool summaries, closing messages
   * and abnormal endings become `assistant` content, with consecutive
   * entries of the same role joined by newlines into one message.
   */
  renderPriorMessages(): ModelMessage<string>[];
}

/** Creates an empty {@link Transcript}. */
export function createTranscript(): Transcript {
  const entries: TranscriptEntry[] = [];
  const runsWithReplyText = new Set<RunId>();

  return {
    recordUserInput(runId, text) {
      entries.push({ kind: 'user_input', runId, text });
    },
    recordMessage(runId, turnId, text) {
      if (text.length === 0) return;
      runsWithReplyText.add(runId);
      const last = entries.at(-1);
      if (last?.kind === 'reply_text' && last.turnId === turnId) {
        last.text += text;
        return;
      }
      entries.push({ kind: 'reply_text', runId, turnId, text });
    },
    recordToolCall(ref, name, args) {
      entries.push({
        kind: 'tool_call',
        ref,
        name,
        args: serializeToolArguments(args),
      });
    },
    recordToolResult(ref, ok, summary) {
      entries.push({ kind: 'tool_result', ref, ok, summary });
    },
    recordClosingMessage(runId, text) {
      entries.push({ kind: 'closing_message', runId, text });
    },
    recordEnding(runId, finished) {
      const line = describeEnding(
        runId,
        finished,
        runsWithReplyText.has(runId),
      );
      if (line !== undefined) entries.push({ kind: 'ending', line });
    },
    renderPriorMessages() {
      const messages: ModelMessage<string>[] = [];
      for (const entry of entries) {
        const role = entry.kind === 'user_input' ? 'user' : 'assistant';
        const content = renderEntry(entry);
        const last = messages.at(-1);
        if (last?.role === role) {
          last.content = `${last.content}\n${content}`;
        } else {
          messages.push({ role, content });
        }
      }
      return messages;
    },
  };
}

type TranscriptEntry =
  | {
      readonly kind: 'user_input';
      readonly runId: RunId;
      readonly text: string;
    }
  | {
      readonly kind: 'reply_text';
      readonly runId: RunId;
      readonly turnId: string;
      text: string;
    }
  | {
      readonly kind: 'tool_call';
      readonly ref: ToolCallRef;
      readonly name: string;
      readonly args: string;
    }
  | {
      readonly kind: 'tool_result';
      readonly ref: ToolCallRef;
      readonly ok: boolean;
      readonly summary: string;
    }
  | {
      readonly kind: 'closing_message';
      readonly runId: RunId;
      readonly text: string;
    }
  | { readonly kind: 'ending'; readonly line: string };

function renderEntry(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case 'user_input':
    case 'reply_text':
      return entry.text;
    case 'tool_call':
      return `[tool call ${entry.ref}] ${entry.name} ${entry.args}`;
    case 'tool_result':
      return `[tool result ${entry.ref}] ${entry.ok ? 'ok' : 'failed'}: ${entry.summary}`;
    case 'closing_message':
      return `[closing message ${entry.runId}] ${entry.text}`;
    case 'ending':
      return entry.line;
    default:
      return assertNever(entry, 'transcript entry');
  }
}

function describeEnding(
  runId: RunId,
  finished: AgentRunFinished,
  hasReplyText: boolean,
): string | undefined {
  const partialNote = hasReplyText ? ', reply above is partial' : '';
  switch (finished.reason) {
    case 'completed':
      return undefined;
    case 'budget': {
      const usageNote = finished.usageUnknown ? ', usage unknown' : '';
      return `[run ${runId} ended: budget, limit ${finished.limit}${usageNote}]`;
    }
    case 'error':
      return `[run ${runId} ended: error ${finished.code}, ${finished.error}${partialNote}]`;
    case 'cancelled':
      return `[run ${runId} ended: cancelled${partialNote}]`;
    default:
      return assertNever(finished, 'agent run ending');
  }
}

function serializeToolArguments(args: unknown): string {
  try {
    return JSON.stringify(args) ?? 'null';
  } catch {
    return '"[unserializable arguments]"';
  }
}
