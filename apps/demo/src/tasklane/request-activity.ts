import type {
  MaelstromExtension,
  MaelstromExtensionContext,
} from '@maelstrom-co/react';
import { useEffect } from 'react';
import { rememberRequestReferences } from './stores/project-tasks.store';
import {
  closeRequestWindow,
  failRequestWindow,
  openRequestWindow,
  settleRequestActions,
} from './tasklane-activity';

export interface TasklaneRequestActivity {
  /** Groups Action outcomes by the user request that caused them, for the receipt line. */
  useRequestActivity: () => void;
}

/**
 * The receipt line needs to know which entries belong to which user request
 * and which of its planned Actions were skipped, which only the orchestrator's
 * request events, command results and admission state carry. An extension
 * closure is the supported seam for reading them.
 *
 * A window opens when a request with a user intent starts, learns which
 * planned Actions were skipped when the request's Action batch completes, and
 * closes when admission goes idle, after the response's Actions have settled.
 */
export const tasklaneRequestActivity: MaelstromExtension<
  TasklaneRequestActivity
> = (ctx: MaelstromExtensionContext) => ({
  useRequestActivity: () => {
    const { orchestrator } = ctx.useMaelstromContext();
    useEffect(() => {
      const requests = orchestrator.requestCoordinator.events;
      const stopStarted = requests.on(
        'processing_started',
        ({ requestId, message }) => {
          const fromUser = message.request.context.updateReasons.some(
            (reason) => reason.type === 'user_intent',
          );
          if (!fromUser) return;
          openRequestWindow(String(requestId));
        },
      );
      // Labels are remembered when the response arrives, before its Actions
      // run, so a hand edit made while the Planner worked still makes the
      // label it saw stale.
      const stopCompleted = requests.on('processing_completed', () =>
        rememberRequestReferences(),
      );
      const stopActions = orchestrator.commandProcessor.events.on(
        'actions_completed',
        ({ command, result }) => {
          if (command.kind !== 'execute_actions') return;
          if (command.requestId === undefined) return;
          settleRequestActions(
            String(command.requestId),
            result.actions.flatMap((record) =>
              record.skipped ? [String(record.action)] : [],
            ),
          );
        },
      );
      const stopError = requests.on('error', ({ requestId }) =>
        failRequestWindow(String(requestId), "Couldn't complete the request"),
      );
      const admission = orchestrator.intentScheduler.store;
      const subscription = admission.subscribe(() => {
        if (admission.state.phase === 'idle') closeRequestWindow();
      });
      return () => {
        stopStarted();
        stopCompleted();
        stopActions();
        stopError();
        subscription.unsubscribe();
        closeRequestWindow();
      };
    }, [orchestrator]);
  },
});
