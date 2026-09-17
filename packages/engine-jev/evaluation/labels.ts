import type { Action, Backend } from './fixtures.js';

type LayoutLabel = {
  type: 'tiling' | 'grid';
  tree?: readonly string[];
  instances?: readonly {
    instanceId: string;
    vesselId: string;
    variant: string;
  }[];
  positions?: readonly unknown[];
};
export type Label = {
  layout: LayoutLabel;
  actions: readonly Action[];
  planRequired: boolean;
  terminal: string;
  reason?: string;
  mistakes: readonly string[];
  calls: number;
  fallbackCalls: number;
};
const retained = [
  { instanceId: 'weather-main', vesselId: 'weather', variant: 'current' },
  { instanceId: 'tasks-main', vesselId: 'tasks', variant: 'list' },
  { instanceId: 'weather-hidden', vesselId: 'weather', variant: 'current' },
];
const original: LayoutLabel = {
  type: 'tiling',
  tree: ['V:1,1', 'ID:weather-main', 'ID:tasks-main'],
  instances: retained,
};

export function labelFor(id: string, backend: Backend): Label {
  const label: Label = {
    layout: original,
    actions: [],
    planRequired: true,
    terminal: 'accepted',
    mistakes: [],
    calls: 1,
    fallbackCalls: 0,
  };
  const defer = (reason: string) => {
    label.terminal = 'PlanningDeferredError';
    label.reason = reason;
  };
  switch (id) {
    case 'preserve':
      break;
    case 'show-hidden':
      label.layout = {
        ...original,
        tree: [
          'V:1,1,1',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:weather-hidden',
        ],
      };
      break;
    case 'hide':
      label.layout = { ...original, tree: ['ID:tasks-main'] };
      break;
    case 'delete':
      label.layout = {
        ...original,
        tree: ['ID:tasks-main'],
        instances: retained.filter((i) => i.instanceId !== 'weather-main'),
      };
      break;
    case 'new-instance':
      label.layout = {
        ...original,
        tree: [
          'V:1,1,1',
          'ID:weather-main',
          'ID:tasks-main',
          'ID:weather-jev-1',
        ],
        instances: [
          ...retained,
          {
            instanceId: 'weather-jev-1',
            vesselId: 'weather',
            variant: 'current',
          },
        ],
      };
      label.actions = [
        {
          instanceId: 'weather-jev-1',
          action: 'setLocation',
          params: { location: 'Paris' },
        },
      ];
      label.calls = backend === 'jev' ? 3 : 1;
      break;
    case 'ordered-transitions':
      label.actions = [
        { instanceId: 'weather-main', action: 'showWeekly' },
        { instanceId: 'weather-main', action: 'showCurrent' },
      ];
      label.calls = backend === 'jev' ? 2 : 1;
      break;
    case 'source-parameter':
    case 'unquoted-source-parameter':
    case 'wrong-parameter':
      label.actions = [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: 'Tokyo' },
        },
      ];
      label.calls = backend === 'jev' ? 3 : 1;
      if (id === 'wrong-parameter') label.mistakes = ['parameters'];
      break;
    case 'candidate-gap':
      label.actions = [
        {
          instanceId: 'weather-main',
          action: 'setLocation',
          params: { location: { latitude: -34.9, longitude: -56.2 } },
        },
      ];
      label.calls = 1;
      if (backend === 'jev') {
        defer('policy');
        label.calls = 2;
      }
      break;
    case 'enum-parameter':
      label.actions = [
        {
          instanceId: 'tasks-main',
          action: 'complete',
          params: { title: 'Buy milk' },
        },
      ];
      label.calls = backend === 'jev' ? 3 : 1;
      break;
    case 'history-follow-up':
    case 'stage-budget':
      label.actions = [{ instanceId: 'weather-main', action: 'showWeekly' }];
      label.calls = backend === 'jev' ? 2 : 1;
      if (id === 'stage-budget' && backend === 'jev') {
        label.terminal = 'PlanningBudgetExceededError';
        label.calls = 1;
      }
      break;
    case 'resize':
      label.calls = backend === 'jev' ? 0 : 1;
      break;
    case 'grid':
      label.layout = {
        type: 'grid',
        positions: [
          {
            instanceId: 'weather-main',
            position: { row: 0, column: 0 },
            size: { width: 2, height: 2 },
          },
        ],
      };
      if (backend === 'jev') {
        defer('unsupported_capability');
        label.calls = 0;
      }
      break;
    case 'wrong-layout':
    case 'wrong-arrangement':
      label.mistakes = ['layout'];
      break;
    case 'wrong-retention':
      label.layout = { ...original, tree: ['ID:tasks-main'] };
      label.mistakes = ['layout'];
      break;
    case 'policy-limit':
      label.actions = ['Tokyo', 'Paris', 'Rome'].map((location) => ({
        instanceId: 'weather-main',
        action: 'setLocation',
        params: { location },
      }));
      if (backend === 'jev') defer('policy');
      break;
    case 'wrong-action':
      label.mistakes = ['actions'];
      label.calls = backend === 'jev' ? 2 : 1;
      break;
    case 'unnecessary-deferral':
      if (backend === 'jev') defer('uncertain');
      break;
    case 'ambiguity':
      label.planRequired = false;
      defer(backend === 'jev' ? 'uncertain' : 'invalid_plan');
      break;
    case 'strict-rejection':
      label.planRequired = false;
      defer('invalid_plan');
      break;
    case 'provider-failure':
      label.planRequired = false;
      label.terminal = 'ProviderError';
      break;
    case 'malformed-response':
      label.planRequired = false;
      label.terminal = 'InvalidProviderResponseError';
      break;
    case 'cancel':
      label.planRequired = false;
      label.terminal = 'CancellationError';
      break;
    case 'fallback':
    case 'strict-fallback':
      label.calls = 2;
      label.fallbackCalls = 1;
      break;
    case 'fallback-budget':
      label.terminal = 'PlanningBudgetExceededError';
      break;
    default:
      throw new Error(`Missing independent label: ${id}`);
  }
  return label;
}
