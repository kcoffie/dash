import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const LOCKFILES = ['npm-shrinkwrap.json', 'package-lock.json'];
const OTHER_LOCKFILES = ['yarn.lock', 'pnpm-lock.yaml'];
const MAX_OUTPUT = 64 * 1024 * 1024;

// Parses `npm audit --json` output. npm reports its own failures (no lockfile, registry
// errors) as `{ "error": { code, summary } }`; those throw instead of reading as "no findings".
export function parseAuditJson(stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch (error) {
    throw new Error(`could not parse npm audit output: ${error.message}`);
  }
  if (data.error) {
    throw new Error(`${data.error.code ?? 'error'}: ${data.error.summary ?? 'npm audit failed'}`);
  }
  if (!data.vulnerabilities || typeof data.vulnerabilities !== 'object') {
    throw new Error('npm audit output has no vulnerabilities section (unsupported npm version?)');
  }
  return data;
}

function npm(args, cwd) {
  try {
    return execFileSync('npm', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_OUTPUT });
  } catch (error) {
    // npm audit exits non-zero when it finds vulnerabilities; its JSON is still on stdout
    if (error.stdout) return error.stdout;
    throw new Error(`npm ${args[0]} failed: ${error.stderr?.trim().split('\n').pop() || error.message}`);
  }
}

// Runs npm audit on the target without modifying it. With a committed npm lockfile, audits
// exactly those versions. Without one, resolves the dependency tree into a temporary
// lockfile first (what `npm install` would pick today), since `npm audit` needs a lockfile.
// Returns the full audit, the production-only audit (null if it failed), and the lockfile.
export function runNpmAudit(targetPath, packageJson) {
  const lockName = LOCKFILES.find((name) => fs.existsSync(path.join(targetPath, name)));
  let auditDir = targetPath;
  let tmpDir = null;

  try {
    if (!lockName) {
      if (packageJson.workspaces) {
        throw new Error('no lockfile, and package.json uses workspaces, which can\'t be resolved from package.json alone. Run `npm install` in the target first.');
      }
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-audit-'));
      fs.copyFileSync(path.join(targetPath, 'package.json'), path.join(tmpDir, 'package.json'));
      npm(['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], tmpDir);
      auditDir = tmpDir;
    }

    const all = parseAuditJson(npm(['audit', '--json'], auditDir));
    let prod = null;
    try {
      prod = parseAuditJson(npm(['audit', '--json', '--omit=dev'], auditDir));
    } catch {
      // Findings still report; they just can't be marked runtime vs dev-only
    }

    const lockfilePath = path.join(auditDir, lockName ?? 'package-lock.json');
    const lockfile = JSON.parse(fs.readFileSync(lockfilePath, 'utf-8'));

    return {
      all,
      prod,
      lockfile,
      lockfileSource: lockName ? lockName : 'resolved',
      otherLockfile: OTHER_LOCKFILES.find((name) => fs.existsSync(path.join(targetPath, name))) ?? null,
    };
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// Installed version at a node path like "node_modules/a/node_modules/b". Lockfile v2/v3 list
// every node under `packages`; v1 nests them under `dependencies`.
export function lockedVersion(lockfile, nodePath) {
  if (!lockfile) return null;
  if (lockfile.packages) return lockfile.packages[nodePath]?.version ?? null;

  let level = lockfile.dependencies;
  let entry = null;
  for (const name of nodePath.split(/(?:^|\/)node_modules\//).filter(Boolean)) {
    entry = level?.[name];
    level = entry?.dependencies;
  }
  return entry?.version ?? null;
}

// First version outside an advisory's affected range, when the range ends in a strict
// upper bound ("<4.17.21", ">=6.0.0 <8.0.3"). "<=X", open-ended, or multi-part ranges
// don't name a fixed version.
export function firstPatchedVersion(range) {
  if (!range || range.includes('||')) return null;
  const upper = range.trim().split(/\s+/).pop();
  const match = /^<(\d[^\s]*)$/.exec(upper);
  return match ? match[1] : null;
}

// Direct dependencies of the target that pull in `name`, following npm's `effects`
// (the dependents that are vulnerable because of it)
export function introducedBy(name, vulnerabilities) {
  const direct = new Set();
  const seen = new Set([name]);
  const queue = [name];
  while (queue.length > 0) {
    const current = vulnerabilities[queue.shift()];
    if (!current) continue;
    if (current.isDirect && current.name !== name) direct.add(current.name);
    for (const parent of current.effects ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
    }
  }
  return [...direct].sort();
}

// Compares two npm versions numerically (1.11.0 > 1.2.2). A prerelease sorts before its
// release (1.0.0-beta < 1.0.0); prerelease tags are compared as plain strings.
export function compareVersions(a, b) {
  const [aCore, aPre = ''] = a.split('-', 2);
  const [bCore, bPre = ''] = b.split('-', 2);
  const aParts = aCore.split('.').map(Number);
  const bParts = bCore.split('.').map(Number);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (aPre === bPre) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  return aPre < bPre ? -1 : 1;
}

function dependencyKind(packageJson, name) {
  if (packageJson.dependencies?.[name]) return 'dependencies';
  if (packageJson.optionalDependencies?.[name]) return 'optionalDependencies';
  if (packageJson.peerDependencies?.[name]) return 'peerDependencies';
  if (packageJson.devDependencies?.[name]) return 'devDependencies';
  return null;
}

// "Upgrade x to 2.0.0" / "Downgrade x from 4.2.1 to 2.0.0" / "Install x 2.0.0" (installed version unknown)
function changeTo(name, installed, version) {
  if (!installed) return `Install ${name} ${version}`;
  return compareVersions(version, installed) < 0
    ? `Downgrade ${name} from ${installed} to ${version}`
    : `Upgrade ${name} to ${version}`;
}

// npm's suggested fix. `fixAvailable` may name a different package (the direct dependency to
// change) and may be a downgrade; `lockfile` gives that package's installed version.
function fixGuidance(packageName, fixAvailable, lockfile) {
  if (fixAvailable === true) {
    return { factor: '✓ Fix available: `npm audit fix` resolves it', remediation: 'Run `npm audit fix`.' };
  }
  if (!fixAvailable) {
    return { factor: '⚠ No fix available yet', remediation: `No patched release is available through npm audit yet. Consider replacing ${packageName}, or check whether the vulnerable code path is reachable.` };
  }
  const installed = lockedVersion(lockfile, `node_modules/${fixAvailable.name}`);
  const change = changeTo(fixAvailable.name, installed, fixAvailable.version);
  // npm's isSemVerMajor isn't always set for a downgrade across majors (4.2.1 → 2.0.0)
  const crossesMajor = installed && installed.split('.')[0] !== fixAvailable.version.split('.')[0];
  const major = fixAvailable.isSemVerMajor || crossesMajor ? ' (major version change: check for breaking changes)' : '';
  const viaOther = fixAvailable.name === packageName
    ? ''
    : `; it depends on ${packageName}, and that version no longer pulls in a vulnerable one`;
  return {
    factor: `✓ Fix available: ${change.charAt(0).toLowerCase()}${change.slice(1)}${major}`,
    remediation: `${change}${major}${viaOther}.`,
  };
}

// One finding per (package, advisory). `audit` is the result of runNpmAudit; `packageJson`
// is the target's package.json.
export function parseAuditResults(audit, packageJson) {
  const { all, prod, lockfile, lockfileSource, otherLockfile } = audit;
  const vulnerabilities = all.vulnerabilities ?? {};
  const findings = [];
  const seen = new Set();

  for (const [packageName, vulnData] of Object.entries(vulnerabilities)) {
    const versions = [...new Set((vulnData.nodes ?? []).map((node) => lockedVersion(lockfile, node)).filter(Boolean))];
    const versionText = versions.length > 0 ? versions.join(', ') : 'unknown version';
    const devOnly = prod ? !(packageName in (prod.vulnerabilities ?? {})) : null;
    const kind = dependencyKind(packageJson, packageName);
    const parents = vulnData.isDirect ? [] : introducedBy(packageName, vulnerabilities);
    const fix = fixGuidance(packageName, vulnData.fixAvailable, lockfile);

    for (const advisory of vulnData.via ?? []) {
      // Strings name another vulnerable package; that package's own entry reports the advisory
      if (typeof advisory !== 'object' || !advisory.title) continue;
      const findingKey = `${packageName}-${advisory.source ?? advisory.url}`;
      if (seen.has(findingKey)) continue;
      seen.add(findingKey);

      const advisorySeverity = mapSeverity(advisory.severity);
      const context = [`✓ ${packageName} ${versionText} is in the affected range ${advisory.range ?? '(not given)'}`];

      if (vulnData.isDirect) {
        context.push(`✓ Direct dependency${kind ? ` (${kind})` : ''}`);
      } else if (parents.length > 0) {
        context.push(`✓ Pulled in by ${parents.join(', ')}`);
      } else {
        context.push('? Not traced to a direct dependency');
      }

      let severity = advisorySeverity;
      if (devOnly === true) {
        context.push(advisorySeverity === 'low' || advisorySeverity === 'info'
          ? '⚠ Dev-only dependency (not installed in production)'
          : `⚠ Dev-only dependency (not installed in production): advisory severity ${advisorySeverity}, scored low`);
        if (advisorySeverity !== 'info') severity = 'low';
      } else if (devOnly === false) {
        context.push('✓ Installed in production (not dev-only)');
      } else {
        context.push('? Could not tell whether it is a dev-only dependency');
      }

      context.push(fix.factor);

      if (lockfileSource === 'resolved') {
        context.push(otherLockfile
          ? `? Target uses ${otherLockfile}, which npm can't read: versions are what npm resolves today, not necessarily what's installed`
          : '? No lockfile: versions are what npm resolves today, so results can change between scans');
      }

      const references = advisory.url ? [advisory.url] : [];
      findings.push({
        id: advisory.source ?? advisory.url?.split('/').pop() ?? `npm-${packageName}`,
        type: 'dependency-cve',
        title: advisory.title,
        severity,
        confidence: devOnly === null ? 0.85 : 0.95,
        description: `${advisory.title} in ${packageName}${advisory.cwe?.length ? ` (${advisory.cwe.join(', ')})` : ''}.`,
        package: packageName,
        packageVersion: versions.length > 0 ? versionText : null,
        affectedVersions: advisory.range ?? null,
        patchedVersions: firstPatchedVersion(advisory.range),
        advisorySeverity,
        devOnly,
        file: 'package.json',
        line: null,
        context,
        remediation: `${fix.remediation}${advisory.url ? ` Details: ${advisory.url}` : ''}`,
        references,
        tags: ['dependency', 'npm-audit', ...(advisory.cwe ?? []), ...(devOnly ? ['dev-only'] : [])],
      });
    }
  }

  return findings;
}

function mapSeverity(npmSeverity) {
  const severityMap = {
    critical: 'critical',
    high: 'high',
    moderate: 'medium',
    low: 'low',
    info: 'info',
  };
  return severityMap[npmSeverity?.toLowerCase()] || 'medium';
}
