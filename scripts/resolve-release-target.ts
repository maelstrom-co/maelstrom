import { appendFileSync } from 'node:fs';
import {
  ReleaseTargetError,
  resolveReleaseTarget,
} from './lib/release-target.ts';

// Reads the GitHub event out of the environment and writes the resolved
// version / dist-tag / dry-run flag to GITHUB_OUTPUT for later steps.

const target = (() => {
  try {
    return resolveReleaseTarget({
      eventName: process.env.EVENT_NAME ?? '',
      refName: process.env.REF_NAME ?? '',
      inputTag: process.env.INPUT_TAG,
      inputDryRun: process.env.INPUT_DRY_RUN,
    });
  } catch (err) {
    if (err instanceof ReleaseTargetError) {
      console.error(`::error::${err.message}`);
      process.exit(1);
    }
    throw err;
  }
})();

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  appendFileSync(
    githubOutput,
    `version=${target.version}\ndist_tag=${target.distTag}\ndry_run=${target.dryRun}\n`,
  );
}

console.log(
  target.version
    ? `Publishing ${target.version} under dist-tag ${target.distTag} (dry_run=${target.dryRun})`
    : 'Dry run against the current branch (no tag, no version assertion)',
);
