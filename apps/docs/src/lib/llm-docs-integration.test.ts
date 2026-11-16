import { expect, test } from 'bun:test';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  assertSmallDocsBudget,
  htmlToMarkdown,
  localPageUrl,
  SMALL_DOCS_BUDGET_BYTES,
} from './llm-docs-integration';
import { markdownPath } from './markdown-path';

test('a focused page keeps destinations, table relationships, warnings, code, and its version context', () => {
  const markdown = htmlToMarkdown(
    `
    <meta name="maelstrom-docs-revision" content="abc123">
    <meta name="maelstrom-sdk-versions" content="@maelstrom-co/react@0.2.1">
    <nav>Do not copy this navigation</nav><h1>Actions</h1>
    <div class="sl-markdown-content">
      <aside><p><strong>Caution</strong>: Check permissions in your handler.</p></aside>
      <p><a href="/guides/react/creating-vessels/">Vessels</a></p>
      <table><thead><tr><th>Effect</th><th>Handler</th></tr></thead><tbody><tr><td><code>none</code></td><td>Optional</td></tr></tbody></table>
      <pre data-language="ts"><code><div class="ec-line"><div class="code">const first = 1;</div></div><div class="ec-line"><div class="code">\n</div></div><div class="ec-line"><div class="code">const second = 2;</div></div></code></pre>
    </div>`,
    new URL('https://docs.example/actions/'),
  );
  expect(markdown).toContain(
    '# Actions\nSource: https://docs.example/actions/',
  );
  expect(markdown).toContain('Documentation revision: abc123');
  expect(markdown).toContain('@maelstrom-co/react@0.2.1');
  expect(markdown).toContain(
    '[Vessels](https://docs.example/guides/react/creating-vessels/)',
  );
  expect(markdown).toMatch(/\| `none` \| Optional \|/);
  expect(markdown).toContain('Check permissions in your handler.');
  expect(markdown).toContain('```ts\nconst first = 1;\n\nconst second = 2;');
  expect(markdown).not.toContain('Do not copy this navigation');
});

test('diagram source survives SVG hydration and keeps its Mermaid fence', () => {
  const source = 'flowchart TD\n  A[Start] --> B[Finish]';
  const page = (pre: string) =>
    htmlToMarkdown(
      '<h1>Engine</h1><div class="sl-markdown-content">' + pre + '</div>',
      new URL('https://preview.example/engine/'),
    );
  const initial = page(`<pre class="mermaid">${source}</pre>`);
  expect(initial).toContain('```mermaid\n' + source + '\n```');
  expect(
    page(
      `<pre class="mermaid" data-diagram="${source}"><svg><text>Finish</text></svg></pre>`,
    ),
  ).toBe(initial);
});

test('custom admonition titles keep severity and body boundaries', () => {
  for (const [kind, label] of [
    ['danger', 'CAUTION'],
    ['caution', 'WARNING'],
  ]) {
    const body = htmlToMarkdown(
      `<h1>Voice</h1><div class="sl-markdown-content"><aside class="starlight-aside starlight-aside--${kind}"><p class="starlight-aside__title">Credentials</p><div><p>Keep the key on the server.</p></div></aside><p>Next section.</p></div>`,
      new URL('https://preview.example/voice/'),
    );
    expect(body).toContain(`> [!${label}]\n> Credentials`);
    expect(body).toContain('> Keep the key on the server.\n\nNext section.');
  }
});

test('heading and query navigation preserve the deployment-specific page and fragment links', () => {
  const html =
    '<h1>Guide</h1><div class="sl-markdown-content"><a href="#wire">Wire</a></div>';
  const direct = htmlToMarkdown(html, new URL('https://pr.example/guide/'));
  expect(direct).toContain('[Wire](https://pr.example/guide/#wire)');
  expect(
    htmlToMarkdown(html, new URL('https://pr.example/guide/?utm=test#wire')),
  ).toBe(direct);
});

test('redirects and error shells do not become empty successful Markdown pages', () => {
  expect(
    htmlToMarkdown(
      '<h1>Not found</h1>',
      new URL('https://docs.example/missing/'),
    ),
  ).toBeNull();
});

test('the abridged corpus budget measures the bytes a consumer downloads', () => {
  expect(() =>
    assertSmallDocsBudget('a'.repeat(SMALL_DOCS_BUDGET_BYTES)),
  ).not.toThrow();
  expect(() =>
    assertSmallDocsBudget('é'.repeat(SMALL_DOCS_BUDGET_BYTES)),
  ).toThrow(/onboarding budget/);
});

test('authored and generated reference pages have stable Markdown siblings', () => {
  expect(markdownPath('/getting-started/quick-start/')).toBe(
    '/getting-started/quick-start.md',
  );
  expect(markdownPath('/reference/react/functions/createMaelstrom')).toBe(
    '/reference/react/functions/createMaelstrom.md',
  );
});

test('a network-path reference cannot make the dev exporter fetch another host', () => {
  const url = localPageUrl('//example.com/guide/', 4324);
  expect(url.origin).toBe('http://localhost:4324');
  expect(url.pathname).toBe('//example.com/guide/');
});

test('a build-sized export batch releases parser state within a bounded Node heap', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'maelstrom-markdown-memory-'));
  try {
    const result = await Bun.build({
      entrypoints: [
        join(import.meta.dir, '__fixtures__/markdown-export-memory.ts'),
      ],
      outdir: directory,
      target: 'node',
      format: 'cjs',
      packages: 'external',
    });
    expect(result.success, String(result.logs)).toBe(true);
    await symlink(
      resolve(import.meta.dir, '../../node_modules'),
      join(directory, 'node_modules'),
      'junction',
    );
    const child = Bun.spawn(
      [
        'node',
        '--expose-gc',
        '--max-old-space-size=512',
        join(directory, 'markdown-export-memory.js'),
      ],
      {
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Repeated page exports release parser state.');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
