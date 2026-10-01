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
