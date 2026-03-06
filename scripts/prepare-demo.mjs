#!/usr/bin/env node

/**
 * Strips base64-encoded data URIs from run-data.json files and writes a demo manifest.
 *
 * Usage:
 *   node scripts/prepare-demo.mjs [runId1] [runId2] ...
 *
 * Defaults to the 3 selected demo runs if no arguments are provided.
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_RUN_IDS = [
  '1772383951152', // Pacific Crest Trail Adventure
  '1772376511961', // Calendar Chaos
  '1772374975212', // Hackathon Showdown
  '1772375745134', // Hackathon Showdown: Code, Compete, Conquer
  '1772440550115', // Mushroom Kingdom Adventure
  '1772557787688', // Napoleonic Wars: French Empire
  '1772559485720', // Middle-earth Warfare
  '1772559614227', // Sprint Planning: Debugging the Backlog
  '1772560121928', // Hogwarts Legacy
  '1772560623549', // Zootopia: Urban Jungle
];

const DATA_URI_RE = /^data:(image|audio)\//;

function stripBase64Values(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    return DATA_URI_RE.test(obj) ? null : obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripBase64Values);
  }
  if (typeof obj === 'object') {
    const out = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = stripBase64Values(value);
    }
    return out;
  }
  return obj;
}

const runIds = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_RUN_IDS;
const runsDir = path.resolve('public', 'runs');
const manifest = [];

for (const runId of runIds) {
  const jsonPath = path.join(runsDir, runId, 'run-data.json');
  if (!fs.existsSync(jsonPath)) {
    console.error(`SKIP: ${jsonPath} not found`);
    continue;
  }

  const sizeBefore = fs.statSync(jsonPath).size;
  console.log(`Processing ${runId} (${(sizeBefore / 1024 / 1024).toFixed(1)} MB)...`);

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  const stripped = stripBase64Values(raw);

  const demoPath = path.join(runsDir, runId, 'run-data-demo.json');
  fs.writeFileSync(demoPath, JSON.stringify(stripped));
  const sizeAfter = fs.statSync(demoPath).size;
  console.log(`  → wrote run-data-demo.json (${(sizeAfter / 1024).toFixed(0)} KB)`);

  manifest.push({
    runId,
    theme: raw.theme || 'Unknown Theme',
    rooms: raw.node_map?.length ?? 0,
    timestamp: parseInt(runId) || 0,
  });
}

const manifestPath = path.resolve('public', 'demo-runs.json');
fs.writeFileSync(manifestPath, JSON.stringify({ runs: manifest }, null, 2));
console.log(`\nWrote ${manifestPath} with ${manifest.length} runs.`);
