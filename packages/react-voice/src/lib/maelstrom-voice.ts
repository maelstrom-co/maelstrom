import type { ComponentType } from 'react';
import type { MaelstromExtension } from '@maelstrom-co/react';

import { createUseVoice } from './use-voice.js';
import { createVoiceOrb } from './voice-orb.js';
import type { UseVoiceOptions, UseVoiceReturn } from './use-voice-types.js';
import type { VoiceOrbProps } from './voice-orb.js';

/**
 * Shape merged onto a `MaelstromInstance` by `maelstromVoice()`. Consumers
 * see this on the returned instance after calling `.with(maelstromVoice())`.
 */
export interface VoiceExtension {
  /**
   * Read or own the shared voice session. See `UseVoiceOptions` and
   * `UseVoiceReturn` for the field-level docs.
   *
   * Three call shapes:
   * - `useVoice({ ...options })` — *owner*: creates the session and drives
   *   its lifecycle.
   * - `useVoice()` — *observer*: reads shared session state, no ownership.
   * - `useVoice({})` — treated as observer (empty options ≡ no ownership).
   *
   * **Only one owner per Provider tree at a time.** A second component
   * calling `useVoice({ ... })` while another is already the owner is
   * silently ignored: the hook hits a `voice-multiple-owners` warnOnce
   * and returns observer state. Choose one component to own the session
   * and have the rest call `useVoice()` without options.
   */
  useVoice: (options?: UseVoiceOptions) => UseVoiceReturn;

  /**
   * Visual indicator that reflects the shared session state. Renders an
   * orb whose appearance changes with `state` and exposes click semantics
   * for `idle` (start) and `error` (retry) — see `VoiceOrbProps`.
   */
  VoiceOrb: ComponentType<VoiceOrbProps>;
}

/**
 * Maelstrom extension that adds voice capabilities to an instance.
 *
 * Apply via `.with()` to expose `m.useVoice()` and `<m.VoiceOrb />` on the
 * extended instance. The extension binds to the same React context tree as
 * the rest of the instance, so observers and owners share session state.
 *
 * Requires `@maelstrom-co/voice` to be available at runtime — it is loaded
 * via dynamic import the first time `useVoice()` is called with options.
 *
 * **Apply at most once per instance.** Each `maelstromVoice()` call
 * returns a fresh extension with its own session store, so chaining
 * `.with(maelstromVoice()).with(maelstromVoice())` produces two
 * independent stores and orphans the first owner. Construct the
 * extension in one place and reuse it if you need the result more than
 * once.
 *
 * @example
 * import { createMaelstrom } from '@maelstrom-co/react';
 * import { maelstromVoice } from '@maelstrom-co/react-voice';
 *
 * const m = createMaelstrom({ vessels }).with(maelstromVoice());
 *
 * function App() {
 *   m.useVoice({ autoAcquireMic: true, greeting: 'Hello!' });
 *   return <m.VoiceOrb size={48} />;
 * }
 */
export function maelstromVoice(): MaelstromExtension<VoiceExtension> {
  return (ctx) => {
    const useVoice = createUseVoice(ctx);
    return { useVoice, VoiceOrb: createVoiceOrb(useVoice) };
  };
}
