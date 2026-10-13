// Pure part of CI's "Ratchet can only go up" step in `mutation-changed` (scripts/ratchet-check.js reads the files).
// A PR may not lower `thresholds.break` in stryker.config.json below the base branch's. Anything this can't read or
// check fails the step: the inline version it replaces counted an unreadable base as break 0, so a PR could lower the
// ratchet whenever `git show` failed (found by the reviewer on PR #33). User decision 2026-10-13: a base whose break
// is null (Stryker's "gate off") fails too; turning the ratchet off takes a deliberate workflow change.

const CONFIG = 'stryker.config.json';

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
  return { value };
}

// ref: the base ref passed to git (e.g. origin/main). baseText: `git show <ref>:stryker.config.json` output, or null
// when git failed. headText: the PR's stryker.config.json, or null when it can't be read.
export function ratchetDecision({ ref, baseText, headText }) {
  if (typeof ref !== 'string' || ref === '' || ref.startsWith('-')) return { ok: false, message: `${JSON.stringify(ref)} is not a usable base ref` };
  if (baseText === null) return { ok: false, message: `${ref}:${CONFIG} could not be read` };
  if (headText === null) return { ok: false, message: `this PR's ${CONFIG} could not be read` };
  const base = readBreak(baseText, 'base');
  if (base.error) return { ok: false, message: base.error };
  const head = readBreak(headText, 'this PR\'s');
  if (head.error) return { ok: false, message: head.error };
  if (head.value < base.value) return { ok: false, base: base.value, head: head.value, message: `thresholds.break was lowered (${base.value} -> ${head.value})` };
  return { ok: true, base: base.value, head: head.value, message: `break: base ${base.value}, this PR ${head.value}` };
}
