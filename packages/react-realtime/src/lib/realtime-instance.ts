import type {
  ConversationLostEvent,
  InputAcceptedEvent,
  Orchestrator,
} from '@maelstrom-co/client';
import type {
  AgentErrorEvent,
  AgentFinishedEvent,
  MessageId,
  RunId,
} from '@maelstrom-co/protocol';
import type {
  AgentMessageOutcome,
  RealtimeInstance,
} from '@maelstrom-co/realtime';

/** Options for {@link createRealtimeInstance}. */
export interface RealtimeInstanceOptions {
  /**
   * Sends one voice intent to the agent and resolves with the input's
   * `MessageId`. When set, the instance answers voice intents from the
   * outcome of the Agent Run that handles the input instead of the intent
   * scheduler. A rejection is reported as unconfirmed unless it is an
   * `AgentWireUnsupportedError`, and the option is not called while the
   * engine connection is down.
   */
  readonly sendAgentMessage?: (
    orchestrator: Orchestrator,
    text: string,
  ) => Promise<MessageId>;
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
          sendAgentMessage: (text: string) =>
            sendThroughAgentRun(orchestrator, text, sendAgentMessage),
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

const IGNORED_INPUT_ERROR = 'The agent ignored the request.';

type SendAgentMessage = NonNullable<
  RealtimeInstanceOptions['sendAgentMessage']
>;

type TrackedAgentEvent =
  | InputAcceptedEvent
  | AgentFinishedEvent
  | AgentErrorEvent
  | ConversationLostEvent;

function sendThroughAgentRun(
  orchestrator: Orchestrator,
  text: string,
  send: SendAgentMessage,
): Promise<AgentMessageOutcome> {
  const connection = orchestrator.connectionManager.store;
  if (connection.state.connectionStatus !== 'connected') {
    return Promise.resolve({
      status: 'not_submitted',
      error: 'the engine is not connected',
    });
  }
  return new Promise((resolve) => {
    const unsubscribes: Array<() => void> = [];
    const buffered: TrackedAgentEvent[] = [];
    let inputId: MessageId | undefined;
    let runId: RunId | undefined;
    let settled = false;

    const settle = (outcome: AgentMessageOutcome) => {
      if (settled) return;
      settled = true;
      for (const unsubscribe of unsubscribes.splice(0)) unsubscribe();
      resolve(outcome);
    };

    const handle = (event: TrackedAgentEvent) => {
      if (settled) return;
      if (inputId === undefined) {
        buffered.push(event);
        return;
      }
      if (
        event.type === 'accepted' &&
        event.inputId === inputId &&
        event.runId !== null &&
        runId === undefined
      ) {
        runId = event.runId;
        return;
      }
      const outcome = settlementFor(event, inputId, runId);
      if (outcome) settle(outcome);
    };

    try {
      const events = orchestrator.agent;
      unsubscribes.push(events.on('accepted', handle));
      unsubscribes.push(events.on('finished', handle));
      unsubscribes.push(events.on('error', handle));
      unsubscribes.push(events.on('conversation_lost', handle));
      // Orchestrator.dispose closes the connection without reporting a
      // conversation loss, so the connection status must also end this wait.
      const subscription = connection.subscribe(() => {
        if (connection.state.connectionStatus === 'disconnected')
          settle({ status: 'lost', reason: 'disconnected' });
      });
      unsubscribes.push(() => subscription.unsubscribe());
    } catch (error) {
      settle({ status: 'not_submitted', error: errorMessage(error) });
      return;
    }

    const sendFailed = (error: unknown) =>
      settle(
        isAgentWireUnsupported(error)
          ? { status: 'not_submitted', error: error.message }
          : { status: 'lost', reason: 'send_failed' },
      );
    try {
      send(orchestrator, text).then((resolvedInputId) => {
        inputId = resolvedInputId;
        for (const event of buffered.splice(0)) handle(event);
      }, sendFailed);
    } catch (error) {
      sendFailed(error);
    }
  });
}

function settlementFor(
  event: TrackedAgentEvent,
  inputId: MessageId,
  runId: RunId | undefined,
): AgentMessageOutcome | undefined {
  switch (event.type) {
    case 'accepted':
      return event.inputId === inputId &&
        event.runId === null &&
        runId === undefined
        ? { status: 'finished', ok: false, error: IGNORED_INPUT_ERROR }
        : undefined;
    case 'finished':
      if (runId === undefined || event.runId !== runId) return undefined;
      return finishedOutcome(event);
    case 'error':
      if (event.inputId !== inputId || event.runId !== undefined)
        return undefined;
      return { status: 'finished', ok: false, error: event.error };
    case 'conversation_lost':
      return { status: 'lost', reason: event.reason };
    default:
      return assertNever(event, 'agent event');
  }
}

function finishedOutcome(event: AgentFinishedEvent): AgentMessageOutcome {
  if (event.ok) {
    return event.reply === undefined
      ? { status: 'finished', ok: true }
      : { status: 'finished', ok: true, reply: event.reply };
  }
  return {
    status: 'finished',
    ok: false,
    error: event.error ?? event.reply ?? event.reason,
  };
}

function isAgentWireUnsupported(error: unknown): error is Error {
  return error instanceof Error && error.name === 'AgentWireUnsupportedError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
