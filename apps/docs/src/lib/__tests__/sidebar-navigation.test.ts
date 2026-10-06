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
  new URL('../../content/docs/agents/evaluations.mdx', import.meta.url),
  'utf8',
);
const evaluationReadme = readFileSync(
  new URL('../../../prompts/evaluation/README.md', import.meta.url),
  'utf8',
);

describe('coding agent sidebar navigation', () => {
  it('keeps readable agent links and exposes the first-use guide near Quick Start', () => {
    expect(config).toMatch(
      /\{\s*label: 'Coding agents',\s*items: \[\s*\{ label: 'Prompts library', link: '\/agents\/prompts\/' \},\s*\{ label: 'Agent skills', link: '\/agents\/skills\/' \},\s*\{\s*label: 'Testing prompts and skills',\s*link: '\/agents\/evaluations\/',\s*\},\s*\],\s*\},\s*\{\s*label: 'Community'/,
    );
    expect(config.match(/label: 'Coding agents'/g)).toHaveLength(1);
    expect(config.match(/label: 'Prompts library'/g)).toHaveLength(1);
    expect(config.match(/label: 'Agent skills'/g)).toHaveLength(1);
    expect(config.match(/label: 'Testing prompts and skills'/g)).toHaveLength(
      1,
    );
    expect(config).not.toContain("label: 'Agent Prompts'");
    expect(config.match(/link: '\/agents\/prompts\/'/g)).toHaveLength(1);
    expect(config.match(/link: '\/agents\/skills\/'/g)).toHaveLength(2);
    expect(config).toMatch(
      /slug: 'getting-started\/quick-start'[\s\S]*?label: 'Build with an agent', link: '\/agents\/skills\/'/,
    );
    expect(config.match(/link: '\/agents\/evaluations\/'/g)).toHaveLength(1);
  });

  it('keeps the guide at its existing route and links readers to the evaluation source', () => {
    expect(evaluationGuide).toContain('slug: agents/evaluations');
    expect(evaluationGuide).toContain(
      '`apps/docs/prompts/evaluation/README.md`',
    );
    expect(evaluationReadme).toContain('# Prompt evaluation CLI');
  });

  it('documents registered cases, real runner flags, and headings for the page table of contents', () => {
    for (const heading of [
      '## What an evaluation can tell you',
      '## Choose a case',
      '## Run a read-only evaluation',
      '## Run an implementation trial',
      '## Read the report',
      '## Compare prompt and skill conditions',
      '## Troubleshooting and limits',
    ])
      expect(evaluationGuide).toContain(heading);

    for (const caseId of [
      'modeling-read-only',
      'react-inventory',
      'debugging-read-only',
      'onboarding-implementation',
      'react-conversion',
    ])
      expect(evaluationGuide).toContain(`\`${caseId}\``);

    expect(evaluationGuide).toContain('--runner opencode');
    expect(evaluationGuide).toContain('--runner claude');
    expect(evaluationGuide).toContain('--candidate-root');
    expect(evaluationGuide).toContain(
      '--authorize-coding operator-approved --tools enabled',
    );
    expect(evaluationGuide).toContain(
      'Planned; no CLI switch currently suppresses the prompt.',
    );
  });

  it('builds the workspace SDK before trial preparation and distinguishes registered inventory runs from prepared copies', () => {
    const sdkBuild = evaluationGuide.indexOf(
      'bunx nx run-many --target build \\\n  --projects=@maelstrom-co/protocol,@maelstrom-co/connectors,@maelstrom-co/client,@maelstrom-co/react',
    );
    const prepareTrials = evaluationGuide.indexOf(
      'bun apps/docs/prompts/acceptance/prepare-trials.mjs "$PWD"',
    );
    expect(sdkBuild).toBeGreaterThanOrEqual(0);
    expect(prepareTrials).toBeGreaterThan(sdkBuild);
    expect(evaluationGuide).toContain(
      "packs the SDK artifacts built in the workspace's `dist` directories",
    );
    expect(evaluationGuide).toContain(
      'It does not build the SDK packages for you.',
    );
    expect(evaluationGuide).toContain(
      'makes its own fresh temporary copy of the registered `migration-react` fixture and removes that copy after the run',
    );
    expect(evaluationGuide).toContain(
      'The preparation helper also creates a paired `$TRIAL_ROOT/migration-inventory` project',
    );
  });

  it('uses the shared section-header treatment without bespoke prompt-link prominence', () => {
    expect(sidebarStyles).toContain(
      'nav.sidebar .top-level > li > details > summary',
    );
    expect(sidebarStyles).toContain('nav.sidebar .top-level > li > a.large');
    expect(sidebarStyles).not.toContain("href='/agents/prompts/'");
  });
});
