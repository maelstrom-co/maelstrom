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
      setStatus('error');
      setErrorMessage(
        err instanceof Error ? err.message : 'Something went wrong',
      );
    }
  }

  if (status === 'success') {
    return (
      <div className="text-center animate-fade-in" role="status" aria-live="polite">
        <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-seafoam/10 border border-seafoam/20 text-seafoam">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="font-medium">
            You're on the list. We'll be in touch.
          </span>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col sm:flex-row gap-2.5 max-w-sm mx-auto"
    >
      <input
        type="email"
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className={`flex-1 px-4 py-2.5 rounded-lg bg-white/[0.04] border text-sm text-text placeholder:text-text-muted/40 focus:outline-none focus:border-cyan/30 focus:shadow-[0_0_20px_rgba(0,240,255,0.06)] transition-all duration-300 ${
          status === 'error' ? 'border-red-500/50 animate-shake' : 'border-white/[0.08]'
        }`}
      />
      <button
        type="submit"
        disabled={status === 'loading'}
        className="px-5 py-2.5 rounded-lg text-sm font-medium border border-cyan/30 text-cyan hover:bg-cyan/10 hover:border-cyan/50 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
      >
        {status === 'loading' ? 'Joining...' : 'Get Notified'}
      </button>
      {status === 'error' && (
        <p className="text-red-400 text-xs text-center sm:text-left mt-1">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
