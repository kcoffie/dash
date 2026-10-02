#!/usr/bin/env node
/**
 * Regenerates the demo reports committed under public/demo/, which the deployed dashboard serves.
 * Scans each target, redacts secrets (src/scanner/demo-export.js), and writes a manifest.
 *
 * Usage: npm run demo:export [-- <targets-dir>]   (default /tmp; expects <targets-dir>/<id> clones)
 */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { scanTarget } from '../src/scanner/report.js';
import { toDemoReport } from '../src/scanner/demo-export.js';

// First entry is the default the dashboard opens with
const DEMOS = [
  { id: 'juice-shop', label: 'OWASP Juice Shop', repo: 'https://github.com/juice-shop/juice-shop', description: 'Intentionally vulnerable Angular + Express shop' },
  { id: 'dvna', label: 'DVNA', repo: 'https://github.com/appsecco/dvna', description: 'Damn Vulnerable Node Application' },
  { id: 'express', label: 'Express', repo: 'https://github.com/expressjs/express', description: 'Popular web framework: real dependency CVEs, no SQL' },
];

const targetsDir = process.argv[2] ?? '/tmp';
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'demo');

async function main() {
  const missing = DEMOS.filter((demo) => !fs.existsSync(path.join(targetsDir, demo.id)));
  if (missing.length > 0) {
    console.error('Missing scan targets. Clone them first:');
    for (const demo of missing) console.error(`  git clone --depth 1 ${demo.repo}.git ${path.join(targetsDir, demo.id)}`);
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const scans = [];

  for (const demo of DEMOS) {
    const targetPath = path.join(targetsDir, demo.id);
    const commit = execFileSync('git', ['-C', targetPath, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    console.log(`\n🔍 ${demo.label} @ ${commit}`);

    const report = await scanTarget(targetPath, { log: (message) => console.log(`  ${message}`) });
    const demoReport = toDemoReport(report, { name: demo.id, repo: demo.repo, commit });
    const file = `${demo.id}.json`;
    fs.writeFileSync(path.join(outDir, file), `${JSON.stringify(demoReport, null, 2)}\n`);

    scans.push({ id: demo.id, label: demo.label, description: demo.description, file, repo: demo.repo, commit, total: demoReport.summary.total });
    console.log(`  📄 public/demo/${file}: ${demoReport.summary.total} finding(s)`);
  }

  fs.writeFileSync(path.join(outDir, 'index.json'), `${JSON.stringify({ scans }, null, 2)}\n`);
  console.log('\n📄 public/demo/index.json written. Review the diff before committing.');
}

main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
});
