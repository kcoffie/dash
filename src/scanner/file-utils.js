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
];

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx']);

export function shouldSkipFile(filePath) {
  return SKIPPED_PATHS.some((pattern) => pattern.test(filePath));
}

export function isSourceFile(filePath) {
  return SOURCE_EXTENSIONS.has(path.extname(filePath));
}

export function isTestOrExampleFile(filePath) {
  return /(^|\/)(test|tests|__tests__|example|examples)\//.test(filePath) || /\.(test|spec)\./.test(filePath);
}

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
