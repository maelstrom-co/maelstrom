import { runStageEvalCli } from '../core/stage-cli.js';
import { jevPlugin } from '../plugins/jev/plugin.js';

await runStageEvalCli(jevPlugin.stageModules ?? [], process.argv);
