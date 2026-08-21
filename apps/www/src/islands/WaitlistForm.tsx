import { WAITLIST_TURNSTILE_ACTION } from '@maelstrom-co/platform-infra/waitlist-contract';
import { useEffect, useRef, useState } from 'react';
import { WAITLIST_TURNSTILE_SITE_KEY } from '../data/turnstile-site-key';
import { submitWaitlist } from '../lib/waitlist';

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      appearance: 'interaction-only';
      execution: 'execute';
      language: 'auto';
      retry: 'auto';
      size: 'compact' | 'flexible';
      theme: 'auto';
      'refresh-expired': 'auto';
      'refresh-timeout': 'auto';
      callback(token: string): void;
      'after-interactive-callback'(): void;
      'before-interactive-callback'(): void;
      'error-callback'(errorCode: string): void;
      'expired-callback'(): void;
      'timeout-callback'(): void;
      'unsupported-callback'(): void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

interface PendingChallenge {
  reject(error: Error): void;
  resolve(token: string): void;
  timeout: number;
}

let turnstilePromise: Promise<TurnstileApi> | undefined;
const TURNSTILE_LOAD_TIMEOUT_MS = 5_000;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;

  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      script.remove();
      reject(error);
    };
    const timeout = window.setTimeout(
      () => fail(new Error('Turnstile load timed out')),
      TURNSTILE_LOAD_TIMEOUT_MS,
    );
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => {
      if (!window.turnstile) {
        fail(new Error('Turnstile did not initialize'));
        return;
      }
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(window.turnstile);
    };
    script.onerror = () => fail(new Error('Turnstile failed to load'));
    document.head.insertAdjacentElement('beforeend', script);
  });
  turnstilePromise = promise;
  promise.catch(() => {
    if (turnstilePromise === promise) turnstilePromise = undefined;
  });
  return turnstilePromise;
}

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'submitted' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [securityStatus, setSecurityStatus] = useState('');
  const [securityVisible, setSecurityVisible] = useState(false);
  const inFlight = useRef(false);
  const turnstileUnsupported = useRef(false);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | null>(null);
  const pendingChallenge = useRef<PendingChallenge | null>(null);
  const widgetReady = useRef<Promise<string | null> | null>(null);
  const mounted = useRef(false);

  function rejectPendingChallenge(message: string) {
    const pending = pendingChallenge.current;
    if (!pending) return;
    window.clearTimeout(pending.timeout);
    pendingChallenge.current = null;
    pending.reject(new Error(message));
    setSecurityVisible(false);
  }

  function initializeTurnstile() {
    return loadTurnstile()
      .then((turnstile) => {
        if (!mounted.current || !turnstileContainer.current) {
          throw new Error('Turnstile form is no longer mounted');
        }
        const widgetId = turnstile.render(turnstileContainer.current, {
          sitekey: WAITLIST_TURNSTILE_SITE_KEY,
          action: WAITLIST_TURNSTILE_ACTION,
          appearance: 'interaction-only',
          execution: 'execute',
          language: 'auto',
          retry: 'auto',
          size: window.matchMedia('(max-width: 420px)').matches
            ? 'compact'
            : 'flexible',
          theme: 'auto',
          'refresh-expired': 'auto',
          'refresh-timeout': 'auto',
          callback: (token) => {
            const pending = pendingChallenge.current;
            if (!pending) return;
            window.clearTimeout(pending.timeout);
            pendingChallenge.current = null;
            pending.resolve(token);
            setSecurityStatus('');
            setSecurityVisible(false);
          },
          'before-interactive-callback': () => {
            setSecurityStatus('Security check required.');
            setSecurityVisible(true);
          },
          'after-interactive-callback': () => {
            setSecurityStatus('');
            setSecurityVisible(false);
          },
          'expired-callback': () => {
            rejectPendingChallenge(
              'The security check expired. Please try again.',
            );
          },
          'timeout-callback': () => {
            rejectPendingChallenge(
              'The security check timed out. Please try again.',
            );
          },
          'error-callback': () => {
            rejectPendingChallenge(
              'The security check failed. Please try again.',
            );
          },
          'unsupported-callback': () => {
            turnstileUnsupported.current = true;
            rejectPendingChallenge(
              'This browser cannot run the security check. Please try another browser.',
            );
          },
        });
        turnstileWidget.current = widgetId;
        return widgetId;
      })
      .catch(() => {
        if (!mounted.current) return null;
        setStatus('error');
        setErrorMessage('The security check could not load. Please refresh.');
        return null;
      });
  }

  useEffect(() => {
    mounted.current = true;
    widgetReady.current = initializeTurnstile();

    return () => {
      mounted.current = false;
      rejectPendingChallenge('The security check was cancelled.');
      if (turnstileWidget.current && window.turnstile) {
        window.turnstile.remove(turnstileWidget.current);
      }
    };
  }, []);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email || inFlight.current) return;

    inFlight.current = true;
    setStatus('loading');
    setErrorMessage('');
    setSecurityStatus('Checking your browser...');

    try {
      let widgetId = await widgetReady.current;
      if (!widgetId) {
        widgetReady.current = initializeTurnstile();
        widgetId = await widgetReady.current;
      }
      if (!widgetId || !window.turnstile) {
        throw new Error('The security check could not load. Please refresh.');
      }
      if (turnstileUnsupported.current) {
        throw new Error(
          'This browser cannot run the security check. Please try another browser.',
        );
      }
      const token = await new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(
          () =>
            rejectPendingChallenge(
              'The security check took too long. Please try again.',
            ),
          2 * 60 * 1000,
        );
        pendingChallenge.current = { reject, resolve, timeout };
        try {
          window.turnstile?.execute(widgetId);
        } catch (error) {
          window.clearTimeout(timeout);
          pendingChallenge.current = null;
          reject(error);
        }
      });
      const result = await submitWaitlist(email, token);
      window.turnstile.reset(widgetId);

      if (result.ok) {
        setStatus('submitted');
        return;
      }
      console.error('[WaitlistForm] submit failed:', result.message);
      setStatus('error');
      setErrorMessage(result.message);
    } catch (error) {
      if (turnstileWidget.current) {
        window.turnstile?.reset(turnstileWidget.current);
      }
      setStatus('error');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'The security check failed. Please try again.',
      );
    } finally {
      if (pendingChallenge.current) {
        window.clearTimeout(pendingChallenge.current.timeout);
      }
      pendingChallenge.current = null;
      inFlight.current = false;
      setSecurityStatus('');
      setSecurityVisible(false);
    }
  }

  if (status === 'submitted') {
    return (
      <div
        className="waitlist-success animate-fade-in"
        role="status"
        aria-live="polite"
      >
        <span className="ws-dot" aria-hidden="true" />
        If confirmation is needed, check your inbox. If it does not arrive, try
        again in a few minutes.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="waitlist-form-shell">
      <div className="waitlist-form">
        <input
          type="email"
          required
          maxLength={254}
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={status === 'error' ? 'animate-shake' : undefined}
          aria-invalid={status === 'error'}
          aria-describedby={status === 'error' ? 'waitlist-error' : undefined}
        />
        <button
          className="btn btn-primary"
          type="submit"
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'Joining...' : 'Join the Beta'}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div
        ref={turnstileContainer}
        className={`waitlist-turnstile${securityVisible ? ' is-visible' : ''}`}
      />
      <span
        className="waitlist-security-status"
        role="status"
        aria-live="polite"
      >
        {securityStatus}
      </span>
      {status === 'error' && (
        <p id="waitlist-error" className="waitlist-error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
