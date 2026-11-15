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

export interface RealtimeInstanceOptions {
  readonly sendAgentMessage?: (
    orchestrator: Orchestrator,
    text: string,
  ) => Promise<MessageId>;
}

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

type TrackedAgentEvent =
  | InputAcceptedEvent
  | AgentFinishedEvent
  | AgentErrorEvent
  | ConversationLostEvent;

function sendThroughAgentRun(
  orchestrator: Orchestrator,
  text: string,
  send: (orchestrator: Orchestrator, text: string) => Promise<MessageId>,
): Promise<AgentMessageOutcome> {
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
      send(orchestrator, text).then(
        (resolvedInputId) => {
          inputId = resolvedInputId;
          for (const event of buffered.splice(0)) handle(event);
        },
        (error: unknown) =>
          settle({ status: 'not_submitted', error: errorMessage(error) }),
      );
    } catch (error) {
      settle({ status: 'not_submitted', error: errorMessage(error) });
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
        ? { status: 'finished', ok: true }
        : undefined;
    case 'finished':
      if (runId === undefined || event.runId !== runId) return undefined;
      return finishedOutcome(event);
    case 'error':
      if (event.inputId !== inputId || event.runId !== undefined)
        return undefined;
      return { status: 'finished', ok: false, error: event.error };
    case 'conversation_lost':
      return lostOutcome(event, inputId, runId);
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
    ...(event.reply === undefined ? {} : { reply: event.reply }),
    error: event.error ?? event.reason,
  };
}

function lostOutcome(
  event: ConversationLostEvent,
  inputId: MessageId,
  runId: RunId | undefined,
): AgentMessageOutcome | undefined {
  switch (event.reason) {
    case 'disconnected':
    case 'connector_replaced':
      return { status: 'lost', reason: event.reason };
    case 'stale_run': {
      const ownRun = runId !== undefined && event.runId === runId;
      const ownInput = event.inputId === inputId;
      return ownRun || ownInput
        ? { status: 'lost', reason: 'stale_run' }
        : undefined;
    }
    default:
      return assertNever(event, 'conversation lost reason');
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: ${JSON.stringify(value)}`);
}
