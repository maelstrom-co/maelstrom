import {
  type ApplicationSettlement,
  WebSocketConnector,
} from '@maelstrom-co/client';
import type { ChartRequestMessage } from '@maelstrom-co/protocol';

import { AguiWorkspaceClient } from './workspace-client.js';

/**
 * AG-UI workspace transport with native history control frames.
 * @experimental
 */
export class AguiWebSocketConnector extends WebSocketConnector {
  /** Observable protocol failure state, independent of React. */
  readonly workspace: AguiWorkspaceClient;

  /** Create a connection; authentication and host control frames remain application-owned. */
  constructor(
    options: Omit<
      ConstructorParameters<typeof WebSocketConnector>[0],
      'protocol'
    >,
  ) {
    const workspace = new AguiWorkspaceClient();
    super({
      ...options,
      protocol: 'legacy',
      onOpen: (send, sessionId) => {
        options.onOpen?.(send, sessionId);
        workspace.open(send, sessionId);
      },
      onFrame: (raw, send, sessionId, current) =>
        workspace.receive(raw, current !== false) ||
        (options.onFrame?.(raw, send, sessionId, current) ?? false),
    });
    this.workspace = workspace;
    this.subscribe((event) => {
      if (event.type === 'disconnected') workspace.disconnect();
    });
  }

  /** Retire pending protocol work before closing its transport. */
  override disconnect() {
    this.workspace.disconnect();
    return super.disconnect();
  }

  /** Validate a complete AG-UI run before handing its response to the client. */
  override process(message: ChartRequestMessage) {
    return this.workspace.process(message);
  }

  /** Acknowledge settlement; cancellation stops acknowledgment I/O, never replays Actions. */
  override applicationSettled(
    settlement: ApplicationSettlement,
    signal?: AbortSignal,
  ): Promise<void> {
    return this.workspace.applicationSettled(settlement, signal);
  }
}

export { AguiWorkspaceClient } from './workspace-client.js';
export { WorkspaceError, type WorkspaceErrorCode } from './workspace-error.js';
