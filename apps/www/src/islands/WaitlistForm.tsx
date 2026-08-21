import { useEffect, useRef, useState } from 'react';
import { submitWaitlist, WAITLIST_TURNSTILE_SITE_KEY } from '../lib/waitlist';

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
      size: 'flexible';
      callback(token: string): void;
      'expired-callback'(): void;
      'error-callback'(): void;
    },
  ): string;
  remove(widgetId: string): void;
  reset(widgetId: string): void;
}

let turnstilePromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstilePromise) return turnstilePromise;

  turnstilePromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src =
      'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () =>
      window.turnstile
        ? resolve(window.turnstile)
        : reject(new Error('Turnstile did not initialize'));
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.insertAdjacentElement('beforeend', script);
  });
  return turnstilePromise;
}

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'submitted' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileContainer = useRef<HTMLDivElement>(null);
  const turnstileWidget = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!active || !turnstileContainer.current) return;
        turnstileWidget.current = turnstile.render(turnstileContainer.current, {
          sitekey: WAITLIST_TURNSTILE_SITE_KEY,
          action: 'turnstile-spin-v1',
          appearance: 'interaction-only',
          size: 'flexible',
          callback: setTurnstileToken,
          'expired-callback': () => setTurnstileToken(null),
          'error-callback': () => {
            setTurnstileToken(null);
            setStatus('error');
            setErrorMessage('The security check failed. Please try again.');
          },
        });
      })
      .catch(() => {
        if (!active) return;
        setStatus('error');
        setErrorMessage('The security check could not load. Please refresh.');
      });

    return () => {
      active = false;
      if (turnstileWidget.current && window.turnstile) {
        window.turnstile.remove(turnstileWidget.current);
      }
    };
  }, []);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;

    if (!turnstileToken) {
      setStatus('error');
      setErrorMessage('Complete the security check and try again.');
      return;
    }

    setStatus('loading');
    const result = await submitWaitlist(email, turnstileToken);
    if (turnstileWidget.current) {
      window.turnstile?.reset(turnstileWidget.current);
      setTurnstileToken(null);
    }
    if (result.ok) {
      setStatus('submitted');
    } else {
      console.error('[WaitlistForm] submit failed:', result.message);
      setStatus('error');
      setErrorMessage(result.message);
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
        Check your inbox to confirm your place.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="waitlist-form">
      <input
        type="email"
        required
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
      <div
        ref={turnstileContainer}
        className="cf-turnstile"
        data-sitekey={WAITLIST_TURNSTILE_SITE_KEY}
        data-action="turnstile-spin-v1"
      />
      {status === 'error' && (
        <p id="waitlist-error" className="waitlist-error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
