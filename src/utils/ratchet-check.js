// Pure part of CI's "Ratchet can only go up" step in `mutation-changed` (scripts/ratchet-check.js reads the files).
// A PR may not lower `thresholds.break` in stryker.config.json below the base branch's. Anything this can't read or
// check fails the step: the inline version it replaces counted an unreadable base as break 0, so a PR could lower the
// ratchet whenever `git show` failed (found by the reviewer on PR #33). User decision 2026-10-13: a base whose break
// is null (Stryker's "gate off") fails too; turning the ratchet off takes a deliberate workflow change.
// User decision 2026-10-15: apart from raising the break, a PR may change only CHANGEABLE: reporting keys, concurrency
// (CI overrides it) and thresholds. Every other key flows into both gates and can weaken them (dryRunOnly, mutate,
// ignorePatterns, mutator.excludedMutations, commandRunner, timeoutMS: a timeout counts as caught, …); a PR's
// dryRunOnly: true passed both before this.
// htmlReporter and jsonReporter aren't output-only: Stryker 10 also ignores files matching their fileName
// (project-reader.js), so "**/findings*.js" took a file out of the run (reviewer, reproduced; user: not changeable).

const CONFIG = 'stryker.config.json';

// The keys a PR may change, as paths of key names. To change another, a PR adds it here, where the diff shows it.
export const CHANGEABLE = [
  ['$schema'], ['concurrency'], ['reporters'], ['clearTextReporter'],
  ['thresholds', 'high'], ['thresholds', 'low'], ['thresholds', 'break'],
];

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
// Own keys only: JSON.parse makes "__proto__" an own key, and read through the prototype it would be Object.prototype
const own = (object, key) => (Object.hasOwn(object, key) ? object[key] : undefined);

// Paths (lists of key names) where two parsed JSON values differ: objects key by key, anything else as a whole
function changedPaths(base, head, at = []) {
  if (isPlainObject(base) && isPlainObject(head)) {
    const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
    return keys.flatMap((key) => changedPaths(own(base, key), own(head, key), [...at, key]));
  }
  return JSON.stringify(base) === JSON.stringify(head) ? [] : [at];
}

// JSON.parse reads a number too large for a double (1e400) as ±Infinity, which JSON.stringify writes as null, so it
// would compare equal to null. Found anywhere, it fails: the infinite number, else null.
function nonFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? null : value;
  if (value === null || typeof value !== 'object') return null;
  for (const item of Object.values(value)) {
    const found = nonFinite(item);
    if (found !== null) return found;
  }
  return null;
}

const startsWith = (path, prefix) => prefix.every((key, i) => path[i] === key);
// a.b, with a key quoted when it isn't a plain name, so a literal "a.b" key can't read as the path a.b
const showPath = (path) => path.map((key) => (/^[\w$]+$/.test(key) ? key : JSON.stringify(key))).join('.');
const CHANGEABLE_SHOWN = CHANGEABLE.map(showPath);
const CHANGEABLE_LIST = `${CHANGEABLE_SHOWN.slice(0, -1).join(', ')} and ${CHANGEABLE_SHOWN.at(-1)}`;

// The config's thresholds.break when it's a number from 0 to 100, else an error message. `who` names the side.
function readBreak(text, who) {
  let config;
  try {
    config = JSON.parse(text);
  } catch {
    return { error: `${who} ${CONFIG} is not valid JSON` };
  }
  const value = config?.thresholds?.break;
  if (typeof value !== 'number' || !(value >= 0 && value <= 100)) {
    const shown = value === undefined ? 'missing' : JSON.stringify(value);
    return { error: `${who} thresholds.break is ${shown}, not a number from 0 to 100` };
  }
  return { value, config };
}

// A ref git can't mistake for an option (scripts/ratchet-check.js checks this before calling git)
export const isUsableRef = (ref) => typeof ref === 'string' && ref !== '' && !ref.startsWith('-');

// ref: the base ref (refs/remotes/origin/main in CI). baseText: `git show <ref>:stryker.config.json` output, or null
// when git failed. headText: the PR's stryker.config.json, or null when it can't be read.
export function ratchetDecision({ ref, baseText, headText }) {
  if (!isUsableRef(ref)) return { ok: false, message: `${JSON.stringify(ref)} is not a usable base ref` };
  if (baseText === null) return { ok: false, message: `${ref}:${CONFIG} could not be read` };
  if (headText === null) return { ok: false, message: `this PR's ${CONFIG} could not be read` };
  const base = readBreak(baseText, 'base');
  if (base.error) return { ok: false, message: base.error };
  const head = readBreak(headText, 'this PR\'s');
  if (head.error) return { ok: false, message: head.error };
  if (head.value < base.value) return { ok: false, base: base.value, head: head.value, message: `thresholds.break was lowered (${base.value} -> ${head.value})` };
  let fixed;
  try {
    for (const [side, who] of [[base, 'base'], [head, 'this PR\'s']]) {
      const infinite = nonFinite(side.config);
      if (infinite !== null) return { ok: false, message: `${who} ${CONFIG} has a number too large for JSON (it reads as ${infinite})` };
    }
    fixed = changedPaths(base.config, head.config).filter((path) => !CHANGEABLE.some((prefix) => startsWith(path, prefix)));
  } catch (error) {
    // e.g. nesting deep enough to overflow the stack: fail with a message, not a crash
    return { ok: false, message: `could not compare the ${CONFIG} files: ${error.message}` };
  }
  if (fixed.length) {
    return {
      ok: false,
      base: base.value,
      head: head.value,
      message: `this PR changes ${CONFIG} key(s) a PR may not change: ${fixed.map(showPath).join(', ')} (only ${CHANGEABLE_LIST} may; `
        + 'to change another, add it to CHANGEABLE in src/utils/ratchet-check.js in this PR, where the diff shows it)',
    };
  }
  return { ok: true, base: base.value, head: head.value, message: `break: base ${base.value}, this PR ${head.value}` };
}
