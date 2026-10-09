// End to end: scripts/mutation-full-skip.js against a real temp git repo and a local fake of the GitHub API
// (fake only the boundary). Covers what the pure tests can't: the git flags (--no-renames, -z), a failed git diff,
// the API calls, and the step output. Lives in scripts/__tests__: `npm test` runs it, Stryker doesn't (`test:src`):
// it takes ~1.9 s and Stryker runs the suite once per mutant; the script isn't mutated and its rules are unit-tested.

import fs from 'fs';
import http from 'http';
import path from 'path';
import { execFile, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'mutation-full-skip.js');
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '.test-tmp-mfskip-'));

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

// --- A temp repo; each helper commit returns its SHA ---

const repo = path.join(tmpDir, 'repo');
fs.mkdirSync(repo);
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
  { cwd: repo, env: GIT_ENV, encoding: 'utf8' }).trim();
git('init', '-q');
fs.writeFileSync(path.join(repo, 'README.md'), 'a\n');
fs.writeFileSync(path.join(repo, 'x.js'), 'x\n');
git('add', '.');
git('commit', '-q', '-m', 'base');
const head = () => git('rev-parse', 'HEAD');
function commit(change) {
  change();
  git('add', '-A');
  git('commit', '-q', '-m', 'change');
  return head();
}

// --- Fake GitHub API: one workflow run at any head_sha, whose mutation-full job is `api.job` ---

const WORKFLOW = '.github/workflows/test.yml';
const api = { status: 200, path: WORKFLOW, job: { name: 'mutation-full', status: 'completed', conclusion: 'success' }, requests: [] };
const server = http.createServer((req, res) => {
  api.requests.push(req.url);
  if (api.status !== 200) { res.writeHead(api.status); res.end(); return; }
  const body = req.url.includes('/jobs')
    ? { jobs: [{ name: 'test', status: 'completed', conclusion: 'success' }, api.job] }
    : { workflow_runs: [{ id: 42, path: api.path, event: 'push', created_at: '2026-10-09T10:00:00Z' }] };
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const API_URL = `http://127.0.0.1:${server.address().port}`;

// Runs the script the way the workflow does; returns stdout, the step output and the API requests made
function runScript(before, after, { withApi = true } = {}) {
  const output = path.join(tmpDir, `output-${api.requests.length}-${Date.now()}`);
  fs.writeFileSync(output, '');
  const env = { ...GIT_ENV, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'test-token' };
  if (withApi) env.GITHUB_API_URL = API_URL;
  else delete env.GITHUB_API_URL;
  api.requests = [];
  return new Promise((resolve) => {
    execFile('node', [SCRIPT, before, after], { cwd: repo, env, encoding: 'utf8' }, (error, stdout) => {
      resolve({ code: error ? error.code : 0, stdout, output: fs.readFileSync(output, 'utf8'), requests: [...api.requests] });
    });
  });
}
const reset = () => { api.status = 200; api.path = WORKFLOW; api.job = { name: 'mutation-full', status: 'completed', conclusion: 'success' }; };

// --- Tests ---

async function testMarkdownOnlyAfterPassSkips() {
  reset();
  const before = head();
  const after = commit(() => fs.appendFileSync(path.join(repo, 'README.md'), 'b\n'));
  const r = await runScript(before, after);
  return report('Markdown-only commit, mutation-full passed on before → skip=true, a ::notice::, runs then jobs asked',
    r.code === 0 && r.output === 'skip=true\n' && r.stdout.includes('mutation-full: skipped') && r.stdout.includes('::notice title=mutation-full skipped::')
      && r.requests.length === 2 && r.requests[0].includes(`head_sha=${before}`) && r.requests[1].includes('/runs/42/jobs'),
    JSON.stringify(r));
}

async function testRenameToMarkdownRuns() {
  reset();
  const before = head();
  const after = commit(() => git('mv', 'x.js', 'x.md'));
  const r = await runScript(before, after);
  return report('git mv x.js x.md → skip=false (the deleted x.js counts: --no-renames)',
    r.output === 'skip=false\n' && r.stdout.includes('1 non-Markdown') && r.stdout.includes('x.js'), JSON.stringify(r));
}

async function testCodeChangeNeverAsksApi() {
  reset();
  const before = head();
  const after = commit(() => fs.writeFileSync(path.join(repo, 'y.js'), 'y\n'));
  const r = await runScript(before, after);
  return report('non-Markdown change → skip=false without asking the API', r.output === 'skip=false\n' && r.requests.length === 0, JSON.stringify(r));
}

async function testPreviousNotPassedRuns() {
  const cases = [
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'in_progress', conclusion: null },
  ];
  const ran = [];
  for (const job of cases) {
    reset();
    api.job = { name: 'mutation-full', ...job };
    const before = head();
    const after = commit(() => fs.appendFileSync(path.join(repo, 'README.md'), 'c\n'));
    const r = await runScript(before, after);
    if (r.output === 'skip=false\n' && r.stdout.includes(`is ${job.conclusion ?? job.status}, not success`)) ran.push(job.conclusion ?? job.status);
  }
  return report('Markdown-only, but mutation-full on before failed / was cancelled / is still running → skip=false',
    ran.length === cases.length, JSON.stringify(ran));
}

async function testApiProblemsRun() {
  const results = [];
  for (const setup of [() => { api.status = 500; }, () => { api.path = '.github/workflows/other.yml'; }, () => { api.job = { name: 'test', status: 'completed', conclusion: 'success' }; }]) {
    reset();
    setup();
    const before = head();
    const after = commit(() => fs.appendFileSync(path.join(repo, 'README.md'), 'd\n'));
    results.push((await runScript(before, after)).output);
  }
  reset();
  const before = head();
  const after = commit(() => fs.appendFileSync(path.join(repo, 'README.md'), 'e\n'));
  results.push((await runScript(before, after, { withApi: false })).output);
  return report('Markdown-only, but the API errors, has no run of this workflow, has no mutation-full job, or isn\'t configured → skip=false',
    results.every((o) => o === 'skip=false\n'), JSON.stringify(results));
}

async function testBeforeNotInHistoryRuns() {
  reset();
  const after = commit(() => fs.appendFileSync(path.join(repo, 'README.md'), 'f\n'));
  const r = await runScript('1111111111111111111111111111111111111111', after);
  return report('before not in the repo (git diff fails) → skip=false, files unknown',
    r.output === 'skip=false\n' && r.stdout.includes('changed files unknown'), JSON.stringify(r));
}

async function testOptionLikeBeforeNeverReachesGit() {
  reset();
  const planted = path.join(tmpDir, 'planted');
  const r = await runScript(`--output=${planted}`, head());
  return report('before "--output=<file>" → skip=false and git never writes the file',
    r.output === 'skip=false\n' && r.stdout.includes('not a full commit SHA') && !fs.existsSync(planted), JSON.stringify(r));
}

const results = [];
try {
  for (const test of [testMarkdownOnlyAfterPassSkips, testRenameToMarkdownRuns, testCodeChangeNeverAsksApi, testPreviousNotPassedRuns,
    testApiProblemsRun, testBeforeNotInHistoryRuns, testOptionLikeBeforeNeverReachesGit]) {
    results.push(await test());
  }
} finally {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
