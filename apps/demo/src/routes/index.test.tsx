// @vitest-environment happy-dom

import { WireEngineError } from '@maelstrom-co/client';
import type { VesselDefinition } from '@maelstrom-co/protocol';
import { isInaccessible } from '@testing-library/dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRealtimeSession } from '../lib/__tests__/fake-realtime-session';
import { createMockConnector } from '../lib/__tests__/mock-connector';
import { DEMO_GREETING, m } from '../lib/maelstrom';
import {
  clearPlaygroundKey,
  setPlaygroundKey,
} from '../lib/playground-key-store';

function enumFor(
  vessel: VesselDefinition,
  variant: string,
  action: string,
  parameter: string,
): readonly unknown[] | undefined {
  return vessel.variants[variant]?.actions
    .find((a) => a.name === action)
    ?.parameters?.find((p) => p.name === parameter)?.enum;
}

// Keeps RealtimeVoiceError real (the drawer-reopen effect's `instanceof`
// check must hold against the actual class) while swapping only
// RealtimeSession for the fake — same split voice-error-note.test.tsx uses.
vi.mock('@maelstrom-co/realtime', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@maelstrom-co/realtime')>();
  return {
    ...actual,
    RealtimeSession: FakeRealtimeSession,
  };
});

vi.mock('@maelstrom-co/realtime-openai', () => ({
  OpenAIAdapter: class {},
}));

vi.mock('../lib/mint-token', () => ({
  mintToken: async () => {
    throw new Error('mintToken should not be called in tests');
  },
  createBrowserMintToken: () => async () => {
    throw new Error('mintToken should not be called in tests');
  },
}));

// Lets individual tests swap in a connector whose process() rejects (e.g.
// simulating a text-path 401), without each test needing its own vi.mock
// factory. vi.hoisted so the ref exists before the vi.mock factory below runs.
const connectorOverride = vi.hoisted(() => ({
  process: null as null | ((message: unknown) => Promise<unknown>),
}));

// createDemoConnector opens a real WebSocketConnector — swapped for the
// shared no-op mock so the route can mount without a live server.
vi.mock('../lib/connector', () => ({
  createDemoConnector: () => {
    const base = createMockConnector();
    return connectorOverride.process
      ? { ...base, process: connectorOverride.process }
      : base;
  },
}));

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error('expected value to be defined');
  return value;
}

function closeInitialKeyPrompt(): void {
  fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
  expect(screen.queryByLabelText(/api key/i)).toBeNull();
}

beforeEach(() => {
  vi.stubEnv('VITE_HOSTED', '1');
  vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
  FakeRealtimeSession.instances = [];
  localStorage.clear();
  clearPlaygroundKey();
  connectorOverride.process = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  localStorage.clear();
  clearPlaygroundKey();
  connectorOverride.process = null;
});

describe('key drawer gating (hosted, no key)', () => {
  it('keeps hosted prompting interaction-driven on initial load', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });

  it('also prompts on localhost when the server has no OpenAI key', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
  });

  it('reopens the drawer when keyless localhost Send follows a dismissal', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    const { HomePage } = await import('./index');
    render(<HomePage />);
    closeInitialKeyPrompt();

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
  });
});

describe('typed assistant feedback', () => {
  it('shows feedback for an unchanged chart and hides it when voice connects', async () => {
    setPlaygroundKey('sk-test');
    connectorOverride.process = async (message) => ({
      type: 'maelstrom_response',
      requestId: (message as { id: string }).id,
      userMessage:
        'I can arrange your calendar, tasks, journal, weather, and routes.',
      rationale: 'The user asked what the workspace can do.',
      executionPlan: [],
      layout: { type: 'grid', positions: [] },
    });

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'what can you do?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(
      await screen.findByText(
        'I can arrange your calendar, tasks, journal, weather, and routes.',
      ),
    ).toBeTruthy();

    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => session.emitState('connected'));
    expect(
      screen.queryByText(
        'I can arrange your calendar, tasks, journal, weather, and routes.',
      ),
    ).toBeNull();
  });
});

describe('voice mint failures (hosted)', () => {
  it('reopens the drawer with an actionable message on a token-mint failure', async () => {
    setPlaygroundKey('sk-rejected');
    const { HomePage } = await import('./index');
    const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
    render(<HomePage />);

    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    const session = must(FakeRealtimeSession.instances[0]);
    session.lastError = new RealtimeVoiceError(
      'TOKEN_MINT_FAILED',
      'Failed to mint an ephemeral realtime token',
      new Error('Invalid API key.'),
    );
    await act(async () => {
      session.emitState('error');
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
  });

  it('does not open the OpenAI drawer for a LiveKit token-mint failure', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    vi.stubEnv('VITE_VOICE_PROVIDER', 'livekit');
    setPlaygroundKey('sk-openai-text-key');
    const { HomePage } = await import('./index');
    const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
    render(<HomePage />);

    const session = must(FakeRealtimeSession.instances[0]);
    session.lastError = new RealtimeVoiceError(
      'TOKEN_MINT_FAILED',
      'Failed to mint a LiveKit token',
    );
    await act(async () => {
      session.emitState('error');
    });

    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });

  it('does not reopen the drawer for a non-mint voice error', async () => {
    setPlaygroundKey('sk-present');
    const { HomePage } = await import('./index');
    const { RealtimeVoiceError } = await import('@maelstrom-co/realtime');
    render(<HomePage />);

    const session = must(FakeRealtimeSession.instances[0]);
    session.lastError = new RealtimeVoiceError('MIC_PERMISSION_DENIED', 'boom');
    await act(async () => {
      session.emitState('error');
    });

    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});

describe('text-path key failures (hosted)', () => {
  it('reopens the drawer with an actionable message on a chart_request 401', async () => {
    setPlaygroundKey('sk-rejected');
    connectorOverride.process = async () => {
      throw new WireEngineError(
        '401 Incorrect API key provided: [redacted]',
        'ProviderError',
      );
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    // A stored key means no drawer up front — the failure must be what
    // reopens it, not the keyless-gating path already covered above.
    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
  });

  it('preserves the submitted draft instead of clearing it when the key that submitted it is rejected', async () => {
    // Regression: processIntent() never rejects (failures surface via
    // lastError), so an unconditional clear after the await wipes the draft
    // even though the request failed — the visitor's typed intent is lost
    // right when the drawer reopens to ask for a corrected key.
    setPlaygroundKey('sk-rejected');
    connectorOverride.process = async () => {
      throw new WireEngineError(
        '401 Incorrect API key provided: [redacted]',
        'ProviderError',
      );
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(
      (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
        .value,
    ).toBe('plan my day');
  });

  it('does not reopen the drawer for a non-key provider failure', async () => {
    setPlaygroundKey('sk-fine');
    connectorOverride.process = async () => {
      throw new WireEngineError('rate limit exceeded', 'ProviderError');
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/rate limit exceeded/i)).toBeTruthy();
    });
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});

describe('resumed auto-submit rejected by an invalid key', () => {
  it('restores the resumed draft instead of leaving it empty when the post-save reconnect is itself rejected', async () => {
    // Regression: submittedIntentRef is only written by handleSubmit, and
    // the keyEpoch remount that follows a drawer save resets it to '' via a
    // fresh IntentInput mount. The resume effect (auto-submit after the
    // reconnect) never re-recorded what it was about to submit, so when
    // *that* submission was also rejected, the restore-the-draft effect had
    // nothing to restore from and wiped the visitor's typed intent instead
    // of preserving it.
    connectorOverride.process = async () => {
      throw new WireEngineError(
        '401 Incorrect API key provided: [redacted]',
        'ProviderError',
      );
    };

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'show me the weather in Lisbon' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-still-rejected-1234567890' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
    expect(screen.getByText('Invalid API key.')).toBeTruthy();
    expect(
      (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
        .value,
    ).toBe('show me the weather in Lisbon');
  });
});

describe('saving an unchanged key mid-session', () => {
  it('does not remount the session when the saved key matches the key already in use', async () => {
    // Regression: onSave used to bump keyEpoch unconditionally, remounting
    // <m.Provider> (fresh sessionId, fresh voice session, chart wiped) even
    // when the visitor opened the drawer from the header pill just to look,
    // or re-entered the exact key already in use. A remount here is
    // observable as a brand-new RealtimeSession instance, since the voice
    // hook constructs one per Provider mount.
    setPlaygroundKey('sk-existing-1234567890');

    const { HomePage } = await import('./index');
    render(<HomePage />);

    const sessionCountBeforeSave = FakeRealtimeSession.instances.length;

    fireEvent.click(screen.getByRole('button', { name: /api key/i }));
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-existing-1234567890' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/api key/i)).toBeNull();
    });
    expect(FakeRealtimeSession.instances.length).toBe(sessionCountBeforeSave);
  });
});

describe('mic-path key gating (browser-owned key)', () => {
  it('reopens the localhost drawer instead of starting voice after dismissal', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '1');
    const { HomePage } = await import('./index');
    render(<HomePage />);
    closeInitialKeyPrompt();

    fireEvent.click(screen.getByRole('button', { name: /voice/i }));

    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    const session = must(FakeRealtimeSession.instances[0]);
    expect(session.connectCalls).toBe(0);
  });
});

const DISCLOSURE_COPY = 'AI-generated voice';

/**
 * Failure-capable visibility check for the AI-voice disclosure.
 * Catches hidden attribute, aria-hidden, inert, display/visibility none,
 * opacity 0, and common screen-reader-only class/style patterns — cases
 * that testid/textContent-only queries would miss.
 */
function expectVisibleDisclosure(): HTMLElement {
  const nodes = screen.getAllByTestId('ai-voice-disclosure');
  expect(nodes).toHaveLength(1);
  const el = nodes[0]!;
  expect(el.textContent).toBe(DISCLOSURE_COPY);

  // Accessibility-tree exclusion (hidden, aria-hidden, display:none, etc.).
  expect(isInaccessible(el)).toBe(false);

  // Explicit attribute gates (belt + suspenders for happy-dom gaps).
  expect(el.hasAttribute('hidden')).toBe(false);
  expect(el.getAttribute('aria-hidden')).not.toBe('true');
  expect(el.hasAttribute('inert')).toBe(false);

  // Ancestor chain must also be accessible/visible.
  let ancestor: HTMLElement | null = el.parentElement;
  while (ancestor && ancestor !== document.body) {
    expect(ancestor.hasAttribute('hidden')).toBe(false);
    expect(ancestor.getAttribute('aria-hidden')).not.toBe('true');
    expect(ancestor.hasAttribute('inert')).toBe(false);
    expect(isInaccessible(ancestor)).toBe(false);
    ancestor = ancestor.parentElement;
  }

  const className =
    typeof el.className === 'string' ? el.className : String(el.className);
  expect(className).not.toMatch(
    /\b(sr-only|screen-reader-only|visually-hidden|u-vh|clip-only)\b/i,
  );

  const style = getComputedStyle(el);
  expect(style.display).not.toBe('none');
  expect(style.visibility).not.toBe('hidden');
  expect(style.opacity === '' || Number(style.opacity) > 0).toBe(true);

  // Off-screen / 1px clip sr-only techniques.
  const width = Number.parseFloat(style.width);
  const height = Number.parseFloat(style.height);
  if (style.position === 'absolute' || style.position === 'fixed') {
    expect(style.clip).not.toMatch(/rect\(\s*0/);
    expect(style.clipPath).not.toMatch(/inset\(\s*50%/);
    if (Number.isFinite(width) && Number.isFinite(height)) {
      expect(width <= 1 && height <= 1).toBe(false);
    }
    const left = Number.parseFloat(style.left);
    if (Number.isFinite(left)) {
      expect(left).toBeGreaterThan(-100);
    }
  }

  // Text query must resolve to the same visible node (not a duplicate hidden copy).
  expect(screen.getByText(DISCLOSURE_COPY)).toBe(el);
  return el;
}

describe('voice greeting (hosted, with a key)', () => {
  it('shows the exact AI-generated disclosure before any orb click in local and hosted modes', async () => {
    const { HomePage } = await import('./index');

    // Local mode: no visitor key, disclosure must be visible before interaction.
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    clearPlaygroundKey();
    const local = render(<HomePage />);
    expectVisibleDisclosure();
    local.unmount();

    // Hosted mode: same unconditional visible copy before any orb click.
    vi.stubEnv('VITE_HOSTED', '1');
    setPlaygroundKey('sk-greeting-1234567890');
    render(<HomePage />);
    expectVisibleDisclosure();
  });

  it('greets through the voice orb once, exactly, per session', async () => {
    setPlaygroundKey('sk-greeting-1234567890');
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: /voice/i }));

    const session = must(FakeRealtimeSession.instances[0]);
    await waitFor(() => expect(session.connectCalls).toBe(1));

    await act(async () => {
      session.emitGreeting();
    });

    const caption = document.querySelectorAll('[data-role="assistant"]');
    expect(caption).toHaveLength(1);
    expect(caption[0]?.textContent).toContain(DEMO_GREETING);

    await act(async () => {
      session.emitGreeting();
    });
    expect(document.querySelectorAll('[data-role="assistant"]')).toHaveLength(
      1,
    );
  });

  it('greets again on a new session (new keyEpoch)', async () => {
    setPlaygroundKey('sk-first-key-1234567890');
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: /voice/i }));
    const first = must(FakeRealtimeSession.instances[0]);
    await waitFor(() => expect(first.connectCalls).toBe(1));
    await act(async () => {
      first.emitGreeting();
    });
    expect(
      document.querySelector('[data-role="assistant"]')?.textContent,
    ).toContain(DEMO_GREETING);

    const sessionCountBefore = FakeRealtimeSession.instances.length;

    // Different key → new keyEpoch → new Provider/session.
    fireEvent.click(screen.getByRole('button', { name: /api key/i }));
    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-second-key-1234567890' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });
    await waitFor(() => {
      expect(screen.queryByLabelText(/api key/i)).toBeNull();
    });
    await waitFor(() => {
      expect(FakeRealtimeSession.instances.length).toBeGreaterThan(
        sessionCountBefore,
      );
    });

    const second = must(
      FakeRealtimeSession.instances[FakeRealtimeSession.instances.length - 1],
    );
    expect(second).not.toBe(first);

    fireEvent.click(screen.getByRole('button', { name: /voice/i }));
    await waitFor(() => expect(second.connectCalls).toBe(1));
    await act(async () => {
      second.emitGreeting();
    });

    const assistants = document.querySelectorAll('[data-role="assistant"]');
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.textContent).toContain(DEMO_GREETING);
  });
});

describe('header "API key" affordance', () => {
  it('is hidden when local mode has a server-owned key', async () => {
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.queryByRole('button', { name: /api key/i })).toBeNull();
  });

  it('is visible when hosted', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    expect(screen.getByRole('button', { name: /api key/i })).toBeTruthy();
  });

  it('opens the drawer when clicked, with no key set', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: /api key/i }));

    expect(screen.getByLabelText(/api key/i)).toBeTruthy();
  });

  it('does not auto-submit typed text when the drawer is opened via the header button', async () => {
    // Regression: onSave used to unconditionally arm resumeIntent off
    // whatever text happened to be in the box, so opening the drawer from
    // the header (not a blocked Send) still auto-submitted it on save.
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /api key/i }));
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-new-key-1234567890' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    await waitFor(() => {
      expect(screen.queryByLabelText(/api key/i)).toBeNull();
    });
    // No auto-submit fired, so the typed text is untouched.
    expect(
      (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
        .value,
    ).toBe('plan my day');
  });
});

describe('resumeIntent auto-submit', () => {
  it('sends the intent typed before the drawer interrupted, once the post-save reconnect lands', async () => {
    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText(/api key/i), {
      target: { value: 'sk-new-key-1234567890' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    });

    // The drawer closes and the reconnect (fresh keyEpoch) auto-submits the
    // intent that was typed before it was interrupted — the input clears
    // once that submit resolves, without the visitor having to press Send
    // again.
    await waitFor(() => {
      expect(
        (screen.getByPlaceholderText(/tell maelstrom/i) as HTMLInputElement)
          .value,
      ).toBe('');
    });
    expect(screen.queryByLabelText(/api key/i)).toBeNull();
  });
});

describe('removing a session key', () => {
  it('clears the in-memory key, closes the drawer, and re-prompts on the next Send', async () => {
    setPlaygroundKey('sk-session-key');

    const { HomePage } = await import('./index');
    render(<HomePage />);

    fireEvent.click(screen.getByRole('button', { name: /api key/i }));
    expect(screen.getByLabelText(/api key/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /remove key/i }));

    expect(screen.queryByLabelText(/api key/i)).toBeNull();

    // The app is back in the keyless state — the next Send re-prompts.
    fireEvent.change(screen.getByPlaceholderText(/tell maelstrom/i), {
      target: { value: 'plan my day' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/api key/i)).toBeTruthy();
    });
  });
});

describe('captions placement (footer chrome)', () => {
  it('keeps captions outside main and between the voice error note and the orb', async () => {
    // Captions over main covered vessel flash borders. This asserts the mount
    // site, not class names — CSS or a moved parent would still fail here.
    vi.stubEnv('VITE_HOSTED', '0');
    vi.stubEnv('VITE_BROWSER_KEY_MODE', '0');
    const { HomePage } = await import('./index');
    const { container } = render(<HomePage />);

    const captions = must(container.querySelector('[data-testid="captions"]'));
    const main = must(container.querySelector('main'));
    expect(main.contains(captions)).toBe(false);

    const footer = must(captions.parentElement);
    const kids = Array.from(footer.children);
    const captionsIdx = kids.indexOf(captions);
    const orbIdx = kids.findIndex((el) => el.querySelector('.voice-orb'));
    expect(orbIdx).toBeGreaterThan(-1);
    expect(captionsIdx).toBeLessThan(orbIdx);

    // VoiceErrorNote mounts only on error — when present it must sit above captions.
    const session = must(FakeRealtimeSession.instances[0]);
    await act(async () => {
      session.emitState('error');
    });
    const errorNote = must(container.querySelector('.voice-error-note'));
    const kidsWithError = Array.from(must(captions.parentElement).children);
    expect(kidsWithError.indexOf(errorNote)).toBeLessThan(
      kidsWithError.indexOf(
        must(container.querySelector('[data-testid="captions"]')),
      ),
    );
  });
});

describe('the seeded first screen', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lands on the default layout instead of the empty-chart hint', async () => {
    // FirstRunHint's visibility condition is `isFirstRunHintVisible` — see
    // first-run-hint.tsx for the exact predicate. Its absence right after
    // mount is what proves DEFAULT_LAYOUT's seeded instances reached the
    // store through the real <m.Provider> mount in routes/index.tsx —
    // default-layout.test.ts only checks the constant in isolation, and
    // would stay green even if `initialLayout={DEFAULT_LAYOUT}` were
    // deleted from the route.
    const { HomePage } = await import('./index');
    await act(async () => {
      render(<HomePage />);
    });

    expect(screen.queryByTestId('first-run-hint')).toBeNull();
    // Positive assertions: both seeded tiles actually rendered their
    // content, which the hint's absence alone doesn't prove — a malformed
    // tree, an unregistered vesselId, or a bad variant name would all leave
    // the hint absent (instanceCount still 2) while the chart stays blank.
    await screen.findByText(/Design review/);
    await screen.findByText('Ship this sprint');
  });

  it('keeps published action options in sync through the real provider tree', async () => {
    // vessel-option-sync.test.tsx renders <VesselOptionSync /> in isolation,
    // which would stay green even if the route stopped mounting it at all.
    // Spying on the real m.updateVessel here and rendering the actual
    // HomePage tree proves <VesselOptionSync /> is mounted where it matters
    // and republishes real store data (a seeded task title) through the
    // real orchestrator, not a mock.
    const updateVesselSpy = vi.spyOn(m, 'updateVessel');

    const { HomePage } = await import('./index');
    await act(async () => {
      render(<HomePage />);
    });

    // The mount-time republish can lose an initial race against the
    // instance-seeding batch (result.ok === false, conflict.code ===
    // 'batch_in_flight') and only succeed on VesselOptionSync's retry, so
    // this polls for a *successful* 'tasks' call rather than asserting on
    // the first one. Asserting on the call args alone (what the original
    // test did) is only proof the update was attempted, not accepted —
    // m.updateVessel returns {ok:false, conflict} rather than throwing, so
    // a wholly-refused republish (e.g. batch_in_flight on every retry)
    // would look identical to a successful one if only the args were
    // checked.
    const findSucceededTasksCallIndex = () =>
      updateVesselSpy.mock.calls.findIndex(
        ([vessel], i) =>
          vessel.id === 'tasks' &&
          updateVesselSpy.mock.results[i]?.value.ok === true,
      );
    await waitFor(() => expect(findSucceededTasksCallIndex()).not.toBe(-1), {
      timeout: 2000,
    });

    const tasksCallIndex = findSucceededTasksCallIndex();
    const tasksCall = updateVesselSpy.mock.calls[tasksCallIndex];
    const titleEnum = enumFor(
      tasksCall?.[0] as VesselDefinition,
      'list',
      'checkTask',
      'title',
    );
    expect(titleEnum).toContain('Ship this sprint');
  });
});
