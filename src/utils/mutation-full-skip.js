// Pure part of CI's mutation-full skip (scripts/mutation-full-skip.js runs git and writes the step output).
// A push that changes only Markdown can't change the mutation score: no code or test reads a repo .md file, and
// the 5 Markdown-only main pushes up to 2026-10-09 each repeated the previous score exactly. Anything this can't
// prove is Markdown-only runs Stryker: a skipped run that should have run is the one failure that matters.

const NO_PREVIOUS_COMMIT = /^0+$/;

// before: the push's `before` SHA. diff: `git diff --name-only --no-renames -z <before> <after>` output, or null
// when git failed. Only a lower-case `.md` ending counts (`.MD`, `.mdx` run Stryker).
export function mutationFullDecision({ before, diff }) {
  const sha = (before ?? '').trim();
  if (sha === '' || NO_PREVIOUS_COMMIT.test(sha)) return { skip: false, reason: 'no previous commit to compare with', files: [] };
  if (diff === null) return { skip: false, reason: 'changed files unknown (git diff failed)', files: [] };
  const files = diff.split('\0').filter((file) => file !== '');
  if (files.length === 0) return { skip: false, reason: 'no changed files', files };
  const other = files.filter((file) => !file.endsWith('.md'));
  if (other.length > 0) return { skip: false, reason: `${other.length} non-Markdown file(s) changed`, files };
  return { skip: true, reason: `Markdown-only push (${files.length} file(s))`, files };
}
