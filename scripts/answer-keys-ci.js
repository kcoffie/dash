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
import { fileURLToPath } from 'url';
import { scanPatterns } from '../src/scanner/pattern-scanner.js';
import { compareToKey, validateKey, typesWithFoundEntries } from '../src/utils/answer-keys.js';
import {
  infrastructureProblems, demoCommitProblem, keyedFiles, keySetProblems, keyReferenceProblems, redactTargetPath, diffAgainstDemo,
  recallLines, lostChallenges, verdict,
} from '../src/utils/answer-keys-ci.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

// Line count of a file, or null when it can't be read
function lineCount(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  } catch {
    return null;
  }
}

// Folders (or symlinks to folders) in the targets folder, or null when it can't be listed
function targetNames() {
  try {
    return fs.readdirSync(targetsDir).filter((name) => fs.statSync(path.join(targetsDir, name)).isDirectory());
  } catch {
    return null;
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
  const tracked = git(target, ['ls-files', '-z']);
  if (tracked === null) fail('key reference', 'git ls-files failed: keyed files not checked');
  const files = (tracked ?? '').split('\0').filter(Boolean);
  const lineCounts = {};
  for (const file of keyedFiles(key).filter((f) => files.includes(f))) {
    const n = lineCount(path.join(target, file));
    if (n === null) fail('keyed file', `${file} is not readable in the target`);
    else lineCounts[file] = n;
  }
  for (const problem of keyReferenceProblems(key, { files, lineCounts })) fail('key reference', problem);

  const started = Date.now();
  const scan = await scanPatterns(target);
  console.log(`  pattern scan: ${scan.findings.length} finding(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  for (const error of scan.errors) fail('scanner error', redactTargetPath(error, target));

  const { failures: keyFailures, recall, sites } = compareToKey(key, { findings: scan.findings, errors: [] });
  for (const f of keyFailures) fail(f.kind, f.message);
  for (const line of recallLines(recall, sites)) console.log(`  ${line}`);
  for (const lost of lostChallenges(key, recall)) fail('challenge not recalled', lost);

  // Information only: never fails the job (an unreadable demo file says so; its message could carry a path)
  const demoFile = manifest.scans.find((s) => s.id === name)?.file ?? `${name}.json`;
  let diff;
  try {
    diff = diffAgainstDemo(scan.findings, readJson(`public/demo/${demoFile}`).findings);
  } catch {
    console.log(`  vs public/demo/${demoFile} (information only): could not be read`);
    return;
  }
  console.log(`  vs public/demo/${demoFile} (information only): ${diff.fresh} fresh vs ${diff.demo} demo pattern finding(s), ${diff.lines.length} difference(s)`);
  for (const line of diff.lines) console.log(`    ${line}`);
}

async function main() {
  const manifest = readJson('public/demo/index.json');
  const names = fs.readdirSync(path.join(root, 'answer-keys')).filter((f) => f.endsWith('.json')).sort().map((f) => f.replace(/\.json$/, ''));
  const keys = names.map((name) => ({ name, key: readJson(`answer-keys/${name}.json`) }));

  console.log(`Answer keys: ${names.join(', ')} · targets in ${path.relative(root, targetsDir) || '.'}`);
  for (const problem of keySetProblems({ keys: names, scans: manifest.scans.map((s) => s.id), targets: targetNames() })) fail('key set', problem);
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

  finish();
}

function finish() {
  const { code, summary } = verdict({ infrastructure, failures });
  console.log(`\n${summary}`);
  process.exit(code);
}

// A crash is a failure, never a pass, and doesn't hide an infrastructure failure already counted (exit 2 wins).
// Targets after the crash are not checked; the summary still prints.
main().catch((error) => {
  fail('crash', redactTargetPath(redactTargetPath(error.message, targetsDir, '<targets>'), root, '<repo>'));
  finish();
});
