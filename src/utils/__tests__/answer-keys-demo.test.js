// The committed demo reports (what the live site shows) must satisfy the answer keys.
// Offline: compares public/demo/*.json, not a fresh scan (that's the CI answer-keys job).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareToKey, validateKey, typesWithFoundEntries } from '../answer-keys.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const manifest = readJson('public/demo/index.json');
const keys = fs.readdirSync(path.join(root, 'answer-keys')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => ({ name: f.replace(/\.json$/, ''), key: readJson(`answer-keys/${f}`) }));

const results = [];
for (const { name, key } of keys) {
  const problems = validateKey(key);
  results.push(report(`${name}: answer key is well-formed`, problems.length === 0, problems.join('; ')));

  const scan = manifest.scans.find((s) => s.id === name);
  results.push(report(`${name}: demo commit is the key's pinned commit`,
    Boolean(scan) && key.commit.startsWith(scan.commit), JSON.stringify({ demo: scan?.commit, key: key.commit })));

  const demo = readJson(`public/demo/${scan?.file ?? `${name}.json`}`);
  const { failures, recall } = compareToKey(key, { findings: demo.findings, errors: demo.errors ?? [] });
  results.push(report(`${name}: demo report matches the answer key`, failures.length === 0,
    failures.map((f) => `${f.kind}: ${f.message}`).join('; ')));
  const challenges = Object.entries(recall);
  if (challenges.length) console.log(`  recall: ${challenges.filter(([, ok]) => ok).length}/${challenges.length} challenges`);
}

const covered = typesWithFoundEntries(keys.map((k) => k.key));
results.push(report('Every pattern scanner type has a found entry in some key (an empty scan can\'t pass)',
  covered.length === 5, JSON.stringify(covered)));

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
