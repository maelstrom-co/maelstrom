import type {
  AgentMessageSubmission,
  IntentScope,
  Orchestrator,
  SettledAgentRun,
} from '@maelstrom-co/client';
import type { RealtimeInstance } from '@maelstrom-co/realtime';

/** Options for {@link createRealtimeInstance}. */
export interface RealtimeInstanceOptions {
  /**
   * Creates a fresh connection-owned scope backed by this Orchestrator's intent
   * scheduler. Called lazily on connect, including reconnects. Defaults to a
   * scope whose intents enter `orchestrator.submit(text, { source: 'voice' })`.
   * Wrappers must preserve the original submission tickets and results, and
   * forward retirement only to their own scope so pending work retires without
   * interrupting active work. Unused when voice takes the agent route
   * (`sendAgentMessage` is set or `intentRoute` is `'agent'`).
   */
  readonly createIntentScope?: (orchestrator: Orchestrator) => IntentScope;
  /**
   * Overrides the default voice route to send each voice intent through a
   * custom agent submission function. When omitted, voice follows the
   * Orchestrator's configured `intentRoute` via `orchestrator.submit(text, {
   * source: 'voice' })` — using the agent route when `intentRoute` is
   * `'agent'`, and the shared FIFO intent queue when `intentRoute` is
   * `'single-request'`. A throw is reported as an unconfirmed outcome.
   *
   * @experimental The agent loop is experimental in 0.3 and may change in any minor release.
   */
  readonly sendAgentMessage?: (
    orchestrator: Orchestrator,
    text: string,
  ) => AgentMessageSubmission;
}

/**
 * Wraps an `Orchestrator` as the {@link RealtimeInstance} bridge that
 * `RealtimeSession` drives.
 */
export function createRealtimeInstance(
  orchestrator: Orchestrator,
  options: RealtimeInstanceOptions = {},
): RealtimeInstance {
  const { createIntentScope, sendAgentMessage } = options;
  const usesAgentRoute =
    sendAgentMessage !== undefined ||
    orchestrator.getConfig().intentRoute === 'agent';
  return {
    ...(usesAgentRoute
      ? {
          sendAgentMessage: (text: string): Promise<SettledAgentRun> => {
            try {
              if (sendAgentMessage) {
                return sendAgentMessage(orchestrator, text).result;
              }
              const submitted = orchestrator.submit(text, { source: 'voice' });
              if (submitted.route !== 'agent') {
                return Promise.reject(
                  new Error(
                    'Orchestrator is not configured for the agent route',
                  ),
                );
              }
              return submitted.result;
            } catch (error) {
              return Promise.reject(error);
            }
          },
        }
      : {}),
    applicationWork: {
      getSnapshot: () => ({
        planning: orchestrator.requestCoordinator.isProcessing
          ? 'active'
          : 'inactive',
        applying:
          orchestrator.commandProcessor.store.state.status === 'error'
            ? 'unknown'
            : orchestrator.commandProcessor.store.state.status ===
                  'processing' || orchestrator.commandProcessor.queueLength > 0
              ? 'active'
              : 'inactive',
      }),
      subscribe: (handler) => {
        const request =
          orchestrator.requestCoordinator.store.subscribe(handler);
        const commands = orchestrator.commandProcessor.store.subscribe(handler);
        return () => {
          request.unsubscribe();
          commands.unsubscribe();
        };
      },
    },
    createIntentScope: () => {
      if (createIntentScope) return createIntentScope(orchestrator);
      const scope = orchestrator.createIntentScope();
      return {
        enqueueIntent: (intent: string) => {
          if (orchestrator.getConfig().intentRoute === 'agent') {
            throw agentRoutedEnqueueError();
          }
          const submitted = orchestrator.submit(intent, {
            source: 'voice',
            scope,
          });
          if (submitted.route !== 'single-request') {
            throw agentRoutedEnqueueError();
          }
          return submitted.submission;
        },
        retire: () => scope.retire(),
      };
    },
    submitIntent: (intent) =>
      orchestrator
        .processIntent(intent)
        .then((response) => ({ userMessage: response.userMessage })),
    waitForIdle: async () => {
      await orchestrator.commandProcessor.waitForIdle();
    },
    waitForIdleResult: () => orchestrator.commandProcessor.waitForIdle(),
    getStructuralSnapshot: () => orchestrator.getStructuralSnapshot(),
    getCapabilitySnapshot: () => orchestrator.getCapabilitySnapshot(),
    onSettled: (callback) => orchestrator.onSettled(callback),
    addAssistantMessageAcknowledged: (args) =>
      orchestrator.addAssistantMessageAcknowledged(args),
    observeEngineConnection: (cb) => {
      const unsubscribe = orchestrator.connectionManager.events.on(
        'connection_status_changed',
        (event) => cb(event.status === 'connected'),
      );
      cb(
        orchestrator.connectionManager.store.state.connectionStatus ===
          'connected',
      );
      return unsubscribe;
    },
  };
}

function agentRoutedEnqueueError(): Error {
  return new Error(
    'Cannot enqueue single-request intent on an agent-routed orchestrator',
  );
}
