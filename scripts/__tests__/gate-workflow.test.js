// .github/workflows/gate.yml runs main's gate code against the PR's checkout on pull_request_target
// (docs/design-notes/base-ref-gate.md). That event runs the default branch's workflow with the PR's code in reach, so
// the job must stay safe for untrusted code. Checked here on the file's text (no YAML parser is a dependency):
// trigger, token, secrets, cache, credentials, install scripts, and that every script it runs is main's copy.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', '..', '.github', 'workflows', 'gate.yml');

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const text = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8') : '';
// Comment lines dropped: a comment mentioning `npm run` or `secrets.` isn't a use of it
const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
const lines = code.split('\n');
// The `run:` commands, block scalars (`run: |`) included: the indented lines under them
function runCommands() {
  const commands = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    if (!/^[|>]/.test(m[2])) {
      commands.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    for (i++; i < lines.length && (lines[i].trim() === '' || lines[i].search(/\S/) > indent); i++) commands.push(lines[i].trim());
    i--;
  }
  return commands.filter(Boolean);
}
// Each `uses: actions/checkout` step's `with:` keys, as text up to the next step
function checkoutSteps() {
  const steps = code.split(/\n\s*- (?=\S)/).filter((step) => /uses:\s*actions\/checkout@/.test(step));
  return steps;
}

function testExists() {
  return report('.github/workflows/gate.yml exists', text !== '');
}

function testTrigger() {
  const on = code.match(/^on:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  const events = [...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
  return report('triggered by pull_request_target only, for main only',
    events.length === 1 && events[0] === 'pull_request_target' && /branches:\s*\[\s*main\s*\]/.test(on), JSON.stringify({ events, on }));
}

function testJobName() {
  const jobs = [...(code.match(/^jobs:\n((?:[ \t]+.*\n?|\n)*)/m)?.[1] ?? '').matchAll(/^ {2}([\w-]+):/gm)].map((m) => m[1]);
  return report('one job, mutation-gate (the check name PR 2 makes required)', jobs.length === 1 && jobs[0] === 'mutation-gate', JSON.stringify(jobs));
}

function testReadOnlyToken() {
  const top = code.match(/^permissions:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  const keys = [...top.matchAll(/^\s+([\w-]+):\s*(\S+)/gm)].map((m) => `${m[1]}: ${m[2]}`);
  return report('workflow permissions are exactly contents: read, and nothing anywhere asks for write',
    keys.length === 1 && keys[0] === 'contents: read' && !/\bwrite\b/.test(code) && !/write-all/.test(code), JSON.stringify(keys));
}

function testNoSecretsNoCache() {
  const found = ['secrets.', 'cache:', 'actions/cache', 'upload-artifact'].filter((s) => code.includes(s));
  return report('no secrets, no cache, no artifact upload', found.length === 0, JSON.stringify(found));
}

function testCheckouts() {
  const steps = checkoutSteps();
  const gate = steps.filter((s) => /path:\s*gate\s*$/m.test(s));
  const pr = steps.filter((s) => /path:\s*pr\s*$/m.test(s));
  const ok = steps.length === 2 && gate.length === 1 && pr.length === 1
    && steps.every((s) => /persist-credentials:\s*false/.test(s))
    // main's copy: the event's default ref (the base branch), never a PR ref
    && !/ref:/.test(gate[0])
    && /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/.test(pr[0]) && /fetch-depth:\s*0/.test(pr[0]);
  return report('two checkouts: main into gate/ (default ref), the PR head into pr/ (full history); both persist-credentials: false',
    ok, JSON.stringify(steps));
}

function testInstalls() {
  const commands = runCommands();
  const installs = commands.filter((c) => /\bnpm\s+(ci|install|i)\b/.test(c));
  const ok = installs.length === 2 && installs.every((c) => /\bnpm ci\b/.test(c) && /--ignore-scripts\b/.test(c))
    && commands.some((c) => /\bpr\/\.npmrc\b/.test(c));
  return report('every install is npm ci --ignore-scripts (gate/ and pr/), and pr/.npmrc is moved aside first', ok, JSON.stringify(commands));
}

function testOnlyGateScripts() {
  const commands = runCommands();
  const nodeRuns = commands.filter((c) => /\bnode\s/.test(c));
  const scripts = nodeRuns.map((c) => c.match(/\bnode\s+(\S+)/)[1]);
  const ok = !commands.some((c) => /\bnpm\s+(run|test|start|exec|x)\b|\bnpx\b|\byarn\b|\bpnpm\b/.test(c))
    && scripts.length === 2 && scripts.every((s) => s.startsWith('../gate/scripts/'))
    && scripts.some((s) => s === '../gate/scripts/ratchet-check.js') && scripts.some((s) => s === '../gate/scripts/mutate-changed.js')
    && /working-directory:\s*pr\b/.test(code);
  return report('no npm run / npx / yarn / pnpm; node runs only ../gate/scripts/ratchet-check.js and mutate-changed.js, from pr/',
    ok, JSON.stringify({ nodeRuns, commands }));
}

function testMutateArgs() {
  const run = runCommands().find((c) => c.includes('gate/scripts/mutate-changed.js')) ?? '';
  return report('mutate-changed.js gets main and --concurrency 4 only', /mutate-changed\.js main --concurrency 4$/.test(run), JSON.stringify(run));
}

const results = [testExists(), testTrigger(), testJobName(), testReadOnlyToken(), testNoSecretsNoCache(), testCheckouts(), testInstalls(),
  testOnlyGateScripts(), testMutateArgs()];
console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);
process.exit(results.every(Boolean) ? 0 : 1);
