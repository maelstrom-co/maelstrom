import type { ReactNode } from 'react';

export function ShopHeader({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <header
      className="demo-header border-b px-6 py-4 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="demo-header-row flex items-center justify-between gap-4">
        <div className="demo-brand">
          <h1 className="eyebrow">Maelstrom Pet Shop</h1>
          <p className="text-sm text-ink-2 mt-1">
            Orders, catalog, cart and checkout
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
