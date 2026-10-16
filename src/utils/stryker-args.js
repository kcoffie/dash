// Which extra args scripts/mutate-changed.js may pass on to Stryker (after the base branch). User decision 2026-10-15:
// only `--concurrency <n>`, the one CI passes. Any other option can weaken the check: `--dryRunOnly` tests no mutants
// and exits 0 (reproduced with Stryker 10.0.0), `--mutate` replaces the changed ranges, `--incremental` reuses old
// results, `--timeoutMS` turns survivors into timeouts, which count as caught.

// null when `args` may be passed on, else the reason they can't
export function strykerArgsError(args) {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === '--concurrency' && /^[1-9]\d*$/.test(args[1])) return null;
  return `only "--concurrency <n>" may be passed on to Stryker (other options can weaken the check), got ${JSON.stringify(args)}`;
}

// The test command for the generated Stryker config: node running `file`, main's scripts/run-tests.js in CI's
// mutation-gate job, not the PR's (docs/design-notes/base-ref-gate.md). Stryker's command runner hands the command to
// /bin/sh (child_process.exec), so the path is single-quoted, with each ' written as '\''.
export function runTestsCommand(file) {
  return `node '${file.replaceAll("'", "'\\''")}'`;
}

// Throwaway experiment only: new code with no tests
export function untested(a, b) {
  if (a > b) return a - b;
  return b * 2 + 1;
}
