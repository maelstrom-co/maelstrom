import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLACEHOLDER_CUE,
  createVoiceCueGate,
  MIN_CUE_GAP_MS,
  PLACEHOLDER_HOLD_MS,
} from './agent-voice-cues';

describe('createVoiceCueGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const gate = () => {
    const spoken: string[] = [];
    const cues = createVoiceCueGate({
      speak: (text) => {
        spoken.push(text);
        return true;
      },
      now: () => Date.now(),
    });
    return { cues, spoken };
  };

  it('drops the placeholder when a real cue follows quickly', () => {
    const { cues, spoken } = gate();
    cues.offer(AGENT_PLACEHOLDER_CUE);
    vi.advanceTimersByTime(PLACEHOLDER_HOLD_MS - 1);
    cues.offer('Searching your past orders…');
    vi.advanceTimersByTime(PLACEHOLDER_HOLD_MS);
    expect(spoken).toEqual(['Searching your past orders…']);
  });

  it('speaks a lone placeholder after the hold', () => {
    const { cues, spoken } = gate();
    cues.offer(AGENT_PLACEHOLDER_CUE);
    vi.advanceTimersByTime(PLACEHOLDER_HOLD_MS);
    expect(spoken).toEqual([AGENT_PLACEHOLDER_CUE]);
  });

  it('skips cues inside the gap and repeats, and never speaks after close', () => {
    const { cues, spoken } = gate();
    cues.offer('Searching your past orders…');
    vi.advanceTimersByTime(MIN_CUE_GAP_MS - 1);
    cues.offer('Comparing dog foods…');
    vi.advanceTimersByTime(1);
    cues.offer('Searching your past orders…');
    cues.offer('Comparing dog foods…');
    cues.offer(AGENT_PLACEHOLDER_CUE);
    cues.close();
    vi.advanceTimersByTime(MIN_CUE_GAP_MS + PLACEHOLDER_HOLD_MS);
    cues.offer('Adding it to your cart…');
    expect(spoken).toEqual([
      'Searching your past orders…',
      'Comparing dog foods…',
    ]);
  });
});
