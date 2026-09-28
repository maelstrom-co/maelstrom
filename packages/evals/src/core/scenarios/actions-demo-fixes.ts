import type {
  BASE_VISIBLE,
  planned,
  routeAfter,
  Scenario,
  STUDIO_ROUTE_TURN,
} from '../scenarios.js';

/** The builders and constants of `scenarios.ts` these scenarios are made with. */
export interface ActionsDemoFixBuilders {
  readonly planned: typeof planned;
  readonly routeAfter: typeof routeAfter;
  readonly STUDIO_ROUTE_TURN: typeof STUDIO_ROUTE_TURN;
  readonly BASE_VISIBLE: typeof BASE_VISIBLE;
}

/**
 * Requests that must plan each action once: a write the intent names once
 * beside a request to show its widget, two different edits of one kind, and
 * a repeated route whose first action slot the planner may leave empty.
 * Parameters are left unscored where their casing is noise; the actions are
 * still counted, so a repeated action fails.
 */
export function actionsDemoFixScenarios(
  build: ActionsDemoFixBuilders,
): readonly Scenario[] {
  const { planned, routeAfter, STUDIO_ROUTE_TURN, BASE_VISIBLE } = build;
  return [
    planned(
      'tasks-shown-and-buy-milk',
      'Add a task once when the request also shows the task list',
      'Show me my tasks and add buy milk.',
      {
        visible: BASE_VISIBLE,
        actions: [{ instanceId: 'tasks-main', action: 'addTask' }],
      },
    ),
    planned(
      'add-task-and-move-design-review',
      'Add a task and move an event, each once',
      'Add a task to prep the slides and move the design review to 11:00.',
      {
        visible: BASE_VISIBLE,
        actions: [
          { instanceId: 'calendar-main', action: 'moveEvent' },
          { instanceId: 'tasks-main', action: 'addTask' },
        ],
      },
    ),
    planned(
      'move-two-events',
      'Move two different events, one call each',
      'Move the gym to 8:00 and the design review to 11:00.',
      {
        visible: BASE_VISIBLE,
        actions: [
          { instanceId: 'calendar-main', action: 'moveEvent' },
          { instanceId: 'calendar-main', action: 'moveEvent' },
        ],
      },
    ),
    routeAfter(
      'route-again-with-empty-first-slot',
      'Route again with the map already showing that route',
      'Route there again.',
      STUDIO_ROUTE_TURN,
      'Studio Vortex HQ',
    ),
    {
      ...planned(
        'hold-tasks-shown-and-add-invoice',
        'Add a task once when the request also opens the task list',
        'Open my tasks and add send invoice.',
        {
          visible: BASE_VISIBLE,
          actions: [{ instanceId: 'tasks-main', action: 'addTask' }],
        },
      ),
      suite: 'holdout',
    },
    {
      ...routeAfter(
        'hold-route-again-overview',
        'Route again from the map overview',
        'Take me there again.',
        STUDIO_ROUTE_TURN,
        'Studio Vortex HQ',
        'overview',
      ),
      suite: 'holdout',
    },
  ];
}
