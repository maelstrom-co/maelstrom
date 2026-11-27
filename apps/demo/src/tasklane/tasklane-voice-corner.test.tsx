// @vitest-environment happy-dom

import type { VoiceSessionState } from '@maelstrom-co/client';
import type { UseVoiceResult } from '@maelstrom-co/react-realtime';
import type { AdapterTurnControl } from '@maelstrom-co/realtime';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_VOICE_OBSERVATIONS } from '../lib/__tests__/fake-realtime-session';
import type { TasklaneVoiceProvider } from './voice-providers';

type TasklaneVoiceResult = UseVoiceResult<TasklaneVoiceProvider>;

let voiceResult: TasklaneVoiceResult;

vi.doMock('./maelstrom', () => ({
  tasklaneM: {
    useVoice: () => voiceResult,
    useVoiceObservations: () => ({ snapshot: EMPTY_VOICE_OBSERVATIONS }),
    useVoiceCaptions: () => ({ user: undefined, assistant: undefined }),
    VoiceOrb: (props: { className?: string }) => (
      <button
        type="button"
        data-testid="voice-orb"
        className={props.className}
      />
    ),
    HoldToTalkControl: (props: { className?: string }) => (
      <button
        type="button"
        data-testid="hold-to-talk"
        className={props.className}
      >
        Hold to talk
      </button>
    ),
  },
}));

vi.doMock('../lib/voice-adapter', () => ({
  prepareBrowserOpenAIVoice: vi.fn(() => true),
}));

vi.doMock('../lib/demo-voice', () => ({
  demoVoiceSession: () => undefined,
}));

const { TasklaneVoiceCorner } = await import('./tasklane-voice-corner');

function makeVoiceResult(
  state: VoiceSessionState,
  overrides: Partial<TasklaneVoiceResult> = {},
): TasklaneVoiceResult {
  return {
    state,
    provider: 'live',
    switching: false,
    turnMode: 'automatic',
    ...overrides,
  } as TasklaneVoiceResult;
}

function makeTurnControl(): AdapterTurnControl {
  return {
    startTurn: vi.fn(async () => {}),
    endTurn: vi.fn(async () => {}),
  };
}

afterEach(cleanup);

describe('TasklaneVoiceCorner turn controls', () => {
  it('mounts the SDK hold-to-talk control and the hold mode switch', () => {
    voiceResult = makeVoiceResult('connected', {
      turnMode: 'manual',
      turnControl: { ...makeTurnControl(), setTurnMode: vi.fn(async () => {}) },
    });
    const { getByRole } = render(
      <TasklaneVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
    );
    expect(getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    expect(getByRole('switch', { name: 'Hold mode' })).toBeTruthy();
  });

  it.each([
    ['connected', 'manual', true, 'Ready'],
    ['listening', 'manual', true, 'Listening'],
    ['connected', 'manual', false, 'Listening'],
    ['connected', 'automatic', true, 'Listening'],
  ] as const)(
    'labels a %s %s session (turnControl: %s) %s',
    (state, turnMode, hasTurnControl, label) => {
      voiceResult = makeVoiceResult(state, {
        provider: 'live',
        turnMode,
        turnControl: hasTurnControl ? makeTurnControl() : undefined,
      });
      const { getByRole } = render(
        <TasklaneVoiceCorner needsKey={false} onRequireKey={vi.fn()} />,
      );
      expect(getByRole('status', { name: 'Voice status' }).textContent).toBe(
        label,
      );
    },
  );
});
