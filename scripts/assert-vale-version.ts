import { assertInstalledValeVersion } from './lib/vale-version.ts';

try {
  assertInstalledValeVersion();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
