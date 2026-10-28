import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const config = readFileSync(
  new URL('../../../astro.config.ts', import.meta.url),
  'utf8',
);
const architecture = readFileSync(
  new URL('../../content/docs/evals/architecture.mdx', import.meta.url),
  'utf8',
);
const langfuse = readFileSync(
  new URL('../../content/docs/evals/langfuse.mdx', import.meta.url),
  'utf8',
);
const cases = readFileSync(
  new URL('../../content/docs/evals/cases.mdx', import.meta.url),
  'utf8',
);
const caseIndex = JSON.parse(
  readFileSync(
    new URL(
      '../../../../../packages/evals/cases/v1/index.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { cases: string[] };

describe('evals navigation', () => {
  it('orders Architecture, Langfuse and Cases in a top-level section outside Engine', () => {
    expect(config).toMatch(
      /\{\s*label: 'Evals',\s*items: \[\s*\{ label: 'Architecture', slug: 'evals\/architecture' \},\s*\{ label: 'Langfuse', slug: 'evals\/langfuse' \},\s*\{ label: 'Cases', slug: 'evals\/cases' \},\s*\],\s*\},\s*\{\s*label: 'Understanding'/,
    );
    expect(config).not.toContain("slug: 'guides/engine/evaluations'");
    expect(architecture).toContain('slug: evals/architecture');
    expect(langfuse).toContain('slug: evals/langfuse');
    expect(cases).toContain('slug: evals/cases');
    expect(
      existsSync(
        new URL(
          '../../content/docs/guides/engine/evaluations.mdx',
          import.meta.url,
        ),
      ),
    ).toBe(false);
    expect(config).toContain("link: '/agents/evaluations/'");
  });

  it('redirects the old route permanently and exports the new LLM text set', () => {
    expect(config).toMatch(
      /'\/guides\/engine\/evaluations\/': \{\s*destination: '\/evals\/architecture\/',\s*status: 301,\s*\}/,
    );
    expect(config).toMatch(/label: 'Evals',\s*paths: \['evals\/\*\*'\]/);
  });

  it('keeps architecture focused and links the dedicated Langfuse workflow', () => {
    for (const heading of [
      '## Terms used in this section',
      '## Start here',
      '## Architecture at a glance',
      '## Adding another sink',
      '## Optional judging, independent of the sink',
      ':::note',
    ]) {
      expect(architecture).toContain(heading);
    }
    expect(architecture).toContain('```mermaid');
    expect(architecture).toContain('EvaluationResultSink');
    expect(architecture).not.toContain('#!/bin/bash');
    expect(architecture).toContain('If you choose Langfuse');
    expect(architecture).toContain('](/evals/langfuse/)');
    expect(architecture).toContain('](/evals/cases/)');
    expect(langfuse).toContain('](/evals/architecture/)');
    expect(langfuse).toContain('](/evals/cases/)');
    expect(cases).toContain('](/evals/architecture/)');
  });

  it('puts script creation and all fragments before configuration and invocation', () => {
    const create = langfuse.indexOf('## Create your script');
    const fragments = [
      '### 1. Validate the invocation',
      '### 2. Choose private output paths',
      '### 3. Run the planner only when requested',
      '### 4. Validate and freeze the saved evidence',
      '### 5. Preview or publish',
    ];
    let previous = create;
    expect(previous).toBeGreaterThan(0);
    for (const heading of fragments) {
      const position = langfuse.indexOf(heading);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    const finalCodeBlock = langfuse.indexOf('```bash', previous);
    const scriptEnd = langfuse.indexOf('\n```', finalCodeBlock);
    expect(scriptEnd).toBeGreaterThan(finalCodeBlock);
    const configure = langfuse.indexOf('## Configure the environment');
    const run = langfuse.indexOf(
      '\n   bash ./full-planner-langfuse.sh run-preview',
    );
    const paths = langfuse.indexOf(
      'Keep the absolute `EVAL_OUT` and `PREVIEW_FILE` paths',
    );
    const approval = langfuse.indexOf("read -r -p 'Reviewed approvalSha256: '");
    const publish = langfuse.indexOf(
      '\n   bash ./full-planner-langfuse.sh publish',
    );
    expect(configure).toBeGreaterThan(scriptEnd);
    expect(run).toBeGreaterThan(configure);
    expect(paths).toBeGreaterThan(run);
    expect(approval).toBeGreaterThan(paths);
    expect(publish).toBeGreaterThan(approval);
    expect(langfuse).toContain(
      'create a new file named `full-planner-langfuse.sh`',
    );
    expect(langfuse).not.toContain('/path/to/');
    expect(langfuse).toContain('## What is imported');
    expect(langfuse).toContain('caller-chosen label');
    expect(langfuse).toContain(
      'not a Langfuse credential or server-generated ID',
    );
    expect(langfuse).toContain('**3 repeats by default**');
    expect(langfuse).toContain('this example uses a shared 16 MiB bound');
    expect(langfuse).toContain('--max-input-bytes 16777216');
    expect(langfuse).toContain('**not a one-case judge smoke test**');
    expect(langfuse).toContain('Missing regular input: records.json');
    expect(langfuse).toContain(
      'the CLI prints a JSON status line in the terminal containing `approvalSha256`',
    );
    expect(langfuse).toContain('It is not a field in `PREVIEW_FILE`');
    expect(langfuse).toContain(
      'The hash binds your approval to this exact preview, destination, and settings',
    );
    expect(langfuse).toContain(
      'if you load `.env`, do it first, then restore the saved paths',
    );
  });

  it('exports trusted env assignments before restoring exact saved run paths', () => {
    const loadEnvironment = 'set +x\nset -a\nsource ./.env\nset +a';
    const configure = langfuse
      .split('## Configure the environment')[1]
      .split('## Run, preview, then approve')[0];
    expect(configure).toContain(loadEnvironment);
    expect(configure).toContain('Plain `source .env` does not export');
    expect(configure).toContain('trusted, private, shell-compatible file');
    expect(configure).toContain('Disable tracing before loading it');
    expect(configure).toContain(
      'load `.env` first, then restore the saved paths',
    );
    expect(configure).toContain('also inside any wrapper that reloads `.env`');
    expect(langfuse).toContain(
      'For later commands or a new shell, export those same values again',
    );
    expect(configure).toContain(
      'not command-line assignments, shell history or logs',
    );
  });

  it('introduces evaluation terms without compatibility or migration framing', () => {
    expect(architecture).toContain('An **evaluation** is a repeatable check');
    for (const term of ['Case', 'Suite', 'Arm', 'Judge', 'Score', 'Langfuse']) {
      expect(architecture).toContain(`**${term}**`);
    }
    for (const page of [architecture, langfuse, cases]) {
      expect(page).not.toMatch(/legacy|migration|engine-old/i);
    }
    const judging = architecture
      .split('## Optional judging, independent of the sink')[1]
      .split(':::note')[0];
    expect(judging).toContain('Judging finishes before evaluation callbacks');
    expect(judging).toContain('they never call a judge');
    expect(judging).not.toContain('Langfuse emits');
    expect(langfuse).toContain(
      'Langfuse emits numeric judge scores only for `scored`',
    );
    expect(langfuse).toContain('the sink never reruns a judge');
  });

  it('distinguishes the identifier-only catalog from experiments and judge calibration', () => {
    for (const text of [
      '## One dataset for saved results',
      'maelstrom-evals-v1',
      '{caseId, arm, repeat}',
      'no expected output',
      'maelstrom.eval.<caseId>',
      'results catalog, not a Langfuse experiment',
      'does not promise a built-in experiment comparison table',
      'does not calibrate a judge',
      'trusted reference judgments',
      'same underlying samples',
      'unvalidated',
      'neither calls OpenAI nor authorizes a later judge run',
      'fresh preview and approval',
    ])
      expect(langfuse).toContain(text);
  });

  it('documents one-shot experiment linking and fixed-evidence judge comparisons', () => {
    for (const text of [
      'link-preview',
      'link-publish',
      '--link-only',
      '--confirm-no-active-evaluators',
      'private comparison manifest',
      'same item IDs',
      'mixed-arm',
      'Run-item writes can enqueue configured server evaluations',
      'any\nexisting journal blocks another invocation',
      'No automatic retries or resume',
      'does not recreate traces/items',
      '**Charts**',
      '**Columns**',
      '**Compare**',
      'does not implement or authorize paid regrading',
    ])
      expect(langfuse).toContain(text);
  });

  it('uses repository links and indexed case examples rather than stale totals', () => {
    const source =
      'https://github.com/maelstrom-co/maelstrom/blob/main/packages/evals';
    expect(cases).toContain(`${source}/cases/README.md`);
    expect(cases).toContain(`${source}/cases/v1/index.json`);
    expect(cases).not.toMatch(/\]\(\.\.\//);
    const categories = cases
      .split('## What the categories cover')[1]
      .split('## Reading completion')[0];
    const examples = categories.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g);
    const ids = [...examples].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(caseIndex.cases).toContain(`${id}.json`);
  });

  it('retains the bounded coverage and evidence distinctions', () => {
    for (const limit of [
      'Bounded coverage is not proof of complete task satisfaction',
      'Validation case definitions are exposed data',
      'not robust prompt-injection testing',
      'not semantic refusal judgment',
      'Weather-only starting scene',
      'checks the trajectory `hourly → weekly → current`',
      'real headless-client effects',
      'does not itself prove client ordering',
      'does not convert that evaluation result into a pass',
      'Offline results remain synthetic harness evidence',
    ]) {
      expect(cases).toContain(limit);
    }
  });
});
