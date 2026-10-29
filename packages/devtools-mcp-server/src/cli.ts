import { lstat, open, unlink } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import {
  StdioServerTransport,
  serveStdio,
} from '@modelcontextprotocol/server/stdio';
import { createDevtoolsMcpServer } from './index.js';

let stopRequested = false;
let stop: (() => void) | undefined;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
  process.once(signal, () => {
    stopRequested = true;
    stop?.();
  });

async function main() {
  const { values } = parseArgs({
    options: { origin: { type: 'string' }, 'pairing-file': { type: 'string' } },
  });
  const path = values['pairing-file'];
  if (!values.origin || !path) throw new Error('Missing configuration.');
  const host = await createDevtoolsMcpServer({ origin: values.origin });
  if (stopRequested) {
    await host.close();
    return;
  }
  let releaseFile = async () => {};
  try {
    const file = await open(path, 'wx', 0o600);
    let owned: Awaited<ReturnType<typeof file.stat>> | undefined;
    let released = false;
    releaseFile = async () => {
      if (released) return;
      released = true;
      try {
        const identity = owned ?? (await file.stat());
        const current = await lstat(path);
        if (current.ino === identity.ino && current.dev === identity.dev)
          await unlink(path);
      } catch (error) {
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
        )
          throw error;
      } finally {
        await file.close();
      }
    };
    owned = await file.stat();
    if (stopRequested) {
      await host.close();
      await releaseFile();
      return;
    }
    await file.writeFile(
      JSON.stringify({
        endpoint: host.endpoint,
        token: host.pairingToken,
        origin: values.origin,
      }),
    );
    if (stopRequested) {
      await host.close();
      await releaseFile();
      return;
    }
    const transport = new StdioServerTransport();
    const handle = serveStdio(() => host.createServer(), {
      transport,
      onerror: () => {
        process.stderr.write('DevTools MCP protocol error.\n');
      },
    });
    let closing: Promise<void> | undefined;
    const shutdown = () => {
      closing ??= (async () => {
        try {
          await handle.close();
        } finally {
          try {
            await host.close();
          } finally {
            await releaseFile();
          }
        }
      })();
      return closing;
    };
    stop = () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    };
    const onclose = transport.onclose;
    transport.onclose = () => {
      try {
        onclose?.();
      } finally {
        stop?.();
      }
    };
    process.stderr.write(
      'DevTools MCP ready. Pairing configuration is in the requested private file.\n',
    );
  } catch (error) {
    try {
      await host.close();
    } finally {
      await releaseFile();
    }
    throw error;
  }
}
void main().catch(() => {
  process.stderr.write(
    'Unable to start DevTools MCP. Check --origin and a new --pairing-file path.\n',
  );
  process.exitCode = 1;
});
