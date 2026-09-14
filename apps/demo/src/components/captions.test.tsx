// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EMPTY_VOICE_OBSERVATIONS,
  FakeRealtimeSession,
} from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { selectVoiceProvider } from '../lib/voice-provider';

vi.mock('@maelstrom-co/realtime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime')>()),
  RealtimeSession: FakeRealtimeSession,
}));

vi.mock('@maelstrom-co/realtime-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@maelstrom-co/realtime-openai')>()),
  OpenAIAdapter: class {},
}));

vi.mock('../lib/mint-token', () => ({
  mintOpenAIToken: async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintOpenAIToken should not be called in tests');
  },
}));

const { m, DEMO_GREETING } = await import('../lib/maelstrom');
const { Captions } = await import('./captions');

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

beforeEach(() => {
  selectVoiceProvider('realtime');
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
  it.each([
    'user',
    'assistant',
  ] as const)('keeps the old %s receipt faded across reconnect until a fresh receipt arrives', async (role) => {
    vi.useFakeTimers();
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('connected');
      session.emitTranscript({ role, text: 'Same words', final: true });
    });
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    const faded = () =>
      container
        .querySelector(`[data-role="${role}"]`)
        ?.getAttribute('data-faded');
    expect(faded()).toBe('true');
    await act(async () => {
      session.emitState('idle');
    });
    await act(async () => {
      session.emitObservations({
        ...EMPTY_VOICE_OBSERVATIONS,
        generation: 2,
        connection: 'connected',
      });
      session.emitState('connected');
    });
    expect(faded()).toBe('true');
    await act(async () => {
      session.emitTranscript({ role, text: 'Same words', final: true });
    });
    expect(faded()).toBe('false');
  });
  it('keeps an unchanged finalized caption faded while another speaker changes, but revives revised text or identity', async () => {
    vi.useFakeTimers();
    const { container, session } = renderCaptions();
    const assistant = {
      id: 'assistant-1',
      speakerId: 'assistant',
      role: 'assistant' as const,
      text: 'Finished',
      final: true,
      fragmentIds: ['a'],
      startMs: 0,
      endMs: 100,
    };
    const publish = (caption = assistant, generation = 1) =>
      session.emitObservations({
        ...EMPTY_VOICE_OBSERVATIONS,
        generation,
        connection: 'connected',
        captions: [
          { ...caption },
          {
            ...assistant,
            id: 'user-1',
            speakerId: 'user',
            role: 'user',
            text: 'A new question',
            final: false,
          },
        ],
      });
    await act(async () => {
      session.emitState('connected');
      publish();
    });
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    const faded = () =>
      container
        .querySelector('[data-role="assistant"]')
        ?.getAttribute('data-faded');
    expect(faded()).toBe('true');
    await act(async () => {
      publish();
    });
    expect(faded()).toBe('true');
    await act(async () => {
      publish({ ...assistant, text: 'Revised' });
    });
    expect(faded()).toBe('false');
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    await act(async () => {
      publish({ ...assistant, id: 'assistant-2', text: 'Revised' });
    });
    expect(faded()).toBe('false');
    await act(async () => {
      vi.advanceTimersByTime(3500);
    });
    await act(async () => {
      publish({ ...assistant, id: 'assistant-2', text: 'Revised' }, 2);
    });
    expect(faded()).toBe('false');
  });
  it('always reserves a fixed-height band so chart layout cannot shift with voice', () => {
    // Mount/unmount of an in-flow caption row shrinks <main> and fires engine
    // chart_resize. The band must stay mounted at a stable height even idle.
    const { container } = renderCaptions();
    const root = must(container.querySelector('[data-testid="captions"]'));
    expect(root.className).toContain('h-12');
    expect(root.className).not.toContain('h-24');
    expect(container.querySelector('[data-role="assistant"]')).toBeNull();
    expect(container.querySelector('[data-role="user"]')).toBeNull();
  });

  it('keeps the band empty in error state', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('error');
    });
    expect(container.querySelector('[data-testid="captions"]')).not.toBeNull();
    expect(container.querySelector('[data-role="assistant"]')).toBeNull();
    expect(container.querySelector('[data-role="user"]')).toBeNull();
  });

  it('keeps the band empty in a live state until a transcript arrives', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
    });
    expect(container.querySelector('[data-testid="captions"]')).not.toBeNull();
    expect(container.querySelector('[data-role="assistant"]')).toBeNull();
    expect(container.querySelector('[data-role="user"]')).toBeNull();
  });

  it('does not render a caption line for empty or whitespace-only transcript text', async () => {
    // Empty entries still produce a FadingCaption object; rendering them leaves
    // a lone accent dot or blank paragraph in the fixed band.
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'assistant', text: '', final: false });
      session.emitTranscript({ role: 'user', text: '   ', final: true });
    });
    expect(container.querySelector('[data-role="assistant"]')).toBeNull();
    expect(container.querySelector('[data-role="user"]')).toBeNull();
  });

  it('clamps caption text to two lines inside the fixed band', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({
        role: 'assistant',
        text: 'Opening the weather vessel and moving tasks to the right column for the morning review',
        final: false,
      });
    });

    const line = must(container.querySelector('[data-role="assistant"]'));
    expect(line.className).toContain('col-span-2');
    expect(line.querySelector('.line-clamp-2')).not.toBeNull();
  });

  it('streams non-final assistant text live, left-aligned with an accent color', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'assistant', text: 'On ', final: false });
    });

    let line = must(container.querySelector('[data-role="assistant"]'));
    expect(line.textContent).toContain('On ');
    expect(line.className).toContain('text-ink');
    expect(line.querySelector('.caption-dot')).not.toBeNull();

    await act(async () => {
      session.emitTranscript({ role: 'assistant', text: 'it', final: false });
    });

    line = must(container.querySelector('[data-role="assistant"]'));
    expect(line.textContent).toContain('it');
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
    expect(line.className).toContain('line-clamp-2');
    expect(line.getAttribute('aria-label')).toBe('Approximate user transcript');
  });

  it('lets a single caption use the full row', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });

    expect(container.querySelector('[data-role="assistant"]')).toBeNull();
    expect(
      must(container.querySelector('[data-role="user"]')).className,
    ).toContain('col-span-2');
  });

  it('keeps simultaneous speakers in separate columns at every width', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({
        role: 'assistant',
        text: 'On it',
        final: false,
      });
      session.emitTranscript({ role: 'user', text: 'show labs', final: true });
    });

    const root = must(container.querySelector('[data-testid="captions"]'));
    const assistant = must(container.querySelector('[data-role="assistant"]'));
    const user = must(container.querySelector('[data-role="user"]'));
    expect(root.className).toContain('grid-cols-2');
    expect(root.className).not.toContain('grid-cols-1');
    expect(assistant.className).not.toContain('col-span-2');
    expect(user.className).not.toContain('col-span-2');
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
    expect(container.querySelector('[data-role="user"]')).toBeNull();
  });

  it('keeps a finalized caption visible for ~3.5s then marks it faded without unmounting the band', async () => {
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
    // Band stays — faded opacity must not collapse footer height.
    expect(container.querySelector('[data-testid="captions"]')).not.toBeNull();
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

  it('clears caption lines once voice state returns to idle, keeping the band', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('listening');
      session.emitTranscript({ role: 'assistant', text: 'done', final: true });
    });
    expect(container.querySelector('[data-role="assistant"]')).not.toBeNull();

    await act(async () => {
      session.emitState('idle');
    });
    expect(container.querySelector('[data-testid="captions"]')).not.toBeNull();
    expect(container.querySelector('[data-role="assistant"]')).toBeNull();
    expect(container.querySelector('[data-role="user"]')).toBeNull();
  });

  it('renders the greeting caption exactly once per session instance', async () => {
    const { container, session } = renderCaptions();
    await act(async () => {
      session.emitState('connected');
      session.emitGreeting();
    });

    const assistants = container.querySelectorAll('[data-role="assistant"]');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.textContent).toContain(DEMO_GREETING);

    await act(async () => {
      session.emitGreeting();
    });
    expect(container.querySelectorAll('[data-role="assistant"]')).toHaveLength(
      1,
    );
  });
});
