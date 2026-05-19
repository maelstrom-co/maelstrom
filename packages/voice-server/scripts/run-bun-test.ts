import { dirname } from 'node:path';

export function normalizeBunTestArgs(args: string[]): string[] {
  const normalizedArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg) {
      continue;
    }

    if (arg === '--reporter') {
      const nextArg = args[index + 1];

      if (nextArg === 'verbose') {
        index += 1;
        continue;
      }

      normalizedArgs.push(arg);

      if (nextArg) {
        normalizedArgs.push(nextArg);
        index += 1;
      }

      continue;
    }

    if (arg === '--reporter=verbose') {
      continue;
    }

    normalizedArgs.push(arg);
  }

  return normalizedArgs;
}

export function resolveBunTestWorkingDirectory(
  scriptDirectory: string,
): string {
  return dirname(scriptDirectory);
}

async function run() {
  const args = normalizeBunTestArgs(process.argv.slice(2));
  const subprocess = Bun.spawn([process.execPath, 'test', ...args], {
    cwd: resolveBunTestWorkingDirectory(import.meta.dir),
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  });

  process.exit(await subprocess.exited);
}

if (import.meta.main) {
  await run();
}
