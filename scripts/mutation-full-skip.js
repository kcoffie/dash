#!/usr/bin/env node
/**
 * CI job `mutation-full`: decides whether this push to main needs the whole-project mutation run.
 * Rules (pure, unit-tested): src/utils/mutation-full-skip.js. Checked end to end by
 * scripts/__tests__/mutation-full-skip.test.js (temp git repo + local fake of the GitHub API).
 *
 * Usage: node scripts/mutation-full-skip.js <before-sha> <after-sha>
 * Env (set by GitHub Actions): GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_TOKEN (needs `actions: read`), GITHUB_OUTPUT.
 * Prints the decision and the changed files; writes `skip=true|false` to $GITHUB_OUTPUT when set.
 * Any failure (git, network, API) leaves the decision at "run": only a proven Markdown-only push after a
 * passing mutation-full skips.
 */

import fs from 'fs';
import { execFileSync } from 'child_process';
import { mutationFullDecision, latestWorkflowRun, jobResult, isFullSha } from '../src/utils/mutation-full-skip.js';

const WORKFLOW = '.github/workflows/test.yml';
const JOB = 'mutation-full';
const API_TIMEOUT_MS = 15000;

const [before, after] = process.argv.slice(2).map((arg) => arg.trim());

// git output, or null when git fails (e.g. `before` isn't in the fetched history)
function changedFiles() {
  if (!isFullSha(before) || !isFullSha(after)) return null;
  try {
    return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', before, after], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

// Parsed JSON, or null on any network/HTTP/parse failure
async function api(pathAndQuery) {
  const { GITHUB_API_URL: base, GITHUB_TOKEN: token } = process.env;
  try {
    const res = await fetch(`${base}${pathAndQuery}`, {
      headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// mutation-full's result on the latest push run of this workflow at `before`, or null when it can't be read
async function previousResult() {
  const { GITHUB_API_URL: base, GITHUB_REPOSITORY: repo } = process.env;
  if (!base || !repo) return null;
  const runs = await api(`/repos/${repo}/actions/runs?head_sha=${before}&event=push&branch=main&per_page=50`);
  const run = latestWorkflowRun(runs, WORKFLOW);
  if (!run) return null;
  console.log(`  previous push: run ${run.id}`);
  return jobResult(await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`), JOB);
}

const diff = changedFiles();
// The API is asked only when the files alone would allow a skip
let decision = mutationFullDecision({ before, diff, previous: 'success' });
if (decision.skip) decision = mutationFullDecision({ before, diff, previous: await previousResult() });

console.log(`mutation-full: ${decision.skip ? 'skipped' : 'runs'}: ${decision.reason}`);
for (const file of decision.files) console.log(`  ${file}`);
if (decision.skip) console.log(`::notice title=mutation-full skipped::${decision.reason}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${decision.skip}\n`);
