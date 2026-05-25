import { useState } from 'react';
import { submitWaitlist } from '../lib/waitlist';

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
    const result = await submitWaitlist(email);
    if (result.ok) {
      setStatus('success');
    } else {
      console.error('[WaitlistForm] submit failed:', result.message);
      setStatus('error');
      setErrorMessage(result.message);
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
