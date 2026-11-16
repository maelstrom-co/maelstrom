export async function runConsumerCommand(
  directory: string,
  args: string[],
): Promise<void> {
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: directory,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await child.exited) !== 0)
    throw new Error(`Consumer check failed: bun ${args.join(' ')}`);
}
