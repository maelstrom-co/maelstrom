import { DiagnosticCapture as DevelopmentCapture } from './capture.js';
import { createDevtoolsCollector } from './controller.js';
import { createDevtools as createDisabledDevtools } from './disabled.js';
import type { Devtools, DevtoolsOptions } from './types.js';
import { VoiceDiagnostics as DevelopmentVoiceDiagnostics } from './voice-diagnostics.js';

export type { CaptureOptions } from './capture.js';
export { mountDevtools } from './panel.js';
export type * from './types.js';
export type {
  DiagnosticEntry,
  RetainedLiveTransport,
  TransportSnapshot,
  VoiceEventIdentity,
} from './voice-diagnostics.js';
export { diagnosticId, projectLiveTransport } from './voice-diagnostics.js';

/** Explicit content capture available in every build, including production. */
export class DiagnosticCapture extends DevelopmentCapture {
  protected override readonly enabled = true;
}

/** Bounded voice metadata available in every build, including production. */
export class VoiceDiagnostics extends DevelopmentVoiceDiagnostics {
  protected override readonly enabled = true;
}

/** Creates an explicitly enabled collector in development, preview, or production. */
export function createDevtools(options: DevtoolsOptions = {}): Devtools {
  if (options.enabled === false) return createDisabledDevtools(options);
  return createDevtoolsCollector({
    ...options,
    capture:
      options.capture instanceof DevelopmentCapture
        ? options.capture
        : new DiagnosticCapture(() => null, options.capture),
  });
}
