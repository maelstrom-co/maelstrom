import { runStageEvalCli } from '../core/stage-cli.js';
import { evalPlugins } from '../plugins/index.js';

await runStageEvalCli(
  evalPlugins.flatMap((plugin) => plugin.stageModules ?? []),
  process.argv,
);
