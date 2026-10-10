import type { DiagnosticCapture as Capture } from './capture.js';
import type { Devtools, DevtoolsOptions } from './types.js';
import type { VoiceDiagnostics as Voice } from './voice-diagnostics.js';

export type { CaptureOptions } from './capture.js';
export type * from './types.js';
export type {
  DiagnosticEntry,
  RetainedLiveTransport,
  TransportSnapshot,
  VoiceEventIdentity,
} from './voice-diagnostics.js';

const status = { active: false, count: 0, dropped: 0, outcome: '' };
class InertCapture {
  getSnapshot = () => status;
  getEvidenceRevision = () => 0;
  getLimits = () => ({
    maxEvents: 0,
    maxCharacters: 0,
    maxStringCharacters: 0,
  });
  subscribe = () => () => {};
  addRedactor = () => () => {};
  start() {}
  stop() {}
  clear() {}
  record() {}
  sessionEvent() {}
  observations() {}
  engineRequest() {}
  engineResponse() {}
  setOutcome() {}
  export() {
    return '';
  }
}
/** Production capture never retains content. */
export const DiagnosticCapture = InertCapture as unknown as typeof Capture;
/** Production voice diagnostics never retain events. */
export const VoiceDiagnostics = class {
  getSnapshot = () => [];
  getTransportHistory = () => [];
  subscribe = () => () => {};
  retainTransport() {}
  record() {}
  onSessionEvent() {}
} as unknown as typeof Voice;
/** Production projection is inert. */
export function diagnosticId(_value?: string): undefined {
  return undefined;
}
/** Production projection is inert. */
export function projectLiveTransport(_value: unknown): Record<string, never> {
  return {};
}
/** Production entrypoint never constructs observers, stores, or browser UI. */
export function createDevtools(_options: DevtoolsOptions = {}): Devtools {
  const no = () => {};
  return {
    options: { enabled: false },
    capture: new DiagnosticCapture(),
    getSnapshot: () => ({
      sessions: [],
      activity: [],
      droppedActivityEvents: 0,
      requestActivity: [],
      droppedRequestEvents: 0,
      transportHistory: [],
      imported: null,
    }),
    subscribe: () => no,
    attach: () => no,
    startCapture: no,
    stopCapture: no,
    exportCapture: () => '',
    importCapture: no,
    closeImport: no,
    setOverlays: no,
    setHighlightedInstance: no,
    dispose: no,
    inspect: () => null,
    clear: no,
  };
}
/** Production mounting is inert. */
export function mountDevtools(
  _tools: Devtools,
  _container?: HTMLElement,
): () => void {
  return () => {};
}
