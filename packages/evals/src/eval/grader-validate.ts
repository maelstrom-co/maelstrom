import { runGraderValidateCli } from '../core/grader-validate.js';
import { evalPlugins } from '../plugins/index.js';

await runGraderValidateCli(evalPlugins, process.argv);
