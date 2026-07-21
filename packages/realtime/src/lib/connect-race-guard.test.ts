import { describe, expect, it } from 'bun:test';

import { ConnectRaceGuard } from './connect-race-guard.js';
import { RealtimeVoiceError } from './realtime-voice-error.js';

describe('ConnectRaceGuard', () => {
  it('a fresh attempt is current and assertCurrent does not throw', () => {
    const guard = new ConnectRaceGuard();
    const attempt = guard.begin();

    expect(attempt.isCurrent).toBe(true);
    expect(() => attempt.assertCurrent()).not.toThrow();
  });

  it('a newer begin() supersedes the prior attempt while staying current itself', () => {
    const guard = new ConnectRaceGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(first.isCurrent).toBe(false);
    expect(second.isCurrent).toBe(true);
    expect(() => second.assertCurrent()).not.toThrow();
  });

  it('supersede() invalidates the current attempt', () => {
    const guard = new ConnectRaceGuard();
    const attempt = guard.begin();

    guard.supersede();

    expect(attempt.isCurrent).toBe(false);
  });

  it('assertCurrent on a superseded attempt throws CONNECT_SUPERSEDED', () => {
    const guard = new ConnectRaceGuard();
    const attempt = guard.begin();
    guard.supersede();

    const error = (() => {
      try {
        attempt.assertCurrent();
        return undefined;
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(RealtimeVoiceError);
    expect((error as RealtimeVoiceError).code).toBe('CONNECT_SUPERSEDED');
  });

  it('isCurrent re-reads the live generation rather than latching a snapshot', () => {
    const guard = new ConnectRaceGuard();
    const attempt = guard.begin();
    expect(attempt.isCurrent).toBe(true);

    guard.supersede();
    expect(attempt.isCurrent).toBe(false);

    // A brand-new attempt is current again; the old handle stays stale.
    const next = guard.begin();
    expect(next.isCurrent).toBe(true);
    expect(attempt.isCurrent).toBe(false);
  });
});
