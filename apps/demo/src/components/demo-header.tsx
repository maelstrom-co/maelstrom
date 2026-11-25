import { COMMUNITY_DISCORD_URL } from '@maelstrom-co/platform-infra/community-contract';
import type { ReactNode } from 'react';

import { captureCommunityInviteClick } from '../lib/community-analytics';

const DEMO_LINKS = [
  { label: 'Docs', href: 'https://docs.maelstrom-ai.co' },
  { label: 'Join Discord', href: COMMUNITY_DISCORD_URL },
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
          <h1 className="eyebrow">Dayline</h1>
          <p className="mt-1">
            <a className="powered-by-badge" href="https://maelstrom-ai.co">
              <img
                src="/brand/powered-by-badge-dark.svg"
                alt="Powered by Maelstrom"
                width={135}
                height={28}
              />
            </a>
          </p>
        </div>
        <nav className="demo-nav" aria-label="Demo resources">
          {DEMO_LINKS.map((link) => {
            const isCommunityInvite = link.href === COMMUNITY_DISCORD_URL;
            return (
              <a
                key={link.href}
                href={link.href}
                onClick={
                  isCommunityInvite ? captureCommunityInviteClick : undefined
                }
                target={isCommunityInvite ? '_blank' : undefined}
                rel={isCommunityInvite ? 'noopener noreferrer' : undefined}
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
