import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AnyActionRunner as GenericActionRunner } from '@maelstrom-co/client';
import { Err, type Result, Success } from '@maelstrom-co/protocol';
import { cleanup, render } from '@testing-library/react';
import { Window } from 'happy-dom';
import React from 'react';

// Setup happy-dom
const happyWindow = new Window();
// @ts-expect-error - happy-dom types don't perfectly match DOM types
globalThis.document = happyWindow.document;
// @ts-expect-error - happy-dom types don't perfectly match DOM types
globalThis.window = happyWindow;

// Clean up after each test
afterEach(() => {
  cleanup();
});

/**
 * Tests for useVesselActions behavior using React Testing Library.
 *
 * We create a minimal mock of the orchestrator and context to test
 * the hook's behavior of registering action runners.
 */

interface MockOrchestrator {
  registerRunner: (instanceId: string, runner: GenericActionRunner) => void;
  unregisterRunner: (instanceId: string) => void;
  send: (event: { type: string }) => void;
  // For testing
  _runners: Map<string, GenericActionRunner>;
  _sendCalls: Array<{ type: string }>;
  simulateAction: (
    instanceId: string,
    action: string,
    params?: Record<string, unknown>,
  ) => Promise<void>;
}

function createMockOrchestrator(): MockOrchestrator {
  const runners = new Map<string, GenericActionRunner>();
  const sendCalls: Array<{ type: string }> = [];

  return {
    _runners: runners,
    _sendCalls: sendCalls,

    registerRunner(instanceId: string, runner: GenericActionRunner) {
      runners.set(instanceId, runner);
    },

    unregisterRunner(instanceId: string) {
      runners.delete(instanceId);
    },

    send(event: { type: string }) {
      sendCalls.push(event);
    },

    async simulateAction(
      instanceId: string,
      action: string,
      params?: Record<string, unknown>,
    ) {
      const runner = runners.get(instanceId);
      if (!runner) {
        throw new Error(`No runner registered for instance "${instanceId}"`);
      }

      const actionHandler = runner[action];
      if (!actionHandler) {
        throw new Error(`No handler for action "${action}"`);
      }

      const result = await actionHandler(params);
      if (result && typeof result === 'object' && 'success' in result) {
        const typedResult = result as Result<unknown, Error>;
        if (!typedResult.success) {
          throw typedResult.error;
        }
      }
    },
  };
}

/**
 * A hook that mirrors the expected behavior of useVesselActions:
 * - Registers action runner on mount
 * - Unregisters on unmount
 * - Uses a stable wrapper that calls through a ref to always get latest implementation
 * - Does NOT re-register runner on re-renders to avoid performance issues with audio chunks, etc.
 * - DOES re-register on remount (instanceId change) to handle variant changes
 */
function useTestVesselActions(
  orchestrator: MockOrchestrator,
  instanceId: string,
  runner: GenericActionRunner,
): void {
  // Store runner in a ref to always access latest without triggering re-registration
  const runnerRef = React.useRef(runner);
  runnerRef.current = runner;

  React.useEffect(() => {
    // Proxy delegates every call to the latest ref — mirrors production useVesselActions
    const stableRunner = new Proxy(runnerRef.current, {
      get(_, prop: string) {
        return (runnerRef.current as Record<string, unknown>)[prop];
      },
    });

    orchestrator.registerRunner(instanceId, stableRunner);

    return () => {
      orchestrator.unregisterRunner(instanceId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orchestrator, instanceId]); // Intentionally NOT including runner - only re-register when instanceId changes
}

// Test component that uses the hook
function TestComponent({
  orchestrator,
  instanceId,
  runner,
}: {
  orchestrator: MockOrchestrator;
  instanceId: string;
  runner: GenericActionRunner;
}) {
  useTestVesselActions(orchestrator, instanceId, runner);
  return <div data-testid="test-component">Test</div>;
}

describe('useVesselActions hook', () => {
  let orchestrator: MockOrchestrator;

  beforeEach(() => {
    orchestrator = createMockOrchestrator();
  });

  describe('runner registration', () => {
    it('should register runner on mount', () => {
      const runner: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };

      render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      // Runner should be registered
      const registeredRunner = orchestrator._runners.get('instance-1');
      expect(registeredRunner).toBeDefined();
    });

    it('should unregister runner on unmount', () => {
      const runner: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };

      const { unmount } = render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      // Verify registered
      expect(orchestrator._runners.has('instance-1')).toBe(true);

      // Unmount
      unmount();

      // Verify unregistered
      expect(orchestrator._runners.has('instance-1')).toBe(false);
    });

    it('should re-register on remount after unmount', () => {
      const runner: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };

      const { unmount } = render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      // Verify registered
      expect(orchestrator._runners.has('instance-1')).toBe(true);

      // Unmount
      unmount();

      // Verify unregistered
      expect(orchestrator._runners.has('instance-1')).toBe(false);

      // Remount with a fresh render (simulating variant change creating new instance)
      render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      // Should be re-registered
      expect(orchestrator._runners.has('instance-1')).toBe(true);
    });

    it('should maintain stable wrapper on re-render (same instance)', () => {
      const runner1: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };
      const runner2: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };

      const { rerender } = render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner1}
        />,
      );

      // Initial registration
      expect(orchestrator._runners.has('instance-1')).toBe(true);

      // Rerender with different runner implementation
      // The stable wrapper should still be registered, not re-registered
      rerender(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner2}
        />,
      );

      // The runner should still be there - stable registration
      expect(orchestrator._runners.has('instance-1')).toBe(true);
    });

    it('should preserve registration on re-render with same instance', () => {
      const runner1: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };
      const runner2: GenericActionRunner = {
        action1: mock(async (_params: unknown) => Success<undefined>()),
      };

      const { rerender } = render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner1}
        />,
      );

      // Initial registration
      expect(orchestrator._runners.has('instance-1')).toBe(true);

      // Rerender with different runner function
      rerender(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner2}
        />,
      );

      // Registration should still exist (stable wrapper)
      expect(orchestrator._runners.has('instance-1')).toBe(true);
    });
  });

  describe('runner execution', () => {
    it('should execute registered runner', async () => {
      const runnerAction1 = mock(async (_params: unknown) =>
        Success<undefined>(),
      );
      const runner: GenericActionRunner = {
        action1: runnerAction1,
      };

      render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      // Simulate action execution
      await orchestrator.simulateAction('instance-1', 'action1', {
        foo: 'bar',
      });

      expect(runnerAction1).toHaveBeenCalledTimes(1);
      expect(runnerAction1).toHaveBeenCalledWith({ foo: 'bar' });
    });

    it('should call latest runner implementation after re-render (stable wrapper)', async () => {
      const originalRunner = mock(async (_params: unknown) =>
        Success<undefined>(),
      );
      const newRunner = mock(async (_params: unknown) => Success<undefined>());

      const runner1: GenericActionRunner = {
        action1: originalRunner,
      };
      const runner2: GenericActionRunner = {
        action1: newRunner,
      };

      const { rerender } = render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner1}
        />,
      );

      // Rerender with different implementation
      rerender(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner2}
        />,
      );

      // Execute action - should call the NEW runner, not original
      await orchestrator.simulateAction('instance-1', 'action1');

      expect(originalRunner).not.toHaveBeenCalled();
      expect(newRunner).toHaveBeenCalledTimes(1);
    });

    it('should handle runner with no params', async () => {
      const runnerAction1 = mock(async (_params: unknown) =>
        Success<undefined>(),
      );
      const runner: GenericActionRunner = {
        action1: runnerAction1,
      };

      render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      await orchestrator.simulateAction('instance-1', 'action1');

      expect(runnerAction1).toHaveBeenCalledTimes(1);
      expect(runnerAction1).toHaveBeenCalledWith(undefined);
    });

    it('should throw error for unregistered instance', async () => {
      // Don't render any component

      let error: Error | null = null;
      try {
        await orchestrator.simulateAction('instance-1', 'action1');
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toContain('No runner registered');
    });
  });

  describe('multiple instances', () => {
    it('should handle runners for different instances independently', async () => {
      const runner1Action = mock(async (_params: unknown) =>
        Success<undefined>(),
      );
      const runner2Action = mock(async (_params: unknown) =>
        Success<undefined>(),
      );

      const runner1: GenericActionRunner = {
        action1: runner1Action,
      };
      const runner2: GenericActionRunner = {
        action1: runner2Action,
      };

      render(
        <>
          <TestComponent
            orchestrator={orchestrator}
            instanceId="instance-1"
            runner={runner1}
          />
          <TestComponent
            orchestrator={orchestrator}
            instanceId="instance-2"
            runner={runner2}
          />
        </>,
      );

      // Execute actions on both instances
      await orchestrator.simulateAction('instance-1', 'action1', { id: 1 });
      await orchestrator.simulateAction('instance-2', 'action1', { id: 2 });

      expect(runner1Action).toHaveBeenCalledTimes(1);
      expect(runner1Action).toHaveBeenCalledWith({ id: 1 });
      expect(runner2Action).toHaveBeenCalledTimes(1);
      expect(runner2Action).toHaveBeenCalledWith({ id: 2 });
    });

    it('should allow same action name on different instances', async () => {
      const runner1Action = mock(async (_params: unknown) =>
        Success<undefined>(),
      );
      const runner2Action = mock(async (_params: unknown) =>
        Success<undefined>(),
      );

      const runner1: GenericActionRunner = {
        showTrends: runner1Action,
      };
      const runner2: GenericActionRunner = {
        showTrends: runner2Action,
      };

      render(
        <>
          <TestComponent
            orchestrator={orchestrator}
            instanceId="instance-1"
            runner={runner1}
          />
          <TestComponent
            orchestrator={orchestrator}
            instanceId="instance-2"
            runner={runner2}
          />
        </>,
      );

      await orchestrator.simulateAction('instance-1', 'showTrends');
      await orchestrator.simulateAction('instance-2', 'showTrends');

      expect(runner1Action).toHaveBeenCalledTimes(1);
      expect(runner1Action).toHaveBeenCalledWith(undefined);
      expect(runner2Action).toHaveBeenCalledTimes(1);
      expect(runner2Action).toHaveBeenCalledWith(undefined);
    });
  });

  describe('async runner behavior', () => {
    it('should handle async runners', async () => {
      let resolved = false;
      const runner: GenericActionRunner = {
        asyncAction: mock(async (_params: unknown) => {
          resolved = true;
          return Success<undefined>();
        }),
      };

      render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      expect(resolved).toBe(false);
      await orchestrator.simulateAction('instance-1', 'asyncAction');
      expect(resolved).toBe(true);
    });

    it('should propagate runner errors', async () => {
      const runner: GenericActionRunner = {
        failingAction: mock(async (_params: unknown) =>
          Err(Error('Runner failed')),
        ),
      };

      render(
        <TestComponent
          orchestrator={orchestrator}
          instanceId="instance-1"
          runner={runner}
        />,
      );

      let error: Error | null = null;
      try {
        await orchestrator.simulateAction('instance-1', 'failingAction');
      } catch (e) {
        error = e as Error;
      }

      expect(error).not.toBeNull();
      expect(error?.message).toBe('Runner failed');
    });
  });
});
