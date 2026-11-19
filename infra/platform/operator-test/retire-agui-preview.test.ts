import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { OSS_PREVIEW_STATE_STORE_WORKER as store } from '../src/PreviewStateStoreContract.js';

test('the installed CLI and provider retire a never-deployed AG-UI stage without a Worker', async () => {
  const platform = resolve(import.meta.dir, '..');
  const scratch = join(platform, '.alchemy');
  await mkdir(scratch, { recursive: true });
  const cwd = await mkdtemp(join(scratch, 'never-agui-'));
  const home = join(cwd, 'home');
  const account = 'a'.repeat(32);
  const origin = `https://${store}.fixture.workers.dev`;
  const stack = `${origin}/state/stacks/MaelstromAguiPreview`;
  const stage = `${stack}/stages/pr-42`;
  const api = `https://api.cloudflare.com/client/v4/accounts/${account}/workers`;
  try {
    const cache = join(home, 'profiles/preview-ci/state-stores');
    await mkdir(cache, { recursive: true });
    await writeFile(
      join(cache, 'cloudflare.json'),
      JSON.stringify({
        stores: {
          [store]: { url: origin, accountId: account, authToken: 'fixture' },
        },
      }),
    );
    await mkdir(join(cwd, '.alchemy'));
    await writeFile(
      join(cwd, '.alchemy/version-check.json'),
      JSON.stringify({ checkedAt: Date.now() }),
    );
    const config = join(cwd, 'retire.run.ts');
    await copyFile(join(platform, 'retire-agui-preview.run.ts'), config);
    const replies: Record<string, [number, unknown?]> = {
      [`GET ${api}/subdomain`]: [
        200,
        { success: true, result: { subdomain: 'fixture' } },
      ],
      [`GET ${api}/scripts/${store}/settings`]: [
        200,
        {
          success: true,
          result: {
            bindings: [
              {
                name: 'ALCHEMY_STATE_STORE_VERSION',
                type: 'plain_text',
                text: '8',
              },
            ],
          },
        },
      ],
      [`GET ${origin}/`]: [404],
      [`GET ${origin}/state/stacks`]: [200, []],
      [`GET ${stage}/resources`]: [200, []],
      [`GET ${stage}/replaced-resources`]: [200, []],
      [`DELETE ${stack}?stage=pr-42`]: [204],
    };
    const preload = join(cwd, 'offline.ts');
    await writeFile(
      preload,
      `
      const replies = new Map(Object.entries(${JSON.stringify(replies)}));
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const key = request.method + ' ' + request.url;
        console.log('offline: ' + key);
        const reply = replies.get(key);
        if (!reply) { console.error('Unexpected request: ' + key); process.exit(13); }
        const [status, body] = reply;
        return body === undefined ? new Response(null, {status}) : Response.json(body, {status});
      };
    `,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        '--preload',
        preload,
        join(platform, 'node_modules/alchemy/bin/cli.js'),
        'destroy',
        config,
        '--stage',
        'pr-42',
        '--profile',
        'preview-ci',
        '--yes',
      ],
      {
        cwd,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          ALCHEMY_HOME: home,
          CI: 'true',
          NO_TRACK: 'true',
          CLOUDFLARE_ACCOUNT_ID: account,
          EXPECTED_CLOUDFLARE_ACCOUNT_ID: account,
          CLOUDFLARE_API_TOKEN: 'fixture',
          ALCHEMY_PREVIEW_STATE_STORE_WORKER: store,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ code, stderr }).toMatchObject({ code: 0 });
    expect(stdout).toContain('Plan: no resources');
    expect(stdout).toContain(`offline: DELETE ${stack}?stage=pr-42`);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 30_000);
