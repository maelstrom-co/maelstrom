// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));

vi.mock('@maelstrom-co/realtime/openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime/openai')>()),
  OpenAIAdapter: class {},
}));

vi.mock('../lib/mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

const { m } = await import('../lib/maelstrom');
const { Captions } = await import('./captions');

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

beforeEach(() => {
  FakeRealtimeSession.instances = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderCaptions() {
  const connector = createMockConnector();
  const utils = render(
    <m.Provider connector={connector}>
      <Captions />
    </m.Provider>,
  );
  return { ...utils, session: must(FakeRealtimeSession.instances[0]) };
}

describe('Captions', () => {
  it('renders nothing while idle', () => {
    const { container } = renderCaptions();
    expect(
      container.querySelector('[data-testid="captions-overlay"]'),
    ).toBeNull();
  });

  it('renders nothing in error state', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('error');
    });
    expect(
      container.querySelector('[data-testid="captions-overlay"]'),
    ).toBeNull();
  });

  it('stays hidden in a live state until a transcript arrives', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
    });
    expect(
      container.querySelector('[data-testid="captions-overlay"]'),
    ).toBeNull();
  });

  it('streams non-final assistant text live, left-aligned with an accent color', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'assistant', text: 'On ', final: false });
    });

    let line = must(container.querySelector('[data-role="assistant"]'));
    expect(line.textContent).toBe('On ');
    expect(line.className).toContain('text-ink');
    expect(line.querySelector('.caption-dot')).not.toBeNull();

    await act(async () => {
      session.emitTranscript({ role: 'assistant', text: 'it', final: false });
    });

    line = must(container.querySelector('[data-role="assistant"]'));
    expect(line.textContent).toBe('On it');
  });

  it('renders the user transcript right-aligned and dim', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });

    const line = must(container.querySelector('[data-role="user"]'));
    expect(line.textContent).toBe('show labs');
    expect(line.className).toContain('text-right');
    expect(line.className).toContain('text-ink-3');
  });

  it('omits the assistant caption dot when only a user transcript is present', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });

    const assistantLine = must(
      container.querySelector('[data-role="assistant"]'),
    );
    expect(assistantLine.querySelector('.caption-dot')).toBeNull();
  });

  it('keeps the assistant caption dot when an assistant transcript is present', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({
        role: 'assistant',
        text: 'On it',
        final: false,
      });
    });

    const assistantLine = must(
      container.querySelector('[data-role="assistant"]'),
    );
    expect(assistantLine.querySelector('.caption-dot')).not.toBeNull();
  });

  it('keeps a finalized caption visible for ~3.5s then marks it faded', async () => {
    vi.useFakeTimers();
    const { container, session } = renderCaptions();

    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });

    let line = must(container.querySelector('[data-role="user"]'));
    expect(line.getAttribute('data-faded')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    line = must(container.querySelector('[data-role="user"]'));
    expect(line.getAttribute('data-faded')).toBe('false');

    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    line = must(container.querySelector('[data-role="user"]'));
    expect(line.getAttribute('data-faded')).toBe('true');
  });

  it('resets fade state when a fresh fragment starts streaming again', async () => {
    vi.useFakeTimers();
    const { container, session } = renderCaptions();

    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    expect(
      must(container.querySelector('[data-role="user"]')).getAttribute(
        'data-faded',
      ),
    ).toBe('true');

    await act(async () => {
      session.emitTranscript({ role: 'user', text: 'and ', final: false });
    });
    expect(
      must(container.querySelector('[data-role="user"]')).getAttribute(
        'data-faded',
      ),
    ).toBe('false');
  });

  it('hides again once voice state returns to idle', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'assistant', text: 'done', final: true });
    });
    expect(
      container.querySelector('[data-testid="captions-overlay"]'),
    ).not.toBeNull();

    await act(async () => {
      session.emitState('idle');
    });
    expect(
      container.querySelector('[data-testid="captions-overlay"]'),
    ).toBeNull();
  });
});
