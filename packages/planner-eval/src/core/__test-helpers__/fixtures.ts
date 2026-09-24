import type { Logger, PlanningInput, StageContext } from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestSchema,
  MessageId,
  SessionId,
  type TilingNode,
  type UpdateReason,
  type Vessel,
} from '@maelstrom-co/protocol';
import { demoVessels } from '../fixtures/demo-vessels.js';

/** The default board: calendar, weather and tasks visible in a row; map and journal hidden. */
export const DEFAULT_TREE: readonly TilingNode[] = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
] as TilingNode[];

export interface RequestOptions {
  readonly tree?: readonly (string | null)[];
  readonly variants?: Readonly<Record<string, string>>;
  readonly columns?: number;
  readonly rows?: number;
  readonly vessels?: readonly Vessel[];
}

/** A tiling request with one `<vessel>-main` instance per demo Vessel. */
export function makeRequest(
  intent: string | readonly UpdateReason[],
  options: RequestOptions = {},
): ChartRequest {
  const catalog = options.vessels ?? demoVessels;
  const instances = catalog.map((vessel) => ({
    instanceId: `${vessel.id}-main`,
    vesselId: vessel.id,
    variant: options.variants?.[vessel.id] ?? vessel.defaultVariant,
  }));
  const updateReasons =
    typeof intent === 'string' ? [{ type: 'user_intent', intent }] : intent;
  return ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      layoutMode: 'tiling',
      chartDimensions: {
        columns: options.columns ?? 30,
        rows: options.rows ?? 18,
      },
      updateReasons,
    },
    instances,
    vessels: catalog,
    layout: { type: 'tiling', tree: options.tree ?? DEFAULT_TREE, instances },
  });
}

export function makeInput(request: ChartRequest): PlanningInput {
  return {
    messageId: MessageId('req-1'),
    sessionId: SessionId('session-1'),
    request,
    history: [],
  };
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export function makeContext(input: PlanningInput): StageContext {
  return {
    origin: input,
    logger: silentLogger,
    validate: () => {
      throw new Error('the core tests validate no candidate');
    },
  };
}
