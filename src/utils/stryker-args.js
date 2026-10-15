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
