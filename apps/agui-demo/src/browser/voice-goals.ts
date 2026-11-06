import type { ToolCallId } from '@maelstrom-co/protocol';
import type {
  RealtimeAdapterEvent,
  RealtimeProviderAdapter,
  UpdateUIToolResult,
} from '@maelstrom-co/realtime';

import {
  VoiceGoalInput,
  voiceConnectOptions,
  voiceTool,
} from '../voice-contract';
import type { GoalOutcome } from './goal-runner';

type VoicePort = Pick<
  RealtimeProviderAdapter,
  'connect' | 'disconnect' | 'on' | 'sendToolResult'
>;
interface Invocation {
  argumentsJson: string;
  output?: UpdateUIToolResult;
}
interface Connection {
  adapter: VoicePort;
  calls: Map<ToolCallId, Invocation>;
  unsubscribe: () => void;
}

export class VoiceGoals {
  private connection?: Connection;

  constructor(
    private readonly run: (goal: string) => Promise<GoalOutcome>,
    private readonly onEvent: (event: RealtimeAdapterEvent) => void,
  ) {}

  async connect(adapter: VoicePort) {
    if (this.connection) throw new Error('Voice is already connected.');
    const connection: Connection = {
      adapter,
      calls: new Map(),
      unsubscribe: () => {},
    };
    this.connection = connection;
    connection.unsubscribe = adapter.on((event) => {
      if (this.connection !== connection) return;
      if (event.type === 'tool_call') {
        void this.invoke(connection, event).catch(() => {
          if (this.connection === connection) {
            this.onEvent({
              type: 'error',
              error: new Error(
                'Voice result delivery failed. Check the workspace outcome.',
              ),
            });
            this.onEvent({ type: 'state', state: 'error' });
            void this.disconnect().catch(() => {});
          }
        });
      } else {
        this.onEvent(event);
        if (
          event.type === 'state' &&
          (event.state === 'idle' || event.state === 'error')
        ) {
          this.connection = undefined;
          connection.unsubscribe();
        }
      }
    });
    try {
      await adapter.connect(voiceConnectOptions);
    } catch (error) {
      if (this.connection === connection) await this.disconnect();
      throw error;
    }
  }

  async disconnect() {
    const connection = this.connection;
    this.connection = undefined;
    if (!connection) return;
    connection.unsubscribe();
    await connection.adapter.disconnect();
  }

  private async invoke(
    connection: Connection,
    event: Extract<RealtimeAdapterEvent, { type: 'tool_call' }>,
  ) {
    const existing = connection.calls.get(event.callId);
    if (existing) {
      if (
        existing.argumentsJson !== event.argumentsJson ||
        event.name !== voiceTool.name
      )
        throw new Error('Voice call identity changed.');
      if (existing.output && this.connection === connection)
        await connection.adapter.sendToolResult(event.callId, existing.output);
      return;
    }
    if (connection.calls.size >= 200)
      throw new Error('Voice invocation budget exhausted.');
    const call: Invocation = { argumentsJson: event.argumentsJson };
    connection.calls.set(event.callId, call);
    let output: UpdateUIToolResult;
    let intent: string;
    try {
      if (event.name !== voiceTool.name) throw new Error('Unknown voice tool.');
      intent = VoiceGoalInput.parse(JSON.parse(event.argumentsJson)).intent;
    } catch {
      output = {
        ok: false,
        summary:
          'No workspace goal was submitted. The voice request was invalid.',
      };
      call.output = output;
      if (this.connection === connection)
        await connection.adapter.sendToolResult(event.callId, output);
      return;
    }
    try {
      const outcome = await this.run(intent);
      output = {
        ok: outcome.status === 'completed',
        summary: outcome.message,
        userMessage: outcome.message,
      };
    } catch {
      output = {
        ok: false,
        summary:
          'No new goal was accepted. The workspace is busy or stopped. Check the workspace before making another request.',
      };
    }
    call.output = output;
    if (this.connection === connection)
      await connection.adapter.sendToolResult(event.callId, output);
  }
}
