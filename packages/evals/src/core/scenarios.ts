import type { LLMContextMessage } from '@maelstrom-co/engine';
import {
  type ChartRequest,
  ChartRequestSchema,
  type Vessel,
} from '@maelstrom-co/protocol';
import { demoVessels } from './fixtures/demo-vessels.js';
import type { Phase } from './plugin.js';
import { selectEvaluationCases } from './run-orchestration.js';
import { loadScenarioRegistry } from './scenario-registry.js';
import type {
  Expectation,
  ExpectedAction,
  Scenario,
  Suite,
} from './scenario-types.js';

export type {
  Expectation,
  ExpectedAction,
  ExpectedAsk,
  Scenario,
  Suite,
} from './scenario-types.js';

/** How {@link request} builds a scenario's Chart request. */
export interface InputOptions {
  /** The current tiling tree; calendar, weather and tasks side by side when absent. Required with `instances`. */
  readonly tree?: readonly (string | null)[];
  /** Variant per Vessel id; each Vessel's default when absent. */
  readonly variants?: Readonly<Record<string, string>>;
  /** The Chart grid width in columns; 30 when absent. */
  readonly columns?: number;
  /** The Chart grid height in rows; 18 when absent. */
  readonly rows?: number;
  /** The Vessel catalog; the demo Vessels when absent. */
  readonly vessels?: readonly Vessel[];
  /** Vessel ids, one Instance `<id>-main` each; the five demo Vessels when absent. */
  readonly instances?: readonly string[];
  /** The prior grid size a `chart_resize` turn starts from; adds a `chart_resize` update reason ahead of the intent when given. */
  readonly resizeFrom?: { readonly columns: number; readonly rows: number };
}

const BASE_TREE = [
  'V:1,1,1',
  'ID:calendar-main',
  'ID:weather-main',
  'ID:tasks-main',
];
/** The Instances the demo board's default tree shows. */
export const BASE_VISIBLE = ['calendar-main', 'weather-main', 'tasks-main'];
const DEMO_INSTANCES = ['calendar', 'weather', 'tasks', 'map', 'journal'];
/** An earlier turn that routed the map to Studio Vortex HQ. */
export const STUDIO_ROUTE_TURN: readonly LLMContextMessage[] = [
  {
    role: 'user',
    content: 'Show me the route to Studio Vortex HQ on the map.',
  },
  { role: 'assistant', content: 'The route is set to Studio Vortex HQ.' },
];

const registry = loadScenarioRegistry();
/** Canonical scenario definitions in manifest order, with no TypeScript data fallback. */
export const scenarios: readonly Scenario[] = registry.scenarios;
/** Source-format inventory from the same manifest that supplies the runtime definitions. */
export const jsonBackedScenarioIds = registry.jsonBackedScenarioIds;

/** Scenarios of `suite` (`all` for every one). */
export function selectScenarios(
  suite: Suite | 'all',
  ids: readonly string[] = [],
): readonly Scenario[] {
  return selectEvaluationCases(scenarios, {
    id: (scenario) => scenario.id,
    ids,
    include: (scenario) => suite === 'all' || scenario.suite === suite,
  });
}

/** A development scenario expecting a plan that meets `expected`, on the demo board changed by `options`. */
export function planned(
  id: string,
  title: string,
  intent: string,
  expected: Omit<Expectation, 'status'>,
  options: InputOptions = {},
): Scenario {
  return {
    id,
    suite: 'development',
    title,
    request: request(intent, options),
    expected: { status: 'planned', ...expected },
  };
}

/** A development scenario expecting a deferral, from `deferStage` when given, on the demo board changed by `options`. */
export function deferred(
  id: string,
  title: string,
  intent: string,
  deferStage?: Phase,
  options: InputOptions = {},
): Scenario {
  return {
    id,
    suite: 'development',
    title,
    request: request(intent, options),
    expected: { status: 'deferred', ...(deferStage && { deferStage }) },
  };
}

/**
 * The Chart request of a scenario whose latest intent is `intent`.
 *
 * @throws {Error} On an Instance whose Vessel the catalog lacks, or on
 * `instances` without a `tree`.
 */
export function request(
  intent: string,
  options: InputOptions = {},
): ChartRequest {
  const vessels = options.vessels ?? demoVessels;
  if (options.instances !== undefined && options.tree === undefined)
    throw new Error(
      'a request naming its Instances needs a tree, since the default tree names demo Instances',
    );
  const instances = (options.instances ?? DEMO_INSTANCES).map((id) => {
    const vessel = vessels.find((v) => v.id === id);
    if (!vessel) throw new Error(`unknown fixture Vessel ${id}`);
    return {
      instanceId: `${id}-main`,
      vesselId: id,
      variant: options.variants?.[id] ?? vessel.defaultVariant,
    };
  });
  const current = { columns: options.columns ?? 30, rows: options.rows ?? 18 };
  return ChartRequestSchema.parse({
    type: 'chart_request',
    context: {
      layoutMode: 'tiling',
      chartDimensions: current,
      updateReasons: [
        ...(options.resizeFrom
          ? [{ type: 'chart_resize', previous: options.resizeFrom, current }]
          : []),
        ...(intent.length > 0 || !options.resizeFrom
          ? [{ type: 'user_intent', intent }]
          : []),
      ],
    },
    instances,
    vessels,
    layout: { type: 'tiling', tree: options.tree ?? BASE_TREE, instances },
  });
}

/**
 * A route request made after earlier turns in `history`, with the map in
 * `mapVariant`: the plan routes to `destination`.
 */
export function routeAfter(
  id: string,
  title: string,
  intent: string,
  history: readonly LLMContextMessage[],
  destination: string,
  mapVariant = 'route',
): Scenario {
  return {
    ...planned(
      id,
      title,
      intent,
      {
        visible: [...BASE_VISIBLE, 'map-main'],
        actions: [
          {
            instanceId: 'map-main',
            action: 'showRoute',
            params: { destination },
          },
        ],
      },
      { variants: { map: mapVariant } },
    ),
    history,
  };
}

/** `scenario` tagged as a request that asks for an arrangement. */
export function spatial(scenario: Scenario): Scenario {
  return { ...scenario, spatial: true };
}

/** `scenario` tagged as a control that should leave the arrangement alone. */
export function control(scenario: Scenario): Scenario {
  return { ...scenario, spatial: false };
}

/** The expected `addTask` on the demo tasks Instance. */
export function addTask(title: string): ExpectedAction {
  return { instanceId: 'tasks-main', action: 'addTask', params: { title } };
}
