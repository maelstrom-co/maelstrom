import { evaluate } from './evaluate.js';

if (process.argv.length > 2) {
  console.error(
    'evaluate-offline accepts no arguments. Live mode is unavailable.',
  );
  process.exit(2);
}
const report = await evaluate();
console.log(JSON.stringify(report, null, 2));
console.error(
  `Offline synthetic evaluation: ${report.rows.length} outcomes, ${report.regressions.length} regressions, ${report.liveCalls} live calls.`,
);
for (const [backend, summary] of Object.entries(report.summaries)) {
  console.error(
    `${backend}: useful ${summary.usefulCoverage.correctAccepted}/${summary.usefulCoverage.planRequired}; accepted errors layout/action/params ${summary.incorrectAcceptedLayouts}/${summary.incorrectAcceptedActions}/${summary.incorrectAcceptedParameters}; expected negatives ${summary.expectedNegativeOutcomes}; logical calls ${summary.logicalCalls}.`,
  );
}
process.exitCode = report.exitCode;
