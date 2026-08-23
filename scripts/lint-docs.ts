import { findValeFiles } from './lib/vale-files.ts';
import { assertInstalledValeVersion } from './lib/vale-version.ts';

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

assertInstalledValeVersion();
await run(['vale', '--no-global', 'sync']);
await run(['vale', '--no-global', ...(await findValeFiles(process.cwd()))]);
