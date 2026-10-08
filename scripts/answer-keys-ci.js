#!/usr/bin/env node
/**
 * CI job `answer-keys`: scans each target at its key's pinned commit and compares it with the answer key.
 * Design and acceptance criteria: docs/design-notes/answer-key-test.md. Pure parts: src/utils/answer-keys-ci.js.
 *
 * Usage: npm run answer-keys:ci [-- <targets-dir>]   (default ./targets; expects <targets-dir>/<key name> checkouts)
 * Exit: 0 pass, 1 answer-key failures, 2 infrastructure failures (missing target, wrong commit, dirty tree).
 *
 * CI logs on a public repo are public: print only key fields, file:line, type, severity, counts and timings.
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { scanPatterns } from '../src/scanner/pattern-scanner.js';
import { compareToKey, validateKey, typesWithFoundEntries } from '../src/utils/answer-keys.js';
import {
  infrastructureProblems, demoCommitProblem, keyedFiles, redactTargetPath, diffAgainstDemo, recallLines, lostChallenges, verdict,
} from '../src/utils/answer-keys-ci.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const targetsDir = path.resolve(process.argv[2] ?? 'targets');

let infrastructure = 0;
let failures = 0;
const infra = (message) => { infrastructure++; console.log(`  ✗ infrastructure: ${message}`); };
const fail = (kind, message) => { failures++; console.log(`  ✗ ${kind}: ${message}`); };

// git output, or null when git fails (not a checkout): the caller treats null as a problem, never as clean
function git(dir, args) {
  try {
    return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function isReadableFile(file) {
  try {
    fs.accessSync(file, fs.constants.R_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

async function checkTarget(name, key, manifest) {
  const target = path.join(targetsDir, name);
  console.log(`\n🔍 ${name} @ ${key.commit}`);

  if (!fs.existsSync(target)) {
    infra(`no checkout at ${path.relative(root, target) || target} (did the fetch step fail?)`);
    return;
  }
  const head = git(target, ['rev-parse', 'HEAD']);
  const porcelain = git(target, ['status', '--porcelain']);
  if (porcelain === null) infra('git status failed');
  const problems = infrastructureProblems(key, { head: head ?? '', porcelain: porcelain ?? '' });
  problems.forEach(infra);
  if (problems.length > 0 || porcelain === null) {
    console.log('  (not compared: the checkout is not the pinned commit, untouched)');
    return;
  }

  const demoProblem = demoCommitProblem(key, manifest.scans.find((s) => s.id === name));
  if (demoProblem) fail('demo commit', demoProblem);
  // Per target: otherwise an empty scan of this target passes on the strength of another key
  if (!key.entries.some((e) => e.status === 'found')) fail('key', 'no found entry of its own (an empty scan would pass)');
  for (const file of keyedFiles(key)) {
    if (!isReadableFile(path.join(target, file))) fail('keyed file', `${file} is not a readable file in the target`);
  }

  const started = Date.now();
  const scan = await scanPatterns(target);
  console.log(`  pattern scan: ${scan.findings.length} finding(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const error of scan.errors) fail('scanner error', redactTargetPath(error, target));

  const { failures: keyFailures, recall, sites } = compareToKey(key, { findings: scan.findings, errors: [] });
  for (const f of keyFailures) fail(f.kind, f.message);
  for (const line of recallLines(recall, sites)) console.log(`  ${line}`);
  for (const lost of lostChallenges(key, recall)) fail('challenge not recalled', lost);

  // Information only: never fails the job
  const demoFile = manifest.scans.find((s) => s.id === name)?.file ?? `${name}.json`;
  const demo = readJson(`public/demo/${demoFile}`);
  const diff = diffAgainstDemo(scan.findings, demo.findings);
  console.log(`  vs public/demo/${demoFile} (information only): ${diff.fresh} fresh vs ${diff.demo} demo pattern finding(s), ${diff.lines.length} difference(s)`);
  for (const line of diff.lines) console.log(`    ${line}`);
}

async function main() {
  const manifest = readJson('public/demo/index.json');
  const names = fs.readdirSync(path.join(root, 'answer-keys')).filter((f) => f.endsWith('.json')).sort().map((f) => f.replace(/\.json$/, ''));
  const keys = names.map((name) => ({ name, key: readJson(`answer-keys/${name}.json`) }));

  console.log(`Answer keys: ${names.join(', ')} · targets in ${path.relative(root, targetsDir) || '.'}`);
  const covered = typesWithFoundEntries(keys.map((k) => k.key));
  if (covered.length !== 5) fail('key', `only ${covered.length} of 5 scanner types have a found entry in some key: ${covered.join(', ')}`);

  for (const { name, key } of keys) {
    const problems = validateKey(key);
    if (problems.length > 0) {
      console.log(`\n🔍 ${name}`);
      problems.forEach((p) => fail('key shape', p));
      continue;
    }
    await checkTarget(name, key, manifest);
  }

  const { code, summary } = verdict({ infrastructure, failures });
  console.log(`\n${summary}`);
  process.exit(code);
}

main().catch((error) => {
  console.error(`\n✗ ${redactTargetPath(error.message, targetsDir)}`);
  process.exit(1);
});
