import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import {
  type ActionExecution,
  ActionName,
  defineVessel,
  err,
  InstanceId,
  isErr,
  ok,
  VariantName,
  type VesselDefinition,
  VesselId,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import {
  calendarMain,
  calendarViewsVessel,
} from '../../../test-utils/calendar-vessel.js';
import {
  inboxMain,
  listDetailVessel,
} from '../../../test-utils/list-detail-vessel.js';
import { Logger } from '../utils/logger.js';
import { ActionManager, type VariantTransitions } from './action-manager.js';
import type {
  ActionRunner,
  BatchExecutionResult,
} from './action-runner.types.js';
import { resolveActionOnVariant } from './action-variant-resolution.js';

const i1 = InstanceId('instance-1');
const i2 = InstanceId('instance-2');

it('Action summaries distinguish unavailable runners from missing handlers', async () => {
  const manager = new ActionManager({ readinessTimeoutMs: 1 });
  try {
    const plan = [{ instanceId: i1, action: ActionName('testAction') }];
    const unavailable = await manager.executeActions(plan);
    expect(unavailable.actions[0]).toMatchObject({
      skipped: true,
      errorCategory: 'readiness',
    });
    manager.registerRunner(i1, {});
    const missingHandler = await manager.executeActions(plan);
    expect(missingHandler.actions[0]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
    });
  } finally {
    manager.dispose();
  }
});

it('only the owning execution deadline classifies a timeout', async () => {
  const manager = new ActionManager({ executionTimeoutMs: 5 });
  const plan = [{ instanceId: i1, action: ActionName('testAction') }];
  try {
    manager.registerRunner(i1, {
      testAction: () => new Promise<never>(() => {}),
    });
    const timed = await manager.executeActions(plan);
    expect(timed.actions[0].errorCategory).toBe('timeout');
    const timeoutResult = timed.actions[0].result;
    if (timeoutResult.ok) throw new Error('Expected execution timeout');
    manager.registerRunner(i1, {
      testAction: () => {
        throw timeoutResult.error;
      },
    });
    expect((await manager.executeActions(plan)).actions[0].errorCategory).toBe(
      'application',
    );
    manager.registerRunner(i1, {
      testAction: () => err(new Error('Timed out after 5ms')),
    });
    expect((await manager.executeActions(plan)).actions[0].errorCategory).toBe(
      'application',
    );
    manager.registerRunner(i1, {
      testAction: async () => {
        throw new Error('Async handler failure');
      },
    });
    expect((await manager.executeActions(plan)).actions[0].errorCategory).toBe(
      'application',
    );
    manager.registerRunner(i1, { testAction: () => ok(undefined) });
    expect(
      (await manager.executeActions(plan)).actions[0].errorCategory,
    ).toBeUndefined();
  } finally {
    manager.dispose();
  }
});

// Mock vessel for testing
const mockVessel = defineVessel({
  id: 'test',
  name: 'Test',
  description: 'Test vessel',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [{ name: 'testAction', description: 'Test action' }],
    },
  },
});

type MockVessel = typeof mockVessel;

describe('ActionManager', () => {
  let manager: ActionManager;

  function createTestManager() {
    manager = new ActionManager({ readinessTimeoutMs: 100 });
  }

  beforeEach(() => {
    createTestManager();
  });

  describe('runner registration', () => {
    it('should register a runner for an instance', () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      manager.registerRunner<MockVessel>(i1, runner);

      expect(manager.hasRunner(i1)).toBe(true);
      expect(manager.getRegisteredInstances()).toContain(i1);
    });

    it('should overwrite existing runner when registering same instance', async () => {
      const runner1: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };
      const runner2: ActionRunner<MockVessel> = {
        testAction: async () => err(new Error('overwritten')),
      };

      manager.registerRunner<MockVessel>(i1, runner1);
      expect(manager.hasRunner(i1)).toBe(true);

      // Overwrite with runner2
      manager.registerRunner<MockVessel>(i1, runner2);
      expect(manager.hasRunner(i1)).toBe(true);

      // Verify the second runner is used by executing an action
      const result = await manager.executeActions([
        {
          instanceId: i1,
          action: ActionName('testAction'),
          params: {},
        },
      ]);

      expect(result.actions).toHaveLength(1);
      expect(isErr(result.actions[0].result)).toBe(true);
    });

    it('should return empty array when no runners registered', () => {
      expect(manager.getRegisteredInstances()).toEqual([]);
    });

    it('registerRunner returns a disposer function', () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      const disposer = manager.registerRunner<MockVessel>(i1, runner);

      expect(typeof disposer).toBe('function');
    });

    it('disposer removes the runner when identity matches', () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      const disposer = manager.registerRunner<MockVessel>(i1, runner);
      expect(manager.hasRunner(i1)).toBe(true);

      disposer();
      expect(manager.hasRunner(i1)).toBe(false);
    });

    it('disposer does not remove a different runner registered for the same instanceId', () => {
      const runnerA: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };
      const runnerB: ActionRunner<MockVessel> = {
        testAction: async () => err(new Error('runner B')),
      };

      const disposerA = manager.registerRunner<MockVessel>(i1, runnerA);
      manager.registerRunner<MockVessel>(i1, runnerB);

      // Calling disposerA should NOT remove runnerB
      disposerA();
      expect(manager.hasRunner(i1)).toBe(true);
    });

    it('disposer is idempotent', () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      const disposer = manager.registerRunner<MockVessel>(i1, runner);
      disposer();
      expect(manager.hasRunner(i1)).toBe(false);

      // Second call should be a no-op (no error)
      disposer();
      expect(manager.hasRunner(i1)).toBe(false);
    });

    it('should support multiple instances with different runners', () => {
      const runner1: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };
      const runner2: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      manager.registerRunner<MockVessel>(i1, runner1);
      manager.registerRunner<MockVessel>(i2, runner2);

      expect(manager.hasRunner(i1)).toBe(true);
      expect(manager.hasRunner(i2)).toBe(true);
      expect(manager.getRegisteredInstances()).toEqual([i1, i2]);
    });
  });

  describe('empty execution plan', () => {
    it('should return empty result for empty execution plan', async () => {
      const result = await manager.executeActions([]);

      expect(result.actions).toHaveLength(0);
      expect(result.allSucceeded).toBe(true);
      expect(result.successCount).toBe(0);
      expect(result.failureCount).toBe(0);
      expect(result.skippedCount).toBe(0);
    });
  });

  describe('single action execution', () => {
    it('should execute a single action', async () => {
      let executedAction = '';
      const mockTestAction = mock(async () => {
        executedAction = 'testAction';
        return ok(undefined);
      });
      const runner: ActionRunner<MockVessel> = {
        testAction: mockTestAction,
      };
      manager.registerRunner<MockVessel>(i1, runner);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(executedAction).toBe('testAction');
      expect(mockTestAction).toHaveBeenCalledTimes(1);
      expect(result.successCount).toBe(1);
      expect(result.allSucceeded).toBe(true);
      expect(result.actions[0].instanceId).toBe(i1);
      expect(result.actions[0].action).toBe(ActionName('testAction'));
      expect(result.actions[0].result.ok).toBe(true);
    });

    it('should handle action failure', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => err(new Error('Action failed')),
      };
      manager.registerRunner<MockVessel>(i1, runner);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.allSucceeded).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(result.actions[0].result.ok).toBe(false);
      expect((result.actions[0].result as { error: Error }).error.message).toBe(
        'Action failed',
      );
    });
  });

  describe('sequential execution within instance', () => {
    it('should execute actions sequentially for same instance', async () => {
      const executionOrder: string[] = [];
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          executionOrder.push('start-testAction');
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push('end-testAction');
          return ok(undefined);
        },
      };
      manager.registerRunner<MockVessel>(i1, runner);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i1, action: ActionName('testAction') },
      ];
      await manager.executeActions(executionPlan);

      // Verify sequential execution: action starts, ends, then next action, etc.
      expect(executionOrder).toEqual([
        'start-testAction',
        'end-testAction',
        'start-testAction',
        'end-testAction',
        'start-testAction',
        'end-testAction',
      ]);
    });
  });

  describe('parallel execution across instances', () => {
    it('should execute actions in parallel for different instances', async () => {
      const executionOrder: string[] = [];
      const runner1: ActionRunner<MockVessel> = {
        testAction: async () => {
          executionOrder.push('start-instance-1');
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionOrder.push('end-instance-1');
          return ok(undefined);
        },
      };
      const runner2: ActionRunner<MockVessel> = {
        testAction: async () => {
          executionOrder.push('start-instance-2');
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionOrder.push('end-instance-2');
          return ok(undefined);
        },
      };

      manager.registerRunner<MockVessel>(i1, runner1);
      manager.registerRunner<MockVessel>(i2, runner2);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i2, action: ActionName('testAction') },
      ];
      await manager.executeActions(executionPlan);

      // Both actions should have started before either ended (parallel)
      expect(executionOrder.slice(0, 2)).toContain('start-instance-1');
      expect(executionOrder.slice(0, 2)).toContain('start-instance-2');
    });
  });

  describe('no runner registered', () => {
    it('should skip actions when no runner is registered for instance', async () => {
      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.skippedCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.actions[0].skipped).toBe(true);
      expect(result.actions[0].result.ok).toBe(true);
    });
  });

  describe('mixed scenarios', () => {
    it('should handle multiple instances with different runners', async () => {
      // runner 1: success
      manager.registerRunner<MockVessel>(i1, {
        testAction: async () => ok(undefined),
      });
      // runner 2: failure
      manager.registerRunner<MockVessel>(i2, {
        testAction: async () => err(new Error('Instance 2 failed')),
      });

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i2, action: ActionName('testAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(1);
      expect(result.allSucceeded).toBe(false);
    });

    it('should handle runner throwing exception', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          throw new Error('Unexpected error');
        },
      };
      manager.registerRunner<MockVessel>(i1, runner);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.allSucceeded).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(result.actions[0].result.ok).toBe(false);
      expect(isErr(result.actions[0].result)).toBe(true);
      expect(
        isErr(result.actions[0].result) &&
          result.actions[0].result.error.message,
      ).toBe('Unexpected error');
    });

    it('should handle sync and async runners', async () => {
      // Sync runner (wrapped in Promise.resolve)
      manager.registerRunner<MockVessel>(i1, {
        testAction: () => ok(undefined),
      });
      // Async runner
      manager.registerRunner<MockVessel>(i2, {
        testAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return ok(undefined);
        },
      });

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i2, action: ActionName('testAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.allSucceeded).toBe(true);
      expect(result.successCount).toBe(2);
    });

    it('should handle registered and unregistered instances', async () => {
      // Only register runner for instance-1
      manager.registerRunner<MockVessel>(i1, {
        testAction: async () => ok(undefined),
      });

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i2, action: ActionName('testAction') }, // No runner
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].result.ok).toBe(true); // executed
      expect(result.actions[0].skipped).toBeUndefined(); // not skipped
      expect(result.actions[1].result.ok).toBe(true); // skipped (no runner)
      expect(result.actions[1].skipped).toBe(true); // marked as skipped
      expect(result.successCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.allSucceeded).toBe(true);
    });
  });

  describe('missing action handler', () => {
    it('should skip action when runner exists but handler for the action name is missing', async () => {
      // Register a runner with testAction but execute a different action name
      manager.registerRunner<MockVessel>(i1, {
        testAction: async () => ok(undefined),
      });

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('nonExistentAction') },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].skipped).toBe(true);
      expect(result.skippedCount).toBe(1);
      expect(result.successCount).toBe(0);
    });
  });

  describe('action parameters', () => {
    it('should pass action parameters to runner', async () => {
      const paramVessel = defineVessel({
        id: 'param-test',
        name: 'Param Test',
        description: 'Param test vessel',
        defaultVariant: 'default',
        variants: {
          default: {
            props: {},
            minSize: { width: 1, height: 1 },
            actions: [
              {
                name: 'testActionWithParams',
                description: 'Test action with params',
                parameters: [
                  {
                    name: 'testParam',
                    type: 'string',
                    description: 'Test param',
                    required: true,
                  },
                ],
              },
            ],
          },
        },
      });
      type ParamVessel = typeof paramVessel;

      let receivedParams: unknown = null;
      const runner: ActionRunner<ParamVessel> = {
        testActionWithParams: async (params) => {
          const _testParam: string = params.testParam;
          void _testParam;
          receivedParams = params;
          return ok(undefined);
        },
      };
      manager.registerRunner<ParamVessel>(i1, runner);

      const executionPlan: ActionExecution[] = [
        {
          instanceId: i1,
          action: ActionName('testActionWithParams'),
          params: { testParam: 'value' },
        },
      ];
      await manager.executeActions(executionPlan);

      expect(receivedParams).toEqual({ testParam: 'value' });
    });
  });

  describe('execution timeout', () => {
    let clock: ReturnType<typeof FakeTimers.install>;

    beforeEach(() => {
      clock = FakeTimers.install({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      clock.uninstall();
    });

    it('should fail action that exceeds execution timeout', async () => {
      const timeoutManager = new ActionManager({
        readinessTimeoutMs: 100,
        executionTimeoutMs: 50,
      });

      timeoutManager.registerRunner<MockVessel>(i1, {
        testAction: () => new Promise<never>(() => {}),
      });

      let result: BatchExecutionResult | null = null;
      timeoutManager
        .executeActions([{ instanceId: i1, action: ActionName('testAction') }])
        .then((_result) => {
          result = _result;
        });

      await clock.tickAsync(50);

      expect(result).not.toBeNull();
      const resolvedResult = result as BatchExecutionResult | null;
      if (!resolvedResult) throw new Error('expected result');
      expect(resolvedResult.failureCount).toBe(1);
      expect(resolvedResult.allSucceeded).toBe(false);
      expect(resolvedResult.actions[0].result.ok).toBe(false);
      expect(
        isErr(resolvedResult.actions[0].result) &&
          resolvedResult.actions[0].result.error.message,
      ).toContain('timed out after 50ms');
    });

    it('should not timeout sync handlers', async () => {
      const timeoutManager = new ActionManager({
        readinessTimeoutMs: 100,
        executionTimeoutMs: 50,
      });

      timeoutManager.registerRunner<MockVessel>(i1, {
        testAction: () => ok(undefined),
      });

      let result: BatchExecutionResult | null = null;
      timeoutManager
        .executeActions([{ instanceId: i1, action: ActionName('testAction') }])
        .then((_result) => {
          result = _result;
        });

      await clock.tickAsync(0);

      expect(result).not.toBeNull();
      const resolvedResult = result as BatchExecutionResult | null;
      if (!resolvedResult) throw new Error('expected result');
      expect(resolvedResult.successCount).toBe(1);
      expect(resolvedResult.allSucceeded).toBe(true);
    });

    it('should not timeout actions that complete within the limit', async () => {
      const timeoutManager = new ActionManager({
        readinessTimeoutMs: 100,
        executionTimeoutMs: 200,
      });

      timeoutManager.registerRunner<MockVessel>(i1, {
        testAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return ok(undefined);
        },
      });

      let result: BatchExecutionResult | null = null;
      timeoutManager
        .executeActions([{ instanceId: i1, action: ActionName('testAction') }])
        .then((_result) => {
          result = _result;
        });

      await clock.tickAsync(10);

      expect(result).not.toBeNull();
      const resolvedResult = result as BatchExecutionResult | null;
      if (!resolvedResult) throw new Error('expected result');
      expect(resolvedResult.successCount).toBe(1);
      expect(resolvedResult.allSucceeded).toBe(true);
    });
  });

  describe('stress tests', () => {
    it('should handle many actions on single instance', async () => {
      let actionCount = 0;
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          actionCount++;
          return ok(undefined);
        },
      };
      manager.registerRunner<MockVessel>(i1, runner);

      const executionPlan: ActionExecution[] = Array.from(
        { length: 100 },
        (_, _i) => ({
          instanceId: i1,
          action: ActionName('testAction'),
        }),
      );
      const result = await manager.executeActions(executionPlan);

      expect(actionCount).toBe(100);
      expect(result.successCount).toBe(100);
    });

    it('should handle many instances in parallel', async () => {
      const executedInstances: string[] = [];

      // Register runners for 50 instances
      for (let i = 0; i < 50; i++) {
        const instanceId = InstanceId(`instance-${i}`);
        manager.registerRunner<MockVessel>(instanceId, {
          testAction: async () => {
            executedInstances.push(instanceId);
            return ok(undefined);
          },
        });
      }

      const executionPlan: ActionExecution[] = Array.from(
        { length: 50 },
        (_, i) => ({
          instanceId: InstanceId(`instance-${i}`),
          action: ActionName('testAction'),
        }),
      );
      const result = await manager.executeActions(executionPlan);

      expect(result.successCount).toBe(50);
      expect(executedInstances).toHaveLength(50);
    });

    it('should handle mixed success and failures', async () => {
      for (let i = 0; i < 20; i++) {
        const instanceId = InstanceId(`instance-${i}`);
        if (i % 2 === 0) {
          manager.registerRunner<MockVessel>(instanceId, {
            testAction: async () => ok(undefined),
          });
        } else {
          manager.registerRunner<MockVessel>(instanceId, {
            testAction: async () => err(new Error(`Failure ${i}`)),
          });
        }
      }

      const executionPlan: ActionExecution[] = Array.from(
        { length: 20 },
        (_, i) => ({
          instanceId: InstanceId(`instance-${i}`),
          action: ActionName('testAction'),
        }),
      );
      const result = await manager.executeActions(executionPlan);

      expect(result.successCount).toBe(10);
      expect(result.failureCount).toBe(10);
      expect(result.allSucceeded).toBe(false);
    });
  });
});

// The shared calendar plus a self-transition and a transition to an
// undeclared Variant, for the edge cases.
const calendarVessel: VesselDefinition = {
  ...calendarViewsVessel,
  variants: {
    ...calendarViewsVessel.variants,
    day: {
      ...calendarViewsVessel.variants.day,
      actions: [
        ...calendarViewsVessel.variants.day.actions,
        {
          name: 'refreshDay',
          description: 'Re-show the day',
          transitionsTo: 'day',
        },
        {
          name: 'showYear',
          description: 'Undeclared view',
          transitionsTo: 'year',
          effect: 'none',
        },
      ],
    },
  },
};

// Keeps Variants in a plain map and resolves with the CommandProcessor's
// resolver, so these tests pin the ActionManager rules without a store.
function createFakeVariantTransitions(
  initial: Record<string, string>,
  vessel: VesselDefinition = calendarVessel,
) {
  const variants = new Map<string, string>(Object.entries(initial));
  const applyCalls: [string, string, string][] = [];
  const transitions: VariantTransitions = {
    resolve(instanceId, action) {
      const variant = variants.get(instanceId);
      if (variant === undefined) return { status: 'instance_missing' };
      return resolveActionOnVariant(vessel, VariantName(variant), action);
    },
    apply(instanceId, expected, next) {
      applyCalls.push([instanceId, expected, next]);
      if (variants.get(instanceId) !== expected) return false;
      variants.set(instanceId, next);
      return true;
    },
  };
  return { transitions, variants, applyCalls };
}

function plan(...actions: string[]): ActionExecution[] {
  return actions.map((action) => ({
    instanceId: calendarMain,
    action: ActionName(action),
  }));
}

describe('variant transitions', () => {
  let manager: ActionManager;

  beforeEach(() => {
    manager = new ActionManager({
      readinessTimeoutMs: 50,
      executionTimeoutMs: 20,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  it('applies an effect none transition with no handler and records it as applied', async () => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    manager.registerRunner(calendarMain, {});

    const result = await manager.executeActions(
      plan('showWeek'),
      undefined,
      transitions,
    );

    expect(result.skippedCount).toBe(0);
    expect(result.successCount).toBe(1);
    expect(result.actions[0].skipped).toBeUndefined();
    expect(result.actions[0].result.ok).toBe(true);
    expect(applyCalls).toEqual([['calendar-main', 'day', 'week']]);
    expect(variants.get('calendar-main')).toBe('week');
  });

  it('skips a transition Action that needs a handler and has none, without moving the Variant', async () => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions(
      { 'inbox-main': 'list' },
      listDetailVessel,
    );
    manager.registerRunner(inboxMain, {});

    const result = await manager.executeActions(
      [
        {
          instanceId: inboxMain,
          action: ActionName('selectItem'),
          params: { id: 'item-7' },
        },
      ],
      undefined,
      transitions,
    );

    expect(result.successCount).toBe(0);
    expect(result.skippedCount).toBe(1);
    expect(result.actions[0]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
      reason:
        'Action "selectItem" on Variant "list" of Instance "inbox-main" has no handler and is not declared effect "none"',
    });
    expect(applyCalls).toEqual([]);
    expect(variants.get('inbox-main')).toBe('list');
  });

  it('applies an effect none switch with no handler, then skips a following Action that has none', async () => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions(
      { 'inbox-main': 'list' },
      listDetailVessel,
    );
    manager.registerRunner(inboxMain, {});

    const result = await manager.executeActions(
      [
        { instanceId: inboxMain, action: ActionName('showDetails') },
        {
          instanceId: inboxMain,
          action: ActionName('selectItem'),
          params: { id: 'item-7' },
        },
      ],
      undefined,
      transitions,
    );

    expect(result.successCount).toBe(1);
    expect(result.actions[0].skipped).toBeUndefined();
    expect(result.actions[1]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
      reason:
        'Action "selectItem" on Variant "detail" of Instance "inbox-main" has no handler and is not declared effect "none"',
    });
    expect(applyCalls).toEqual([['inbox-main', 'list', 'detail']]);
    expect(variants.get('inbox-main')).toBe('detail');
  });

  it('runs a side-effect handler on the pre-action Variant, then applies the transition', async () => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const seen: string[] = [];
    manager.registerRunner(calendarMain, {
      showWeek: async () => {
        const resolution = transitions.resolve(
          calendarMain,
          ActionName('showWeek'),
        );
        seen.push(
          resolution.status === 'available' ? resolution.variant : 'n/a',
        );
        seen.push(`applies-before-handler-returns:${applyCalls.length}`);
        return ok(undefined);
      },
    });

    const result = await manager.executeActions(
      plan('showWeek'),
      undefined,
      transitions,
    );

    expect(seen).toEqual(['day', 'applies-before-handler-returns:0']);
    expect(result.successCount).toBe(1);
    expect(applyCalls).toEqual([['calendar-main', 'day', 'week']]);
    expect(variants.get('calendar-main')).toBe('week');
  });

  it.each([
    ['an error result', () => err(new Error('rejected')), 'application'],
    [
      'a throw',
      () => {
        throw new Error('thrown');
      },
      'application',
    ],
    ['a timeout', () => new Promise<never>(() => {}), 'timeout'],
  ] as const)('applies no transition when the handler fails with %s', async (_label, handler, category) => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    manager.registerRunner(calendarMain, { showWeek: handler });

    const result = await manager.executeActions(
      plan('showWeek'),
      undefined,
      transitions,
    );

    expect(result.failureCount).toBe(1);
    expect(result.actions[0].errorCategory).toBe(category);
    expect(applyCalls).toEqual([]);
    expect(variants.get('calendar-main')).toBe('day');
  });

  it('skips every Action as readiness without a transition when the runner never registers', async () => {
    const { transitions, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const resolve = spyOn(transitions, 'resolve');

    const result = await manager.executeActions(
      plan('showWeek', 'addEvent'),
      undefined,
      transitions,
    );

    expect(result.skippedCount).toBe(2);
    expect(result.actions.map((record) => record.errorCategory)).toEqual([
      'readiness',
      'readiness',
    ]);
    expect(applyCalls).toEqual([]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('skips an Action not defined on the current Variant with a reason, and keeps going', async () => {
    const { transitions, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const addEvent = mock(() => ok(undefined));
    const showDay = mock(() => ok(undefined));
    manager.registerRunner(calendarMain, { addEvent, showDay });

    const result = await manager.executeActions(
      plan('showDay', 'addEvent'),
      undefined,
      transitions,
    );

    expect(result.actions[0]).toMatchObject({
      action: ActionName('showDay'),
      skipped: true,
      errorCategory: 'application',
      reason:
        'Action "showDay" is not defined on Variant "day" of Instance "calendar-main"',
    });
    expect(showDay).not.toHaveBeenCalled();
    expect(addEvent).toHaveBeenCalledTimes(1);
    expect(result.successCount).toBe(1);
    expect(applyCalls).toEqual([]);
  });

  it('names a missing Instance and an unknown Vessel in the skip reason', async () => {
    manager.registerRunner(calendarMain, {});
    const missing = await manager.executeActions(plan('showWeek'), undefined, {
      resolve: () => ({ status: 'instance_missing' }),
      apply: () => true,
    });
    expect(missing.actions[0]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
      reason:
        'Action "showWeek" targets Instance "calendar-main", which is not in the store',
    });

    const unknownVessel = await manager.executeActions(
      plan('showWeek'),
      undefined,
      {
        resolve: () => ({
          status: 'vessel_unknown',
          vesselId: VesselId('calendar'),
          variant: VariantName('day'),
        }),
        apply: () => true,
      },
    );
    expect(unknownVessel.actions[0]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
      reason:
        'Action "showWeek" cannot be resolved on Variant "day" of Instance "calendar-main": Vessel "calendar" is not registered',
    });
  });

  it('resolves each Action against the Variant the previous Action left', async () => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const seenByAddEvent: (string | undefined)[] = [];
    manager.registerRunner(calendarMain, {
      addEvent: () => {
        seenByAddEvent.push(variants.get('calendar-main'));
        return ok(undefined);
      },
    });

    const result = await manager.executeActions(
      plan('addEvent', 'showWeek', 'showDay'),
      undefined,
      transitions,
    );

    expect(result.successCount).toBe(3);
    expect(result.skippedCount).toBe(0);
    expect(seenByAddEvent).toEqual(['day']);
    expect(applyCalls).toEqual([
      ['calendar-main', 'day', 'week'],
      ['calendar-main', 'week', 'day'],
    ]);
    expect(variants.get('calendar-main')).toBe('day');
  });

  it('reads the runner at each Action turn so a replaced runner handles later Actions', async () => {
    const { transitions } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const firstAddEvent = mock(() => ok(undefined));
    const secondAddEvent = mock(() => ok(undefined));
    manager.registerRunner(calendarMain, {
      showWeek: () => {
        manager.registerRunner(calendarMain, { addEvent: secondAddEvent });
        return ok(undefined);
      },
      addEvent: firstAddEvent,
    });

    const result = await manager.executeActions(
      plan('showWeek', 'addEvent'),
      undefined,
      transitions,
    );

    expect(result.successCount).toBe(2);
    expect(firstAddEvent).not.toHaveBeenCalled();
    expect(secondAddEvent).toHaveBeenCalledTimes(1);
  });

  it('waits for readiness again when the runner unregisters mid-sequence', async () => {
    // A readiness window far longer than the re-registration delay, so a slow
    // timer cannot turn the wait into a readiness skip.
    const patient = new ActionManager({ readinessTimeoutMs: 1_000 });
    try {
      const { transitions } = createFakeVariantTransitions({
        'calendar-main': 'day',
      });
      const secondAddEvent = mock(() => ok(undefined));
      const unregister = patient.registerRunner(calendarMain, {
        showWeek: () => {
          unregister();
          setTimeout(() => {
            patient.registerRunner(calendarMain, { addEvent: secondAddEvent });
          }, 5);
          return ok(undefined);
        },
      });

      const result = await patient.executeActions(
        plan('showWeek', 'addEvent'),
        undefined,
        transitions,
      );

      expect(result.successCount).toBe(2);
      expect(secondAddEvent).toHaveBeenCalledTimes(1);
    } finally {
      patient.dispose();
    }
  });

  it('skips as readiness without a transition when the runner stays gone mid-sequence', async () => {
    const { transitions, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const unregister = manager.registerRunner(calendarMain, {
      addEvent: () => {
        unregister();
        return ok(undefined);
      },
    });

    const result = await manager.executeActions(
      plan('addEvent', 'showWeek'),
      undefined,
      transitions,
    );

    expect(result.actions[1]).toMatchObject({
      skipped: true,
      errorCategory: 'readiness',
    });
    expect(applyCalls).toEqual([]);
  });

  it('does not apply a transition whose target is the current Variant', async () => {
    const { transitions, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    const refreshDay = mock(() => ok(undefined));
    manager.registerRunner(calendarMain, { refreshDay });

    const result = await manager.executeActions(
      plan('refreshDay'),
      undefined,
      transitions,
    );

    expect(refreshDay).toHaveBeenCalledTimes(1);
    expect(result.successCount).toBe(1);
    expect(applyCalls).toEqual([]);
  });

  it('warns about an unknown target Variant and applies no transition', async () => {
    const logger = new Logger(false);
    const warn = spyOn(logger, 'warn').mockImplementation(() => {});
    const local = new ActionManager({ logger, readinessTimeoutMs: 50 });
    try {
      const { transitions, applyCalls } = createFakeVariantTransitions({
        'calendar-main': 'day',
      });
      local.registerRunner(calendarMain, { showYear: () => ok(undefined) });
      const withHandler = await local.executeActions(
        plan('showYear'),
        undefined,
        transitions,
      );
      expect(withHandler.successCount).toBe(1);
      expect(applyCalls).toEqual([]);
      expect(
        warn.mock.calls.some((args) => String(args[0]).includes('"year"')),
      ).toBe(true);

      local.registerRunner(calendarMain, {});
      const withoutHandler = await local.executeActions(
        plan('showYear'),
        undefined,
        transitions,
      );
      expect(withoutHandler.actions[0]).toMatchObject({
        skipped: true,
        errorCategory: 'application',
      });
      expect(withoutHandler.actions[0].reason).toContain('"year"');
      expect(applyCalls).toEqual([]);
    } finally {
      local.dispose();
    }
  });

  it('skips an Action with neither a transition nor a handler as application', async () => {
    const { transitions } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    manager.registerRunner(calendarMain, {});

    const result = await manager.executeActions(
      plan('addEvent'),
      undefined,
      transitions,
    );

    expect(result.actions[0]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
      reason:
        'Action "addEvent" on Variant "day" of Instance "calendar-main" has no handler and is not declared effect "none"',
    });
  });

  it('treats a lost compare-and-set as applied, not as an error', async () => {
    const { transitions, variants, applyCalls } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    manager.registerRunner(calendarMain, {
      showWeek: () => {
        variants.set('calendar-main', 'month');
        return ok(undefined);
      },
    });

    const result = await manager.executeActions(
      plan('showWeek'),
      undefined,
      transitions,
    );

    expect(result.successCount).toBe(1);
    expect(applyCalls).toEqual([['calendar-main', 'day', 'week']]);
    expect(variants.get('calendar-main')).toBe('month');
  });

  it('runs each Instance in its own Variant sequence and counts across Instances', async () => {
    const calendarSide = InstanceId('calendar-side');
    const { transitions, variants } = createFakeVariantTransitions({
      'calendar-main': 'day',
      'calendar-side': 'week',
    });
    const mainAddEvent = mock(() => ok(undefined));
    manager.registerRunner(calendarMain, { addEvent: mainAddEvent });
    manager.registerRunner(calendarSide, {});

    const result = await manager.executeActions(
      [
        { instanceId: calendarMain, action: ActionName('showWeek') },
        { instanceId: calendarSide, action: ActionName('showMonth') },
        { instanceId: calendarMain, action: ActionName('addEvent') },
        { instanceId: calendarSide, action: ActionName('showMonth') },
      ],
      undefined,
      transitions,
    );

    expect(variants.get('calendar-main')).toBe('week');
    expect(variants.get('calendar-side')).toBe('month');
    expect(mainAddEvent).toHaveBeenCalledTimes(1);
    expect(result.successCount).toBe(3);
    expect(result.skippedCount).toBe(1);
    expect(
      result.actions
        .filter((record) => record.skipped)
        .map((record) => [record.instanceId, record.action, record.reason]),
    ).toEqual([
      [
        calendarSide,
        ActionName('showMonth'),
        'Action "showMonth" is not defined on Variant "month" of Instance "calendar-side"',
      ],
    ]);
  });

  it('reports readiness and handler starts to the observer, with no start for an effect none transition', async () => {
    const { transitions, variants } = createFakeVariantTransitions({
      'calendar-main': 'day',
    });
    manager.registerRunner(calendarMain, { addEvent: () => ok(undefined) });
    const progress: string[] = [];

    const result = await manager.executeActions(
      plan('addEvent', 'showWeek', 'showMonth'),
      ({ phase, action }) => {
        progress.push(action ? `${phase}:${action}` : phase);
      },
      transitions,
    );

    expect(progress).toEqual(['waiting', 'ready', 'started:addEvent']);
    expect(result.successCount).toBe(3);
    expect(variants.get('calendar-main')).toBe('month');
  });

  it('keeps the flat handler lookup with no transitions when none are supplied', async () => {
    const showDay = mock(() => ok(undefined));
    manager.registerRunner(calendarMain, { showDay });

    const flat = await manager.executeActions(plan('showDay', 'showWeek'));

    expect(showDay).toHaveBeenCalledTimes(1);
    expect(flat.actions[0].skipped).toBeUndefined();
    expect(flat.actions[1]).toMatchObject({
      skipped: true,
      errorCategory: 'application',
    });
    expect(flat.actions[1].reason).toBeUndefined();
  });
});
