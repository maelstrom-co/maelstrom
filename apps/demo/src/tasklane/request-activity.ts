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
  planRequestWindow,
} from './tasklane-activity';

export interface TasklaneRequestActivity {
  /** Groups Action outcomes by the user request that caused them, for the receipt line. */
  useRequestActivity: () => void;
}

/**
 * The receipt line needs to know which entries belong to which user request
 * and what that request planned, which only the orchestrator's request events
 * and admission state carry. An extension closure is the supported seam for
 * reading them.
 *
 * A window opens when a request with a user intent starts, learns its plan
 * when the response arrives, and closes when admission goes idle, after the
 * response's Actions have settled.
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
          rememberRequestReferences();
          openRequestWindow(String(requestId));
        },
      );
      const stopCompleted = requests.on(
        'processing_completed',
        ({ requestId, response }) =>
          planRequestWindow(
            String(requestId),
            response.executionPlan.map((step) => String(step.action)),
          ),
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
        stopError();
        subscription.unsubscribe();
        closeRequestWindow();
      };
    }, [orchestrator]);
  },
});
