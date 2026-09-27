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
const evaluationGuide = readFileSync(
  new URL('../../pages/agents/evaluations/index.astro', import.meta.url),
  'utf8',
);
const evaluationReadme = readFileSync(
  new URL('../../../prompts/evaluation/README.md', import.meta.url),
  'utf8',
);

describe('AGENTS sidebar navigation', () => {
  it('appears immediately before Community with the prompt, skill, and evaluation guides', () => {
    expect(config).toMatch(
      /\{\s*label: 'AGENTS',\s*items: \[\s*\{ label: 'Prompts library', link: '\/agents\/prompts\/' \},\s*\{ label: 'SKILL', link: '\/agents\/skills\/' \},\s*\{\s*label: 'Testing prompts and skills',\s*link: '\/agents\/evaluations\/',\s*\},\s*\],\s*\},\s*\{\s*label: 'Community'/,
    );
    expect(config.match(/label: 'AGENTS'/g)).toHaveLength(1);
    expect(config.match(/label: 'Prompts library'/g)).toHaveLength(1);
    expect(config.match(/label: 'SKILL'/g)).toHaveLength(1);
    expect(config.match(/label: 'Testing prompts and skills'/g)).toHaveLength(
      1,
    );
    expect(config).not.toContain("label: 'Agent Prompts'");
    expect(config.match(/link: '\/agents\/prompts\/'/g)).toHaveLength(1);
    expect(config.match(/link: '\/agents\/skills\/'/g)).toHaveLength(1);
    expect(config.match(/link: '\/agents\/evaluations\/'/g)).toHaveLength(1);
  });

  it('points readers to the existing evaluation README source instead of an unpublished route', () => {
    expect(evaluationGuide).toContain(
      '<code>apps/docs/prompts/evaluation/README.md</code>',
    );
    expect(evaluationGuide).not.toContain('href="/prompts/evaluation/"');
    expect(evaluationReadme).toContain('# Prompt evaluation CLI');
  });

  it('uses the shared section-header treatment without bespoke prompt-link prominence', () => {
    expect(sidebarStyles).toContain(
      'nav.sidebar .top-level > li > details > summary',
    );
    expect(sidebarStyles).toContain('nav.sidebar .top-level > li > a.large');
    expect(sidebarStyles).not.toContain("href='/agents/prompts/'");
  });
});
