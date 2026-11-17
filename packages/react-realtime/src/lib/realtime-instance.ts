import type {
  AgentMessageSubmission,
  Orchestrator,
  SettledAgentRun,
} from '@maelstrom-co/client';
import type { RealtimeInstance } from '@maelstrom-co/realtime';

/** Options for {@link createRealtimeInstance}. */
export interface RealtimeInstanceOptions {
  /**
   * Sends one voice intent to the agent, normally by calling
   * `orchestrator.sendMessage(text, { source: 'voice' })` through the app's
   * own submit path, and returns that submission. When set, the instance
   * answers voice intents from the submission's `result` instead of the
   * intent scheduler. A throw is reported as an unconfirmed outcome.
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
  const { sendAgentMessage } = options;
  return {
    ...(sendAgentMessage
      ? {
          sendAgentMessage: (text: string): Promise<SettledAgentRun> => {
            try {
              return sendAgentMessage(orchestrator, text).result;
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
    createIntentScope: () => orchestrator.createIntentScope(),
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
