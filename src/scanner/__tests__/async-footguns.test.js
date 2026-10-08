import fs from 'fs';
import path from 'path';
import { scanForAsyncFootguns } from '../patterns/async-footguns.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Unique per run, so parallel runs (Stryker workers) don't delete each other's fixtures
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.test-tmp-async-'));

function setup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

// files: { 'relative/path.js': 'source' | ['line', …] }
async function scanFiles(files) {
  const testPath = setup();
  for (const [fileName, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(testPath, fileName)), { recursive: true });
    fs.writeFileSync(path.join(testPath, fileName), Array.isArray(source) ? source.join('\n') : source);
  }
  return scanForAsyncFootguns(testPath);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

const hasShape = (f) => f.type === 'async-footgun' && f.context.length >= 3 && f.remediation && f.references.length > 0
  && f.context.every((factor) => /^[✓⚠?]/.test(factor));

// --- Promise chains without .catch() ---

async function testRouteChainWithRequestInputIsHigh() {
  // DVNA core/authHandler.js:42 — Sequelize query built from req.query, no .catch()
  const findings = await scanFiles({
    'core/authHandler.js': [
      'module.exports.resetPw = function (req, res) {',
      '  db.User.find({',
      '    where: { login: req.query.login }',
      '  }).then(user => {',
      "    res.render('resetpw')",
      '  })',
      '}',
    ],
  });
  const f = findings[0];
  return report(
    'Route-handler chain fed by req.* without .catch() → high, reported at the chain start',
    findings.length === 1 && f.line === 2 && f.severity === 'high' && hasShape(f),
    JSON.stringify(findings),
  );
}

async function testRouteChainWithoutRequestInputIsMedium() {
  // DVNA core/appHandler.js:47 — listProducts
  const findings = await scanFiles({
    'core/appHandler.js': [
      'module.exports.listProducts = function (req, res) {',
      '  db.Product.findAll().then(products => {',
      "    res.render('app/products', { products })",
      '  })',
      '}',
    ],
  });
  return report('Route-handler chain without req.* → medium', findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testAuthCallbackChainIsMedium() {
  // DVNA core/passport.js:12 — deserializeUser
  const findings = await scanFiles({
    'core/passport.js': [
      'passport.deserializeUser(function (uid, done) {',
      '  db.User.findOne({ where: { id: uid } }).then(function (user) {',
      '    done(null, user)',
      '  })',
      '})',
    ],
  });
  return report('Passport callback chain → medium', findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testLocalStrategyCredentialsAreRequestInput() {
  // DVNA core/passport.js:27-35: passport-local takes username/password from req.body (user decision 2026-10-07)
  const findings = await scanFiles({
    'core/passport.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      "passport.use('login', new LocalStrategy({",
      '    passReqToCallback: true',
      '  },',
      '  function (req, username, password, done) {',
      "    db.User.findOne({ where: { 'login': username } }).then(function (user) {",
      '      return done(null, user)',
      '    })',
      '  }))',
    ],
  });
  return report('passport-local verify callback: a chain fed by the username/password parameters → high, says the credentials come from req.body',
    findings.length === 1 && findings[0].line === 6 && findings[0].severity === 'high'
      && findings[0].context.includes('✓ Login credentials feed the promise (passport-local reads them from req.body): a crafted request can make it reject'),
    JSON.stringify(findings));
}

async function testLocalStrategyCustomFieldWithoutReq() {
  // usernameField: 'email' → the first parameter is the email; no req parameter without passReqToCallback
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      "passport.use(new LocalStrategy({ usernameField: 'email' }, function (email, password, done) {",
      '  User.findOne({ email: email }).then(function (user) { done(null, user) })',
      '}))',
    ],
  });
  return report('passport-local with a custom field name and no req parameter: the credential parameter still counts → high',
    findings.length === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testLocalStrategyChainWithoutCredentialsIsMedium() {
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(function (username, password, done) {',
      '  Settings.load().then(function (s) { done(null, false) })',
      '}))',
    ],
  });
  return report('passport-local callback chain that uses neither credential → medium',
    findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testLocalStrategyNestedFunctionAndBlocks() {
  // DVNA core/passport.js:50-59 signup: the chain sits in an inner function and an if block inside the verify callback
  const findings = await scanFiles({
    'core/passport.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      "passport.use('signup', new LocalStrategy({",
      '    passReqToCallback: true',
      '  },',
      '  function (req, username, password, done) {',
      '    findOrCreateUser = function () {',
      '      if (username) {',
      "        db.User.findOne({ where: { 'email': username } }).then(function (user) {",
      '          return done(null, user)',
      '        })',
      '      }',
      '    }',
      '    process.nextTick(findOrCreateUser)',
      '  }))',
    ],
  });
  return report('passport-local: a credential-fed chain inside an inner function and if block of the verify callback → high',
    findings.length === 1 && findings[0].line === 8 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testLocalStrategyArrowAndCbCallback() {
  // passport's current docs name the callback cb; arrow functions are common too
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy({ passReqToCallback: true }, async (req, username, password, cb) => {',
      '  db.get(username).then((row) => cb(null, row))',
      '}))',
      'passport.use(new LocalStrategy(function verify(username, password, cb) {',
      '  db.get(username).then((row) => cb(null, row))',
      '}))',
    ],
  });
  return report('passport-local with an async arrow callback, or an inline named function expression, and a callback named cb → high',
    findings.length === 2 && findings.every((f) => f.severity === 'high'), JSON.stringify(findings));
}

async function testClosedLocalStrategyCallDoesNotCount() {
  // The LocalStrategy call closes before this function, so its parameters aren't passport-local's
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(verify));',
      'function sync (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}',
      'register(LocalStrategyAdapter(function (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
    ],
  });
  // Line 7 is medium from the loose existing auth-callback rule (`function (…, done)`, HANDOFF TODO), not from passport-local
  const at = (line) => findings.find((f) => f.line === line)?.severity;
  return report('A LocalStrategy call that already closed, or a callee that merely starts with LocalStrategy, doesn\'t make parameters request input (low / medium, not high)',
    findings.length === 2 && at(4) === 'low' && at(7) === 'medium', JSON.stringify(findings));
}

async function testLocalStrategyArrowWithoutOptions() {
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy((username, password, done) => {',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
    ],
  });
  return report('passport-local arrow callback with no options object → high',
    findings.length === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testInnerCallbackIsNotTheVerifyCallback() {
  // forEach's (row, i, all) has three parameters but isn't the verify callback; username still is a credential
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(function (username, password, done) {',
      '  rows.forEach(function (row, i, all) {',
      '    db.get(username).then((r) => done(null, r))',
      '  })',
      '}))',
    ],
  });
  return report('An inner three-parameter callback inside the verify callback doesn\'t hide the credentials → high',
    findings.length === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testClosedLiteralsAndCallsBeforeTheChain() {
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      "passport.use(new LocalStrategy({ usernameField: 'email' }, [verify]));",
      'function sync (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}',
      'passport.use(new LocalStrategy(verify)); run((x) => {',
      '  db.get(x).then(ok)',
      '})',
      'const a = new LocalStrategy(wrap([verify]));',
      'const b = new LocalStrategy(wrap({ verify }));',
      'function sync2 (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}',
    ],
  });
  const at = (line) => findings.find((f) => f.line === line)?.severity;
  return report('Object/array literals and a Strategy call that closed before the chain don\'t make it a passport callback → low',
    findings.length === 3 && at(4) === 'low' && at(7) === 'low' && at(12) === 'low', JSON.stringify(findings));
}

async function testDeserializeChainInBlockStaysMedium() {
  const findings = await scanFiles({
    'core/passport.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.deserializeUser(function (uid, done) {',
      '  if (uid) {',
      '    db.User.findOne({ where: { id: uid } }).then(function (user) { done(null, user) })',
      '  }',
      '})',
    ],
  });
  return report('A deserializeUser chain inside an if block is still a passport callback → medium (uid comes from the session, not the request)',
    findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testOtherStrategyParamsAreNotRequestInput() {
  // Only passport-local reads credentials from the request body; a JWT payload has been verified first
  const findings = await scanFiles({
    'auth.js': [
      "const JwtStrategy = require('passport-jwt').Strategy;",
      'passport.use(new JwtStrategy(opts, function (jwtPayload, extra, done) {',
      '  User.findOne({ id: jwtPayload.sub }).then(function (user) { done(null, user) })',
      '}))',
    ],
  });
  return report('Other passport strategies: callback parameters are not request input → medium',
    findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

const AUTH_FACTOR = '✓ Inside an auth callback (passport): a rejection exits the process on Node ≥ 15, otherwise login hangs';
const CREDENTIALS_FACTOR = '✓ Login credentials feed the promise (passport-local reads them from req.body): a crafted request can make it reject';

async function testNonPassportStrategyIsNotAuthCallback() {
  // User decision 2026-10-07: a …Strategy( call is a passport callback only when the file imports passport
  const findings = await scanFiles({
    'retry.js': [
      'const s = new RetryStrategy({ maxRetries: 3 }, function onRetry (attempt) {',
      "  notify(attempt).then(() => log('retry'))",
      '})',
    ],
  });
  return report('A …Strategy( call in a file that doesn\'t import passport is not a passport callback → low',
    findings.length === 1 && findings[0].severity === 'low', JSON.stringify(findings));
}

async function testOtherPassportStrategyWithOptionsIsMedium() {
  const findings = await scanFiles({
    'auth.js': [
      "const JwtStrategy = require('passport-jwt').Strategy;",
      'passport.use(new JwtStrategy({ secretOrKey: key }, (payload, cb) => {',
      '  User.findById(payload.sub).then((user) => cb(null, user))',
      '}))',
    ],
  });
  return report('Another passport strategy with an options object and a cb callback → medium, auth-callback factor, not credentials',
    findings.length === 1 && findings[0].severity === 'medium' && findings[0].context.includes(AUTH_FACTOR)
      && !findings[0].context.includes(CREDENTIALS_FACTOR), JSON.stringify(findings));
}

async function testLocalStrategyTypedParams() {
  const findings = await scanFiles({
    'auth.ts': [
      "import { Strategy as LocalStrategy } from 'passport-local';",
      'passport.use(new LocalStrategy(async (username: string, password: string, done: Function) => {',
      '  User.findOne({ username }).then((u) => done(null, u))',
      '}))',
      'passport.use(new LocalStrategy((username, password, done): void => {',
      '  User.findOne({ username }).then((u) => done(null, u))',
      '}))',
    ],
  });
  return report('passport-local with TypeScript parameter types or a return type → high, credentials factor',
    findings.length === 2 && findings.every((f) => f.severity === 'high' && f.context.includes(CREDENTIALS_FACTOR)), JSON.stringify(findings));
}

async function testPassportLocalImportStyles() {
  const findings = await scanFiles({
    'a.js': [
      "const { Strategy } = require('passport-local');",
      'passport.use(new Strategy(function (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
    ],
    'b.js': [
      "const passportLocal = require('passport-local');",
      'passport.use(new passportLocal.Strategy(function (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
    ],
  });
  return report('passport-local imported as Strategy or used as passportLocal.Strategy → high',
    findings.length === 2 && findings.every((f) => f.severity === 'high'), JSON.stringify(findings));
}

async function testPassportImportForms() {
  // ES import, require with spaces, and a bare side-effect import all mark the file as using passport / passport-local
  const jwt = (importLine) => [importLine, 'passport.use(new JwtStrategy({ secretOrKey: k }, (p, cb) => {', '  User.findById(p.sub).then((u) => cb(null, u))', '}))'];
  const local = (importLine) => [importLine, 'passport.use(new Strategy((username, password, cb) => {', '  db.get(username).then((u) => cb(null, u))', '}))'];
  const findings = await scanFiles({
    'j1.js': jwt("import { Strategy as JwtStrategy } from 'passport-jwt';"),
    'j2.js': jwt("const JwtStrategy = require( 'passport-jwt' ).Strategy;"),
    'j3.js': jwt("import 'passport';"),
    'l1.js': local("import { Strategy } from 'passport-local';"),
    'l2.js': local("const { Strategy } = require( \"passport-local\" );"),
    'l3.js': local("import 'passport-local';"),
    'l4.js': local("const LocalStrategy = require('my-passport-local');"),
  });
  const sev = (file) => findings.find((f) => f.file === file)?.severity;
  // l4: passport.use( still makes it a passport callback (medium), but a lookalike package isn't passport-local, so no credentials
  return report('Passport imports in any form (from, require with spaces, bare import) count; a lookalike package isn\'t passport-local',
    ['j1.js', 'j2.js', 'j3.js'].every((f) => sev(f) === 'medium') && ['l1.js', 'l2.js', 'l3.js'].every((f) => sev(f) === 'high')
      && sev('l4.js') === 'medium', JSON.stringify(findings.map((f) => [f.file, f.severity])));
}

async function testLocalStrategyShapes() {
  // try block, inner one-parameter callback, array in the options, no spaces, trailing comma
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      "passport.use('a', new LocalStrategy({ fields: ['a'] }, function(username, password, done){",
      '  try {',
      '    db.get(username).then((row) => done(null, row))',
      '  } catch (e) { done(e) }',
      '}))',
      "passport.use('b', new LocalStrategy(function (username, password, done) {",
      '  async.waterfall([function (next) {',
      '    db.get(password).then((row) => next(null, row))',
      '  }])',
      '}))',
      "passport.use('c', new LocalStrategy(function (",
      '  username,',
      '  password,',
      '  done,',
      ') {',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
    ],
  });
  const at = (line) => findings.find((f) => f.line === line)?.severity;
  return report('passport-local: try block, inner one-parameter callback, array in options, no spaces, trailing comma → all high',
    findings.length === 3 && at(4) === 'high' && at(9) === 'high' && at(17) === 'high', JSON.stringify(findings));
}

async function testReqObjectIsNotACredential() {
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy({ passReqToCallback: true }, function (req, username, password, done) {',
      '  Audit.log(req).then(() => done(null, false))',
      '}))',
    ],
  });
  return report('With passReqToCallback, a chain passing the whole req (not req.*, not a credential) → medium: req itself is not a credential',
    findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testStrategyCallWithoutOptionsInNonPassportFileIsLow() {
  // User decision 2026-10-07 applies to every way a …Strategy( call is recognised, not just calls with an options object
  const findings = await scanFiles({
    'retry.js': [
      'new RetryStrategy(function onRetry (attempt) {',
      "  notify(attempt).then(() => log('retry'))",
      '})',
    ],
    'config.js': [
      "config.getStrategy('x', () => {",
      '  load().then(ok)',
      '})',
    ],
  });
  return report('A …Strategy( call without an options object, in a file that doesn\'t import passport → low',
    findings.length === 2 && findings.every((f) => f.severity === 'low' && !f.context.includes(AUTH_FACTOR)), JSON.stringify(findings));
}

async function testCommentedOutPassportImportDoesNotCount() {
  // An import inside a comment or a string doesn't make the file a passport file
  const findings = await scanFiles({
    'a.js': [
      "// const passport = require('passport')",
      'new RetryStrategy({ n: 3 }, function () {',
      '  notify().then(() => x())',
      '})',
    ],
    'b.js': [
      "const help = \"usage: require('passport')\"",
      'new RetryStrategy({ n: 3 }, function () {',
      '  notify().then(() => x())',
      '})',
    ],
    'c.js': [
      "/* const LocalStrategy = require('passport-local').Strategy */",
      'passport.use(new Strategy(function (username, password, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
    ],
  });
  const sev = (file) => findings.find((f) => f.file === file)?.severity;
  // c.js: passport.use( still makes it a passport callback (medium), but passport-local isn't imported, so no credentials
  return report('A passport / passport-local import in a comment or string doesn\'t count (a, b → low; c → medium, no credentials)',
    findings.length === 3 && sev('a.js') === 'low' && sev('b.js') === 'low' && sev('c.js') === 'medium',
    JSON.stringify(findings.map((f) => [f.file, f.severity])));
}

async function testOtherStrategyNamespaceInPassportLocalFileIsNotCredentials() {
  // One config file setting up local + JWT: jwt.Strategy is passport-jwt's, so its parameters aren't login credentials
  const findings = await scanFiles({
    'config/passport.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      "const jwt = require('passport-jwt');",
      'passport.use(new jwt.Strategy(opts, function (payload, extra, done) {',
      '  User.findOne(payload.sub).then((u) => done(null, u))',
      '}))',
      'passport.use(new JwtStrategy(opts, function (payload, extra, done) {',
      '  User.findOne(payload.sub).then((u) => done(null, u))',
      '}))',
    ],
    // passport-local bound to a module name: only that name's Strategy is passport-local's
    'config/both.js': [
      "const passportLocal = require('passport-local');",
      "const jwt = require('passport-jwt');",
      'passport.use(new jwt.Strategy(opts, function (payload, extra, done) {',
      '  User.findOne(payload.sub).then((u) => done(null, u))',
      '}))',
    ],
  });
  return report('In a passport-local file, another strategy (jwt.Strategy, JwtStrategy) → medium with the auth factor, not credentials',
    findings.length === 3 && findings.every((f) => f.severity === 'medium' && f.context.includes(AUTH_FACTOR) && !f.context.includes(CREDENTIALS_FACTOR)),
    JSON.stringify(findings));
}

async function testRequestFirstParamIsNotACredential() {
  // passport-local with passReqToCallback calls verify(req, username, password, done): the first of four is the request, whatever its name
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy({ passReqToCallback: true }, function (request, username, password, done) {',
      '  Audit.log(request).then(() => done(null, false))',
      '}))',
      'passport.use(new LocalStrategy({ passReqToCallback: true }, function (request, username, password, done) {',
      '  db.get(password).then((row) => done(null, row))',
      '}))',
    ],
  });
  const at = (line) => findings.find((f) => f.line === line);
  return report('passReqToCallback with the request named request: a chain on the request → medium; on the password → high, credentials factor',
    findings.length === 2 && at(3)?.severity === 'medium' && at(6)?.severity === 'high' && at(6).context.includes(CREDENTIALS_FACTOR),
    JSON.stringify(findings));
}

async function testLocalStrategyFunctionTypedDone() {
  // The usual TypeScript typing of done is a function type, with parentheses inside the parameter list
  const findings = await scanFiles({
    'auth.ts': [
      "import { Strategy as LocalStrategy } from 'passport-local';",
      'passport.use(new LocalStrategy(async (username: string, password: string, done: (err: any, user?: any) => void) => {',
      '  User.findOne({ where: { login: username } }).then((u) => done(null, u))',
      '}))',
      'passport.use(new LocalStrategy(function (username: string, password: Map<string, number>, done: (e: Error) => void): Promise<void> {',
      '  db.get(password).then((u) => done(null, u))',
      '}))',
    ],
  });
  return report('passport-local with a function-typed done, a generic type with a comma, or a return type → high, credentials factor',
    findings.length === 2 && findings.every((f) => f.severity === 'high' && f.context.includes(CREDENTIALS_FACTOR)), JSON.stringify(findings));
}

async function testVerifyCallbackNames() {
  // The last parameter is the verify callback: done, cb, callback, verified or next (exactly those names)
  const local = (cbName) => [
    "const LocalStrategy = require('passport-local').Strategy;",
    `passport.use(new LocalStrategy(function (username, password, ${cbName}) {`,
    `  db.get(username).then((row) => ${cbName}(null, row))`,
    '}))',
  ];
  const findings = await scanFiles({
    'callback.js': local('callback'), 'verified.js': local('verified'), 'next.js': local('next'),
    'cbOptions.js': local('cbOptions'), 'ondone.js': local('ondone'),
  });
  const sev = (file) => findings.find((f) => f.file === file)?.severity;
  return report('Verify callback named callback / verified / next → high; a last parameter that only contains a callback name → medium',
    ['callback.js', 'verified.js', 'next.js'].every((f) => sev(f) === 'high') && sev('cbOptions.js') === 'medium' && sev('ondone.js') === 'medium',
    JSON.stringify(findings.map((f) => [f.file, f.severity])));
}

async function testTwoParamCallbackIsNotTheVerifyCallback() {
  // passport-local's verify takes (username, password, done): a two-parameter function inside the call isn't it
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(opts, wrap(function (username, done) {',
      '  db.get(username).then((row) => done(null, row))',
      '})))',
    ],
  });
  return report('A two-parameter (username, done) function inside a LocalStrategy call → medium, not credentials',
    findings.length === 1 && findings[0].severity === 'medium' && !findings[0].context.includes(CREDENTIALS_FACTOR), JSON.stringify(findings));
}

async function testCredentialNameAsPropertyDoesNotCount() {
  // opts.username is a property of something else, not the username parameter
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(function (username, password, done) {',
      '  db.get(opts.username).then((row) => done(null, row))',
      '}))',
    ],
  });
  return report('Inside the verify callback, opts.username (a property, not the parameter) → medium, not credentials',
    findings.length === 1 && findings[0].severity === 'medium' && !findings[0].context.includes(CREDENTIALS_FACTOR), JSON.stringify(findings));
}

async function testPassportLocalModuleBindingsAndWrappedImports() {
  // The passport-local module bound by require or import (namespace or default), with imports wrapped across lines
  const local = (importLines, callee) => [...importLines, `passport.use(new ${callee}(function (username, password, done) {`,
    '  db.get(username).then((row) => done(null, row))', '}))'];
  const jwt = (importLines) => [...importLines, 'passport.use(new JwtStrategy({ secretOrKey: k }, (p, cb) => {',
    '  User.findById(p.sub).then((u) => cb(null, u))', '}))'];
  const findings = await scanFiles({
    'l1.js': local(['const passportLocal =', "  require ( 'passport-local' );"], 'passportLocal.Strategy'),
    'l2.ts': local(['import * as pl from', "  'passport-local';"], 'pl.Strategy'),
    'l3.ts': local(['import  pl  from', "  'passport-local';"], 'pl.Strategy'),
    'l5.js': local(["const pl=require('passport-local');"], 'pl.Strategy'),
    'l6.js': local(['import', "  'passport-local';"], 'Strategy'),
    'l4.ts': local(['import {', '  Strategy,', '} from', "  'passport-local';"], 'Strategy'),
    'j1.js': jwt(['const JwtStrategy = require', "  ('passport-jwt').Strategy;"]),
    'j2.ts': jwt(['import { Strategy as JwtStrategy } from', "  'passport-jwt';"]),
    'j3.ts': jwt(['import', "  'passport';"]),
  });
  const sev = (file) => findings.find((f) => f.file === file)?.severity;
  return report('passport-local bound by require / import * as / default import, imports wrapped across lines → high; wrapped passport imports → medium',
    ['l1.js', 'l2.ts', 'l3.ts', 'l4.ts', 'l5.js', 'l6.js'].every((f) => sev(f) === 'high') && ['j1.js', 'j2.ts', 'j3.ts'].every((f) => sev(f) === 'medium'),
    JSON.stringify(findings.map((f) => [f.file, f.severity])));
}

async function testVerifyCallbackSpacing() {
  // Spacing doesn't change the parameter list: =>{ with no space, a return type with no space, a space before )
  const findings = await scanFiles({
    'auth.ts': [
      "import { Strategy as LocalStrategy } from 'passport-local';",
      'passport.use(new LocalStrategy((username, password, done)=>{',
      '  db.get(username).then((row) => done(null, row))',
      '}))',
      'passport.use(new LocalStrategy(function (username, password, done):void{',
      '  db.get(password).then((row) => done(null, row))',
      '}))',
    ],
    'session.js': [
      'module.exports = function(user, done ) {',
      '  db.find(user.id).then((row) => done(null, row))',
      '}',
    ],
  });
  const at = (file, line) => findings.find((f) => f.file === file && f.line === line)?.severity;
  // session.js: the existing loose rule, function (…, done) is an auth callback (HANDOFF TODO), with any spacing
  return report('Verify callbacks written =>{ or ):void{ → high; function(user, done ) counts as an auth callback → medium',
    findings.length === 3 && at('auth.ts', 3) === 'high' && at('auth.ts', 6) === 'high' && at('session.js', 2) === 'medium',
    JSON.stringify(findings.map((f) => [f.file, f.line, f.severity])));
}

async function testVerifyCallbackDefaultParameter() {
  // A default value is not part of the parameter's name, and its brackets don't hide the parameters after it
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(function (username, password = normalize(raw), done) {',
      '  db.get(password).then((row) => done(null, row))',
      '}))',
    ],
  });
  return report('passport-local verify callback with a default value (password = normalize(raw)) → high, credentials factor',
    findings.length === 1 && findings[0].severity === 'high' && findings[0].context.includes(CREDENTIALS_FACTOR), JSON.stringify(findings));
}

async function testCalleeContainingStrategyIsNotAStrategyCall() {
  // A …Strategy( call means the callee ends in Strategy: StrategyRegistry.add( is not one, even in a passport file
  const findings = await scanFiles({
    'registry.js': [
      "const passport = require('passport');",
      "StrategyRegistry.add('x', function () {",
      '  load().then(ok)',
      '})',
    ],
  });
  return report('In a passport file, a callee that only contains Strategy (StrategyRegistry.add) is not a passport callback → low',
    findings.length === 1 && findings[0].severity === 'low' && !findings[0].context.includes(AUTH_FACTOR), JSON.stringify(findings));
}

async function testUnrecognisedVerifySignatureStaysMedium() {
  const findings = await scanFiles({
    'auth.js': [
      "const LocalStrategy = require('passport-local').Strategy;",
      'passport.use(new LocalStrategy(opts, wrap(function (u) {',
      '  db.get(u).then((row) => row)',
      '})))',
    ],
  });
  return report('Inside a LocalStrategy call but no verify-shaped parameter list → medium (not high)',
    findings.length === 1 && findings[0].severity === 'medium', JSON.stringify(findings));
}

async function testOtherServerChainIsLow() {
  const findings = await scanFiles({
    'lib/cache.js': ['function warm () {', '  loadAll().then(items => store(items))', '}'],
  });
  return report('Server chain outside request handling → low', findings.length === 1 && findings[0].severity === 'low', JSON.stringify(findings));
}

async function testBrowserChainIsLow() {
  const findings = await scanFiles({
    'frontend/src/app/search.component.ts': [
      'startInstructor (name: string) {',
      "  import('../../hacking-instructor').then(module => {",
      '    module.start(name)',
      '  })',
      '}',
    ],
  });
  const f = findings[0];
  return report(
    'Browser chain (dynamic import) → low, noted as lazy loading',
    findings.length === 1 && f.severity === 'low' && f.context.some((c) => /browser/i.test(c)) && f.context.some((c) => /import\(\)/.test(c)),
    JSON.stringify(findings),
  );
}

async function testVoidChainReportedWithIntent() {
  // Juice Shop routes/verify.ts:216
  const findings = await scanFiles({
    'routes/verify.ts': ['function changeProductChallenge (osaft) {', '  void osaft.reload().then(() => {', '    check(osaft)', '  })', '}'],
  });
  const f = findings[0];
  return report(
    "`void promise.then(...)` still reported, with a 'looks deliberate' factor",
    findings.length === 1 && f.context.some((c) => /void/.test(c)),
    JSON.stringify(findings),
  );
}

async function testHandledChainsNotFlagged() {
  const findings = await scanFiles({
    'core/appHandler.js': [
      'module.exports.a = function (req, res) {',
      '  db.User.find({ where: { id: req.body.id } }).then(user => {',
      '    res.json(user)',
      '    // a long body so the .catch is far away',
      '    log(1)', '    log(2)', '    log(3)', '    log(4)', '    log(5)', '    log(6)', '    log(7)', '    log(8)', '    log(9)', '    log(10)', '    log(11)', '    log(12)', '    log(13)', '    log(14)', '    log(15)', '    log(16)',
      '  }).catch(err => res.status(500).end())',
      '  db.User.find().then(ok, fail)',
      '  db.User.find().then(ok).finally(done).catch(fail)',
      '}',
      'function b () { return db.User.find().then(ok) }',
      'async function c () { await db.User.find().then(ok) }',
      'const p = db.User.find().then(ok)',
    ],
  });
  return report('.catch (even 20 lines later), two-arg .then, returned / awaited / assigned chains not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testNestedChainsReportedSeparately() {
  // DVNA core/appHandler.js:144 — user.save().then(...) nested inside find().then(...)
  const findings = await scanFiles({
    'core/appHandler.js': [
      'module.exports.userEditSubmit = function (req, res) {',
      '  db.User.find({ where: { id: req.body.id } }).then(user => {',
      '    user.save().then(function () {',
      "      res.render('app/useredit')",
      '    })',
      '  })',
      '}',
    ],
  });
  const lines = findings.map((f) => `${f.line}:${f.severity}`).sort();
  return report('Outer and nested chains are two findings (outer high, inner medium)', JSON.stringify(lines) === JSON.stringify(['2:high', '3:medium']), JSON.stringify(lines));
}

async function testChainContinuedOnNextLineIsOneChain() {
  // Juice Shop data/datacreator.ts: a .then() starting its own line continues the chain above
  const findings = await scanFiles({
    'lib/seed.js': ['function seed () {', '  create(product).then(p => p)', '    .then(p => insertReviews(p))', '}'],
  });
  return report('A .then() on its own line continues the chain (one finding, not two)', findings.length === 1 && findings[0].line === 2, JSON.stringify(findings));
}

async function testDeeplyNestedChainKeepsRouteContext() {
  // DVNA core/appHandler.js:175 — user.save().then(...) 30 lines into userEditSubmit
  const filler = Array.from({ length: 30 }, (_, i) => `    log(${i})`);
  const findings = await scanFiles({
    'core/appHandler.js': [
      'module.exports.userEditSubmit = function (req, res) {',
      '  db.User.find({ where: { id: req.body.id } }).then(user => {',
      ...filler,
      '    user.save().then(function () {',
      "      res.render('app/useredit')",
      '    })',
      '  })',
      '}',
    ],
  });
  const inner = findings.find((f) => f.line === 33);
  return report('Chain far inside a route handler still counts as route context (medium)', inner?.severity === 'medium', JSON.stringify(findings));
}

async function testThenInCommentsAndStringsNotFlagged() {
  const findings = await scanFiles({
    'lib/a.js': [
      '// db.find().then(x => x)',
      ' * promise.then(done)',
      "const help = 'call fetch(url).then(cb) to load'",
    ],
  });
  return report('.then in comments and strings not flagged', findings.length === 0, JSON.stringify(findings));
}

// --- Async route handlers ---

async function testUnwrappedInlineAsyncRouteIsHigh() {
  const findings = await scanFiles({
    'server.js': [
      "const app = require('express')()",
      "app.get('/users/:id', async (req, res) => {",
      '  const user = await db.find(req.params.id)',
      '  res.json(user)',
      '})',
    ],
    'package.json': '{ "dependencies": { "express": "^4.21.0" } }',
  });
  const f = findings[0];
  return report('Unwrapped inline async route with await outside try → high', findings.length === 1 && f.line === 2 && f.severity === 'high' && hasShape(f), JSON.stringify(findings));
}

async function testAwaitInsideTryNotFlagged() {
  const findings = await scanFiles({
    'server.js': [
      "app.get('/users/:id', async (req, res, next) => {",
      '  try {',
      '    res.json(await db.find(req.params.id))',
      '  } catch (err) {',
      '    next(err)',
      '  }',
      '})',
    ],
  });
  return report('All awaits inside try → not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testAwaitInCatchBlockFlagged() {
  const findings = await scanFiles({
    'server.js': [
      "app.post('/x', async (req, res) => {",
      '  try {',
      '    await work()',
      '  } catch (err) {',
      '    await audit.log(err)',
      '  }',
      '})',
    ],
  });
  return report('Await inside the catch block is unprotected → flagged', findings.length === 1 && findings[0].severity === 'high', JSON.stringify(findings));
}

async function testWrappedFactoryHandlerNotFlagged() {
  // Juice Shop: routes/address.ts exports a factory, server.ts registers it via utils.asyncHandler(...)
  const files = {
    'routes/address.ts': [
      'export function getAddress () {',
      '  return async (req: Request, res: Response) => {',
      '    const addresses = await AddressModel.findAll({ where: { UserId: req.body.UserId } })',
      '    res.status(200).json({ status: \'success\', data: addresses })',
      '  }',
      '}',
    ],
    'server.ts': [
      "import { getAddress } from './routes/address'",
      "app.get('/api/Addresss', security.appendUserId(), utils.asyncHandler(getAddress()))",
    ],
  };
  const wrapped = await scanFiles(files);
  const unwrapped = await scanFiles({ ...files, 'server.ts': ["import { getAddress } from './routes/address'", "app.get('/api/Addresss', security.appendUserId(), getAddress())"] });
  return report(
    'Factory handler registered through asyncHandler() not flagged; same handler registered bare → high',
    wrapped.length === 0 && unwrapped.length === 1 && unwrapped[0].file === 'routes/address.ts' && unwrapped[0].severity === 'high'
      && unwrapped[0].context.some((c) => c.includes('server.ts:2')),
    JSON.stringify({ wrapped, unwrapped }),
  );
}

async function testExpress5NotFlagged() {
  const findings = await scanFiles({
    'server.js': ["app.get('/u', async (req, res) => {", '  res.json(await db.find())', '})'],
    'package.json': '{ "dependencies": { "express": "^5.1.0" } }',
  });
  return report('Express 5 handles async rejections → not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testExpressAsyncErrorsNotFlagged() {
  const findings = await scanFiles({
    'server.js': ["require('express-async-errors')", "app.get('/u', async (req, res) => {", '  res.json(await db.find())', '})'],
    'package.json': '{ "dependencies": { "express": "^4.21.0" } }',
  });
  return report('express-async-errors installed → not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testHelperWithExtraParamsNotFlagged() {
  // Juice Shop routes/basketItems.ts:85 — quantityCheck(req, res, next, id, quantity) is awaited by the handlers
  const findings = await scanFiles({
    'routes/basketItems.ts': [
      'async function quantityCheck (req: Request, res: Response, next: NextFunction, id: number, quantity: number) {',
      '  const product = await QuantityModel.findOne({ where: { ProductId: id } })',
      '  next()',
      '}',
    ],
  });
  return report('async helper taking (req, res, next, …more) is not a route handler', findings.length === 0, JSON.stringify(findings));
}

async function testUnregisteredHandlerFlaggedWithLowerConfidence() {
  const findings = await scanFiles({
    'routes/users.js': ['module.exports.show = async function (req, res) {', '  res.json(await db.find(req.params.id))', '}'],
  });
  const f = findings[0];
  return report(
    'Async handler whose registration can\'t be found → high, lower confidence, says so',
    findings.length === 1 && f.severity === 'high' && f.confidence < 0.7 && f.context.some((c) => /registered/i.test(c)),
    JSON.stringify(findings),
  );
}

// --- Patterns that lose rejections ---

async function testForEachAsync() {
  const findings = await scanFiles({
    'lib/jobs.js': 'items.forEach(async (item) => { await save(item) })',
    'frontend/src/app/list.component.ts': 'this.items.forEach(async (item) => { await this.load(item) })',
  });
  const bySide = Object.fromEntries(findings.map((f) => [f.file, f.severity]));
  return report(
    'forEach(async …) → medium on the server, low in the browser',
    findings.length === 2 && bySide['lib/jobs.js'] === 'medium' && bySide['frontend/src/app/list.component.ts'] === 'low' && findings.every(hasShape),
    JSON.stringify(findings),
  );
}

async function testAsyncPromiseExecutorTimersAndListeners() {
  const findings = await scanFiles({
    'lib/misc.js': [
      'const p = new Promise(async (resolve, reject) => { resolve(await load()) })',
      'setTimeout(async () => { await refresh() }, 1000)',
      "socket.on('message', async (msg) => { await handle(msg) })",
      "setTimeout(() => refresh(), 1000)",
      "socket.on('message', (msg) => handle(msg))",
    ],
  });
  const lines = findings.map((f) => f.line).sort();
  return report(
    'new Promise(async), setTimeout(async), async .on() listener → medium; sync versions not flagged',
    JSON.stringify(lines) === JSON.stringify([1, 2, 3]) && findings.every((f) => f.severity === 'medium'),
    JSON.stringify(findings),
  );
}

// --- Context, merging, ids ---

async function testNonProductionCappedLow() {
  const findings = await scanFiles({
    'examples/server.js': ["app.get('/u', async (req, res) => {", '  res.json(await db.find(req.query.id))', '})'],
  });
  return report('Example file → low', findings.length === 1 && findings[0].severity === 'low', JSON.stringify(findings));
}

async function testOneFindingPerLine() {
  const findings = await scanFiles({
    'lib/jobs.js': 'items.forEach(async (item) => { await save(item) }); load().then(done)',
  });
  return report('Two issues on one line → one finding listing both', findings.length === 1 && findings[0].title.includes('+'), JSON.stringify(findings));
}

async function testIdsUnique() {
  const findings = await scanFiles({
    'lib/a.js': 'items.forEach(async (x) => { await save(x) })',
    'lib/b.js': 'items.forEach(async (x) => { await save(x) })',
  });
  return report('Finding ids are unique across files', findings.length === 2 && new Set(findings.map((f) => f.id)).size === 2, JSON.stringify(findings.map((f) => f.id)));
}

async function runTests() {
  console.log('🧪 Running Async Footgun Scanner Tests\n');
  const results = [];

  results.push(await testRouteChainWithRequestInputIsHigh());
  results.push(await testRouteChainWithoutRequestInputIsMedium());
  results.push(await testAuthCallbackChainIsMedium());
  results.push(await testLocalStrategyCredentialsAreRequestInput());
  results.push(await testLocalStrategyCustomFieldWithoutReq());
  results.push(await testLocalStrategyChainWithoutCredentialsIsMedium());
  results.push(await testLocalStrategyNestedFunctionAndBlocks());
  results.push(await testLocalStrategyArrowAndCbCallback());
  results.push(await testClosedLocalStrategyCallDoesNotCount());
  results.push(await testLocalStrategyArrowWithoutOptions());
  results.push(await testInnerCallbackIsNotTheVerifyCallback());
  results.push(await testClosedLiteralsAndCallsBeforeTheChain());
  results.push(await testDeserializeChainInBlockStaysMedium());
  results.push(await testOtherStrategyParamsAreNotRequestInput());
  results.push(await testNonPassportStrategyIsNotAuthCallback());
  results.push(await testOtherPassportStrategyWithOptionsIsMedium());
  results.push(await testLocalStrategyTypedParams());
  results.push(await testPassportLocalImportStyles());
  results.push(await testPassportImportForms());
  results.push(await testLocalStrategyShapes());
  results.push(await testReqObjectIsNotACredential());
  results.push(await testStrategyCallWithoutOptionsInNonPassportFileIsLow());
  results.push(await testCommentedOutPassportImportDoesNotCount());
  results.push(await testOtherStrategyNamespaceInPassportLocalFileIsNotCredentials());
  results.push(await testRequestFirstParamIsNotACredential());
  results.push(await testLocalStrategyFunctionTypedDone());
  results.push(await testVerifyCallbackNames());
  results.push(await testTwoParamCallbackIsNotTheVerifyCallback());
  results.push(await testCredentialNameAsPropertyDoesNotCount());
  results.push(await testPassportLocalModuleBindingsAndWrappedImports());
  results.push(await testVerifyCallbackSpacing());
  results.push(await testVerifyCallbackDefaultParameter());
  results.push(await testCalleeContainingStrategyIsNotAStrategyCall());
  results.push(await testUnrecognisedVerifySignatureStaysMedium());
  results.push(await testOtherServerChainIsLow());
  results.push(await testBrowserChainIsLow());
  results.push(await testVoidChainReportedWithIntent());
  results.push(await testHandledChainsNotFlagged());
  results.push(await testNestedChainsReportedSeparately());
  results.push(await testChainContinuedOnNextLineIsOneChain());
  results.push(await testDeeplyNestedChainKeepsRouteContext());
  results.push(await testThenInCommentsAndStringsNotFlagged());
  results.push(await testUnwrappedInlineAsyncRouteIsHigh());
  results.push(await testAwaitInsideTryNotFlagged());
  results.push(await testAwaitInCatchBlockFlagged());
  results.push(await testWrappedFactoryHandlerNotFlagged());
  results.push(await testExpress5NotFlagged());
  results.push(await testExpressAsyncErrorsNotFlagged());
  results.push(await testHelperWithExtraParamsNotFlagged());
  results.push(await testUnregisteredHandlerFlaggedWithLowerConfidence());
  results.push(await testForEachAsync());
  results.push(await testAsyncPromiseExecutorTimersAndListeners());
  results.push(await testNonProductionCappedLow());
  results.push(await testOneFindingPerLine());
  results.push(await testIdsUnique());

  console.log(`\n📊 Results: ${results.filter(Boolean).length}/${results.length} passed\n`);

  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  process.exit(results.every(Boolean) ? 0 : 1);
}

runTests().catch((error) => {
  console.error('Test error:', error.message);
  process.exit(1);
});
