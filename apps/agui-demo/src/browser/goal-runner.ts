import type { Message } from '@ag-ui/core';
import { EventSchemas, MessagesSnapshotEventSchema } from '@ag-ui/core/schemas';
import type { Orchestrator } from '@maelstrom-co/client';

import {
  ApplyWorkspaceInput,
  applyWorkspaceTool,
  GoalSummary,
} from '../goal-contract';
import type { WorkspaceConnector } from './workspace-connector';

export interface GoalOutcome {
  status: 'completed' | 'incomplete' | 'unknown';
  message: string;
  applications: string[];
}

export type WorkspaceRequest = (
  path: string,
  body: unknown,
  signal?: AbortSignal,
) => Promise<Response>;

export class GoalRunner {
  private history: Message[] = [];
  private active = false;
  private readonly lifetime = new AbortController();
  private readonly completedCalls = new Set<string>();

  constructor(
    private readonly threadId: string,
    private readonly request: WorkspaceRequest,
    private readonly connector: WorkspaceConnector,
    private readonly orchestrator: Orchestrator,
  ) {}

  async stop(notify = true) {
    if (this.lifetime.signal.aborted) return;
    this.lifetime.abort();
    await this.connector.disconnect();
    if (notify)
      void Promise.resolve()
        .then(() =>
          this.request('/api/workspace/stop', {}, AbortSignal.timeout(3_000)),
        )
        .catch(() => undefined);
  }

  async run(
    goal: string,
    onProgress?: (message: string) => void,
  ): Promise<GoalOutcome> {
    if (this.active || this.lifetime.signal.aborted)
      throw new Error('A goal is running or the workspace is stopped.');
    this.active = true;
    const applications: string[] = [];
    let next: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: goal,
    };
    let parentRunId: string | undefined;
    try {
      for (let step = 0; step < 20; step++) {
        const runId = crypto.randomUUID();
        onProgress?.(
          step
            ? 'Continuing from confirmed application…'
            : 'Planning your goal…',
        );
        const response = await this.request(
          '/api/goal',
          {
            threadId: this.threadId,
            runId,
            parentRunId,
            messages: [...this.history, next],
            tools: [applyWorkspaceTool],
            context: [],
            state: null,
          },
          this.lifetime.signal,
        );
        if (!response.ok) throw new Error('Goal run stopped.');
        const text = await response.text();
        if (text.length > 2_000_000)
          throw new Error('Goal response exceeds its budget.');
        const events = text
          .split(/\r?\n\r?\n/)
          .filter(
            (frame) =>
              frame.startsWith('data: ') && frame.trim() !== 'data: [DONE]',
          )
          .map((frame) => EventSchemas.parse(JSON.parse(frame.slice(6))));
        const first = events[0];
        const last = events.at(-1);
        if (
          first?.type !== 'RUN_STARTED' ||
          first.threadId !== this.threadId ||
          first.runId !== runId ||
          last?.type !== 'RUN_FINISHED' ||
          last.threadId !== this.threadId ||
          last.runId !== runId ||
          events.filter((event) => event.type === 'RUN_STARTED').length !== 1 ||
          events.filter((event) => event.type === 'RUN_FINISHED').length !==
            1 ||
          events.some((event) => event.type === 'RUN_ERROR') ||
          (last.outcome && last.outcome.type !== 'success')
        )
          throw new Error('Incomplete or unsupported goal run.');
        const snapshot = [...events]
          .reverse()
          .find((event) => event.type === 'MESSAGES_SNAPSHOT');
        this.history = MessagesSnapshotEventSchema.parse(snapshot).messages;
        const pending =
          last.outcome?.type === 'success'
            ? (last.outcome.pendingToolCallIds ?? [])
            : [];
        this.lifetime.signal.throwIfAborted();
        if (!pending.length) {
          const summary = GoalSummary.parse(last.result);
          return {
            ...summary,
            applications,
          };
        }
        if (pending.length !== 1 || this.completedCalls.has(pending[0]))
          throw new Error('Duplicate or concurrent frontend tools.');
        const call = this.history
          .flatMap((message) =>
            message.role === 'assistant' ? (message.toolCalls ?? []) : [],
          )
          .find((call) => call.id === pending[0]);
        if (call?.function.name !== applyWorkspaceTool.name)
          throw new Error('Unrecognized frontend tool.');
        const { intent } = ApplyWorkspaceInput.parse(
          JSON.parse(call.function.arguments),
        );
        this.completedCalls.add(call.id);
        onProgress?.(intent);
        const settlement = await this.connector.apply(
          this.orchestrator,
          call.id,
          intent,
        );
        this.lifetime.signal.throwIfAborted();
        applications.push(settlement.requestId);
        next = {
          id: crypto.randomUUID(),
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({
            requestId: settlement.requestId,
            status: 'applied',
          }),
        };
        parentRunId = runId;
      }
      throw new Error('Goal continuation budget exhausted.');
    } catch {
      await this.stop();
      return {
        status: 'unknown',
        message:
          'The goal stopped. Some changes may already be saved. Inspect the records and reconcile before continuing.',
        applications,
      };
    } finally {
      this.active = false;
    }
  }
}
