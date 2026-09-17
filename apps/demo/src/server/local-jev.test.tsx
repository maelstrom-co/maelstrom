// @vitest-environment happy-dom

import { Orchestrator } from '@maelstrom-co/client';
import type { Planner } from '@maelstrom-co/engine';
import {
  ActionName,
  InstanceId,
  ok,
  SessionId,
  VariantName,
  VesselId,
} from '@maelstrom-co/protocol';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantResponse } from '../components/assistant-response';
import { createDemoConnector } from '../lib/connector';
import * as engineModel from './engine-model';
import { buildLocalServer, createWebSocketHandlers } from './ws-server';

const invoke = vi.hoisted(() => vi.fn<Planner['invoke']>());
const chat = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/ai')>()),
  chat,
}));
vi.mock('@maelstrom-co/engine-jev', () => ({
  createJevPlanner: () => ({
    id: 'jev-scripted',
    supportedLayoutModes: ['tiling'],
    invoke,
  }),
}));

afterEach(() => {
  cleanup();
  invoke.mockReset();
  chat.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup(env: Record<string, string> = {}) {
  vi.stubEnv('VITE_HOSTED', '0');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
  const network = vi.fn(() => {
    throw new Error('Unexpected live provider call');
  });
  vi.stubGlobal('fetch', network);
  const local = buildLocalServer({
    MAELSTROM_PLANNER: 'jev',
    TYPESAFE_API_KEY: 'typesafe-test-secret',
    JEV_MODEL: 'jev-pinned-test',
    ...env,
  });
  const handlers = createWebSocketHandlers({
    sharedEngine: local.engine,
    sharedEngineInitError: local.initError,
    secrets: local.secrets,
  });
  const frames: string[] = [];
  class LoopbackSocket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    readonly server = {
      data: { helloReceived: local.helloReceived },
      send: (data: string) => this.onmessage?.({ data }),
      close: (code: number, reason: string) => this.onclose?.({ code, reason }),
    };
    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
      });
    }
    send(data: string) {
      frames.push(data);
      void handlers.message(this.server as never, data);
    }
    close() {
      this.readyState = 3;
    }
  }
  vi.stubGlobal('WebSocket', LoopbackSocket);
  const getApiKey = vi.fn(() => {
    throw new Error('Jev must not read a browser key');
  });
  const orchestrator = new Orchestrator(createDemoConnector({ getApiKey }), {
    sessionId: SessionId('local-jev-test'),
    vessels: [
      {
        id: VesselId('calendar'),
        name: 'Calendar',
        description: 'Calendar events',
        defaultVariant: VariantName('month'),
        variants: {
          [VariantName('month')]: {
            props: {},
            minSize: { width: 4, height: 4 },
            actions: [
              {
                name: ActionName('configure'),
                description: 'Configure calendar',
                idempotent: false,
              },
            ],
          },
        },
      },
    ],
  });
  return { orchestrator, local, network, getApiKey, frames };
}

describe('local Jev over the demo WebSocket path', () => {
  it('runs one server-key LLM fallback after Jev defers and records only the accepted plan', async () => {
    invoke.mockResolvedValue(ok({ kind: 'deferred', reason: 'uncertain' }));
    chat.mockResolvedValue({
      layout: { type: 'tiling', tree: [], instances: [] },
      executionPlan: [],
      userMessage: 'Nothing to change.',
      rationale: 'Keep the current chart.',
    });
    const adapter = vi
      .spyOn(engineModel, 'createDemoOpenaiChat')
      .mockReturnValue({
        kind: 'text',
        name: 'offline-openai',
        model: 'offline',
        chatStream: vi.fn(),
        structuredOutput: vi.fn(),
      } as unknown as ReturnType<typeof engineModel.createDemoOpenaiChat>);
    const { orchestrator, local, network, getApiKey } = setup({
      MAELSTROM_PLANNER_FALLBACK: 'llm',
      OPENAI_API_KEY: 'server-openai-secret',
    });
    try {
      await orchestrator.connect();
      const response = await orchestrator.processIntent('Keep my chart');
      expect(response.userMessage).toBe('Nothing to change.');
      expect(adapter).toHaveBeenCalledExactlyOnceWith('server-openai-secret');
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(chat).toHaveBeenCalledTimes(1);
      const history = await local.engine?.getHistory(
        SessionId('local-jev-test'),
      );
      expect(history?.ok && history.value).toHaveLength(1);
      expect(getApiKey).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      await orchestrator.dispose();
    }
  });

  it('applies a text-free plan without hello, before executing its new-instance action', async () => {
    invoke.mockImplementation(async ({ context }) => {
      expect(context.deadlineAt).toBeGreaterThan(Date.now());
      expect(context.deadlineAt).toBeLessThanOrEqual(Date.now() + 25_000);
      expect(context.calls.remaining).toBe(3);
      return ok({
        kind: 'candidate',
        candidate: {
          layout: {
            type: 'tiling',
            tree: ['ID:new-calendar'],
            instances: [
              {
                instanceId: 'new-calendar',
                vesselId: 'calendar',
                variant: 'month',
              },
            ],
          },
          executionPlan: [{ instanceId: 'new-calendar', action: 'configure' }],
        },
      });
    });
    const { orchestrator, network, getApiKey, frames } = setup();
    const order: string[] = [];
    orchestrator.commandProcessor.events.on('command_start', ({ command }) =>
      order.push(command.kind),
    );
    const id = InstanceId('new-calendar');
    const action = vi.fn(() => {
      expect(orchestrator.commandProcessor.store.state.instances.has(id)).toBe(
        true,
      );
      return ok(undefined);
    });
    orchestrator.commandProcessor.registerRunner(id, { configure: action });
    try {
      await orchestrator.connect();
      const response = await orchestrator.processIntent('Add a calendar');
      await orchestrator.commandProcessor.waitForIdle();
      expect(order).toEqual(['set_layout', 'execute_actions']);
      expect(action).toHaveBeenCalledTimes(1);
      expect(orchestrator.getViewState().isProcessing).toBe(false);
      expect(response.userMessage).toBeUndefined();
      expect(
        render(
          <AssistantResponse
            isProcessing={false}
            message={response.userMessage}
            voiceActive={false}
          />,
        ).container.firstChild,
      ).toBeNull();
      expect(frames.some((frame) => frame.includes('playground.hello'))).toBe(
        false,
      );
      expect(getApiKey).not.toHaveBeenCalled();
      expect(network).not.toHaveBeenCalled();
    } finally {
      await orchestrator.dispose();
    }
  });

  it.each([
    'semantic',
    'invalid-plan',
  ] as const)('rejects %s deferral distinctly without changing the chart or recording history', async (kind) => {
    invoke.mockResolvedValue(
      kind === 'semantic'
        ? ok({ kind: 'deferred', reason: 'uncertain' })
        : ok({
            kind: 'candidate',
            candidate: {
              layout: { type: 'tiling', tree: [], instances: [] },
              executionPlan: [{ instanceId: 'missing', action: 'configure' }],
            },
          }),
    );
    const { orchestrator, local, network } = setup();
    const before = orchestrator.commandProcessor.store.state;
    const command = vi.fn();
    orchestrator.commandProcessor.events.on('command_start', command);
    try {
      await orchestrator.connect();
      await expect(
        orchestrator.processIntent('Uncertain request'),
      ).rejects.toMatchObject({
        code: 'PlanningDeferredError',
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(command).not.toHaveBeenCalled();
      expect(orchestrator.commandProcessor.store.state.instances).toEqual(
        before.instances,
      );
      expect(
        await local.engine?.getHistory(SessionId('local-jev-test')),
      ).toEqual(ok([]));
      expect(network).not.toHaveBeenCalled();
    } finally {
      await orchestrator.dispose();
    }
  });
});
