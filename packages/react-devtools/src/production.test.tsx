import { afterEach, expect, test } from 'bun:test';
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import { DiagnosticCapture } from '@maelstrom-co/devtools/production';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { devtools } from './production.js';

const nodeEnv = process.env.NODE_ENV;
afterEach(() => {
  cleanup();
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
});

const connector: EngineConnector = {
  capabilities: { voice: false, streaming: false, stateful: false },
  connect: async () => {},
  disconnect: async () => {},
  subscribe: () => () => {},
  process: async () => {
    throw new Error('unexpected request');
  },
  addAssistantMessage: async () => {},
  getHistory: async () => [],
};

test('the demo opt-in mounts a working capture panel in a production runtime', async () => {
  process.env.NODE_ENV = 'production';
  const capture = new DiagnosticCapture();
  const client = new Orchestrator(connector);
  let detach = () => {};
  const extension = devtools({ initialIsOpen: true, capture })({
    useMaelstromContext: () => {
      throw new Error('the panel must work outside a Provider');
    },
    onOrchestrator: (attach) => {
      detach = attach(client) ?? (() => {});
      return detach;
    },
  });
  try {
    render(<extension.Devtools />);
    const shadow = document.querySelector(
      '[data-maelstrom-devtools]',
    )?.shadowRoot;
    expect(shadow).toBeDefined();
    const button = (name: string) =>
      Array.from(shadow!.querySelectorAll('button')).find(
        (element) => element.textContent === name,
      )!;
    fireEvent.click(button('Recordings'));
    fireEvent.click(button('Start recording'));
    client.diagnostics.emit('fixture.completed', { ok: true }, () => ({
      intent: 'show my day',
    }));
    fireEvent.click(button('Stop'));
    expect(button('Export JSON').disabled).toBe(false);
    expect(capture.export()).toContain('show my day');
  } finally {
    detach();
    await client.dispose();
  }
});

test('the production opt-in still respects an explicit disable', () => {
  process.env.NODE_ENV = 'production';
  const extension = devtools({ enabled: false })({
    useMaelstromContext: () => {
      throw new Error('disabled tools must not access a Provider');
    },
    onOrchestrator: () => {
      throw new Error('disabled tools must not observe clients');
    },
  });
  render(<extension.Devtools />);
  expect(document.querySelector('[data-maelstrom-devtools]')).toBeNull();
});
