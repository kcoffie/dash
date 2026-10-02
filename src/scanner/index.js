#!/usr/bin/env node
/**
 * Security Audit Scanner
 * Scans a target repository for vulnerabilities:
 * - Dependency CVEs
 * - Hardcoded secrets
 * - Code patterns (SQL injection, XSS, etc.)
 */

import fs from 'fs';
import { scanTarget } from './report.js';

const targetPath = process.argv[2];

if (!targetPath) {
  console.error('Usage: node src/scanner/index.js <target-repo-path>');
  process.exit(1);
}

if (!fs.existsSync(targetPath)) {
  console.error(`Error: Path not found: ${targetPath}`);
  process.exit(1);
}

async function scan() {
  console.log(`\n🔍 Scanning ${targetPath}...\n`);
  const report = await scanTarget(targetPath);
  const { summary } = report;

  const outputPath = 'scanner-output.json';
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to ${outputPath}`);
  console.log(`\n📊 Summary: ${summary.total} finding(s)`);
  if (summary.critical > 0) console.log(`   🔴 Critical: ${summary.critical}`);
  if (summary.high > 0) console.log(`   🟠 High: ${summary.high}`);
  if (summary.medium > 0) console.log(`   🟡 Medium: ${summary.medium}`);
  if (summary.low > 0) console.log(`   🟢 Low: ${summary.low}`);
  console.log();
}

scan().catch((error) => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
