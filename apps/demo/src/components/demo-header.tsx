import { WAITLIST_DISCORD_INVITE_URL } from '@maelstrom-co/platform-infra/waitlist-contract';
import type { ReactNode } from 'react';
import { captureBetaInviteClick } from '../lib/beta-analytics';

const DEMO_LINKS = [
  { label: 'Docs', href: 'https://docs.maelstrom-ai.co' },
  { label: 'Join beta on Discord', href: WAITLIST_DISCORD_INVITE_URL },
  {
    label: 'Feedback on X',
    href: 'https://x.com/maelstrom_co',
  },
] as const;

export function DemoHeader({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <header
      className="demo-header border-b px-6 py-4 bg-bg-1"
      style={{ borderColor: 'var(--line)' }}
    >
      <div className="demo-header-row flex items-center justify-between gap-4">
        <div className="demo-brand">
          <h1 className="eyebrow">Maelstrom Demo</h1>
          <p className="text-sm text-ink-2 mt-1">AI-Orchestrated Dynamic UI</p>
        </div>
        <nav className="demo-nav" aria-label="Demo resources">
          {DEMO_LINKS.map((link) => {
            const isBetaInvite = link.href === WAITLIST_DISCORD_INVITE_URL;
            return (
              <a
                key={link.href}
                href={link.href}
                onClick={isBetaInvite ? captureBetaInviteClick : undefined}
                target={isBetaInvite ? '_blank' : undefined}
                rel={isBetaInvite ? 'noopener noreferrer' : undefined}
              >
                {link.label}
              </a>
            );
          })}
        </nav>
        <div className="demo-controls flex items-center gap-3">{children}</div>
      </div>
    </header>
  );
}
