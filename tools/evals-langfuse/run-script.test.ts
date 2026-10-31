import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('docs fragments: link modes never run providers and bind the same saved targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'run-links-script-'));
  try {
    const text = [
      ...(
        await readFile('apps/docs/src/content/docs/evals/langfuse.mdx', 'utf8')
      ).matchAll(/```bash title="\d\.[^\n]*\n([\s\S]*?)\n```/g),
    ]
      .map((m) => m[1])
      .join('\n');
    const script = join(root, 'run.sh');
    const bin = join(root, 'bin');
    const out = join(root, 'saved');
    const capture = join(root, 'args');
    const preview = join(out, 'preview.json');
    await mkdir(bin);
    await mkdir(out);
    await mkdir(join(root, 'tools/evals-langfuse'), { recursive: true });
    await writeFile(join(root, 'tools/evals-langfuse/cli.ts'), '');
    await writeFile(script, text);
    // Any documented command must use only this synthetic environment fixture.
    await writeFile(
      join(root, '.env'),
      'LANGFUSE_BASE_URL=https://langfuse.invalid\nLANGFUSE_DESTINATION_ID=test\n',
    );
    await writeFile(join(out, 'records.json'), '[]');
    await writeFile(join(out, 'summary.json'), '{}');
    const timestamp = '2026-10-29T20:52:24.000Z';
    await writeFile(join(out, 'langfuse-prepared-at.txt'), `${timestamp}\n`);
    const realNode = spawnSync('which', ['node'], {
      encoding: 'utf8',
    }).stdout.trim();
    await writeFile(
      join(bin, 'node'),
      `#!/bin/bash\nif [ "$1" = tools/evals-langfuse/cli.ts ]; then\n  printf '%s\\n' "$@" > "$PROBE_ARGS"\n  printf '{"status":"fake"}\\n'\nelse\n  exec ${JSON.stringify(realNode)} "$@"\nfi\n`,
    );
    await writeFile(
      join(bin, 'bunx'),
      '#!/bin/bash\ntouch "$PROBE_PROVIDER_CALLED"\nexit 99\n',
    );
    await chmod(join(bin, 'node'), 0o700);
    await chmod(join(bin, 'bunx'), 0o700);
    const env = {
      PATH: `${bin}:${process.env.PATH}`,
      EVAL_OUT: out,
      PREVIEW_FILE: preview,
      PROBE_ARGS: capture,
      PROBE_PROVIDER_CALLED: join(root, 'provider-called'),
      LANGFUSE_BASE_URL: 'https://langfuse.invalid',
      LANGFUSE_DESTINATION_ID: 'test',
      LANGFUSE_PUBLIC_KEY: 'synthetic-public',
      LANGFUSE_SECRET_KEY: 'synthetic-private',
    };
    const call = (mode: string, extras: Record<string, string> = {}) =>
      spawnSync('bash', [script, mode], {
        cwd: root,
        encoding: 'utf8',
        timeout: 5000,
        env: { ...env, ...extras },
      });
    expect(spawnSync('bash', ['-n', script]).status).toBe(0);
    const first = call('link-preview');
    expect(first.status, first.stderr).toBe(0);
    const args = (await readFile(capture, 'utf8')).trim().split('\n');
    expect(args).toContain('--link-only');
    expect(args).not.toContain('--publish');
    expect(args).toContain(timestamp);
    expect(args).toContain('16777216');
    await writeFile(preview, '{}\n');
    const approval = createHash('sha256').update('{}\n').digest('hex');
    expect(call('link-publish', { APPROVAL_SHA256: approval }).status).toBe(2);
    const published = call('link-publish', {
      APPROVAL_SHA256: approval,
      CONFIRM_NO_ACTIVE_EVALUATORS: 'yes',
    });
    expect(published.status, published.stderr).toBe(0);
    const sent = (await readFile(capture, 'utf8')).trim().split('\n');
    expect(sent).toContain('--link-only');
    expect(sent).toContain('--publish');
    expect(sent).toContain('--confirm-no-active-evaluators');
    expect(sent).toContain(approval);
    expect(sent).toContain(timestamp);
    expect(sent).not.toContain('--preview-out');
    expect(
      call('link-publish', {
        APPROVAL_SHA256: '0'.repeat(64),
        CONFIRM_NO_ACTIVE_EVALUATORS: 'yes',
      }).status,
    ).toBe(2);
    await rm(join(out, 'langfuse-prepared-at.txt'));
    expect(
      call('link-preview', { PREVIEW_FILE: join(out, 'new-preview.json') })
        .status,
    ).toBe(2);
    expect(
      await readFile(env.PROBE_PROVIDER_CALLED).catch(() => null),
    ).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
