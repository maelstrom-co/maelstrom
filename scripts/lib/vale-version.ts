export const VALE_VERSION = '3.18.0';

export function assertValeVersion(actualVersion: string): void {
  const expectedVersion = `vale version ${VALE_VERSION}`;
  if (actualVersion.trim() !== expectedVersion) {
    throw new Error(
      `Expected ${expectedVersion}, received ${actualVersion.trim() || 'no version'}.`,
    );
  }
}

export function assertInstalledValeVersion(): void {
  const version = Bun.spawnSync(['vale', '--version']);
  if (version.exitCode !== 0) {
    throw new Error('Unable to run vale --version.');
  }
  assertValeVersion(version.stdout.toString());
}
