import fs from 'fs';
import path from 'path';
import { scanForSqlInjection } from '../patterns/sql-injection.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Unique per run, so parallel runs (Stryker workers) don't delete each other's fixtures
const tmpDir = fs.mkdtempSync(path.join(__dirname, '..', '..', '..', '.test-tmp-sqli-'));

function setup() {
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

async function scanSource(fileName, source) {
  const testPath = setup();
  fs.mkdirSync(path.dirname(path.join(testPath, fileName)), { recursive: true });
  fs.writeFileSync(path.join(testPath, fileName), source);
  return scanForSqlInjection(testPath);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

async function testConcatenationDetection() {
  const findings = await scanSource('db.js', `const query = 'SELECT * FROM users WHERE id = ' + userId;`);
  return report(
    'String concatenation detection',
    findings.length === 1 && findings[0].title.includes('Concatenation') && findings[0].line === 1,
    JSON.stringify(findings),
  );
}

async function testLowercaseSqlDetection() {
  const findings = await scanSource('db.js', `const q = "select id, name from users where name = '" + name + "'";`);
  return report('Lowercase SQL detection', findings.length === 1, JSON.stringify(findings));
}

async function testTemplateLiteralDetection() {
  const findings = await scanSource('db.js', 'db.query(`SELECT name FROM users WHERE email = \'${email}\'`);');
  return report(
    'Template literal detection',
    findings.length === 1 && findings[0].title.includes('Template'),
    JSON.stringify(findings),
  );
}

async function testUserInputInRouteUpgradesSeverity() {
  const findings = await scanSource('routes.js', [
    "app.get('/users/:id', (req, res) => {",
    "  db.query('SELECT * FROM users WHERE id = ' + req.params.id, (err, rows) => res.json(rows));",
    '});',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'User input in route handler → critical',
    finding?.severity === 'critical'
      && finding.context.some((c) => c.includes('User input'))
      && finding.context.some((c) => c.includes('route handler'))
      && finding.context.length >= 3,
    JSON.stringify(finding),
  );
}

async function testExportedHandlerFunctionIsRouteHandler() {
  // DVNA style: handler defined in its own module, no app.get( in the file
  const findings = await scanSource('core/appHandler.js', [
    'module.exports.userSearch = function (req, res) {',
    "  var query = \"SELECT name,id FROM Users WHERE login='\" + req.body.login + \"'\";",
    '};',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'Exported (req, res) function → critical',
    finding?.severity === 'critical' && finding.context.some((c) => c.includes('route handler')),
    JSON.stringify(finding),
  );
}

async function testTypedArrowHandlerIsRouteHandler() {
  // Juice Shop style: factory returning a typed (req: Request, res: Response) arrow function
  const findings = await scanSource('routes/login.ts', [
    'export function login () {',
    '  return (req: Request, res: Response, next: NextFunction) => {',
    "    models.sequelize.query(`SELECT * FROM Users WHERE email = '${req.body.email || ''}'`)",
    '  }',
    '}',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'Typed (req: Request, res: Response) arrow → critical',
    finding?.severity === 'critical' && finding.context.some((c) => c.includes('route handler')),
    JSON.stringify(finding),
  );
}

async function testNoUserInputStaysMedium() {
  const findings = await scanSource('report.js', `const sql = "DELETE FROM sessions WHERE user_id = " + userId;`);
  return report('No visible user input → medium', findings[0]?.severity === 'medium', JSON.stringify(findings[0]));
}

async function testEscapingDowngradesSeverity() {
  const findings = await scanSource('safe.js', [
    'const id = parseInt(req.query.id, 10);',
    "const sql = 'SELECT * FROM orders WHERE id = ' + id;",
  ].join('\n'));
  return report(
    'Numeric cast nearby → downgraded',
    findings[0]?.severity === 'medium' && findings[0].context.some((c) => c.includes('Escaping or numeric cast')),
    JSON.stringify(findings[0]),
  );
}

async function testConstantInterpolationIsLow() {
  const findings = await scanSource('pager.js', 'const sql = `SELECT * FROM posts LIMIT ${PAGE_SIZE}`;');
  return report('Constant interpolation → low', findings[0]?.severity === 'low', JSON.stringify(findings[0]));
}

async function testParameterizedQueryNotFlagged() {
  const findings = await scanSource('db.js', [
    "db.query('SELECT * FROM users WHERE id = ?', [userId]);",
    "pool.query('UPDATE users SET name = $1 WHERE id = $2', [name, id]);",
  ].join('\n'));
  return report('Parameterized queries not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testNonSqlStringsNotFlagged() {
  const findings = await scanSource('app.js', [
    "app.use(express.raw());",
    "const msg = 'Please select an option from ' + menuName;",
    "const greeting = `Hello ${user.name}, update your profile`;",
    "request(app).get('/').query('/').expect(200);",
  ].join('\n'));
  return report('Non-SQL strings not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testCommentedCodeNotFlagged() {
  const findings = await scanSource('db.js', `// const query = 'SELECT * FROM users WHERE id = ' + userId;`);
  return report('Commented-out code not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testExampleFileContext() {
  const findings = await scanSource('examples/db.js', `const query = 'SELECT * FROM users WHERE id = ' + userId;`);
  return report(
    'Example file context factor',
    findings[0]?.context.some((c) => c.includes('test/example')),
    JSON.stringify(findings[0]),
  );
}

async function testSnippetFileCappedLow() {
  // Juice Shop's "pick the right fix" quiz files: vulnerable, but never executed
  const findings = await scanSource('data/static/codefixes/loginAdminChallenge_1.ts', [
    'return (req: Request, res: Response, next: NextFunction) => {',
    "  models.sequelize.query(`SELECT * FROM Users WHERE email = '${req.body.email}'`)",
    '}',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'Code snippet file → low, flagged non-executed',
    finding?.severity === 'low' && finding.confidence <= 0.5
      && finding.context.some((c) => c.includes('Non-executed')),
    JSON.stringify(finding),
  );
}

async function testTestFileCappedLow() {
  const findings = await scanSource('test/routes.js', [
    "app.get('/users/:id', (req, res) => {",
    "  db.query('SELECT * FROM users WHERE id = ' + req.params.id);",
    '});',
  ].join('\n'));
  return report('Test file → low (not critical)', findings[0]?.severity === 'low', JSON.stringify(findings[0]));
}

async function testSkipsNodeModules() {
  const findings = await scanSource('node_modules/orm/index.js', `const query = 'SELECT * FROM t WHERE id = ' + id;`);
  return report('Skips node_modules', findings.length === 0, JSON.stringify(findings));
}

async function testMultiLineConcatenation() {
  const findings = await scanSource('db.js', [
    "const query = 'SELECT * FROM users ' +",
    "  'WHERE id = ' + userId;",
  ].join('\n'));
  return report('Multi-line concatenation (trailing +)', findings.length === 1 && findings[0].line === 1, JSON.stringify(findings));
}

async function testMultiLineLeadingPlus() {
  const findings = await scanSource('db.js', [
    "const query = 'select id, name '",
    "  + 'from users where email = ' + email;",
  ].join('\n'));
  return report('Multi-line concatenation (leading +, lowercase)', findings.length === 1 && findings[0].line === 1, JSON.stringify(findings));
}

async function testMultiLineTemplateLiteral() {
  const findings = await scanSource('routes.js', [
    "router.post('/orders', async (req, res) => {",
    '  const rows = await db.query(`',
    '    SELECT * FROM orders',
    '    WHERE customer = ${req.body.customer}',
    '  `);',
    '});',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'Multi-line template literal → critical',
    findings.length === 1 && finding.line === 2 && finding.severity === 'critical',
    JSON.stringify(findings),
  );
}

async function testMultiLineParameterizedNotFlagged() {
  const findings = await scanSource('db.js', [
    'db.query(',
    "  'SELECT * FROM users ' +",
    "  'WHERE id = ?',",
    '  [userId],',
    ');',
    'const html = `',
    '  <div>${user.name}</div>',
    '`;',
  ].join('\n'));
  return report('Multi-line safe code not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testLineNumbersAfterMultiLineStatement() {
  const findings = await scanSource('db.js', [
    'const intro = `',
    '  Welcome back',
    '`;',
    "const query = 'DELETE FROM sessions WHERE id = ' + sessionId;",
  ].join('\n'));
  return report('Line numbers correct after multi-line statement', findings[0]?.line === 4, JSON.stringify(findings));
}

async function runTests() {
  console.log('\n🧪 Running SQL injection tests...\n');

  const results = [];
  results.push(await testConcatenationDetection());
  results.push(await testLowercaseSqlDetection());
  results.push(await testTemplateLiteralDetection());
  results.push(await testUserInputInRouteUpgradesSeverity());
  results.push(await testExportedHandlerFunctionIsRouteHandler());
  results.push(await testTypedArrowHandlerIsRouteHandler());
  results.push(await testNoUserInputStaysMedium());
  results.push(await testEscapingDowngradesSeverity());
  results.push(await testConstantInterpolationIsLow());
  results.push(await testParameterizedQueryNotFlagged());
  results.push(await testNonSqlStringsNotFlagged());
  results.push(await testCommentedCodeNotFlagged());
  results.push(await testExampleFileContext());
  results.push(await testSnippetFileCappedLow());
  results.push(await testTestFileCappedLow());
  results.push(await testSkipsNodeModules());
  results.push(await testMultiLineConcatenation());
  results.push(await testMultiLineLeadingPlus());
  results.push(await testMultiLineTemplateLiteral());
  results.push(await testMultiLineParameterizedNotFlagged());
  results.push(await testLineNumbersAfterMultiLineStatement());

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
