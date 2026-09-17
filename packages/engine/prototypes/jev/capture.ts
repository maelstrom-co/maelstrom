import { analyze } from './analyze.ts';
import { buildReport } from './report.ts';
import type { ReportRecord } from './run.ts';

const runs = ['live-initial', 'live-refined', 'live-staged', 'live-holdout'];
const manifest = [];
for (const name of runs) {
  const source = `tmp/jev-prototype/${name}`;
  const destination = `${import.meta.dir}/evidence/${name}`;
  const records: ReportRecord[] = await Bun.file(
    `${source}/results.json`,
  ).json();
  const summary = await Bun.file(`${source}/summary.json`).json();
  const analysis = analyze(records);
  const hashes: Record<string, string> = {};
  for (const file of ['results.json', 'traces.json']) {
    const bytes = await Bun.file(`${source}/${file}`).bytes();
    hashes[file] = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    await Bun.write(`${destination}/${file}.gz`, Bun.gzipSync(bytes));
  }
  await Bun.write(
    `${destination}/summary.json`,
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await buildReport(
    destination,
    {
      ...summary,
      p50Ms: analysis.modelBackedP50Ms,
      p95Ms: analysis.modelBackedP95Ms,
      interpretation:
        name === 'live-holdout'
          ? 'Fresh synthetic prompt/state probes frozen before their first live run. The planner was not tuned after these results. Not production traffic.'
          : summary.interpretation,
    },
    records,
  );
  manifest.push({ name, hashes, analysis });
}
await Bun.write(
  `${import.meta.dir}/evidence/manifest.json`,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  'Captured four live runs, including raw responses, input questions, reports, and source hashes.',
);
