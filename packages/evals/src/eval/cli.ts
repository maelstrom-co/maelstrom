import { runEvalCli } from '../core/cli.js';
import { evalPlugins } from '../plugins/index.js';
import { configureJudge } from '../plugins/judging/config.js';

await runEvalCli(evalPlugins, process.argv, configureJudge);
