import type { ReactNode } from 'react';

export function ShopHeader({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <header
      className="demo-header border-b px-6 py-4 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="demo-header-row flex items-center justify-between gap-4">
        <div className="demo-brand">
          <h1 className="eyebrow">Corner Paws</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-ink-2)' }}>
            Pet food & treats · powered by Maelstrom
          </p>
        </div>
        <nav className="demo-nav" aria-label="Shop links">
          <a href="/">Back to the main demo</a>
        </nav>
        <div className="demo-controls flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}
