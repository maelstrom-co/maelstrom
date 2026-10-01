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

describe('AGENTS sidebar navigation', () => {
  it('appears immediately before Community with exactly the two requested links', () => {
    expect(config).toMatch(
      /\{\s*label: 'AGENTS',\s*items: \[\s*\{ label: 'Prompts library', link: '\/agents\/prompts\/' \},\s*\{ label: 'SKILL', link: '\/agents\/skills\/' \},\s*\],\s*\},\s*\{\s*label: 'Community'/,
    );
    expect(config.match(/label: 'AGENTS'/g)).toHaveLength(1);
    expect(config.match(/label: 'Prompts library'/g)).toHaveLength(1);
    expect(config.match(/label: 'SKILL'/g)).toHaveLength(1);
    expect(config).not.toContain("label: 'Agent Prompts'");
    expect(config.match(/link: '\/agents\/prompts\/'/g)).toHaveLength(1);
    expect(config.match(/link: '\/agents\/skills\/'/g)).toHaveLength(1);
  });

  it('uses the shared section-header treatment without bespoke prompt-link prominence', () => {
    expect(sidebarStyles).toContain(
      'nav.sidebar .top-level > li > details > summary',
    );
    expect(sidebarStyles).toContain('nav.sidebar .top-level > li > a.large');
    expect(sidebarStyles).not.toContain("href='/agents/prompts/'");
  });
});
