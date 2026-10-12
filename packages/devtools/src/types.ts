import type { Orchestrator } from '@maelstrom-co/client';
import type { DiagnosticEvent } from '@maelstrom-co/protocol';
import type { CaptureOptions, DiagnosticCapture } from './capture.js';

/** Configuration shared by every framework adapter. */
export interface DevtoolsOptions {
  /** Disables collection and mounting. Defaults to true in development. */
  readonly enabled?: boolean;
  /** Initial panel visibility. Defaults to false. */
  readonly initialIsOpen?: boolean;
  /** Trigger corner. Defaults to bottom-right. */
  readonly position?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Color scheme. Defaults to system. */
  readonly theme?: 'system' | 'light' | 'dark';
  /** Recent metadata events retained across clients. Defaults to 100. */
  readonly maxActivityEvents?: number;
  /** Metadata events retained for request history. Evicts whole requests; a single oversized request keeps its latest events. Defaults to 1000. */
  readonly maxRequestEvents?: number;
  /** Maximum retained client lifetimes. Defaults to 16. */
  readonly maxSessions?: number;
  /** Capture bounds/redaction, or an existing capture store for migration. */
  readonly capture?: CaptureOptions | DiagnosticCapture;
  /** Redacts all metadata, snapshots, imported files, and explicit content. */
  readonly redact?: (value: unknown) => unknown;
  /** Optional event filter applied before retention. */
  readonly filter?: (event: DiagnosticEvent) => boolean;
}

/** One Provider lifetime, retained after detachment for inspection. */
export interface DevtoolsSession {
  /** Unique Provider lifetime, independent of application session identity. */
  readonly id: string;
  /** Application session identifier. */
  readonly sessionId: string;
  /** Whether the Provider remains attached. */
  readonly active: boolean;
  /** Latest projected client state, with no live instance data. */
  readonly snapshot: unknown;
}

/** Immutable external-store view of diagnostic state. */
export interface DevtoolsSnapshot {
  /** Isolated Provider lifetimes. */
  readonly sessions: readonly DevtoolsSession[];
  /** Recent metadata observations; application content is absent. */
  readonly activity: readonly DiagnosticEvent[];
  /** Number of older metadata events evicted from the recent-event buffer. */
  readonly droppedActivityEvents: number;
  /** Request metadata retained independently of recent activity; application content is absent. */
  readonly requestActivity: readonly DiagnosticEvent[];
  /** Number of request metadata events evicted from request history. */
  readonly droppedRequestEvents: number;
  /** Latest terminal transport summaries, retained independently of recent activity. */
  readonly transportHistory: readonly DiagnosticEvent[];
  /** Capture opened for read-only inspection. */
  readonly imported: unknown;
}

/** Framework-independent collector and capture interface. */
export interface Devtools {
  /** Configuration used by the shared panel. */
  readonly options: DevtoolsOptions;
  /** Explicit bounded content capture. */
  readonly capture: DiagnosticCapture;
  /** Returns a stable snapshot until the store changes. */
  getSnapshot(): DevtoolsSnapshot;
  /** Reads full live definitions only on explicit inspection; retained clients expose structural evidence. */
  inspect(clientId: string): unknown;
  /** Clears capture, imported evidence, activity, and detached lifetimes. Active clients remain attached. */
  clear(): void;
  /** Observes state until unsubscribed. */
  subscribe(listener: () => void): () => void;
  /** Attaches before connect; cleanup retains bounded history after detachment. */
  attach(orchestrator: Orchestrator): () => void;
  /** Starts content capture for all Providers, or one active lifetime. A stale lifetime throws without clearing evidence. */
  startCapture(clientId?: string): void;
  /** Stops content capture and unsubscribes server content forwarding. */
  stopCapture(): void;
  /** Exports a versioned JSON capture without executing any work. */
  exportCapture(): string;
  /** Validates and opens a bounded capture for read-only inspection. Throws on invalid files. */
  importCapture(json: string): void;
  /** Removes imported evidence from the panel. */
  closeImport(): void;
  /** Enables visual Chart outlines without changing its layout. */
  setOverlays(enabled: boolean): void;
  /** Highlights a rendered Instance on its owning active client without changing layout. Omit either identity to clear selection. */
  setHighlightedInstance?(clientId?: string, instanceId?: string): void;
  /** Releases subscriptions and evidence. */
  dispose(): void;
}
