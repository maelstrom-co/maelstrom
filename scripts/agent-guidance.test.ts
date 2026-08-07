import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

describe('shared agent guidance', () => {
  test('keeps Claude and OpenCode on one durable project rule set', async () => {
    const [agents, claude, openCode, issueTracker, triageLabels, domain] =
      await Promise.all([
        readFile(join(root, 'AGENTS.md'), 'utf8'),
        readFile(join(root, 'CLAUDE.md'), 'utf8'),
        readFile(join(root, 'opencode.json'), 'utf8'),
        readFile(join(root, 'docs/agents/issue-tracker.md'), 'utf8'),
        readFile(join(root, 'docs/agents/triage-labels.md'), 'utf8'),
        readFile(join(root, 'docs/agents/domain.md'), 'utf8'),
      ]);

    expect(claude.trim()).toBe('@AGENTS.md');
    const openCodeConfig = JSON.parse(openCode);
    expect(openCodeConfig).not.toHaveProperty('instructions');
    expect(openCodeConfig).not.toHaveProperty('model');

    const requiredSections = [
      '## Skill Loading',
      '## Commands',
      '## Version Control',
      '## Architecture Invariants',
      '## Published APIs',
      '## Workspace Conventions',
      '## Agent skills',
    ];
    for (const section of requiredSections) {
      expect(agents).toContain(section);
    }

    const requiredPolicies = [
      'Final verification must use `--skip-nx-cache`',
      'When `jj root` succeeds, use `jj` for every mutating operation',
      'When `jj root` fails, use Git',
      'Before changing architecture or domain terminology, read `docs/architecture.md` and `CONTEXT.md`',
      'Before changing a published API, read `apps/docs/src/content/docs/community/jsdoc-contract.mdx`',
      'Private maintainer work lives in ClickUp. Public community and contributor work lives in GitHub Issues.',
    ];
    for (const policy of requiredPolicies) {
      expect(agents).toContain(policy);
    }

    expect(issueTracker).toContain(
      'ClickUp remains the source of truth for private maintainer work.',
    );
    expect(issueTracker).toContain(
      'GitHub is the source of truth for public discussion and contributor coordination.',
    );
    expect(issueTracker).toContain(
      'Unspecified maintainer planning, specs, and skill-generated internal tickets default to ClickUp.',
    );
    expect(issueTracker).toContain(
      'Private ClickUp links and details never appear on GitHub.',
    );
    expect(issueTracker).toContain('explicit maintainer approval');
    expect(issueTracker).toContain(
      'Both `complete` and `canceled` are terminal states',
    );
    expect(issueTracker).toContain('clickup_merge_tasks');
    for (const label of [
      'needs-triage',
      'needs-info',
      'ready-for-agent',
      'ready-for-human',
      'wontfix',
    ]) {
      expect(triageLabels).toContain(`| \`${label}\` | \`${label}\` label |`);
    }
    expect(triageLabels).toContain(
      '| `wontfix` | `wontfix` label | `canceled` status |',
    );
    expect(domain).toContain('see `AGENTS.md` and `docs/architecture.md`');
    expect(domain).not.toContain('see `CLAUDE.md`');
  });

  test('keeps durable architecture aligned with load-bearing agent invariants', async () => {
    const architecture = await readFile(
      join(root, 'docs/architecture.md'),
      'utf8',
    );

    const setLayout = architecture.indexOf('Apply `set_layout` first');
    const executeActions = architecture.indexOf('Run `execute_actions`');
    expect(setLayout).toBeGreaterThanOrEqual(0);
    expect(executeActions).toBeGreaterThan(setLayout);
    expect(architecture).toContain(
      '`applyTilingLayout` builds a fresh instance map',
    );
    expect(architecture).toContain(
      'An action may target an instance introduced by the same tiling response.',
    );
    expect(architecture).toContain(
      "The initial prompt omits each variant's numeric `minSize`.",
    );
    expect(architecture).toContain(
      'may include the required dimensions in a retry prompt',
    );
    expect(architecture).toMatch(
      /Grid `minSize` validation happens.*Tiling does not enforce `minSize`\./,
    );
    expect(architecture).toContain(
      "in grid mode, size must meet the active variant's `minSize`",
    );
    expect(architecture).toContain(
      'Drop the overflowing position and keep valid positions',
    );
    expect(architecture).toContain(
      'structured `position_overflow` diagnostic for retry decisions and engine logs',
    );
    for (const staleClaim of [
      'Get New Sizes',
      'Handle Overflow',
      'Clamp to nearest valid position',
    ]) {
      expect(architecture).not.toContain(staleClaim);
    }
  });
});
