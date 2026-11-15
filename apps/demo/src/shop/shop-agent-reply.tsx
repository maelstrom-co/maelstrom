import type { AgentRunsSnapshot, AgentRunStatus } from '@maelstrom-co/react';

import { shopM } from './maelstrom';

/**
 * Shows the latest Agent Run of the shop, typed or voice, on one line.
 * Renders nothing until there is text to show. A conversation-level error
 * takes precedence until the next input registers.
 */
export function ShopAgentReply() {
  const reply = describeReply(shopM.useAgentRun());
  if (reply === null) return null;

  return (
    <div
      className="shop-agent-reply"
      data-testid="shop-agent-reply"
      data-status={reply.status}
      data-change-error={reply.changeError ? '' : undefined}
      aria-live="polite"
    >
      <p className="shop-caption-line">{reply.text}</p>
    </div>
  );
}

const WORKING_COPY = 'Working on it…';
const DROPPED_COPY =
  'Conversation lost. The connection dropped, so please ask again.';
const STALE_COPY =
  'Conversation lost. The assistant went quiet and may still answer.';
const CHANGE_ERROR_COPY = 'The page could not be fully updated.';

type ReplyView = {
  readonly status: AgentRunStatus;
  readonly text: string;
  readonly changeError?: boolean;
};

function describeReply({
  run,
  error,
}: Pick<AgentRunsSnapshot, 'run' | 'error'>): ReplyView | null {
  if (error !== null) {
    return { status: 'failed', text: errorCopy(error.message) };
  }
  if (run === null) return null;

  switch (run.status) {
    case 'pending':
    case 'working':
      return { status: run.status, text: run.placeholder ?? WORKING_COPY };
    case 'streaming':
    case 'finished': {
      if (run.changeErrors.length > 0) {
        return {
          status: run.status,
          text: [run.reply, CHANGE_ERROR_COPY].filter(Boolean).join(' '),
          changeError: true,
        };
      }
      return run.reply.length === 0
        ? null
        : { status: run.status, text: run.reply };
    }
    case 'lost':
      return {
        status: run.status,
        text: run.lostReason === 'stale_run' ? STALE_COPY : DROPPED_COPY,
      };
    case 'failed':
      return {
        status: run.status,
        text: errorCopy(run.error?.message ?? 'the agent stopped'),
      };
    default:
      return assertNever(run.status);
  }
}

function errorCopy(message: string): string {
  return `Something went wrong: ${message}`;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled agent run status: ${JSON.stringify(value)}`);
}
