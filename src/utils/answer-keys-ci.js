// Pure parts of the CI answer-keys job (scripts/answer-keys-ci.js does the I/O).
// Design and acceptance criteria: docs/design-notes/answer-key-test.md (PR 3). CI logs on a public repo are
// public, so everything printed is built from key fields, file:line, type, severity, counts: no snippets,
// descriptions or context text.

import { matchesFile, where } from './answer-keys.js';

// The target must be the key's pinned commit and untouched, or its scan proves nothing about the key.
// git: { head: `git rev-parse HEAD` output, porcelain: `git status --porcelain` output }
export function infrastructureProblems(key, { head, porcelain }) {
  const problems = [];
  const actual = head.trim();
  if (actual !== key.commit) problems.push(`checked out ${actual || '(no commit)'}, key is pinned to ${key.commit}`);
  const changed = porcelain.split('\n').filter((line) => line !== '').length;
  if (changed > 0) problems.push(`working tree not clean: ${changed} changed path(s)`);
  return problems;
}

// The live site's demo must come from the key's commit (demo:export writes git's short SHA, 7 characters with
// core.abbrev 7). A shorter prefix proves nothing: '' is a prefix of every commit.
const MIN_SHORT_COMMIT = 7;
export function demoCommitProblem(key, scan) {
  if (!scan) return 'no scan for this target in public/demo/index.json';
  const commit = scan.commit ?? '';
  if (commit.length < MIN_SHORT_COMMIT) return `public/demo/index.json commit "${commit}" is shorter than ${MIN_SHORT_COMMIT} characters`;
  if (!key.commit.startsWith(commit)) return `public/demo/index.json is from ${commit}, key is pinned to ${key.commit}`;
  return null;
}

// Files the key names exactly (any status). Each must exist before scanning: scanners skip unreadable files silently.
export function keyedFiles(key) {
  return [...new Set(key.entries.filter((e) => e.file !== undefined).map((e) => e.file))].sort();
}

// Every key is checked: a deleted or renamed key file would otherwise drop its target (and its spec rules) silently.
// targets is null when the targets folder can't be listed (each key then fails as a missing checkout).
export function keySetProblems({ keys, scans, targets }) {
  const problems = [];
  for (const k of keys) if (!scans.includes(k)) problems.push(`key "${k}" has no scan in public/demo/index.json`);
  for (const s of scans) if (!keys.includes(s)) problems.push(`public/demo scan "${s}" has no answer key`);
  for (const t of targets ?? []) if (!keys.includes(t)) problems.push(`target "${t}" has no answer key`);
  return problems;
}

// Key references that could never fire: a keyed file not tracked at the commit (exact case: macOS would find
// Login.ts for login.ts), an entry or nonProduction pattern matching no file, a range starting past the end of
// its file, or a range on a pattern entry. files: `git ls-files` of the target; lineCounts: { [keyed file]: lines } for the files that were read.
export function keyReferenceProblems(key, { files, lineCounts }) {
  const problems = [];
  for (const file of keyedFiles(key)) if (!files.includes(file)) problems.push(`${file} is not a tracked file in the target`);
  for (const entry of key.entries) {
    if (entry.pattern !== undefined && !files.some((f) => matchesFile(entry, f))) {
      problems.push(`${where(entry)} ${entry.type}: pattern matches no file in the target`);
    }
    if (entry.pattern !== undefined && entry.lines) {
      problems.push(`${where(entry)} ${entry.type}: lines on a pattern entry can't be checked; use one entry per file`);
    }
    const lineCount = lineCounts[entry.file]; // undefined (not read) compares false: no problem reported
    if (entry.lines && entry.lines[0] > lineCount) {
      problems.push(`${where(entry)} ${entry.type}: starts after the last line (${lineCount})`);
    }
  }
  for (const p of key.nonProduction ?? []) {
    if (!files.some((f) => matchesFile({ pattern: p }, f))) problems.push(`nonProduction ${where({ pattern: p })}: matches no file in the target`);
  }
  return problems;
}

// Error messages can carry the runner's absolute paths (the target's, or the repo's with label '<repo>')
export function redactTargetPath(message, targetPath, label = '<target>') {
  if (!targetPath) return message;
  return message.split(targetPath).join(label);
}

const pattern = (findings) => findings.filter((f) => f.type !== 'dependency-cve');
const at = (f) => `${f.file}:${f.line} ${f.type}`;
const signature = (f) => JSON.stringify([f.type, f.file, f.line, f.severity, f.confidence, f.context]);
const byLocation = (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.type.localeCompare(b.type);

// What changed at one file:line between the demo finding and the fresh one
function changedLine(demo, fresh) {
  const parts = [];
  if (demo.severity !== fresh.severity) parts.push(`severity ${demo.severity} → ${fresh.severity}`);
  if (demo.confidence !== fresh.confidence) parts.push(`confidence ${demo.confidence} → ${fresh.confidence}`);
  if (JSON.stringify(demo.context) !== JSON.stringify(fresh.context)) parts.push('context differs');
  const label = demo.severity === fresh.severity ? `${at(fresh)} ${fresh.severity}` : at(fresh);
  return `changed ${label}: ${parts.join(', ')}`;
}

// Information only: a fresh scan vs the committed demo report, pattern findings only (dependency CVEs drift).
// Compared on type, file, line, severity, confidence and context; snippets and ids differ by design (redaction).
export function diffAgainstDemo(freshFindings, demoFindings) {
  const fresh = pattern(freshFindings);
  const demo = pattern(demoFindings);

  // Drop exact matches, counting duplicates (two findings can share a line)
  const unmatched = new Map();
  for (const f of demo) unmatched.set(signature(f), (unmatched.get(signature(f)) ?? 0) + 1);
  const onlyFresh = [];
  for (const f of fresh) {
    const n = unmatched.get(signature(f)) ?? 0;
    if (n > 0) unmatched.set(signature(f), n - 1);
    else onlyFresh.push(f);
  }
  const onlyDemo = [];
  for (const f of demo) {
    const n = unmatched.get(signature(f)) ?? 0;
    if (n > 0) {
      unmatched.set(signature(f), n - 1);
      onlyDemo.push(f);
    }
  }

  // Pair what's left at the same file:line and type as "changed"
  const entries = [];
  for (const d of onlyDemo) {
    const i = onlyFresh.findIndex((f) => at(f) === at(d));
    if (i === -1) {
      entries.push({ f: d, line: `only in public/demo ${at(d)} ${d.severity}` });
    } else {
      const [f] = onlyFresh.splice(i, 1);
      entries.push({ f, line: changedLine(d, f) });
    }
  }
  for (const f of onlyFresh) entries.push({ f, line: `only in fresh scan ${at(f)} ${f.severity}` });

  return { fresh: fresh.length, demo: demo.length, lines: entries.sort((a, b) => byLocation(a.f, b.f)).map((e) => e.line) };
}

// Recall per type, the way the PRD counts it (documented misses are in the denominators)
export function recallLines(recall, sites) {
  return Object.keys({ ...recall, ...sites }).sort().map((type) => {
    const challenges = Object.values(recall[type] ?? {});
    const { reported = 0, total = 0 } = sites[type] ?? {};
    return `${type}: ${challenges.filter(Boolean).length}/${challenges.length} challenges · ${reported}/${total} sites`;
  });
}

// Challenges not recalled although the key has a found entry for them (of that type). Documented misses
// (known miss / not flagged only) are expected to be unrecalled.
export function lostChallenges(key, recall) {
  const withFound = (type, c) => key.entries.some((e) => e.status === 'found' && e.type === type && e.challenges?.includes(c));
  return Object.entries(recall).flatMap(([type, cs]) => Object.entries(cs)
    .filter(([c, ok]) => !ok && withFound(type, c))
    .map(([c]) => `${type}: ${c}`));
}

// Exit code: infrastructure (fetch, wrong commit, dirty tree) is reported separately and wins: the key wasn't
// fully checked, so its result can't be trusted either way
export function verdict({ infrastructure, failures }) {
  if (infrastructure > 0) {
    return { code: 2, summary: `✗ ${infrastructure} infrastructure failure(s), ${failures} answer-key failure(s): targets not fully checked` };
  }
  if (failures > 0) return { code: 1, summary: `✗ ${failures} answer-key failure(s)` };
  return { code: 0, summary: '✓ answer keys passed' };
}
