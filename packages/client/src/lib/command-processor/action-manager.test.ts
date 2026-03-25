import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import FakeTimers from '@sinonjs/fake-timers';

import {
  type ActionExecution,
  defineVessel,
  Err,
  isErr,
  Success,
} from '@maelstrom-co/protocol-old';

import { ActionManager } from './action-manager.js';
import type {
  ActionRunner,
  BatchExecutionResult,
} from './action-runner.types.js';

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
        testAction: async () => Success(undefined),
      };

      manager.registerRunner<MockVessel>('instance-1', runner);

      expect(manager.hasRunner('instance-1')).toBe(true);
      expect(manager.getRegisteredInstances()).toContain('instance-1');
    });

    it('should unregister a runner', () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => Success(undefined),
      };
      manager.registerRunner<MockVessel>('instance-1', runner);

      manager.unregisterRunner('instance-1');

      expect(manager.hasRunner('instance-1')).toBe(false);
      expect(manager.getRegisteredInstances()).not.toContain('instance-1');
    });

    it('should overwrite existing runner when registering same instance', async () => {
      const runner1: ActionRunner<MockVessel> = {
        testAction: async () => Success(undefined),
      };
      const runner2: ActionRunner<MockVessel> = {
        testAction: async () => Err(new Error('overwritten')),
      };

      manager.registerRunner<MockVessel>('instance-1', runner1);
      expect(manager.hasRunner('instance-1')).toBe(true);

      // Overwrite with runner2
      manager.registerRunner<MockVessel>('instance-1', runner2);
      expect(manager.hasRunner('instance-1')).toBe(true);

      // Verify the second runner is used by executing an action
      const result = await manager.executeActions([
        {
          instanceId: 'instance-1',
          action: 'testAction',
          params: {},
        } as unknown as ActionExecution,
      ]);

      expect(result.actions).toHaveLength(1);
      expect(isErr(result.actions[0].result)).toBe(true);
    });

    it('should return empty array when no runners registered', () => {
      expect(manager.getRegisteredInstances()).toEqual([]);
    });

    it('should support multiple instances with different runners', () => {
      const runner1: ActionRunner<MockVessel> = {
        testAction: async () => Success(undefined),
      };
      const runner2: ActionRunner<MockVessel> = {
        testAction: async () => Success(undefined),
      };

      manager.registerRunner<MockVessel>('instance-1', runner1);
      manager.registerRunner<MockVessel>('instance-2', runner2);

      expect(manager.hasRunner('instance-1')).toBe(true);
      expect(manager.hasRunner('instance-2')).toBe(true);
      expect(manager.getRegisteredInstances()).toEqual([
        'instance-1',
        'instance-2',
      ]);
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
        return Success(undefined);
      });
      const runner: ActionRunner<MockVessel> = {
        testAction: mockTestAction,
      };
      manager.registerRunner<MockVessel>('instance-1', runner);

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(executedAction).toBe('testAction');
      expect(mockTestAction).toHaveBeenCalledTimes(1);
      expect(result.successCount).toBe(1);
      expect(result.allSucceeded).toBe(true);
      expect(result.actions[0].instanceId).toBe('instance-1');
      expect(result.actions[0].action).toBe('testAction');
      expect(result.actions[0].result.success).toBe(true);
    });

    it('should handle action failure', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => Err(new Error('Action failed')),
      };
      manager.registerRunner<MockVessel>('instance-1', runner);

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.allSucceeded).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(result.actions[0].result.success).toBe(false);
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
          return Success(undefined);
        },
      };
      manager.registerRunner<MockVessel>('instance-1', runner);

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
        { instanceId: 'instance-1', action: 'testAction' },
        { instanceId: 'instance-1', action: 'testAction' },
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
          return Success(undefined);
        },
      };
      const runner2: ActionRunner<MockVessel> = {
        testAction: async () => {
          executionOrder.push('start-instance-2');
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionOrder.push('end-instance-2');
          return Success(undefined);
        },
      };

      manager.registerRunner<MockVessel>('instance-1', runner1);
      manager.registerRunner<MockVessel>('instance-2', runner2);

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
        { instanceId: 'instance-2', action: 'testAction' },
      ];
      await manager.executeActions(executionPlan);

      // Both actions should have started before either ended (parallel)
      expect(executionOrder.slice(0, 2)).toContain('start-instance-1');
      expect(executionOrder.slice(0, 2)).toContain('start-instance-2');
    });
  });

  describe('no runner registered', () => {
    it('should skip actions when no runner is registered for instance', async () => {
      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.skippedCount).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.actions[0].skipped).toBe(true);
      expect(result.actions[0].result.success).toBe(true);
    });
  });

  describe('mixed scenarios', () => {
    it('should handle multiple instances with different runners', async () => {
      // runner 1: success
      manager.registerRunner<MockVessel>('instance-1', {
        testAction: async () => Success(undefined),
      });
      // runner 2: failure
      manager.registerRunner<MockVessel>('instance-2', {
        testAction: async () => Err(new Error('Instance 2 failed')),
      });

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
        { instanceId: 'instance-2', action: 'testAction' },
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
      manager.registerRunner<MockVessel>('instance-1', runner);

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.allSucceeded).toBe(false);
      expect(result.failureCount).toBe(1);
      expect(result.actions[0].result.success).toBe(false);
      expect(isErr(result.actions[0].result)).toBe(true);
      expect(
        isErr(result.actions[0].result) &&
          result.actions[0].result.error.message,
      ).toBe('Unexpected error');
    });

    it('should handle sync and async runners', async () => {
      // Sync runner (wrapped in Promise.resolve)
      manager.registerRunner<MockVessel>('instance-1', {
        testAction: () => Success(undefined),
      });
      // Async runner
      manager.registerRunner<MockVessel>('instance-2', {
        testAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return Success(undefined);
        },
      });

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
        { instanceId: 'instance-2', action: 'testAction' },
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.allSucceeded).toBe(true);
      expect(result.successCount).toBe(2);
    });

    it('should handle registered and unregistered instances', async () => {
      // Only register runner for instance-1
      manager.registerRunner<MockVessel>('instance-1', {
        testAction: async () => Success(undefined),
      });

      const executionPlan: ActionExecution<MockVessel>[] = [
        { instanceId: 'instance-1', action: 'testAction' },
        { instanceId: 'instance-2', action: 'testAction' }, // No runner
      ];
      const result = await manager.executeActions(executionPlan);

      expect(result.actions).toHaveLength(2);
      expect(result.actions[0].result.success).toBe(true); // executed
      expect(result.actions[0].skipped).toBeUndefined(); // not skipped
      expect(result.actions[1].result.success).toBe(true); // skipped (no runner)
      expect(result.actions[1].skipped).toBe(true); // marked as skipped
      expect(result.successCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.allSucceeded).toBe(true);
    });
  });

  describe('missing action handler', () => {
    it('should skip action when runner exists but handler for the action name is missing', async () => {
      // Register a runner with testAction but execute a different action name
      manager.registerRunner<MockVessel>('instance-1', {
        testAction: async () => Success(undefined),
      });

      const executionPlan: ActionExecution[] = [
        { instanceId: 'instance-1', action: 'nonExistentAction' },
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
          return Success(undefined);
        },
      };
      manager.registerRunner<ParamVessel>('instance-1', runner);

      const executionPlan: ActionExecution<ParamVessel>[] = [
        {
          instanceId: 'instance-1',
          action: 'testActionWithParams',
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

      timeoutManager.registerRunner<MockVessel>('instance-1', {
        testAction: () => new Promise<never>(() => {}),
      });

      let result: BatchExecutionResult | null = null;
      timeoutManager
        .executeActions<MockVessel>([
          { instanceId: 'instance-1', action: 'testAction' },
        ])
        .then((_result) => {
          result = _result;
        });

      await clock.tickAsync(50);

      expect(result).not.toBeNull();
      expect(result!.failureCount).toBe(1);
      expect(result!.allSucceeded).toBe(false);
      expect(result!.actions[0].result.success).toBe(false);
      expect(
        isErr(result!.actions[0].result) &&
          result!.actions[0].result.error.message,
      ).toContain('timed out after 50ms');
    });

    it('should not timeout sync handlers', async () => {
      const timeoutManager = new ActionManager({
        readinessTimeoutMs: 100,
        executionTimeoutMs: 50,
      });

      timeoutManager.registerRunner<MockVessel>('instance-1', {
        testAction: () => Success(undefined),
      });

      let result: BatchExecutionResult | null = null;
      timeoutManager
        .executeActions<MockVessel>([
          { instanceId: 'instance-1', action: 'testAction' },
        ])
        .then((_result) => {
          result = _result;
        });

      await clock.tickAsync(0);

      expect(result).not.toBeNull();
      expect(result!.successCount).toBe(1);
      expect(result!.allSucceeded).toBe(true);
    });

    it('should not timeout actions that complete within the limit', async () => {
      const timeoutManager = new ActionManager({
        readinessTimeoutMs: 100,
        executionTimeoutMs: 200,
      });

      timeoutManager.registerRunner<MockVessel>('instance-1', {
        testAction: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return Success(undefined);
        },
      });

      let result: BatchExecutionResult | null = null;
      timeoutManager
        .executeActions<MockVessel>([
          { instanceId: 'instance-1', action: 'testAction' },
        ])
        .then((_result) => {
          result = _result;
        });

      await clock.tickAsync(10);

      expect(result).not.toBeNull();
      expect(result!.successCount).toBe(1);
      expect(result!.allSucceeded).toBe(true);
    });
  });

  describe('stress tests', () => {
    it('should handle many actions on single instance', async () => {
      let actionCount = 0;
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          actionCount++;
          return Success(undefined);
        },
      };
      manager.registerRunner<MockVessel>('instance-1', runner);

      const executionPlan: ActionExecution<MockVessel>[] = Array.from(
        { length: 100 },
        (_, _i) => ({
          instanceId: 'instance-1',
          action: 'testAction',
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
        const instanceId = `instance-${i}`;
        manager.registerRunner<MockVessel>(instanceId, {
          testAction: async () => {
            executedInstances.push(instanceId);
            return Success(undefined);
          },
        });
      }

      const executionPlan: ActionExecution<MockVessel>[] = Array.from(
        { length: 50 },
        (_, i) => ({
          instanceId: `instance-${i}`,
          action: 'testAction',
        }),
      );
      const result = await manager.executeActions(executionPlan);

      expect(result.successCount).toBe(50);
      expect(executedInstances).toHaveLength(50);
    });

    it('should handle mixed success and failures', async () => {
      for (let i = 0; i < 20; i++) {
        const instanceId = `instance-${i}`;
        if (i % 2 === 0) {
          manager.registerRunner<MockVessel>(instanceId, {
            testAction: async () => Success(undefined),
          });
        } else {
          manager.registerRunner<MockVessel>(instanceId, {
            testAction: async () => Err(new Error(`Failure ${i}`)),
          });
        }
      }

      const executionPlan: ActionExecution<MockVessel>[] = Array.from(
        { length: 20 },
        (_, i) => ({
          instanceId: `instance-${i}`,
          action: 'testAction',
        }),
      );
      const result = await manager.executeActions(executionPlan);

      expect(result.successCount).toBe(10);
      expect(result.failureCount).toBe(10);
      expect(result.allSucceeded).toBe(false);
    });
  });
});
