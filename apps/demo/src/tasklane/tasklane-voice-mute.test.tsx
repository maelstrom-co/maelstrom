// @vitest-environment happy-dom

import {
  type ChartRequestMessage,
  type MaelstromResponse,
  SessionId,
} from '@maelstrom-co/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { tasklaneM } from './maelstrom';
import { TasklaneIntentForm } from './tasklane-intent-form';
import { TasklaneVoiceCorner } from './tasklane-voice-corner';

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));

const requests: ChartRequestMessage[] = [];

function makeConnector() {
  return {
    ...createMockConnector(),
    process: async (
      message: ChartRequestMessage,
    ): Promise<MaelstromResponse> => {
      requests.push(message);
      return {
        type: 'maelstrom_response',
        requestId: message.id,
        rationale: 'Applied typed request while muted.',
        layout: { type: 'grid', positions: [] },
        userMessage: 'Applied typed request.',
        executionPlan: [],
      };
    },
  };
}

function TasklaneMuteHarness() {
  const { enqueueIntent } = tasklaneM.useMaelstrom();
  const [intent, setIntent] = useState('');
  return (
    <>
      <TasklaneIntentForm
        intent={intent}
        onIntentChange={setIntent}
        onSubmit={() => {
          enqueueIntent(intent);
          setIntent('');
        }}
        submitLabel="Send"
      />
      <TasklaneVoiceCorner needsKey={false} onRequireKey={vi.fn()} />
    </>
  );
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
  requests.length = 0;
});

afterEach(cleanup);

describe('Tasklane voice mute toggle with FakeRealtimeSession', () => {
  it('still sends a typed intent while the microphone is muted', async () => {
    render(
      <tasklaneM.Provider
        sessionId={SessionId('tasklane-mute-test')}
        connector={makeConnector()}
      >
        <TasklaneMuteHarness />
      </tasklaneM.Provider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start voice' }));
    });
    const session = FakeRealtimeSession.instances.at(-1)!;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Mute microphone' }));
    });
    expect(session.inputMuted).toBe(true);

    const input = screen.getByLabelText('Ask Tasklane');
    fireEvent.change(input, { target: { value: 'show all tasks' } });
    await act(async () => {
      fireEvent.submit(input.closest('form')!);
    });
    expect(
      requests.some((req) =>
        req.request.context.updateReasons.some(
          (reason) =>
            reason.type === 'user_intent' && reason.intent === 'show all tasks',
        ),
      ),
    ).toBe(true);
    expect(session.state).toBe('connected');
    expect(session.inputMuted).toBe(true);
  });
});
