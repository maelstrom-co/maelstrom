import {
  type Ask,
  type AskCall,
  createTypeSafeClient,
} from '@maelstrom-co/planner-jev/_internal';
import { TYPESAFE_ENV, type TypeSafeSettings } from './typesafe-settings.js';

/**
 * The provider client the stage eval modules and the stage plugin run on,
 * with how the eval labels and configures it. Its settings are read each
 * time a client is built and each time its meta is printed, so a missing
 * key fails the run, not the import.
 */
export interface ClientBuilder {
  /** What the stage report calls the client's calls, for example `Jev` or `Decisions`. */
  readonly provider: string;
  /** Environment variables the client needs; the CLIs refuse to run without them. */
  readonly requiredEnv: readonly string[];
  /** The client's settings printed with a run's meta, for example `{ jevModel }`. */
  meta(): Readonly<Record<string, string>>;
  /** A client reporting every call it makes to `onCall`. */
  ask(onCall: (call: AskCall) => void): Ask;
}

/** The TypeSafe Jev client on `settings`, labelled `Jev`. */
export function typesafeClientBuilder(
  settings: TypeSafeSettings,
): ClientBuilder {
  return {
    provider: 'Jev',
    requiredEnv: TYPESAFE_ENV,
    meta: () => ({ jevModel: settings().model }),
    ask: (onCall) => createTypeSafeClient({ ...settings(), onCall }),
  };
}

/**
 * A client of `client` for one stage eval turn: every call it makes is
 * reported to `onCall` with the evaluation's `state` added.
 */
export function askRecordingState(
  client: ClientBuilder,
  onCall: (call: AskCall & { readonly state: unknown }) => void,
): Ask {
  return (stage, evaluation, ctx) =>
    client.ask((call) => onCall({ ...call, state: evaluation.state }))(
      stage,
      evaluation,
      ctx,
    );
}
