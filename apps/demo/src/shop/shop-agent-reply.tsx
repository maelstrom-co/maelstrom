import type { AgentRunsSnapshot, AgentRunStatus } from '@maelstrom-co/react';

import { shopM } from './maelstrom';

/**
 * Shows the latest Agent Run of the shop: the placeholder while the agent
 * works, the reply as it streams and once it finishes, a notice when the
 * conversation is lost, and an error notice when the run or the conversation
 * fails. Typed and voice runs render the same way. Renders nothing before any
 * input.
 */
export function ShopAgentReply() {
  const { run, error } = shopM.useAgentRun();
  const reply = describeReply({ run, error });
  if (reply === null) return null;

  return (
    <div
      className="shop-agent-reply"
      data-testid="shop-agent-reply"
      data-status={reply.status}
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

type ReplyView = {
  readonly status: AgentRunStatus;
  readonly text: string;
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
    case 'finished':
      return run.reply.length === 0
        ? null
        : { status: run.status, text: run.reply };
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
