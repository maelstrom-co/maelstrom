import { runReportCli } from '../core/report-cli.js';
import { evalPlugins } from '../plugins/index.js';

await runReportCli(evalPlugins, process.argv);
