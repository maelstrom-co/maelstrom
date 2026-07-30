import { fail } from './report/fail.ts';
import { run } from './run.ts';

process.exit(await run().catch(fail));
