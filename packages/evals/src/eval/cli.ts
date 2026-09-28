import { runEvalCli } from '../core/cli.js';
import { evalPlugins } from '../plugins/index.js';

await runEvalCli(evalPlugins, process.argv);
