import type { ComponentType } from 'react';
import type { MaelstromExtension } from '@maelstrom-co/react';

import { createUseVoice } from './use-voice.js';
import { createVoiceOrb } from './voice-orb.js';
import type { UseVoiceOptions, UseVoiceReturn } from './use-voice-types.js';
import type { VoiceOrbProps } from './voice-orb.js';
import type { VoiceProbeResult } from './voice-probe.js';

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
 * Requires `@maelstrom-co/voice` to be available at runtime. The factory
 * eagerly probes the dynamic import the moment `.with(maelstromVoice())` is
 * evaluated in the browser, so a missing peer is detected before any
 * component renders rather than the first time `useVoice()` runs. On
 * non-browser hosts (SSR, edge runtimes, workers) the probe is skipped to
 * avoid pulling `onnxruntime-web` during server-side module evaluation —
 * the hook's `useEffect` never fires on the server, so the skipped probe
 * is harmless. The cached promise is passed into the hook so subsequent
 * reads do not re-trigger the import.
 *
 * **Error contract on missing peer.** When `@maelstrom-co/voice` is not
 * installed, the first owner call to `useVoice({ ... })` invokes the
 * caller's `onError` with a typed
 * `VoiceDependencyError { code: 'DEPENDENCY_MISSING' }` and flips
 * `isVoiceSupported` to `false`. When the package is installed but
 * unusable (eval-time failure or no `VoiceSession` export), the code is
 * `DEPENDENCY_BROKEN` and the original rejection is preserved on `cause`.
 * Wire an `onError` handler to surface either failure in your UI. The
 * failure is reported from an async `.then(...)` chain, so React error
 * boundaries do not catch it directly — store the error in component
 * state from `onError` and re-throw during render if you want a boundary
 * to handle it.
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
 *   m.useVoice({
 *     autoAcquireMic: true,
 *     greeting: 'Hello!',
 *     onError: (err) => console.error('voice failed', err),
 *   });
 *   return <m.VoiceOrb size={48} />;
 * }
 */
export function maelstromVoice(): MaelstromExtension<VoiceExtension> {
  const voiceModulePromise: Promise<VoiceProbeResult> =
    typeof window === 'undefined'
      ? Promise.resolve({ status: 'skipped' as const })
      : import('@maelstrom-co/voice').then(
          (module) => ({ status: 'ready' as const, module }),
          (error) => ({ status: 'failed' as const, error }),
        );
  return (ctx) => {
    const useVoice = createUseVoice(ctx, voiceModulePromise);
    return { useVoice, VoiceOrb: createVoiceOrb(useVoice) };
  };
}
