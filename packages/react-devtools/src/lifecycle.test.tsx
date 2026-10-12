import { afterEach, expect, test } from 'bun:test';
import { type EngineConnector, Orchestrator } from '@maelstrom-co/client';
import {
  createDevtools,
  DiagnosticCapture,
  mountDevtools,
} from '@maelstrom-co/devtools';
import { createMaelstrom } from '@maelstrom-co/react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { devtools } from './index.js';

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
  process: async () => {
    throw new Error('unexpected request');
  },
  subscribe: () => () => {},
  addAssistantMessage: async () => {},
  getHistory: async () => [],
};

test('one shared panel keeps a retained capture accessible after every Provider detaches', async () => {
  process.env.NODE_ENV = 'development';
  const capture = new DiagnosticCapture();
  let attach: (client: Orchestrator) => () => void = () => () => {};
  const extension = devtools({ initialIsOpen: true, capture })({
    useMaelstromContext: () => {
      throw new Error('A retained panel must not require an active Provider');
    },
    onOrchestrator: (observer) => {
      attach = observer;
      return () => {};
    },
  });
  const client = new Orchestrator(connector);
  const detach = attach(client);
  try {
    render(
      <>
        <extension.Devtools />
        <extension.Devtools />
      </>,
    );
    expect(document.querySelectorAll('[data-maelstrom-devtools]')).toHaveLength(
      1,
    );
    const shadow = document.querySelector(
      '[data-maelstrom-devtools]',
    )?.shadowRoot;
    expect(shadow).toBeDefined();
    const button = (name: string) => {
      const match = Array.from(shadow?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent === name,
      );
      expect(match).toBeDefined();
      return match!;
    };
    fireEvent.click(button('Recordings'));
    fireEvent.click(button('Start recording'));
    act(() => {
      capture.setOutcome('Retain this failure after remount');
      capture.stop();
      detach();
    });
    expect(shadow?.querySelector('textarea')?.value).toBe(
      'Retain this failure after remount',
    );
    expect(button('Export JSON').disabled).toBe(false);
    fireEvent.click(button('Clear recording'));
    expect(capture.getSnapshot().count).toBe(0);
    expect(shadow?.querySelector('textarea')?.value).toBe('');
  } finally {
    detach();
    await client.dispose();
  }
});

test('constructing an instrumented branch leaves base and sibling Providers unobserved', () => {
  process.env.NODE_ENV = 'development';
  const capture = new DiagnosticCapture();
  const base = createMaelstrom({ vessels: [] });
  const extended = base.with(devtools({ capture }));
  const sibling = base.with(() => ({ sibling: true }));
  capture.start('fixture', 'fixture', 'fixture');
  const baseView = render(
    <base.Provider connector={connector}>
      <div />
    </base.Provider>,
  );
  baseView.unmount();
  const siblingView = render(
    <sibling.Provider connector={connector}>
      <div />
    </sibling.Provider>,
  );
  siblingView.unmount();
  expect(
    JSON.parse(capture.export()).events.some(
      (event: { kind: string }) => event.kind === 'client.attached',
    ),
  ).toBe(false);
  const child = extended.with(() => ({ child: true }));
  render(
    <child.Provider connector={connector}>
      <div />
    </child.Provider>,
  );
  expect(
    JSON.parse(capture.export()).events.filter(
      (event: { kind: string }) => event.kind === 'client.attached',
    ),
  ).toHaveLength(1);
});

test('unregistering a branch observer also stops future descendant attachments', () => {
  let attached = 0;
  const parent = createMaelstrom({ vessels: [] }).with((context) => ({
    unregister: context.onOrchestrator!(() => {
      attached++;
      return () => {};
    }),
  }));
  const descendant = parent.with(() => ({}));
  parent.unregister();
  render(
    <descendant.Provider connector={connector}>
      <div />
    </descendant.Provider>,
  );
  expect(attached).toBe(0);
});

test('a Chart remount restores the enabled outline preference', async () => {
  process.env.NODE_ENV = 'development';
  const previous = globalThis.ResizeObserver;
  // Layout is unmeasured; this test checks the outline preference only.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  let client: Orchestrator | undefined;
  const m = createMaelstrom({ vessels: [] })
    .with(devtools())
    .with((context) => {
      context.onOrchestrator!((value) => {
        client = value;
        return () => {};
      });
      return {};
    });
  const tree = (shown: boolean) => (
    <m.Provider connector={connector}>{shown ? <m.Chart /> : null}</m.Provider>
  );
  try {
    const view = render(tree(true));
    await act(async () =>
      client!.diagnostics.emit('devtools.overlays.changed', { enabled: true }),
    );
    expect(document.querySelectorAll('[data-chart-debug]')).toHaveLength(1);
    view.rerender(tree(false));
    view.rerender(tree(true));
    expect(document.querySelectorAll('[data-chart-debug]')).toHaveLength(1);
  } finally {
    cleanup();
    globalThis.ResizeObserver = previous;
  }
});

test('Open capture accepts a legacy file whose indentation exceeds four MiB', async () => {
  process.env.NODE_ENV = 'development';
  const tools = createDevtools({ initialIsOpen: true });
  tools.startCapture();
  for (let i = 0; i < 999; i++)
    tools.capture.record('fixture', {
      values: Array.from({ length: 800 }, () => 0),
    });
  tools.stopCapture();
  const legacy = tools.capture.export();
  expect(legacy.length).toBeGreaterThan(4_194_304);
  const unmount = mountDevtools(tools);
  try {
    const shadow = document.querySelector('[data-maelstrom-devtools]')!
      .shadowRoot!;
    const tab = Array.from(shadow.querySelectorAll('button')).find(
      (button) => button.textContent === 'Recordings',
    )!;
    fireEvent.click(tab);
    const input = shadow.querySelector<HTMLInputElement>('input[type=file]')!;
    fireEvent.change(input, {
      target: {
        files: [
          new File([legacy], 'legacy.json', { type: 'application/json' }),
        ],
      },
    });
    await waitFor(() => expect(tools.getSnapshot().imported).not.toBeNull(), {
      timeout: 2000,
    });
  } finally {
    unmount();
    tools.dispose();
  }
});

test('the panel restores its outline checkbox when it remounts', () => {
  process.env.NODE_ENV = 'development';
  const tools = createDevtools({ initialIsOpen: true });
  let unmount = mountDevtools(tools);
  const checkbox = () =>
    document
      .querySelector('[data-maelstrom-devtools]')!
      .shadowRoot!.querySelector<HTMLInputElement>('input[type=checkbox]')!;
  try {
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(true);
    unmount();
    unmount = mountDevtools(tools);
    expect(checkbox().checked).toBe(true);
  } finally {
    unmount();
    tools.dispose();
  }
});
