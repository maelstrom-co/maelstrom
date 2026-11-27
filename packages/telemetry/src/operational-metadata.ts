import type { OperationalKind } from './operational-kinds.js';
import type { TelemetryOutcomeDetails } from './types.js';

type Scalars = Readonly<
  Record<string, string | number | boolean | null | undefined>
>;
type Timed = { readonly durationMs?: number };

/** Terminal evidence with error categories restricted to unsuccessful or unknown work. */
export type OperationalOutcome = TelemetryOutcomeDetails & {
  /** Result established by the producer, independent of transport acknowledgement. */
  readonly outcome:
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'skipped'
    | 'unknown';
};

/** Built-in producer metadata. Additional diagnostic scalars never become export dimensions. */
export type OperationalMetadata = {
  /** A locally initiated client request. */
  readonly 'client.request.started': Scalars;
  /** Response origin distinguishes local requests from pushed responses. */
  readonly 'client.response.received': Scalars &
    Timed & { readonly source: 'request' | 'push' };
  /** Request termination before response application. */
  readonly 'client.request.failed': Scalars & Timed & OperationalOutcome;
  /** Application evidence may be absent when completion details are unavailable. */
  readonly 'client.response.applied': Scalars &
    Timed & {
      readonly actionFailures?: number;
      readonly skippedActions?: number;
    };
  /** Application failure independent of request transport. */
  readonly 'client.response.failed': Scalars & Timed;
  /** A response that cannot be applied to its original owner. */
  readonly 'client.response.discarded': Scalars;
  /** One completed Action. */
  readonly 'client.action.completed': Scalars & Timed & OperationalOutcome;
  /** Whole Engine request admission. */
  readonly 'engine.request.started': Scalars;
  /** Whole Engine request result. */
  readonly 'engine.request.completed': Scalars & Timed & OperationalOutcome;
  /** Planner admission independent of request deduplication. */
  readonly 'engine.planner.started': Scalars;
  /** Planner result independent of nested stages. */
  readonly 'engine.planner.completed': Scalars & Timed & OperationalOutcome;
  /** Nested stage admission. Its diagnostic name is never a metric label. */
  readonly 'engine.stage.started': Scalars & { readonly stage: string };
  /** Nested stage result. */
  readonly 'engine.stage.completed': Scalars &
    Timed &
    OperationalOutcome & { readonly stage: string };
  /** Unexpected stage termination. */
  readonly 'engine.stage.failed': Scalars &
    Timed &
    OperationalOutcome & { readonly stage: string };
  /** Voice tool admission within its producer lifetime. */
  readonly 'voice.tool.called': Scalars;
  /** Voice result; missing outcome evidence stays unknown during projection. */
  readonly 'voice.tool.result': Scalars &
    Timed & { readonly ok: boolean } & (
      | OperationalOutcome
      | { readonly outcome?: never; readonly errorCategory?: never }
    );
  /** Voice cancellation independent of result delivery. */
  readonly 'voice.tool.cancelled': Scalars & { readonly outcome: 'cancelled' };
  /** Loss of an observation before export. */
  readonly 'voice.telemetry.dropped': Scalars;
};

/** Checks built-in fields while leaving application-defined diagnostic kinds extensible. */
export type ObservationMetadata<Kind extends string> =
  Kind extends OperationalKind ? OperationalMetadata[Kind] : Scalars;

/** Require evidence for built-in events that cannot be described by empty metadata. */
export type ObservationArguments<Kind extends string> =
  Record<string, never> extends ObservationMetadata<Kind>
    ? [metadata?: ObservationMetadata<Kind>]
    : [metadata: ObservationMetadata<Kind>];
