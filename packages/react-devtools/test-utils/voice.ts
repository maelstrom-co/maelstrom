import { afterEach } from 'bun:test';
import { Orchestrator } from '@maelstrom-co/client';
import {
  type Devtools,
  mountDevtools,
} from '@maelstrom-co/devtools/production';
import { fireEvent } from '@testing-library/react';

export function createVoicePanelHarness() {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  });

  function attach(tools: Devtools) {
    const client = new Orchestrator({
      capabilities: { voice: false, streaming: false, stateful: false },
      connect: async () => {},
      disconnect: async () => {},
      subscribe: () => () => {},
      addAssistantMessage: async () => {},
      getHistory: async () => [],
      process: async () => {
        throw new Error('No application work is expected');
      },
    });
    cleanups.push(() => {
      void client.dispose();
    }, tools.attach(client));
    return (
      kind: string,
      metadata: Record<string, string | number | boolean> = {},
      requestId?: string,
    ) =>
      client.diagnostics.emitDiagnostic(
        kind,
        {
          provider: 'live',
          providerInstanceId: 'provider',
          generation: 1,
          generationScope: 'session',
          ...metadata,
        },
        undefined,
        requestId,
      );
  }

  function event(
    id: string,
    kind: string,
    metadata: Record<string, unknown> = {},
    requestId?: string,
    content?: unknown,
  ) {
    return {
      id,
      kind,
      at: 100,
      sessionId: 'session',
      requestId,
      metadata: {
        clientId: 'app',
        provider: 'live',
        providerInstanceId: 'provider-a',
        generation: 1,
        generationScope: 'session',
        ...metadata,
      },
      content,
    };
  }

  function mount(tools: Devtools) {
    const unmount = mountDevtools(tools);
    cleanups.push(() => tools.dispose(), unmount);
    const shadow = document.querySelector(
      '[data-maelstrom-devtools]',
    )?.shadowRoot;
    if (!shadow) throw new Error('DevTools panel did not mount');
    const click = (name: string) => {
      const target = Array.from(shadow.querySelectorAll('button')).find(
        (node) =>
          (node.getAttribute('aria-label') ?? node.textContent) === name,
      );
      if (!target) throw new Error(`Missing button ${name}`);
      fireEvent.click(target);
    };
    const select = (name: string, value: string) => {
      const target = shadow.querySelector<HTMLSelectElement>(
        `select[aria-label="${name}"]`,
      );
      if (!target) throw new Error(`Missing select ${name}`);
      fireEvent.change(target, { target: { value } });
    };
    return { shadow, click, select, unmount };
  }

  return { attach, event, mount, cleanups };
}
