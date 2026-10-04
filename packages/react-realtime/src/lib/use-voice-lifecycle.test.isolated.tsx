import { afterEach, expect, test } from 'bun:test';
import { defineVessel } from '@maelstrom-co/protocol';
import { createMaelstrom, vessel } from '@maelstrom-co/react';
import type { RealtimeProviderAdapter } from '@maelstrom-co/realtime';
import { act, cleanup, render } from '@testing-library/react';
import { createMockConnector } from './__tests__/mock-connector.js';
import {
  type MaelstromRealtimeOptions,
  maelstromRealtime,
  type UseVoiceResult,
} from './maelstrom-realtime.js';

afterEach(cleanup);

type Provider = 'first' | 'second';

const testVessel = defineVessel({
  id: 'voice-lifecycle',
  name: 'Voice lifecycle',
  description: 'Vessel for shared voice lifecycle tests',
  defaultVariant: 'default',
  variants: {
    default: {
      props: {},
      minSize: { width: 1, height: 1 },
      actions: [],
    },
  },
});

function makeAdapter(): RealtimeProviderAdapter & { active: boolean } {
  const adapter = {
    active: false,
    connect: async () => {
      adapter.active = true;
    },
    disconnect: async () => {
      adapter.active = false;
    },
    getAudioStreams: () => ({}),
    sendToolResult: async () => {},
    injectGrounding: () => {},
    on: () => () => {},
    observations: { subscribe: () => () => {} },
  };
  return adapter;
}

function setup(
  options: Pick<
    MaelstromRealtimeOptions<Provider>,
    'onSession' | 'initialProvider' | 'greeting'
  > = {},
) {
  const adapters: ReturnType<typeof makeAdapter>[] = [];
  const m = createMaelstrom({ vessels: [vessel(testVessel, () => null)] }).with(
    maelstromRealtime({
      providers: ['first', 'second'],
      initialProvider: options.initialProvider,
      createAdapter: () => {
        const adapter = makeAdapter();
        adapters.push(adapter);
        return adapter;
      },
      onSession: options.onSession,
      greeting: options.greeting,
    }),
  );
  let voice!: UseVoiceResult<Provider>;
  function Controls() {
    voice = m.useVoice();
    return null;
  }
  const view = render(
    <m.Provider connector={createMockConnector()}>
      <Controls />
    </m.Provider>,
  );
  return { adapters, current: () => voice, unmount: view.unmount };
}

test('retained controls stop the replacement provider they connected', async () => {
  const state = setup();
  const { switchProvider, connect, disconnect } = state.current();
  await act(async () => {
    await switchProvider('second');
    await connect();
  });
  expect(state.adapters.at(-1)?.active).toBe(true);

  await act(async () => disconnect());

  expect(state.adapters.at(-1)?.active).toBe(false);
  expect(state.current().state).toBe('idle');
});

test.each([
  false,
  true,
])('releases every session when the last consumer unmounts, reentrant: %s', async (reentrant) => {
  const released: Provider[] = [];
  let unmount = () => {};
  const state = setup({
    onSession:
      (_session, { provider }) =>
      () => {
        released.push(provider);
        if (reentrant && provider === 'first') unmount();
      },
  });
  unmount = state.unmount;

  await act(async () => state.current().switchProvider('second'));
  if (!reentrant) state.unmount();
  await act(async () => Promise.resolve());

  expect(released).toEqual(['first', 'second']);
});

test('rejects a stored initial provider outside the configured list before attaching a session', () => {
  let attached = false;
  expect(() =>
    setup({
      onSession: () => {
        attached = true;
      },
      initialProvider: () => 'missing' as Provider,
    }),
  ).toThrow(RangeError);
  expect(attached).toBe(false);
});

test('rejects an empty provider list rather than passing undefined to the adapter factory', () => {
  expect(() =>
    maelstromRealtime({ providers: [], createAdapter: makeAdapter }),
  ).toThrow(RangeError);
});

test('retained greeting controls skip the current provider opening', async () => {
  const state = setup({ greeting: { text: 'Hello.' } });
  const { skipGreeting } = state.current();
  await act(async () => state.current().switchProvider('second'));

  await act(async () => skipGreeting());

  expect(state.current().greetingState).toBe('skipped');
});

test('retained stop controls do not recreate a session after its last consumer unmounts', async () => {
  const state = setup();
  const { disconnect, skipGreeting } = state.current();
  state.unmount();
  await act(async () => Promise.resolve());

  await disconnect();
  skipGreeting();

  expect(state.adapters).toHaveLength(1);
  expect(state.adapters[0]?.active).toBe(false);
});
