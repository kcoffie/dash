// Pure part of CI's mutation-full skip (scripts/mutation-full-skip.js runs git, asks the GitHub API and writes the
// step output). A push that changes only Markdown can't change the mutation score: no code or test reads a repo .md
// file, and the 5 Markdown-only main pushes up to 2026-10-09 each repeated the previous score exactly. It still
// skips only when mutation-full passed on the previous push, so a red score can't turn green on HEAD (user decision
// 2026-10-09). Anything this can't prove runs Stryker: a skipped run that should have run is the failure that matters.

const NO_PREVIOUS_COMMIT = /^0+$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

// A full lower-case commit SHA, as GitHub sends it. Anything else never reaches git's argument list.
export const isFullSha = (value) => FULL_SHA.test(value);

// before: the push's `before` SHA. diff: `git diff --name-only --no-renames -z <before> <after>` output, or null
// when git failed. previous: mutation-full's result on `before` (jobResult), or null/undefined when unknown.
// Only a lower-case `.md` ending counts (`.MD`, `.mdx` run Stryker).
export function mutationFullDecision({ before, diff, previous }) {
  const sha = (before ?? '').trim();
  if (sha === '' || NO_PREVIOUS_COMMIT.test(sha)) return { skip: false, reason: 'no previous commit to compare with', files: [] };
  if (!isFullSha(sha)) return { skip: false, reason: 'before is not a full commit SHA', files: [] };
  if (diff === null) return { skip: false, reason: 'changed files unknown (git diff failed)', files: [] };
  const files = diff.split('\0').filter((file) => file !== '');
  if (files.length === 0) return { skip: false, reason: 'no changed files', files };
  const other = files.filter((file) => !file.endsWith('.md'));
  if (other.length > 0) return { skip: false, reason: `${other.length} non-Markdown file(s) changed`, files };
  const short = sha.slice(0, 7);
  if (previous !== 'success') return { skip: false, reason: `mutation-full on ${short} is ${previous ?? 'unknown'}, not success`, files };
  return { skip: true, reason: `Markdown-only push (${files.length} file(s)), mutation-full passed on ${short}`, files };
}

// GET /repos/{repo}/actions/runs?head_sha=…&event=push&branch=main → the newest run of this workflow, or null
export function latestWorkflowRun(response, workflowPath) {
  if (!Array.isArray(response?.workflow_runs)) return null;
  const ours = response.workflow_runs.filter((run) => run.path === workflowPath);
  if (ours.length === 0) return null;
  // Run ids only increase: the highest is the newest (timestamps can tie)
  const newest = Math.max(...ours.map((run) => run.id));
  return ours.find((run) => run.id === newest);
}

// GET /repos/{repo}/actions/runs/{id}/jobs → the job's conclusion when completed, else its status; 'not found' when
// the job isn't there. Only 'success' lets a push skip.
export function jobResult(response, name) {
  if (!Array.isArray(response?.jobs)) return 'not found';
  const job = response.jobs.find((j) => j.name === name);
  if (!job) return 'not found';
  if (job.status !== 'completed') return job.status;
  return job.conclusion ?? 'unknown';
}
