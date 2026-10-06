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
