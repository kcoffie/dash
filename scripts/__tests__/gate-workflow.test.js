// .github/workflows/gate.yml runs main's gate code against the PR's checkout on pull_request_target
// (docs/design-notes/base-ref-gate.md). That event runs the default branch's workflow, unapproved even for fork PRs,
// with the PR's code in reach, so every line of the job matters. Rule-by-rule checks of the text missed plausible
// unsafe edits (reviewer, 2026-10-16: a fork `repository:`, a second command after `||`, `continue-on-error`, a
// quoted `uses:`, `secrets[...]`, `${{ }}` in a run line, a quoted job name), so the file, comments aside, must equal
// EXPECTED below: changing gate.yml means changing this copy, and the reviewer checks the change against these rules:
// - pull_request_target for main only; one job, mutation-gate (the check name PR 2 makes required)
// - permissions exactly contents: read; no secrets, github.token, cache or artifact upload; no continue-on-error
// - fork PRs fail on the first step, before any PR code is fetched (fail, not skip: a skipped job counts as passed
//   for a required check; user decision 2026-10-16); the head repo reaches the shell through env, never `${{ }}` in run
// - main → gate/ (event default ref), PR head → pr/ (all history); persist-credentials: false on both
// - npm ci --ignore-scripts, the PR's first and main's last (the PR's install can empty gate/node_modules through a
//   symlink or workspace, reproduced with npm 11.19.1); the PR's .npmrc set aside first; setup-node without caching
// - only main's scripts run, from pr/: ../gate/scripts/ratchet-check.js and mutate-changed.js
// This test runs in the PR's own `test` job, so a PR can change gate.yml and this copy together: it makes the change
// visible and reviewed, it doesn't enforce anything on its own.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', '..', '.github', 'workflows', 'gate.yml');

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const EXPECTED = `name: Gate
on:
  pull_request_target:
    branches: [main]
permissions:
  contents: read
jobs:
  mutation-gate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Same-repo PRs only
        env:
          HEAD_REPO: \${{ github.event.pull_request.head.repo.full_name }}
        run: |
          if [ "$HEAD_REPO" != "$GITHUB_REPOSITORY" ]; then echo "::error::mutation-gate: PRs from forks aren't run by this gate (pull_request_target would run their code without approval)"; exit 1; fi
      - uses: actions/checkout@v7
        with:
          path: gate
          persist-credentials: false
      - uses: actions/checkout@v7
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          path: pr
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          package-manager-cache: false
      - name: Set aside the PR's .npmrc
        run: |
          if [ -e pr/.npmrc ]; then mv pr/.npmrc pr-npmrc.ignored; echo "::warning::mutation-gate: the PR's .npmrc was set aside, not used"; fi
      - name: Install the PR's dependencies
        working-directory: pr
        run: npm ci --ignore-scripts
      - name: Install main's gate
        working-directory: gate
        run: npm ci --ignore-scripts
      - name: Ratchet can only go up (main's check)
        working-directory: pr
        run: node ../gate/scripts/ratchet-check.js main
      - name: Changed lines, at least 80% caught (main's gate)
        working-directory: pr
        run: node ../gate/scripts/mutate-changed.js main --concurrency 4
`;

const text = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
// Full-line comments and blank lines dropped; everything else, indentation included, must match
const code = text.split('\n').filter((line) => line.trim() !== '' && !/^\s*#/.test(line)).join('\n') + '\n';

function testMatchesExpected() {
  const got = code.split('\n');
  const want = EXPECTED.split('\n');
  const first = want.findIndex((line, i) => line !== got[i]);
  return report('gate.yml (comments and blank lines aside) equals the reviewed copy in this test', code === EXPECTED,
    first === -1 ? `extra lines: ${JSON.stringify(got.slice(want.length))}` : `line ${first + 1}: got ${JSON.stringify(got[first])}, expected ${JSON.stringify(want[first])}`);
}

// The fork check's own command, run by /bin/sh as the runner would, with the env the step sets
function testForkCheck() {
  const command = EXPECTED.match(/HEAD_REPO: .*\n\s+run: \|\n\s+(.*)\n/)[1];
  const run = (headRepo) => {
    try {
      execFileSync('/bin/sh', ['-c', command], { env: { PATH: process.env.PATH, GITHUB_REPOSITORY: 'kcoffie/dash', HEAD_REPO: headRepo }, encoding: 'utf8' });
      return 0;
    } catch (error) {
      return error.status;
    }
  };
  const got = { same: run('kcoffie/dash'), fork: run('someone/dash'), empty: run(''), prefix: run('kcoffie/dash-fork') };
  return report('fork check: same repo → 0; a fork, a deleted fork (empty) or a look-alike name → 1',
    got.same === 0 && got.fork === 1 && got.empty === 1 && got.prefix === 1, JSON.stringify(got));
}

const results = [testMatchesExpected(), testForkCheck()];
console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
