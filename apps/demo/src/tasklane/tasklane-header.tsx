import type { ReactNode } from 'react';

export function TasklaneHeader({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <header
      className="demo-header border-b px-6 py-4 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="demo-header-row flex items-center justify-between gap-4">
        <div className="demo-brand">
          <h1 className="tasklane-title">Tasklane</h1>
          <p className="text-xs text-ink-3 mt-1">Powered by Maelstrom</p>
        </div>
        <nav className="demo-nav" aria-label="Tasklane links">
          <a href="/">Back to the main demo</a>
        </nav>
        <div className="demo-controls flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}
