import fs from 'fs';
import path from 'path';

const SKIPPED_PATHS = [
  /node_modules/,
  /\.git/,
  /dist\//,
  /build\//,
  /\.test\./,
  /\.spec\./,
  /README/,
  /\.md$/,
  /\.lock$/,
  /\.svg$/,
  /\.png$/,
  /\.jpg$/,
  /\.min\.js$/,
];

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);
const TEMPLATE_EXTENSIONS = new Set(['.html', '.htm', '.ejs', '.pug', '.jade', '.hbs', '.handlebars', '.mustache', '.vue']);

export function shouldSkipFile(filePath) {
  return SKIPPED_PATHS.some((pattern) => pattern.test(filePath));
}

export function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

export function isTemplateFile(filePath) {
  return TEMPLATE_EXTENSIONS.has(path.extname(filePath));
}

export function isTestOrExampleFile(filePath) {
  return /(^|\/)(test|tests|__tests__|example|examples)\//.test(filePath) || /\.(test|spec)\./.test(filePath);
}

// Code kept for teaching or testing rather than run by the app (e.g. Juice Shop's
// data/static/codefixes/ "pick the right fix" quiz files)
export function isCodeSnippetFile(filePath) {
  return /(^|\/)(codefixes|snippets|fixtures)\//.test(filePath);
}

// Findings in code that doesn't run in production are capped at LOW severity. Returns the
// context factor and an adjustment for the finding's confidence, or null for production code.
export function nonProductionContext(filePath) {
  if (isCodeSnippetFile(filePath)) {
    // Never runs, so it can't be exploited no matter how risky the code looks
    return {
      factor: '⚠ Non-executed code snippet (training/fixture file, not run by the app)',
      adjustConfidence: (confidence) => Math.min(confidence, 0.3),
    };
  }
  if (isTestOrExampleFile(filePath)) {
    return {
      factor: '⚠ In test/example file (lower real-world risk)',
      adjustConfidence: (confidence) => confidence - 0.15,
    };
  }
  return null;
}

// Attacker-controlled request data on the server side
export const USER_INPUT = /\breq\.(query|params|body|headers|cookies)\b|\bctx\.(query|params|request)\b|\brequest\.(query|params|body|payload)\b/;

// Code that is reachable over HTTP: either registered inline (`app.get(...)`) or a handler
// with a `(req, res` signature defined elsewhere (`module.exports = function (req, res)`,
// `(req: Request, res: Response) =>`).
export const ROUTE_HANDLER = /\b(app|router|server)\.(get|post|put|patch|delete|all|use)\s*\(|\(\s*req\b[^,()]*,\s*res\b/;

export function walkDir(dir, files = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!shouldSkipFile(fullPath)) {
          walkDir(fullPath, files);
        }
      } else {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

// Cap on how many physical lines one statement may span, so an unbalanced backtick can't swallow a file
const MAX_STATEMENT_LINES = 20;

function countBackticks(line) {
  return (line.match(/(?<!\\)`/g) || []).length;
}

function continuesOnNextLine(line, nextLine, openBackticks) {
  if (openBackticks % 2 === 1) return true;
  return /(^|[^+])\+$/.test(line.trim()) || /^\+(?!\+)/.test(nextLine.trim());
}

// Group physical lines into logical statements: lines joined by a trailing/leading `+`
// or by an open template literal. Line numbers are 0-based.
export function toStatements(lines) {
  const statements = [];
  let i = 0;

  while (i < lines.length) {
    const startLine = i;
    let text = lines[i];
    let backticks = countBackticks(lines[i]);

    while (
      i + 1 < lines.length
      && i - startLine < MAX_STATEMENT_LINES - 1
      && continuesOnNextLine(lines[i], lines[i + 1], backticks)
    ) {
      i++;
      text += `\n${lines[i]}`;
      backticks += countBackticks(lines[i]);
    }

    statements.push({ text, startLine, endLine: i });
    i++;
  }

  return statements;
}
