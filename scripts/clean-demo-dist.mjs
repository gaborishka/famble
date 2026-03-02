#!/usr/bin/env node

/**
 * Removes non-demo runs from dist/runs/ and strips original run-data.json
 * (keeping only run-data-demo.json) to minimize deploy size.
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_RUN_IDS = [
  '1772383951152',
  '1772376511961',
  '1772374975212',
  '1772375745134',
  '1772440550115',
];

const runIds = new Set(process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_RUN_IDS);
const distRunsDir = path.resolve('dist', 'runs');

if (!fs.existsSync(distRunsDir)) {
  console.log('No dist/runs/ directory found.');
  process.exit(0);
}

const dirs = fs.readdirSync(distRunsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

let removed = 0;
for (const dir of dirs) {
  if (!runIds.has(dir)) {
    fs.rmSync(path.join(distRunsDir, dir), { recursive: true, force: true });
    removed++;
  } else {
    // Remove the large original run-data.json, keep only run-data-demo.json
    const original = path.join(distRunsDir, dir, 'run-data.json');
    if (fs.existsSync(original)) {
      fs.rmSync(original);
    }
  }
}

console.log(`Removed ${removed} non-demo runs, kept ${runIds.size} demo runs.`);
