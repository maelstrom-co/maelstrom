import type { VoiceSessionState } from '@maelstrom-co/client';

/**
 * Input mute state for fake realtime sessions. Mirrors the session contract:
 * mute requests are ignored while idle or in error, and disconnect clears it.
 */
export class FakeInputMute {
  muted = false;
  readonly handlers = new Set<(muted: boolean) => void>();

  set(state: VoiceSessionState, muted: boolean): void {
    if (state === 'idle' || state === 'error') return;
    this.#apply(muted);
  }

  clear(): void {
    this.#apply(false);
  }

  #apply(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    for (const handler of this.handlers) handler(muted);
  }
}
