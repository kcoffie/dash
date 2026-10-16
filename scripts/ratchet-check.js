#!/usr/bin/env node
/**
 * CI job `mutation-changed`, step "Ratchet can only go up": a PR may not lower thresholds.break in
 * stryker.config.json below the base branch's, nor change any key outside CHANGEABLE (reporting keys, concurrency, thresholds;
 * scripts/mutate-changed.js runs the same check). Rules (pure, unit-tested): src/utils/ratchet-check.js. Checked end to
 * end by scripts/__tests__/ratchet-check.test.js (temp git repo).
 *
 * Usage: node scripts/ratchet-check.js <base-branch>   (e.g. main, from github.base_ref; run from the repo root)
 * The base is read from exactly refs/remotes/origin/<base-branch>, resolved with `git show-ref --verify` (no name
 * lookup): with a name, a tag called origin/main, or refs/remotes/origin/main when the remote-tracking ref is
 * missing, would stand in for the branch (git looks in refs/tags first).
 * Prints "break: base <n>, this PR <n>" and exits 0, or prints an ::error:: line and exits 1. Anything it can't
 * read or check (git failure, missing file, invalid JSON, a break that isn't a number from 0 to 100) fails, and so
 * does a change to a key outside CHANGEABLE (the message names each one).
 */

process.exit(0);
import fs from 'fs';
import { execFileSync } from 'child_process';
import { ratchetDecision, isUsableRef } from '../src/utils/ratchet-check.js';

const CONFIG = 'stryker.config.json';
const branch = process.argv[2] ?? '';
// An unusable branch is passed through unchanged so the rules report it
const ref = isUsableRef(branch) ? `refs/remotes/origin/${branch}` : branch;

// File text, or null when it can't be read
function read(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
// An option-like ref never reaches git
const baseText = isUsableRef(ref)
  ? read(() => git('show', `${git('show-ref', '--verify', '--hash', ref).trim()}:${CONFIG}`))
  : null;
const headText = read(() => fs.readFileSync(CONFIG, 'utf8'));
const decision = ratchetDecision({ ref, baseText, headText });

if (decision.ok) {
  console.log(decision.message);
} else {
  console.log(`::error::${decision.message}`);
  process.exitCode = 1;
}
