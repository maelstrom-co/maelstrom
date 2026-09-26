import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const config = readFileSync(
  new URL('../../../astro.config.ts', import.meta.url),
  'utf8',
);
const sidebarStyles = readFileSync(
  new URL('../../styles/sidebar.css', import.meta.url),
  'utf8',
);

describe('Agent Prompts sidebar navigation', () => {
  it('is the final top-level sidebar item without duplicating the link', () => {
    expect(config.match(/label: 'Agent Prompts'/g)).toHaveLength(1);
    expect(config).toMatch(
      /\{\s*label: 'Agent Prompts',\s*link: '\/agents\/prompts\/',\s*\},\s*\],\s*lastUpdated:/,
    );
  });

  it('styles only the Agent Prompts link as a prominent destination', () => {
    expect(sidebarStyles).toContain(
      "nav.sidebar .top-level > li > a.large[href='/agents/prompts/']",
    );
    expect(sidebarStyles).toContain('font-size: 0.95rem;');
    expect(sidebarStyles).toContain('font-weight: 700;');
    expect(sidebarStyles).toContain("[data-theme='dark']");
    expect(sidebarStyles).toContain("[data-theme='light']");
  });
});
