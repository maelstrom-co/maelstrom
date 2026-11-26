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
  it('renders the mute toggle when connected, keeps the session connected, and allows typed submit while muted', async () => {
    render(
      <tasklaneM.Provider
        sessionId={SessionId('tasklane-mute-test')}
        connector={makeConnector()}
      >
        <TasklaneMuteHarness />
      </tasklaneM.Provider>,
    );

    expect(
      screen.queryByRole('button', { name: /mute microphone/i }),
    ).toBeNull();

    const orb = screen.getByRole('button', { name: 'Start voice' });
    await act(async () => {
      fireEvent.click(orb);
    });

    const session = FakeRealtimeSession.instances.at(-1)!;
    expect(session.state).toBe('connected');
    expect(session.connectCalls).toBe(1);
    expect(session.disconnectCalls).toBe(0);

    const toggle = screen.getByRole('button', { name: 'Mute microphone' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      fireEvent.click(toggle);
    });
    expect(session.inputMuted).toBe(true);
    expect(session.state).toBe('connected');
    expect(session.disconnectCalls).toBe(0);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Unmute microphone');
    expect(
      screen
        .getByRole('button', { name: 'Stop voice' })
        .getAttribute('data-muted'),
    ).toBe('true');

    // Typed input still submits while voice is muted.
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

    // Unmute keeps the same session connected.
    act(() => {
      fireEvent.click(toggle);
    });
    expect(session.inputMuted).toBe(false);
    expect(session.connectCalls).toBe(1);
    expect(session.disconnectCalls).toBe(0);
  });
});
