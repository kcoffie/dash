import fs from 'fs';
import path from 'path';
import {
  isSourceFile, nonProductionContext, walkDir, USER_INPUT, ROUTE_HANDLER,
} from '../file-utils.js';

const SEVERITY_LADDER = ['low', 'medium', 'high', 'critical'];

// How far back to look for the name of the function that returns a handler (factory-style routes)
const FUNCTION_LOOKBACK = 15;

// Callbacks that run while authenticating a request (passport session hooks and verify callbacks)
const AUTH_CALLBACK = /passport\.(use|serializeUser|deserializeUser)\b|function\s*\([^)]*\bdone\s*\)/;
// Files that use passport / passport-local
const PASSPORT_IMPORT = /(?:require\s*\(\s*|from\s+|import\s+)['"]passport(?:-[\w-]+)?['"]/g;
const PASSPORT_LOCAL_IMPORT = /(?:require\s*\(\s*|from\s+|import\s+)['"]passport-local['"]/g;
// The passport-local module bound to a name: const passportLocal = require('passport-local'), import * as pl from 'passport-local'
const PASSPORT_LOCAL_MODULE = /\b(?:(?:const|let|var)\s+([\w$]+)\s*=\s*require\s*\(\s*['"]passport-local['"]\s*\)(?!\s*\.)|import\s+(?:\*\s*as\s+)?([\w$]+)\s+from\s+['"]passport-local['"])/g;

// Express route registration: app.get(…), router.post(…), apiRouter.use(…)
const ROUTE_REGISTRATION = /\b(?:app|router|[\w$]*[Rr]outer)\s*\.\s*(?:get|post|put|patch|delete|all|use|options|head)\s*\(/g;

const ASYNC_HANDLER = /\basync\s*(?:function\b\s*[\w$]*\s*)?\(\s*req\b[^,()]*,\s*res\b/g;

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with']);

const maxSeverity = (a, b) => (SEVERITY_LADDER.indexOf(a) >= SEVERITY_LADDER.indexOf(b) ? a : b);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Matches of `pattern` (global) in the source that are real code: not inside a comment or string (blank in `code`)
const codeMatches = (content, code, pattern) => [...content.matchAll(pattern)].filter((match) => code[match.index] !== ' ');

// Blank out string and comment contents (keeping length and newlines) so brackets and keywords
// inside them don't count. Regex literals aren't recognized; a quote inside one can mask the rest of its line.
function maskCode(source) {
  const out = source.split('');
  let state = null; // null | '//' | '/*' | "'" | '"' | '`'
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === null) {
      if (ch === '/' && next === '/') { state = '//'; i++; } else if (ch === '/' && next === '*') { state = '/*'; i++; } else if (ch === '\'' || ch === '"' || ch === '`') state = ch;
      continue;
    }
    if (ch === '\n') {
      if (state === '//' || state === '\'' || state === '"') state = null; // unterminated quotes end at the line
      continue;
    }
    if (state === '/*' && ch === '*' && next === '/') { out[i] = ' '; out[i + 1] = ' '; state = null; i++; continue; }
    if ((state === '\'' || state === '"' || state === '`') && ch === '\\') { out[i] = ' '; if (next !== '\n' && next !== undefined) out[i + 1] = ' '; i++; continue; }
    if (state === ch && (ch === '\'' || ch === '"' || ch === '`')) { state = null; continue; }
    out[i] = ' ';
  }
  return out.join('');
}

// Index of the bracket that closes the one at `open`, or -1
function closeBracket(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const opener = code[open];
  const closer = pairs[opener];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === opener) depth++;
    else if (code[i] === closer && --depth === 0) return i;
  }
  return -1;
}

// Number of top-level comma-separated arguments in `text`
function argumentCount(text) {
  if (!text.trim()) return 0;
  let depth = 0;
  let count = 1;
  for (const ch of text) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

function lineIndex(code) {
  const starts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo; // 0-based line
  };
}

// Text just before each block or call that encloses `index`, innermost first: the signatures of the
// functions a statement sits in (function (req, res) {, passport.deserializeUser(function (uid, done) {, …)
function enclosingSignatures(code, index) {
  const signatures = [];
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) { depth--; continue; }
      if (ch === '{') {
        const before = code.slice(Math.max(0, i - 200), i);
        signatures.push(before.slice(Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'), before.lastIndexOf('}')) + 1));
      }
    }
  }
  return signatures;
}

// Whether `index` sits inside the arguments of a call whose callee matches `callee`
// (e.g. new LocalStrategy({ … }, function (…) { here }))
function insideCallTo(code, index, callee) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) { depth--; continue; }
      if (ch === '(' && callee.test(code.slice(Math.max(0, i - 40), i))) return true;
    }
  }
  return false;
}

// Callee of a passport-local Strategy call in a file that imports passport-local: LocalStrategy, its Strategy
// under its own name (new Strategy(), or Strategy on the module's own binding (passportLocal.Strategy(), not jwt.Strategy(
function localStrategyCallee(content, code) {
  const modules = codeMatches(content, code, PASSPORT_LOCAL_MODULE).map((match) => escapeRegex(match[1] ?? match[2]));
  const callees = ['\\bLocalStrategy', '(?<![\\w$.])Strategy', ...modules.map((name) => `(?<![\\w$.])${name}\\s*\\.\\s*Strategy`)];
  return new RegExp(`(?:${callees.join('|')})\\s*$`);
}

// Parameter names of the function whose body follows `signature`: function name (a, b) { … } or (a, b) => { … }.
// TypeScript annotations are dropped, including ones with brackets: (username: string, done: (err: any) => void): Promise<void>
function parameterNames(signature) {
  const tail = signature.match(/\)\s*(?::\s*[\w$.<>[\]| ]+)?\s*(?:=>\s*)?$/);
  const open = tail ? openingParen(signature, tail.index) : -1;
  if (open < 0) return null;
  // Split on commas outside a type's brackets (the > of => doesn't close anything)
  const params = [''];
  let depth = 0;
  for (let i = open + 1; i < tail.index; i++) {
    const ch = signature[i];
    if ('([{<'.includes(ch)) depth++;
    else if (')]}'.includes(ch) || (ch === '>' && signature[i - 1] !== '=')) depth--;
    if (ch === ',' && depth === 0) params.push('');
    else params[params.length - 1] += ch;
  }
  return params.map((p) => p.replace(/:[\s\S]*/, '').trim()).filter(Boolean);
}

// Index of the ( that the ) at `close` closes, or -1
function openingParen(text, close) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === ')') depth++;
    else if (text[i] === '(' && --depth === 0) return i;
  }
  return -1;
}

// passport-local's verify callback gets the username and password straight from req.body, so its
// credential parameters are request input (user decision, 2026-10-07). Other strategies' parameters
// (a verified JWT payload, an OAuth profile) are not.
function usesLocalStrategyCredentials(code, index, signatures, head, localCallee) {
  // Only in files that import passport-local, inside a call to its Strategy
  if (!localCallee || !insideCallTo(code, index, localCallee)) return false;
  for (const signature of signatures) {
    const names = parameterNames(signature);
    if (!names) continue;
    if (names.length < 3 || !/^(done|cb|callback|verified|next)$/.test(names[names.length - 1])) continue;
    // verify(username, password, done), or verify(req, username, password, done) with passReqToCallback
    const credentials = names.slice(names.length > 3 ? 1 : 0, -1);
    return credentials.some((name) => new RegExp(`(?<![\\w$.])${escapeRegex(name)}(?![\\w$])`).test(head));
  }
  return false;
}

// Name of the nearest function declared at or above `startLine`
function enclosingFunctionName(lines, startLine) {
  for (let i = startLine; i >= Math.max(0, startLine - FUNCTION_LOOKBACK); i--) {
    const line = lines[i];
    const match = line.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/)
      || line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/)
      || line.match(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/)
      || line.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/);
    if (match && !KEYWORDS.has(match[1])) return match[1];
  }
  return null;
}

// Browser code: a rejection logs an error but doesn't take a server down
function isBrowserFile(relFile, content) {
  return /(^|\/)(frontend|client|public|static|www|browser)\//.test(relFile)
    || /\.(jsx|tsx|vue|svelte)$/.test(relFile)
    || /from\s+['"](@angular\/|react['"]|vue['"])/.test(content);
}

// Express major version from the target's package.json, or null
function expressMajor(targetPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(targetPath, 'package.json'), 'utf-8'));
    const range = pkg.dependencies?.express ?? pkg.devDependencies?.express;
    const major = range?.match(/(\d+)/);
    return major ? { major: Number(major[1]), range } : null;
  } catch {
    return null;
  }
}

// --- Promise chains without a rejection handler ---

// Start of the expression a `.then(` hangs off: back to the enclosing bracket, a `;` or `,`,
// or a line break that ends a statement (semicolon-free code)
function chainStart(code, index) {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const ch = code[i];
    if (')]}'.includes(ch)) depth++;
    else if ('([{'.includes(ch)) {
      if (depth === 0) return i + 1;
      depth--;
    } else if (depth === 0 && (ch === ';' || ch === ',')) {
      return i + 1;
    } else if (depth === 0 && ch === '\n') {
      const after = code.slice(i + 1, index + 1).trimStart(); // includes the '.' of the .then itself
      const before = code.slice(0, i).trimEnd();
      if (after.startsWith('.') || /[.(,=+\-*/&|?:!]$|=>$/.test(before)) continue;
      return i + 1;
    }
  }
  return 0;
}

// Walk .then/.catch/.finally calls from `index`; handled when any .catch() or two-argument .then() appears
function chainIsHandled(code, index) {
  let pos = index;
  for (;;) {
    const call = /^\s*\.\s*(then|catch|finally)\s*\(/.exec(code.slice(pos));
    if (!call) return false;
    const open = pos + call[0].length - 1;
    const close = closeBracket(code, open);
    if (close < 0) return false;
    if (call[1] === 'catch') return true;
    if (call[1] === 'then' && argumentCount(code.slice(open + 1, close)) >= 2) return true;
    pos = close + 1;
  }
}

function promiseChainIssues({ code, lines, lineOf, browser, passport, localCallee }) {
  const issues = [];
  const starts = new Set();
  const then = /\.\s*then\s*\(/g;
  let match;
  while ((match = then.exec(code)) !== null) {
    const thenLine = lineOf(match.index);
    if (lines[thenLine].trim().startsWith('*')) continue; // JSDoc-style comment line

    let start = chainStart(code, match.index);
    while (/\s/.test(code[start])) start++;
    if (starts.has(start)) continue; // later .then() in a chain already seen
    starts.add(start);

    const head = code.slice(start, match.index);
    const before = code.slice(Math.max(0, start - 40), start).trimEnd();
    // Returned, awaited, assigned, or passed on: someone else owns the rejection
    if (/^(return|await|yield|throw)\b/.test(head) || /^(export\s+)?(const|let|var)\s/.test(head)
      || /^[\w$.[\]]+\s*=[^=>]/.test(head) || /(\breturn|\bawait|\byield|=>|[=(,:?[]|&&|\|\|)$/.test(before)) continue;
    if (chainIsHandled(code, match.index)) continue;

    const startLine = lineOf(start);
    const signatures = enclosingSignatures(code, start);
    const inRoute = signatures.some((signature) => ROUTE_HANDLER.test(signature));
    // Inside a …Strategy( call's arguments: a passport callback only in files that import passport (user decision 2026-10-07)
    const inAuth = signatures.some((signature) => AUTH_CALLBACK.test(signature)) || (passport && insideCallTo(code, start, /Strategy\s*$/));
    const factors = ['✓ Promise chain has no .catch() and isn\'t returned or awaited, so a rejection is unhandled'];
    let severity = 'low';
    let confidence = 0.4;

    if (browser) {
      factors.push('⚠ Runs in the browser: a rejection logs an error, the page keeps running');
    } else if (inRoute || inAuth) {
      severity = 'medium';
      confidence = 0.6;
      factors.push(inRoute
        ? '✓ Inside a route handler: on Node ≥ 15 an unhandled rejection exits the process (Express 4 doesn\'t catch it), otherwise the request hangs'
        : '✓ Inside an auth callback (passport): a rejection exits the process on Node ≥ 15, otherwise login hangs');
      const credentials = !USER_INPUT.test(head) && usesLocalStrategyCredentials(code, start, signatures, head, localCallee);
      if (USER_INPUT.test(head) || credentials) {
        severity = 'high';
        confidence = 0.75;
        factors.push(credentials
          ? '✓ Login credentials feed the promise (passport-local reads them from req.body): a crafted request can make it reject'
          : '✓ Request input (req.*) feeds the promise: a crafted request can make it reject');
      }
    } else {
      factors.push('? Server code outside request handling: a rejection still exits Node ≥ 15, but requests don\'t trigger it directly');
    }

    if (/^void\b/.test(head)) factors.push('⚠ Marked `void`: fire-and-forget looks deliberate, but rejections are still unhandled');
    if (/^import\s*\(/.test(head)) factors.push('⚠ Lazy-loaded module (import()): rejects only if the chunk fails to load');
    if (factors.length < 3) factors.push('? Errors thrown inside the .then() callbacks become rejections too');

    issues.push({
      line: startLine,
      name: 'Promise Without .catch()',
      severity,
      confidence,
      factors,
      description: 'A promise chain ends without a rejection handler. If the promise rejects, or a .then() callback throws, nothing handles it: Node ≥ 15 exits the process, older Node logs a warning and the request never gets a response.',
      remediation: 'End the chain with a handler: db.User.find(...).then(user => res.render(...)).catch(next). In async code: try { const user = await db.User.find(...) } catch (err) { next(err) }.',
      tags: ['unhandled-rejection'],
    });
  }
  return issues;
}

// --- Async route handlers that Express 4 can't catch ---

// Body text of the function whose parameter list opens at `paramsOpen`
function functionBody(code, paramsOpen) {
  const paramsClose = closeBracket(code, paramsOpen);
  if (paramsClose < 0) return null;
  const rest = code.slice(paramsClose + 1);
  const brace = rest.match(/^\s*(?::[^={]*)?(?:=>)?\s*\{/);
  if (brace) {
    const open = paramsClose + 1 + brace[0].length - 1;
    const close = closeBracket(code, open);
    return code.slice(open, close < 0 ? code.length : close + 1);
  }
  return rest.split('\n')[0]; // expression-bodied arrow
}

// Awaits not protected by a surrounding try block or a .catch() on the same line
function unprotectedAwaits(body) {
  let text = body;
  for (;;) {
    const tryAt = text.search(/\btry\s*\{/);
    if (tryAt < 0) break;
    const open = text.indexOf('{', tryAt);
    const close = closeBracket(text, open);
    text = text.slice(0, tryAt) + ' '.repeat((close < 0 ? text.length : close + 1) - tryAt) + text.slice(close < 0 ? text.length : close + 1);
  }
  return text.split('\n').filter((line) => /\bawait\b/.test(line) && !/\.catch\s*\(/.test(line))
    .reduce((count, line) => count + line.match(/\bawait\b/g).length, 0);
}

// Callee of the innermost call whose argument list contains `index`, or null at the top level
function enclosingCallee(code, index, floor = 0) {
  let depth = 0;
  for (let i = index - 1; i >= floor; i--) {
    const ch = code[i];
    if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth > 0) { depth--; continue; }
      if (ch !== '(') return null;
      return code.slice(0, i).match(/([\w$.]+)\s*$/)?.[1] ?? null;
    }
  }
  return null;
}

// How a handler is registered: [{ location, wrapper }] where wrapper is null for a bare registration
function registrationsOf(name, sources) {
  const found = [];
  const reference = new RegExp(`(?<![\\w$])(?:[\\w$]+\\.)*${escapeRegex(name)}(?![\\w$])`, 'g');
  for (const { relFile, code, lineOf } of sources) {
    ROUTE_REGISTRATION.lastIndex = 0;
    let call;
    while ((call = ROUTE_REGISTRATION.exec(code)) !== null) {
      const open = call.index + call[0].length - 1;
      const close = closeBracket(code, open);
      if (close < 0) continue;
      reference.lastIndex = 0;
      let ref;
      const args = code.slice(0, close);
      while ((ref = reference.exec(args)) !== null) {
        if (ref.index <= open) continue;
        const callee = enclosingCallee(code, ref.index, open);
        found.push({ location: `${relFile}:${lineOf(call.index) + 1}`, wrapper: callee });
      }
    }
  }
  return found;
}

// Name a handler is exported or stored under: module.exports.x = async (…), const x = async (…), or a factory that returns it
function handlerName(lines, line) {
  const text = lines[line];
  const own = text.match(/(?:module\.)?exports\.([\w$]+)\s*=/) || text.match(/(?:const|let|var)\s+([\w$]+)\s*=\s*async\b/)
    || text.match(/async\s+function\s+([\w$]+)\s*\(/);
  if (own) return own[1];
  if (/^\s*return\b/.test(text)) return enclosingFunctionName(lines, line - 1);
  return null;
}

function asyncHandlerIssues({ code, lines, lineOf, relFile }, sources, express) {
  const issues = [];
  ASYNC_HANDLER.lastIndex = 0;
  let match;
  while ((match = ASYNC_HANDLER.exec(code)) !== null) {
    const paramsOpen = code.indexOf('(', match.index + 5);
    // (req, res) or (req, res, next): more parameters means a helper the handler calls, not the handler
    if (argumentCount(code.slice(paramsOpen + 1, closeBracket(code, paramsOpen))) > 3) continue;
    const body = functionBody(code, paramsOpen);
    if (!body) continue;
    const awaits = unprotectedAwaits(body);
    if (awaits === 0) continue;

    const line = lineOf(match.index);
    let registration;
    let confidence = 0.75;
    const inlineCallee = enclosingCallee(code, match.index);
    if (inlineCallee && /\.(get|post|put|patch|delete|all|use|options|head)$/.test(inlineCallee)) {
      registration = `✓ Registered inline (${relFile}:${line + 1}) with no error-forwarding wrapper`;
    } else if (inlineCallee) {
      continue; // wrapped where it's defined: catchAsync(async (req, res) => …)
    } else {
      const name = handlerName(lines, line);
      const registrations = name ? registrationsOf(name, sources) : [];
      const bare = registrations.filter((r) => r.wrapper === null || r.wrapper === name || /\.(get|post|put|patch|delete|all|use|options|head)$/.test(r.wrapper));
      if (registrations.length > 0 && bare.length === 0) continue; // every registration goes through a wrapper
      if (bare.length > 0) {
        registration = `✓ Registered without an error-forwarding wrapper: ${bare.map((r) => r.location).join(', ')}`;
      } else {
        registration = `? Couldn't find where ${name ?? 'this handler'} is registered: if it's wrapped (asyncHandler-style), this is a false positive`;
        confidence = 0.5;
      }
    }

    issues.push({
      line,
      name: 'Async Route Handler Without Error Handling',
      severity: 'high',
      confidence,
      factors: [
        `✓ async route handler has ${awaits} await${awaits > 1 ? 's' : ''} outside try/catch`,
        express
          ? `✓ Express ${express.range}: Express 4 doesn't catch a rejected handler, so on Node ≥ 15 the process exits`
          : '? Express version unknown: Express 4 doesn\'t catch a rejected handler (Express 5 does)',
        registration,
      ],
      description: 'Express 4 ignores the promise an async handler returns. If an awaited call rejects (database down, bad input reaching a query), the error is unhandled: Node ≥ 15 exits the process, older Node leaves the request hanging. Any request that can trigger the failure takes the server down.',
      remediation: 'Forward errors to Express: wrap the handler (app.get(\'/x\', asyncHandler(handler)) with const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)), add try { … } catch (err) { next(err) }, require(\'express-async-errors\') once at startup, or upgrade to Express 5.',
      tags: ['unhandled-rejection', 'route-handler'],
    });
  }
  return issues;
}

// --- Callbacks whose rejections nobody sees ---

const LOST_REJECTIONS = [
  {
    name: 'async Callback in forEach()',
    regex: /\.forEach\s*\(\s*async\b/g,
    detected: '✓ forEach() ignores the promises its callback returns: no waiting, no error handling',
    remediation: 'Use for (const item of items) { await save(item) } to run in order, or await Promise.all(items.map(async (item) => save(item))) to run in parallel.',
  },
  {
    name: 'async Promise Executor',
    regex: /\bnew\s+Promise\s*\(\s*async\b/g,
    detected: '✓ new Promise(async …): an error thrown after an await never reaches reject()',
    remediation: 'Drop the wrapper and use the async function directly: const p = (async () => { … })(); or call the inner promise and chain .then(resolve, reject).',
  },
  {
    name: 'async Timer Callback',
    regex: /\bset(?:Timeout|Interval|Immediate)\s*\(\s*async\b/g,
    detected: '✓ Timer callback is async: the timer ignores the promise, so a rejection is unhandled',
    remediation: 'Catch inside the callback: setTimeout(async () => { try { await refresh() } catch (err) { log(err) } }, 1000).',
  },
  {
    name: 'async Event Listener',
    regex: /\.(?:on|once|addListener|addEventListener)\s*\(\s*[^,()]+,\s*async\b/g,
    detected: '✓ Event listener is async: the emitter ignores the promise, so a rejection is unhandled',
    remediation: 'Catch inside the listener: emitter.on(\'message\', async (msg) => { try { await handle(msg) } catch (err) { log(err) } }).',
  },
];

function lostRejectionIssues({ code, lines, lineOf, browser }) {
  const issues = [];
  for (const pattern of LOST_REJECTIONS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(code)) !== null) {
      const line = lineOf(match.index);
      if (lines[line].trim().startsWith('*')) continue;
      issues.push({
        line,
        name: pattern.name,
        severity: browser ? 'low' : 'medium',
        confidence: browser ? 0.4 : 0.6,
        factors: [
          pattern.detected,
          browser
            ? '⚠ Runs in the browser: a rejection logs an error, the page keeps running'
            : '✓ Server code: on Node ≥ 15 an unhandled rejection exits the process',
          '? Check whether the callback can reject (I/O, database, parsing)',
        ],
        description: 'The async callback\'s promise is dropped by its caller, so a rejection inside it is never handled.',
        remediation: pattern.remediation,
        tags: ['unhandled-rejection'],
      });
    }
  }
  return issues;
}

const REFERENCES = [
  'https://nodejs.org/api/cli.html#--unhandled-rejectionsmode',
  'https://expressjs.com/en/guide/error-handling.html',
  'https://cwe.mitre.org/data/definitions/248.html',
];

// One finding per line: merge every issue found there, at the highest severity
function toFinding(relFile, lines, issues) {
  const line = issues[0].line + 1;
  let severity = issues.reduce((worst, issue) => maxSeverity(worst, issue.severity), 'low');
  let confidence = Math.max(...issues.map((issue) => issue.confidence));
  const factors = [...new Set(issues.flatMap((issue) => issue.factors))];

  const nonProduction = nonProductionContext(relFile);
  if (nonProduction) {
    factors.push(nonProduction.factor);
    severity = 'low';
    confidence = nonProduction.adjustConfidence(confidence);
  }

  return {
    id: `async-${relFile.replace(/[^\w]/g, '_')}-${line}`,
    type: 'async-footgun',
    title: `Async Footgun (${[...new Set(issues.map((issue) => issue.name))].join(' + ')})`,
    severity,
    confidence: Math.round(Math.max(0.1, Math.min(0.95, confidence)) * 100) / 100,
    description: [...new Set(issues.map((issue) => issue.description))].join(' '),
    file: relFile,
    line,
    snippet: lines[line - 1].replace(/\s+/g, ' ').trim().substring(0, 120),
    context: factors,
    remediation: [...new Set(issues.map((issue) => issue.remediation))].join(' '),
    references: REFERENCES,
    tags: ['async', ...new Set(issues.flatMap((issue) => issue.tags))],
  };
}

export async function scanForAsyncFootguns(targetPath) {
  const findings = [];

  try {
    const sources = [];
    for (const file of walkDir(targetPath)) {
      if (!isSourceFile(file)) continue;
      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // Unreadable (permissions, broken symlink)
      }
      const code = maskCode(content);
      const relFile = path.relative(targetPath, file);
      sources.push({
        relFile, content, code, lines: content.split('\n'), lineOf: lineIndex(code), browser: isBrowserFile(relFile, content),
        passport: codeMatches(content, code, PASSPORT_IMPORT).length > 0,
        localCallee: codeMatches(content, code, PASSPORT_LOCAL_IMPORT).length > 0 ? localStrategyCallee(content, code) : null,
      });
    }

    // Express 5 forwards rejected handlers to the error handler; express-async-errors patches Express 4 to do the same
    const express = expressMajor(targetPath);
    const handlersCovered = (express && express.major >= 5)
      || sources.some(({ content }) => /(require\s*\(|import\s+|from\s+)\s*['"]express-async-errors['"]/.test(content));

    for (const source of sources) {
      const issues = [
        ...promiseChainIssues(source),
        ...(handlersCovered ? [] : asyncHandlerIssues(source, sources, express)),
        ...lostRejectionIssues(source),
      ];
      const byLine = new Map();
      for (const issue of issues) {
        if (!byLine.has(issue.line)) byLine.set(issue.line, []);
        byLine.get(issue.line).push(issue);
      }
      for (const lineIssues of [...byLine.values()].sort((a, b) => a[0].line - b[0].line)) {
        findings.push(toFinding(source.relFile, source.lines, lineIssues));
      }
    }
  } catch (error) {
    throw new Error(`Async footgun scanning failed: ${error.message}`);
  }

  return findings;
}
