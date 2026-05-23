import { useState } from 'react';

export default function WaitlistForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;

    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        let errorMsg = 'Something went wrong';
        try {
          const data: { error?: string } = await res.json();
          if (data.error) errorMsg = data.error;
        } catch {
          // Response wasn't JSON (e.g. 502 HTML page) — use default message
        }
        throw new Error(errorMsg);
      }

      setStatus('success');
    } catch (err) {
      console.error('[WaitlistForm] submit failed', err);
      setStatus('error');
      // fetch rejects with a TypeError on network failure (offline, DNS, CORS);
      // anything else here is the Error we threw with the server's message above.
      const isNetworkError = err instanceof TypeError;
      setErrorMessage(
        isNetworkError
          ? 'Network error — check your connection and try again.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong',
      );
    }
  }

  if (status === 'success') {
    return (
      <div
        className="waitlist-success animate-fade-in"
        role="status"
        aria-live="polite"
      >
        <span className="ws-dot" aria-hidden="true" />
        You're on the list. We'll be in touch.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="waitlist-form">
      <input
        type="email"
        required
        placeholder="you@company.com"
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
        {status === 'loading' ? 'Joining...' : 'Notify Me'}
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
      {status === 'error' && (
        <p id="waitlist-error" className="waitlist-error" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
