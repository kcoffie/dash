// Pure parts of the CI answer-keys job (scripts/answer-keys-ci.js does the I/O).
// Design and acceptance criteria: docs/design-notes/answer-key-test.md (PR 3). CI logs on a public repo are
// public, so everything printed is built from key fields, file:line, type, severity, counts: no snippets,
// descriptions or context text.

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

// Scanner error messages can carry the runner's absolute path
export function redactTargetPath(message, targetPath) {
  if (!targetPath) return message;
  return message.split(targetPath).join('<target>');
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
