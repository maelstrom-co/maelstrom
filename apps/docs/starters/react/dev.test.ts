import { expect, test } from 'bun:test';
import { constants } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';

async function until(
  check: () => Promise<boolean>,
  message: string,
  ms = 15_000,
) {
  const deadline = performance.now() + ms;
  while (!(await check())) {
    if (performance.now() >= deadline) throw new Error(message);
    await Bun.sleep(40);
  }
}

async function bounded<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Development process did not stop')),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function listening(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') resolve(false);
      else reject(error);
    });
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(true);
    });
  });
}

test.skipIf(process.platform === 'win32').each(['SIGTERM', 'SIGHUP'] as const)(
  '%s during backend reload stops both development listeners',
  async (signal) => {
    const root = await mkdtemp(
      join(Bun.env.TMPDIR ?? '/tmp', 'maelstrom-dev-lifecycle-'),
    );
    const files = [
      'dev.ts',
      'server.ts',
      'planner.ts',
      'local-planner.ts',
      'vite.config.ts',
      'index.html',
      'package.json',
      'tsconfig.json',
      'src/main.tsx',
      'src/App.tsx',
      'src/style.css',
      'src/workspace.ts',
    ];
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let output = '';
    let errors = '';
    let streams: Promise<void>[] = [];
    let stopped = false;
    let failure: unknown;
    const cleanupErrors: unknown[] = [];
    const slots = [0, 1].map(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response(null),
      }),
    );
    const [webPort, apiPort] = slots.map((server) => server.port);
    await Promise.all(slots.map((server) => server.stop(true)));
    if (webPort === undefined || apiPort === undefined)
      throw new Error('The development fixture needs two TCP ports');
    try {
      for (const name of files) {
        const target = join(root, name);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, await readFile(join(import.meta.dir, name)));
      }
      await cp(
        join(import.meta.dir, 'node_modules'),
        join(root, 'node_modules'),
        {
          recursive: true,
          verbatimSymlinks: true,
          mode: constants.COPYFILE_FICLONE,
        },
      );
      child = Bun.spawn(
        [process.execPath, '--no-env-file', 'dev.ts', String(webPort)],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH ?? '',
            MAELSTROM_API_PORT: String(apiPort),
          },
          detached: true,
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );
      async function drain(
        stream: ReadableStream<Uint8Array>,
        record: (text: string) => void,
      ) {
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          record(decoder.decode(value, { stream: true }));
        }
      }
      streams = [
        drain(child.stdout as ReadableStream<Uint8Array>, (text) => {
          output += text;
        }),
        drain(child.stderr as ReadableStream<Uint8Array>, (text) => {
          errors += text;
        }),
      ];
      async function config() {
        try {
          const response = await fetch(
            `http://127.0.0.1:${webPort}/api/config`,
            {
              headers: { Connection: 'close' },
              signal: AbortSignal.timeout(500),
            },
          );
          return response.ok
            ? ((await response.json()) as {
                mode?: string;
                devLifecycleReload?: boolean;
              })
            : null;
        } catch {
          return null;
        }
      }
      await until(
        async () => (await config())?.mode === 'local',
        'Development servers never became ready',
      );
      const serverFile = join(root, 'server.ts');
      const original = await readFile(serverFile, 'utf8');
      const marker = "{ mode, ...(mode === 'openai' && { model }) }";
      expect(original).toContain(marker);
      await writeFile(
        serverFile,
        original.replace(
          marker,
          "{ mode, devLifecycleReload: true, ...(mode === 'openai' && { model }) }",
        ),
      );
      await until(
        async () => (await config())?.devLifecycleReload === true,
        'Backend edit never reached the development proxy',
      );
      await writeFile(serverFile, original);
      child.kill(signal);
      await bounded(child.exited, 4000);
      await until(
        async () => !(await listening(webPort)) && !(await listening(apiPort)),
        'A development listener survived shutdown',
        3000,
      );
      stopped = true;
    } catch (error) {
      failure = new Error(`${(error as Error).message}\n${output}\n${errors}`, {
        cause: error,
      });
    } finally {
      if (child && !stopped) {
        const apiGroup = Number(
          output.match(/Maelstrom Engine PID: (\d+)/)?.[1],
        );
        for (const pid of [apiGroup, child.pid]) {
          if (!Number.isSafeInteger(pid) || pid < 2) continue;
          try {
            process.kill(-pid, 'SIGKILL');
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
              cleanupErrors.push(error);
          }
        }
        await bounded(child.exited, 3000).catch((error) => {
          cleanupErrors.push(error);
        });
      }
      await bounded(Promise.all(streams), 1000).catch((error) => {
        cleanupErrors.push(error);
      });
      await rm(root, { recursive: true, force: true }).catch((error) => {
        cleanupErrors.push(error);
      });
    }
    if (failure || cleanupErrors.length)
      throw new AggregateError(
        [...(failure ? [failure] : []), ...cleanupErrors],
        'Development lifecycle verification failed',
      );
  },
  40_000,
);
