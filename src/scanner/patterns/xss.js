import fs from 'fs';
import path from 'path';
import {
  isSourceFile, isTemplateFile, nonProductionContext, walkDir, toStatements, USER_INPUT, ROUTE_HANDLER,
} from '../file-utils.js';

// How many physical lines after a sink to read when its argument spans lines: `sink(\n  value\n)`
const ARGUMENT_LOOKAHEAD = 5;

// Return the text inside the parentheses that open at `openIndex`, or null if they never close
function balancedArgument(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (depth === 0) return text.slice(openIndex + 1, i);
  }
  return null;
}

const callArgument = (match, rest) => balancedArgument(rest, match[0].length - 1);

const PATTERNS = [
  {
    name: 'Angular Sanitizer Bypass',
    sink: 'framework-bypass',
    // this.sanitizer.bypassSecurityTrustHtml(value)
    regex: /\bbypassSecurityTrust(Html|Script|Url|ResourceUrl|Style)\s*\(/g,
    payload: callArgument,
    detected: '✓ Angular sanitization explicitly bypassed (bypassSecurityTrust*)',
    description: 'Value is marked as trusted HTML, so Angular renders it without sanitizing',
  },
  {
    name: 'React dangerouslySetInnerHTML',
    sink: 'framework-bypass',
    // <div dangerouslySetInnerHTML={{ __html: value }} />
    regex: /dangerouslySetInnerHTML\s*=\s*\{\{\s*__html\s*:\s*([^}]+?)\s*\}\}/g,
    payload: (match) => match[1],
    detected: '✓ React escaping bypassed (dangerouslySetInnerHTML)',
    description: 'Value is rendered as raw HTML instead of escaped text',
  },
  {
    name: 'DOM innerHTML Assignment',
    sink: 'dom',
    // el.innerHTML = value   (not el.innerHTML === value)
    regex: /\.(innerHTML|outerHTML)\s*\+?=(?!=)\s*(.+)/g,
    payload: (match) => match[2].replace(/;\s*$/, ''),
    detected: '✓ Value assigned to innerHTML/outerHTML',
    description: 'Value is parsed as HTML by the browser, so any markup or script in it runs',
  },
  {
    name: 'DOM HTML Write',
    sink: 'dom',
    // document.write(value), el.insertAdjacentHTML('beforeend', value), $(el).html(value)
    regex: /(\bdocument\.write(ln)?|\.insertAdjacentHTML|\.html)\s*\(/g,
    payload: callArgument,
    detected: '✓ Value written into the page as HTML (document.write / insertAdjacentHTML / .html())',
    description: 'Value is parsed as HTML by the browser, so any markup or script in it runs',
  },
  {
    name: 'Unescaped Template Output',
    sink: 'template',
    // EJS <%- value %>, Handlebars {{{ value }}}, Pug !{value}, Vue v-html="value"
    regex: /<%-(?!\s*include\b)\s*(.+?)\s*-?%>|\{\{\{\s*(.+?)\s*\}\}\}|!\{([^}]+)\}|\bv-html\s*=\s*"([^"]+)"/g,
    payload: (match) => match[1] ?? match[2] ?? match[3] ?? match[4],
    templatesOnly: true,
    detected: '✓ Template outputs a value without HTML escaping',
    description: 'Template renders the value as raw HTML instead of escaping it',
  },
  {
    name: 'HTML Response from Variable',
    sink: 'response',
    // res.send('<p>' + name + '</p>'), res.status(200).send(html)
    regex: /\bres(?:\.status\([^)]*\))?\.(send|write|end)\s*\(/g,
    payload: callArgument,
    // A response is only an XSS sink when it carries HTML or raw request data (not JSON / plain status text)
    requiresHtmlOrInput: true,
    detected: '✓ Dynamic HTML sent in an HTTP response',
    description: 'HTML response built from a variable without encoding it first',
  },
];

// Browser-side values an attacker controls via the URL, storage, or a token they can forge
const CLIENT_INPUT = /\b(location\.(search|hash|href)|document\.(URL|referrer|cookie)|URLSearchParams|queryParams?\b|route\.snapshot|window\.name|localStorage\.getItem|sessionStorage\.getItem|postMessage)\b/;
const SANITIZER_CALL = String.raw`\b(DOMPurify\.sanitize|sanitizeHtml|sanitize|escapeHtml|escape|encodeURIComponent|htmlEncode|encode)\s*\(`;
const SANITIZER = new RegExp(String.raw`${SANITIZER_CALL}|\bentities\.encode\b|\btextContent\b`);
const LOOKS_LIKE_HTML = /<\/?[a-zA-Z][\w-]*[\s>/]/;

const CONTEXT_WINDOW = 15;
const SEVERITY_LADDER = ['low', 'medium', 'high', 'critical'];

function shiftSeverity(severity, steps) {
  const index = SEVERITY_LADDER.indexOf(severity) + steps;
  return SEVERITY_LADDER[Math.max(0, Math.min(SEVERITY_LADDER.length - 1, index))];
}

// A plain string literal (no interpolation) can't carry attacker input
function isStaticValue(payload) {
  const value = payload.trim();
  return value === ''
    || /^(['"])(?:(?!\1).)*\1$/s.test(value)
    || (/^`[^`]*`$/s.test(value) && !value.includes('${'))
    || /^[\d.]+$/.test(value)
    || /^(true|false|null|undefined)$/.test(value);
}

// Drop sanitizer calls so `escapeHtml(req.params.id)` doesn't count as raw user input
function withoutSanitizedCalls(text) {
  let result = text;
  let match;
  const sanitizerCall = new RegExp(SANITIZER_CALL, 'g');
  while ((match = sanitizerCall.exec(result)) !== null) {
    const argument = balancedArgument(result, match.index + match[0].length - 1);
    if (argument === null) break;
    result = result.slice(0, match.index) + result.slice(match.index + match[0].length + argument.length + 1);
    sanitizerCall.lastIndex = match.index;
  }
  return result;
}

function isConstantValue(payload) {
  return /^[A-Z][A-Z0-9_]*$/.test(payload.trim());
}

// When the sink receives a bare variable, pull in the lines that assigned it so we can see what it holds:
//   html = '<p>' + name + '</p>'; ... res.send(html)
function assignmentsOf(payload, lines, startLine) {
  const name = payload.trim().match(/^(?:this\.)?([\w$]+)$/)?.[1];
  if (!name) return '';
  const assignment = new RegExp(String.raw`(\b(let|const|var)\s+|\.|^|[^\w$.])${name.replace(/\$/g, '\\$')}\s*\+?=(?!=)`);
  return lines
    .slice(Math.max(0, startLine - CONTEXT_WINDOW), startLine)
    .filter((line) => assignment.test(line))
    .join('\n');
}

function assessContext(lines, statement, payload, traced, filePath, pattern) {
  const { text, startLine, endLine } = statement;
  const nearby = lines.slice(Math.max(0, startLine - CONTEXT_WINDOW), endLine + 1).join('\n');
  const valueText = `${payload}\n${traced}`;

  const factors = [pattern.detected];
  let severity = 'medium';
  let confidence = 0.6;

  if (SANITIZER.test(valueText)) {
    factors.push('⚠ Value passes through an encoder/sanitizer (may be mitigated)');
    severity = shiftSeverity(severity, -1);
    confidence -= 0.2;
  } else {
    factors.push('⚠ No HTML encoding or sanitization visible');
  }

  const unsanitized = withoutSanitizedCalls(`${text}\n${traced}`);
  const serverInputOnLine = USER_INPUT.test(unsanitized);
  if (serverInputOnLine || USER_INPUT.test(withoutSanitizedCalls(nearby))) {
    factors.push(serverInputOnLine
      ? '✓ User input (req.*) flows directly into the HTML'
      : '✓ User input (req.*) read nearby — likely flows into the HTML');
    severity = shiftSeverity(severity, 1);
    confidence += serverInputOnLine ? 0.25 : 0.15;
  } else if (CLIENT_INPUT.test(nearby)) {
    factors.push('✓ URL / storage value read nearby (attacker-controllable in the browser)');
    severity = shiftSeverity(severity, 1);
    confidence += 0.15;
  } else {
    factors.push('? Value source unclear (API or database data → possible stored XSS)');
  }

  if (ROUTE_HANDLER.test(nearby)) {
    factors.push('⚠ Inside a route handler (reachable over HTTP)');
    if (serverInputOnLine) severity = shiftSeverity(severity, 1);
    confidence += 0.05;
  } else if (pattern.sink === 'dom' || pattern.sink === 'framework-bypass') {
    factors.push('⚠ Runs in the browser (DOM-based XSS)');
  } else if (pattern.sink === 'template') {
    factors.push('? Template — check which route renders it and with what data');
  } else {
    factors.push('? Endpoint access level unclear (check routes)');
  }

  if (isConstantValue(payload)) {
    factors.push('⚠ Value looks like a constant (likely not attacker-controlled)');
    severity = 'low';
    confidence -= 0.3;
  }

  const nonProduction = nonProductionContext(filePath);
  if (nonProduction) {
    factors.push(nonProduction.factor);
    severity = 'low';
    confidence = nonProduction.adjustConfidence(confidence);
  }

  return {
    factors,
    severity,
    confidence: Math.round(Math.max(0.1, Math.min(0.95, confidence)) * 100) / 100,
  };
}

const REMEDIATION = {
  'framework-bypass': 'Don\'t mark untrusted data as trusted. Render it as text ({{ value }} in Angular, {value} in React); if it must contain HTML, sanitize it first: sanitizer.bypassSecurityTrustHtml(DOMPurify.sanitize(value)) / dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value) }}.',
  dom: 'Insert text, not HTML: el.textContent = value  // instead of el.innerHTML = value. If HTML is required, sanitize it first: el.innerHTML = DOMPurify.sanitize(value).',
  template: 'Use the escaping form of the template tag: <%= value %> instead of <%- value %> (EJS), {{ value }} instead of {{{ value }}} (Handlebars), #{value} instead of !{value} (Pug), {{ value }} instead of v-html (Vue).',
  response: 'Encode before building HTML: res.send(`<p>${escapeHtml(name)}</p>`)  // instead of \'<p>\' + name + \'</p>\'. Better: render through an auto-escaping template (res.render) or return data with res.json().',
};

export async function scanForXss(targetPath) {
  const findings = [];
  const seen = new Set();

  try {
    const files = walkDir(targetPath);

    for (const file of files) {
      if (!(isSourceFile(file) || isTemplateFile(file))) continue;

      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // Unreadable (permissions, broken symlink)
      }

      const relFile = path.relative(targetPath, file);
      const lines = content.split('\n');

      for (const statement of toStatements(lines)) {
        const firstLine = lines[statement.startLine].trim();
        if (firstLine.startsWith('//') || firstLine.startsWith('*')) continue;

        const lineNumber = statement.startLine + 1;
        const findingKey = `${relFile}:${lineNumber}`;
        // Lets a sink's argument continue onto the following lines
        const textWithLookahead = [statement.text, ...lines.slice(statement.endLine + 1, statement.endLine + 1 + ARGUMENT_LOOKAHEAD)].join('\n');

        for (const pattern of PATTERNS) {
          if (pattern.templatesOnly && !isTemplateFile(file)) continue;
          pattern.regex.lastIndex = 0;
          let match;

          while ((match = pattern.regex.exec(statement.text)) !== null) {
            const payload = pattern.payload(match, textWithLookahead.slice(match.index));
            if (payload === null || payload === undefined || isStaticValue(payload)) continue;

            const traced = assignmentsOf(payload, lines, statement.startLine);
            if (pattern.requiresHtmlOrInput
              && !LOOKS_LIKE_HTML.test(`${payload}\n${traced}`)
              && !USER_INPUT.test(payload)) continue;

            if (seen.has(findingKey)) continue;
            seen.add(findingKey);

            const { factors, severity, confidence } = assessContext(lines, statement, payload, traced, relFile, pattern);

            findings.push({
              id: `xss-${relFile.replace(/[^\w]/g, '_')}-${lineNumber}`,
              type: 'xss',
              title: `Potential XSS (${pattern.name})`,
              severity,
              confidence,
              description: pattern.description,
              file: relFile,
              line: lineNumber,
              snippet: statement.text.replace(/\s+/g, ' ').trim().substring(0, 120),
              context: factors,
              remediation: REMEDIATION[pattern.sink],
              references: [
                'https://owasp.org/www-community/attacks/xss/',
                'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html',
                'https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html',
              ],
              tags: ['xss', 'injection', pattern.sink],
            });
          }
        }
      }
    }
  } catch (error) {
    throw new Error(`XSS scanning failed: ${error.message}`);
  }

  return findings;
}
