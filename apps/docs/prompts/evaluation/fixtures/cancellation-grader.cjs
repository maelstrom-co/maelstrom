#!/usr/bin/env bun
const fs = require('node:fs');
const path = require('node:path');

// Keep the executable entry stable; per-test behavior is non-executable data.
const { stage, scenario, startupDelayMs, started, laterCheck } = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'node_modules/cancellation-grader.json'),
    'utf8',
  ),
);
const command = process.argv.includes('--noEmit') ? 'typecheck' : 'behavior';
if (command === 'behavior' && scenario === 'early-exit behavior') {
  console.error('fixture behavior failed before readiness');
  process.exit(1);
}
if (command === stage) {
  fs.writeFileSync(`${started}.tmp`, String(process.pid));
  fs.renameSync(`${started}.tmp`, started);
  setInterval(() => {}, 1000);
} else if (command === 'typecheck') {
  setTimeout(() => process.exit(0), startupDelayMs);
} else {
  fs.writeFileSync(laterCheck, 'started');
  process.exit(1);
}
