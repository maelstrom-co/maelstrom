import type { Orchestrator } from '@maelstrom-co/client';
import type { InstanceId } from '@maelstrom-co/protocol';
import { ActionName, toError } from '@maelstrom-co/protocol';
import type { MutableRefObject } from 'react';

/**
 * Builds the `executeAction` callback injected into vessel components — a
 * client-authoritative dispatch through `Orchestrator.invokeAction`.
 */
export function buildExecuteAction(
  orchestrator: Orchestrator,
  instanceId: InstanceId,
  debug: boolean,
  onErrorRef: MutableRefObject<((error: Error) => void) | undefined>,
): (name: string, params?: Record<string, unknown>) => void {
  return (name, params) => {
    if (debug) {
      console.log(`[Maelstrom] executeAction: ${name}`, params);
    }
    try {
      // Branding an empty/invalid name can throw; the catch keeps render
      // callbacks safe and routes the failure to the app's onError.
      orchestrator.invokeAction(instanceId, ActionName(name), params);
    } catch (err) {
      onErrorRef.current?.(toError(err));
    }
  };
}
