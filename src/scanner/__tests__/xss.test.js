import fs from 'fs';
import path from 'path';
import { scanForXss } from '../patterns/xss.js';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', '..', '..', '.test-tmp-xss');

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
  return scanForXss(testPath);
}

function report(name, passed, detail = '') {
  console.log(`${passed ? '✓' : '✗'} ${name}: ${passed ? 'passed' : `failed ${detail}`}`);
  return passed;
}

async function testAngularBypassWithUrlInput() {
  // Juice Shop DOM XSS: query param → bypassSecurityTrustHtml
  const findings = await scanSource('search-result.component.ts', [
    'filterTable () {',
    '  let queryParam: string = this.route.snapshot.queryParams.q',
    '  this.searchValue = this.sanitizer.bypassSecurityTrustHtml(queryParam)',
    '}',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'Angular bypass with URL input → high',
    findings.length === 1 && finding.line === 3 && finding.severity === 'high'
      && finding.title.includes('Sanitizer Bypass') && finding.type === 'xss'
      && finding.context.length >= 3,
    JSON.stringify(findings),
  );
}

async function testMultiLineSinkArgument() {
  const findings = await scanSource('about.component.ts', [
    'feedbacks[i].comment = this.sanitizer.bypassSecurityTrustHtml(',
    '  feedbacks[i].comment',
    ')',
  ].join('\n'));
  return report('Sink argument on the next line', findings.length === 1 && findings[0].line === 1, JSON.stringify(findings));
}

async function testInnerHtmlAssignment() {
  const findings = await scanSource('widget.js', 'el.innerHTML = user.bio;');
  return report(
    'innerHTML assignment → medium',
    findings.length === 1 && findings[0].severity === 'medium' && findings[0].tags.includes('dom'),
    JSON.stringify(findings),
  );
}

async function testStaticAndComparisonNotFlagged() {
  const findings = await scanSource('widget.js', [
    "cancelButton.innerHTML = '<div>&times;</div>'",
    'if (element.innerHTML === value) { done() }',
    'el.innerHTML = `<p>Loading…</p>`;',
    'const txt = $(val).html();',
  ].join('\n'));
  return report('Static HTML / comparisons / getters not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testSanitizedValueDowngraded() {
  const findings = await scanSource('widget.js', 'el.innerHTML = DOMPurify.sanitize(user.bio);');
  return report(
    'Sanitized value → low',
    findings[0]?.severity === 'low' && findings[0].context.some((c) => c.includes('sanitizer')),
    JSON.stringify(findings),
  );
}

async function testEjsUnescapedOutput() {
  const findings = await scanSource('views/products.ejs', [
    "<%- include('header') %>",
    '<p>Search: <%- output.searchTerm %></p>',
    '<p>Safe: <%= output.searchTerm %></p>',
  ].join('\n'));
  return report(
    'EJS <%- %> flagged, <%= %> and include not',
    findings.length === 1 && findings[0].line === 2 && findings[0].tags.includes('template'),
    JSON.stringify(findings),
  );
}

async function testHandlebarsTripleStash() {
  const findings = await scanSource('views/page.hbs', [
    '<title>{{title}}</title>',
    '<div>{{{ comment.body }}}</div>',
  ].join('\n'));
  return report('Handlebars {{{ }}} flagged, {{ }} not', findings.length === 1 && findings[0].line === 2, JSON.stringify(findings));
}

async function testVueVHtml() {
  const findings = await scanSource('Comment.vue', '<div v-html="comment.body"></div>');
  return report('Vue v-html flagged', findings.length === 1, JSON.stringify(findings));
}

async function testPugUnescapedOnlyInTemplates() {
  const pug = await scanSource('views/profile.pug', 'p !{user.bio}');
  const js = await scanSource('app.js', 'if (!{ ...options }.silent) log()');
  return report('Pug !{} flagged in .pug, ignored in .js', pug.length === 1 && js.length === 0, JSON.stringify({ pug, js }));
}

async function testReactDangerouslySetInnerHtml() {
  const findings = await scanSource('Comment.jsx', '<div dangerouslySetInnerHTML={{ __html: props.body }} />');
  return report('React dangerouslySetInnerHTML flagged', findings.length === 1, JSON.stringify(findings));
}

async function testJqueryHtml() {
  const findings = await scanSource('footer.js', '$(val).html(converter.makeHtml(txt));');
  return report('jQuery .html(value) flagged', findings.length === 1, JSON.stringify(findings));
}

async function testReflectedInRouteIsCritical() {
  const findings = await scanSource('routes.js', [
    "app.get('/hello', (req, res) => {",
    "  res.send('<h1>Hello ' + req.query.name + '</h1>');",
    '});',
  ].join('\n'));
  const finding = findings[0];
  return report(
    'Reflected req.* in route handler → critical',
    finding?.severity === 'critical'
      && finding.context.some((c) => c.includes('User input'))
      && finding.context.some((c) => c.includes('route handler')),
    JSON.stringify(findings),
  );
}

async function testExportedHandlerIsCritical() {
  const findings = await scanSource('core/handler.js', [
    'module.exports.greet = function (req, res) {',
    "  res.send('<p>' + req.body.name + '</p>')",
    '}',
  ].join('\n'));
  return report('Exported (req, res) handler → critical', findings[0]?.severity === 'critical', JSON.stringify(findings));
}

async function testResponseTracesVariable() {
  // Juice Shop Video XSS: HTML built on one line, sent on the next
  const findings = await scanSource('videoHandler.ts', [
    'let page = fn()',
    "page = page.replace('<script id=\"subtitle\"></script>', '<script id=\"subtitle\">' + subs + '</script>')",
    'res.send(page)',
  ].join('\n'));
  return report('res.send(variable) traced back to HTML concat', findings.length === 1 && findings[0].line === 3, JSON.stringify(findings));
}

async function testNonHtmlResponsesNotFlagged() {
  const findings = await scanSource('routes.js', [
    "app.get('/items', (req, res) => {",
    '  res.send(utils.queryResultToJson(items))',
    "  res.send('Error fetching items')",
    '  res.json(req.body)',
    '  res.write(`data: ${JSON.stringify(event)}\\n\\n`)',
    '  res.send(html)',
    '});',
  ].join('\n'));
  return report('JSON / static / untraced responses not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testEscapedInputNotEscalated() {
  const findings = await scanSource('routes.js', [
    "app.get('/user/:uid', (req, res) => {",
    "  res.send('<p>user ' + escapeHtml(req.params.uid) + '</p>')",
    '});',
  ].join('\n'));
  return report(
    'escapeHtml(req.*) → not escalated',
    findings[0]?.severity === 'low' && !findings[0].context.some((c) => c.includes('flows directly')),
    JSON.stringify(findings),
  );
}

async function testConstantIsLow() {
  const findings = await scanSource('banner.js', 'banner.innerHTML = DEFAULT_BANNER;');
  return report('Constant value → low', findings[0]?.severity === 'low', JSON.stringify(findings));
}

async function testCommentedCodeNotFlagged() {
  const findings = await scanSource('widget.js', '// el.innerHTML = user.bio;');
  return report('Commented-out code not flagged', findings.length === 0, JSON.stringify(findings));
}

async function testExampleFileContext() {
  const findings = await scanSource('examples/widget.js', 'el.innerHTML = user.bio;');
  return report(
    'Example file context factor',
    findings[0]?.context.some((c) => c.includes('test/example')),
    JSON.stringify(findings),
  );
}

async function testSnippetFileCappedLow() {
  const findings = await scanSource('data/static/codefixes/localXssChallenge_1.ts', [
    'let queryParam: string = this.route.snapshot.queryParams.q',
    'this.searchValue = this.sanitizer.bypassSecurityTrustResourceUrl(queryParam)',
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
  // Express's own test suite: res.send(req.params.user) inside app.get(...)
  const findings = await scanSource('test/app.router.js', [
    "app.get('/user/:user', function (req, res) {",
    '  res.send(req.params.user);',
    '});',
  ].join('\n'));
  return report('Test file → low (not critical)', findings[0]?.severity === 'low', JSON.stringify(findings[0]));
}

async function testSkipsVendoredCode() {
  const testPath = setup();
  fs.mkdirSync(path.join(testPath, 'node_modules', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(testPath, 'node_modules', 'lib', 'index.js'), 'el.innerHTML = value;');
  fs.writeFileSync(path.join(testPath, 'jquery.min.js'), 'a.innerHTML = b;');
  const findings = await scanForXss(testPath);
  return report('Skips node_modules and .min.js', findings.length === 0, JSON.stringify(findings));
}

async function runTests() {
  console.log('\n🧪 Running XSS tests...\n');

  const results = [];
  results.push(await testAngularBypassWithUrlInput());
  results.push(await testMultiLineSinkArgument());
  results.push(await testInnerHtmlAssignment());
  results.push(await testStaticAndComparisonNotFlagged());
  results.push(await testSanitizedValueDowngraded());
  results.push(await testEjsUnescapedOutput());
  results.push(await testHandlebarsTripleStash());
  results.push(await testVueVHtml());
  results.push(await testPugUnescapedOnlyInTemplates());
  results.push(await testReactDangerouslySetInnerHtml());
  results.push(await testJqueryHtml());
  results.push(await testReflectedInRouteIsCritical());
  results.push(await testExportedHandlerIsCritical());
  results.push(await testResponseTracesVariable());
  results.push(await testNonHtmlResponsesNotFlagged());
  results.push(await testEscapedInputNotEscalated());
  results.push(await testConstantIsLow());
  results.push(await testCommentedCodeNotFlagged());
  results.push(await testExampleFileContext());
  results.push(await testSnippetFileCappedLow());
  results.push(await testTestFileCappedLow());
  results.push(await testSkipsVendoredCode());

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
