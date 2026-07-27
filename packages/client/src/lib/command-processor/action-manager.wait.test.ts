import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  type ActionExecution,
  ActionName,
  defineVessel,
  InstanceId,
  ok,
} from '@maelstrom-co/protocol';
import FakeTimers from '@sinonjs/fake-timers';

import { ActionManager } from './action-manager.js';
import type {
  ActionRunner,
  BatchExecutionResult,
} from './action-runner.types.js';

const i1 = InstanceId('instance-1');
const i2 = InstanceId('instance-2');

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

describe('ActionManager waitForReady', () => {
  let manager: ActionManager;
  let clock: ReturnType<typeof FakeTimers.install>;

  beforeEach(() => {
    clock = FakeTimers.install({ shouldAdvanceTime: true });
    manager = new ActionManager();
  });

  afterEach(() => {
    clock.uninstall();
  });

  describe('waitForReady', () => {
    it('should return true immediately if runner already registered', async () => {
      let promiseResolved = false;
      let result = false;
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };
      manager.registerRunner<MockVessel>(i1, runner);

      manager.waitForReady(i1).then((_result) => {
        promiseResolved = true;
        result = _result;
        return _result;
      });

      // Allow microtasks to run
      await clock.tickAsync(0);

      expect(promiseResolved).toBe(true);
      expect(result).toBe(true);
    });

    it('should wait for runner to be registered', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      let result = false;
      let promiseResolved = false;
      manager.waitForReady(i1, 1000).then((_result) => {
        promiseResolved = true;
        result = _result;
        return _result;
      });

      // Runner registered after 50ms
      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i1, runner);
      }, 50);

      // Advance time but not enough for runner to be registered
      await clock.tickAsync(25);
      // Promise should not be resolved yet
      expect(promiseResolved).toBe(false);
      expect(result).toBe(false);

      // Advance time past when runner is registered
      await clock.tickAsync(25);

      expect(promiseResolved).toBe(true);
      expect(result).toBe(true);
    });

    it('should timeout if runner never registered', async () => {
      let promiseResolved = false;
      let result: boolean = false;

      manager.waitForReady(i1, 100).then((_result) => {
        promiseResolved = true;
        result = _result;
        return _result;
      });

      await clock.tickAsync(100);

      expect(promiseResolved).toBe(true);
      expect(result).toBe(false);
    });

    it('should handle multiple waiters for same instance', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };
      let result1 = false;
      let result2 = false;
      let result3 = false;

      let resolvedCount = 0;
      manager.waitForReady(i1, 1000).then((result) => {
        resolvedCount++;
        result1 = result;
        return result;
      });
      manager.waitForReady(i1, 1000).then((result) => {
        resolvedCount++;
        result2 = result;
        return result;
      });
      manager.waitForReady(i1, 1000).then((result) => {
        resolvedCount++;
        result3 = result;
        return result;
      });

      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i1, runner);
      }, 50);

      // Before runner is registered, no promises should be resolved
      await clock.tickAsync(25);
      expect(resolvedCount).toBe(0);

      // After runner is registered, all promises should resolve
      await clock.tickAsync(25);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(result3).toBe(true);
      expect(resolvedCount).toBe(3);
    });

    it('should clean up waiters after resolution', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      let promiseResolvedCount = 0;
      let result1 = false;
      manager.waitForReady(i1, 1000).then((result) => {
        promiseResolvedCount++;
        result1 = result;
        return result;
      });

      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i1, runner);
      }, 50);

      // Before runner is registered, promise should not be resolved
      await clock.tickAsync(25);
      expect(promiseResolvedCount).toBe(0);

      // After runner is registered, promise should be resolved
      await clock.tickAsync(25);
      expect(promiseResolvedCount).toBe(1);
      expect(result1).toBe(true);

      // After resolution, a new waiter should immediately find the runner
      manager.waitForReady(i1, 0).then((result) => {
        promiseResolvedCount++;
        return result;
      });

      await clock.tickAsync(0);
      expect(promiseResolvedCount).toBe(2);
    });

    it('should handle different timeout values for different waiters', async () => {
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => ok(undefined),
      };

      let shortResolved = false;
      let shortResult = false;
      let longResolved = false;
      let longResult = false;

      // Short timeout waiter
      manager.waitForReady(i1, 50).then((result) => {
        shortResult = result;
        shortResolved = true;
        return result;
      });
      // Long timeout waiter
      manager.waitForReady(i1, 200).then((result) => {
        longResult = result;
        longResolved = true;
        return result;
      });

      // Register runner after 100ms - short waiter should timeout, long should succeed
      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i1, runner);
      }, 100);

      // At 50ms, short waiter should timeout
      await clock.tickAsync(50);
      expect(shortResolved).toBe(true);
      expect(shortResult).toBe(false);
      expect(longResolved).toBe(false);
      expect(longResult).toBe(false);

      // At 100ms, long waiter should resolve
      await clock.tickAsync(50);
      expect(longResolved).toBe(true);
      expect(longResult).toBe(true);
    });
  });

  describe('executeActions with waitForReady', () => {
    it('should wait for runners before executing actions', async () => {
      let runnerCallCount = 0;
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          runnerCallCount++;
          return ok(undefined);
        },
      };

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i1, action: ActionName('testAction') },
      ];
      let result: BatchExecutionResult | null = null;
      let executionCompleted = false;
      manager.executeActions(executionPlan).then((_result) => {
        executionCompleted = true;
        result = _result;
        return _result;
      });

      // Actions should not be executed yet
      expect(runnerCallCount).toBe(0);
      expect(executionCompleted).toBe(false);

      // Register runner after 50ms
      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i1, runner);
      }, 50);

      // Before runner is registered, execution should not complete
      await clock.tickAsync(25);
      expect(runnerCallCount).toBe(0);
      expect(executionCompleted).toBe(false);

      // After runner is registered, execution should complete
      await clock.tickAsync(25);
      expect(executionCompleted).toBe(true);

      // Both actions should have been executed successfully
      expect(runnerCallCount).toBe(2);
      expect((result as unknown as BatchExecutionResult)?.successCount).toBe(2);
      expect((result as unknown as BatchExecutionResult).allSucceeded).toBe(
        true,
      );
      expect(
        (result as unknown as BatchExecutionResult).actions[0].result.ok,
      ).toBe(true);
      expect(
        (result as unknown as BatchExecutionResult).actions[1].result.ok,
      ).toBe(true);
    });

    it('should skip actions if runner times out', async () => {
      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
      ];
      let result: BatchExecutionResult | null = null;
      manager.executeActions(executionPlan).then((_result) => {
        result = _result;
      });

      // Wait for timeout (default is 500ms)
      await clock.tickAsync(500);

      expect((result as unknown as BatchExecutionResult).allSucceeded).toBe(
        true,
      );
      expect((result as unknown as BatchExecutionResult).successCount).toBe(0);
      expect((result as unknown as BatchExecutionResult).skippedCount).toBe(1);
      expect(
        (result as unknown as BatchExecutionResult).actions[0].skipped,
      ).toBe(true);
      expect(
        (result as unknown as BatchExecutionResult).actions[0].result.ok,
      ).toBe(true); // Skipped actions return success
    });

    it('should execute immediately when runner is already registered', async () => {
      let runnerCallCount = 0;
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          runnerCallCount++;
          return ok(undefined);
        },
      };

      manager.registerRunner<MockVessel>(i1, runner);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
      ];
      let executionCompleted = false;
      let result: BatchExecutionResult | null = null;
      manager.executeActions(executionPlan).then((_result) => {
        executionCompleted = true;
        result = _result;
        return _result;
      });

      // Should complete immediately since runner is already registered
      await clock.tickAsync(0);

      expect(executionCompleted).toBe(true);
      expect(runnerCallCount).toBe(1);
      expect((result as unknown as BatchExecutionResult).successCount).toBe(1);
      expect((result as unknown as BatchExecutionResult).allSucceeded).toBe(
        true,
      );
      expect(
        (result as unknown as BatchExecutionResult).actions[0].result.ok,
      ).toBe(true);
    });

    it('should handle mixed registered and unregistered instances', async () => {
      let registeredRunnerCalls = 0;
      const registeredRunner: ActionRunner<MockVessel> = {
        testAction: async () => {
          registeredRunnerCalls++;
          return ok(undefined);
        },
      };

      // Register runner for instance-1 only
      manager.registerRunner<MockVessel>(i1, registeredRunner);

      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i2, action: ActionName('testAction') }, // No runner
      ];
      let executionCompleted = false;
      let result: BatchExecutionResult | null = null;
      manager.executeActions(executionPlan).then((_result) => {
        executionCompleted = true;
        result = _result;
        return _result;
      });

      // Wait for timeout (default is 500ms)
      await clock.tickAsync(500);

      expect(executionCompleted).toBe(true);
      // First action executed, second skipped
      expect(registeredRunnerCalls).toBe(1);
      expect((result as unknown as BatchExecutionResult).successCount).toBe(1);
      expect((result as unknown as BatchExecutionResult).skippedCount).toBe(1);
      expect((result as unknown as BatchExecutionResult).allSucceeded).toBe(
        true,
      );
    });

    it('should handle runner registration during action execution', async () => {
      let runnerCallCount = 0;
      const runner: ActionRunner<MockVessel> = {
        testAction: async () => {
          runnerCallCount++;
          return ok(undefined);
        },
      };

      // Start executing actions for two instances
      const executionPlan: ActionExecution[] = [
        { instanceId: i1, action: ActionName('testAction') },
        { instanceId: i2, action: ActionName('testAction') },
      ];
      let executionCompleted = false;
      let result: BatchExecutionResult | null = null;
      manager.executeActions(executionPlan).then((_result) => {
        executionCompleted = true;
        result = _result;
        return _result;
      });

      // Register runners at different times
      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i1, runner);
      }, 50);

      clock.setTimeout(() => {
        manager.registerRunner<MockVessel>(i2, runner);
      }, 100);

      // At 50ms, first instance should execute but not second
      await clock.tickAsync(50);
      expect(runnerCallCount).toBe(1);
      expect(executionCompleted).toBe(false);

      // At 100ms, both should have executed
      await clock.tickAsync(50);
      expect(executionCompleted).toBe(true);

      // Both should execute after their respective runners are registered
      expect(runnerCallCount).toBe(2);
      expect((result as unknown as BatchExecutionResult).successCount).toBe(2);
      expect((result as unknown as BatchExecutionResult).allSucceeded).toBe(
        true,
      );
    });
  });
});
