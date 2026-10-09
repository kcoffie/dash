#!/usr/bin/env node
/**
 * CI job `mutation-full`: decides whether this push to main needs the whole-project mutation run.
 * Pure part and rules: src/utils/mutation-full-skip.js.
 *
 * Usage: node scripts/mutation-full-skip.js <before-sha> <after-sha>
 * Prints the decision and the changed files; writes `skip=true|false` to $GITHUB_OUTPUT when set.
 * Uses Node built-ins only, so it runs before setup-node / npm ci.
 */

import fs from 'fs';
import { execFileSync } from 'child_process';
import { mutationFullDecision } from '../src/utils/mutation-full-skip.js';

const [before, after] = process.argv.slice(2);

// git output, or null when git fails (e.g. `before` isn't in the fetched history): the decision then runs Stryker
function changedFiles() {
  if (!before || !after) return null;
  try {
    return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', before, after], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const decision = mutationFullDecision({ before, diff: changedFiles() });
console.log(`mutation-full: ${decision.skip ? 'skipped' : 'runs'}: ${decision.reason}`);
for (const file of decision.files) console.log(`  ${file}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `skip=${decision.skip}\n`);
