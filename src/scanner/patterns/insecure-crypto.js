import fs from 'fs';
import path from 'path';
import {
  isSourceFile, nonProductionContext, walkDir, toStatements, USER_INPUT,
} from '../file-utils.js';

const SEVERITY_LADDER = ['low', 'medium', 'high', 'critical'];

// How many physical lines after a call to read when its arguments span lines: `jwt.verify(\n  token, …\n)`
const ARGUMENT_LOOKAHEAD = 10;

// How far back to look for the function a statement sits in
const FUNCTION_LOOKBACK = 15;

// Values that must stay secret or unguessable: hashing or generating these weakly is exploitable
const SENSITIVE_VALUE = /passw(or)?d|passwd|\bpwd\b|secret|token|\botp\b|reset|answer|credential/i;

// Names that say a random value guards something. Bare "key" is left out: React's key={Math.random()} isn't security
const SECURITY_NAME = /token|secret|passw(or)?d|passwd|salt|nonce|\botp\b|session|csrf|captcha|reset|api_?key|private_?key|secret_?key|\buuid\b|guid|credential/i;

// Hashing file contents for integrity / cache busting rather than to protect a secret
const CHECKSUM_CONTEXT = /checksum|etag|fingerprint|integrity|\.update\(\s*(content|contents|fileContent|buf|buffer|chunk|fileBuffer)\b/i;

const PUBLIC_KEY = /public|\bpub\b|\.pub\b|cert|\bpem\b|jwks/i;

// Packages whose default export is a plain MD5 / SHA-1 function: md5(value)
const WEAK_HASH_PACKAGES = ['md5', 'js-md5', 'blueimp-md5', 'md5-hex', 'sha1', 'js-sha1'];

const WEAK_HASH_ALGORITHM = /^(md5|md4|sha1|sha-1|ripemd160)$/i;

// Broken ciphers, and ECB mode for any cipher (identical blocks encrypt identically)
const WEAK_CIPHER = /^(des|des-ede|des-ede3|des3|rc2|rc4|bf|blowfish|cast|cast5|idea|seed)(-|$)|-ecb$/i;

const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'with']);

const maxSeverity = (a, b) => (SEVERITY_LADDER.indexOf(a) >= SEVERITY_LADDER.indexOf(b) ? a : b);

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The text after an opening parenthesis up to its matching close, or to the end of `text` if it never closes
function argumentText(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (depth === 0) return text.slice(openIndex + 1, i);
  }
  return text.slice(openIndex + 1);
}

// Split call arguments on top-level commas (ignores commas inside brackets and strings)
function splitArguments(text) {
  const args = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
    } else if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
    } else if ('([{'.includes(ch)) {
      depth++;
    } else if (')]}'.includes(ch)) {
      depth--;
    } else if (ch === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

// 'abc', "abc", `abc` (no interpolation), or Buffer.from('abc'[, 'hex'])
function isLiteralKey(arg) {
  if (!arg) return false;
  const value = arg.replace(/\s+as\s+\w+$/, '').trim();
  const buffer = value.match(/^Buffer\.from\(\s*(.+?)\s*(,\s*['"]\w+['"]\s*)?\)$/);
  const inner = buffer ? buffer[1] : value;
  return /^'[^']*'$|^"[^"]*"$/.test(inner) || (/^`[^`]*`$/.test(inner) && !inner.includes('${'));
}

const stringLiteral = (arg) => (arg || '').match(/^['"`]([^'"`]*)['"`]$/)?.[1];

// Name of the nearest function declared at or above `startLine`: function f(…), const f = (…) =>, f: function, f (…) {
function enclosingFunctionName(lines, startLine) {
  for (let i = startLine; i >= Math.max(0, startLine - FUNCTION_LOOKBACK); i--) {
    const line = lines[i];
    const match = line.match(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/)
      || line.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/)
      || line.match(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function\b/)
      || line.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/);
    if (match && !KEYWORDS.has(match[1])) return match[1];
  }
  return null;
}

// Names this file binds to an MD5/SHA-1 package: var md5 = require('md5') / import md5 from 'md5'
function weakHashPackageNames(content) {
  const names = [];
  const packages = WEAK_HASH_PACKAGES.map(escapeRegex).join('|');
  const binding = new RegExp(`(?:(?:var|let|const)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*require\\(\\s*|import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+)['"](?:${packages})['"]`, 'g');
  let match;
  while ((match = binding.exec(content)) !== null) names.push(match[1] || match[2]);
  return names;
}

// Local names bound to express-jwt (defaults cover the usual import names)
function expressJwtNames(content) {
  const names = new Set(['expressJwt', 'expressjwt']);
  const binding = /(?:(?:var|let|const)\s+\{?\s*([A-Za-z_$][\w$]*)\s*\}?\s*=\s*require\(\s*|import\s+\{?\s*([A-Za-z_$][\w$]*)\s*\}?\s+from\s+)['"]express-jwt['"]/g;
  let match;
  while ((match = binding.exec(content)) !== null) names.add(match[1] || match[2]);
  return [...names];
}

// --- Checks: each returns issues found in one statement ---
// An issue: { name, severity, confidence, factors, description, remediation, tags, helper? }

function weakHashIssues({ statement, lines, content }) {
  const issues = [];
  const algorithms = [];

  const createHash = /\bcreateHash\s*\(\s*['"`]([\w-]+)['"`]/g;
  let match;
  while ((match = createHash.exec(statement.text)) !== null) {
    if (WEAK_HASH_ALGORITHM.test(match[1])) algorithms.push(match[1].toUpperCase().replace('-', ''));
  }
  for (const name of weakHashPackageNames(content)) {
    const call = new RegExp(`(?<![\\w$.])${escapeRegex(name)}\\s*\\(`);
    if (call.test(statement.text)) algorithms.push(/sha/i.test(name) ? 'SHA1' : 'MD5');
  }
  const cryptoJs = statement.text.match(/\bCryptoJS\.(MD5|SHA1)\s*\(/);
  if (cryptoJs) algorithms.push(cryptoJs[1]);
  if (algorithms.length === 0) return issues;

  const algorithm = algorithms[0];
  const factors = [`✓ ${algorithm} is broken for security use (fast to brute-force, practical collisions)`];
  let severity = 'medium';
  let confidence = 0.5;
  let helper = null;

  const nearby = lines.slice(Math.max(0, statement.startLine - 3), statement.endLine + 4).join('\n');
  if (SENSITIVE_VALUE.test(statement.text) || USER_INPUT.test(statement.text)) {
    severity = 'high';
    confidence = 0.8;
    if (SENSITIVE_VALUE.test(statement.text)) factors.push('✓ Hashes or compares a password / token / secret on this line');
    if (USER_INPUT.test(statement.text)) factors.push('✓ Request input (req.*) on the same line');
    if (!/salt/i.test(statement.text)) factors.push('⚠ No salt visible (identical inputs give identical hashes)');
    if (factors.length < 3) factors.push('? Check what the hash protects (reset tokens and password hashes are guessable)');
  } else if (CHECKSUM_CONTEXT.test(nearby)) {
    severity = 'low';
    confidence = 0.4;
    factors.push('⚠ Looks like a file checksum (integrity, not secrecy)');
    factors.push('? Collisions still matter if an attacker can supply the file');
  } else {
    // A small function wrapping the hash: its callers decide how bad it is (scored in the tracing pass)
    const name = enclosingFunctionName(lines, statement.startLine);
    if (name) helper = { name };
    factors.push('? What is hashed is unclear: fine for cache keys, not for passwords, tokens, or signatures');
  }

  issues.push({
    name: `Weak Hash (${algorithm})`,
    severity,
    confidence,
    factors,
    description: `${algorithm} is used where its output may protect a secret. It is fast to brute-force and collisions are practical, so hashed passwords and tokens derived from guessable values can be recovered or forged.`,
    remediation: 'Passwords: use a slow, salted KDF: await bcrypt.hash(password, 12) or crypto.scryptSync(password, salt, 64). Tokens: generate them randomly (crypto.randomBytes(32).toString(\'hex\')) and store a SHA-256 of the token. Integrity checks: use SHA-256.',
    tags: ['weak-hash'],
    helper,
  });
  return issues;
}

function literalKeyIssues({ statement, textWithLookahead }) {
  const issues = [];
  const calls = [
    { regex: /\bcreateHmac\s*\(/g, keyIndex: 1, use: 'HMAC', impact: 'anyone with the source can compute valid MACs' },
    { regex: /\bcreate(?:Cipheriv|Decipheriv)\s*\(/g, keyIndex: 1, use: 'cipher', impact: 'anyone with the source can decrypt the data' },
    { regex: /\b(?:jwt|jsonwebtoken|JWT)\.(?:sign|verify)\s*\(/g, keyIndex: 1, use: 'JWT', impact: 'anyone with the source can forge valid tokens' },
  ];
  for (const { regex, keyIndex, use, impact } of calls) {
    let match;
    while ((match = regex.exec(statement.text)) !== null) {
      const args = splitArguments(argumentText(textWithLookahead, match.index + match[0].length - 1));
      if (!isLiteralKey(args[keyIndex])) continue;
      issues.push(literalKeyIssue(use, impact));
    }
  }
  return issues;
}

function literalKeyIssue(use, impact) {
  return {
    name: `Hardcoded ${use} Key`,
    severity: 'high',
    confidence: 0.85,
    factors: [
      `✓ ${use} key is a string literal in the source`,
      `✓ ${impact.charAt(0).toUpperCase()}${impact.slice(1)}`,
      '⚠ Already in version control history: rotate it, don\'t just move it',
    ],
    description: `The ${use} key is written into the code, so it is shared with everyone who can read the repository or the built bundle.`,
    remediation: 'Load the key from the environment or a secrets manager (const key = process.env.HMAC_KEY), fail at startup if it is missing, and rotate the exposed key.',
    tags: ['hardcoded-key'],
  };
}

function cipherIssues({ statement }) {
  const issues = [];
  if (/\bcreate(?:Cipher|Decipher)\s*\(/.test(statement.text)) {
    issues.push({
      name: 'createCipher Without IV',
      severity: 'high',
      confidence: 0.9,
      factors: [
        '✓ crypto.createCipher/createDecipher derive the key with one MD5 pass and use no IV',
        '✓ Same plaintext + key always gives the same ciphertext',
        '⚠ Removed in Node.js 22 (deprecated since Node 10)',
      ],
      description: 'createCipher derives the key from a password with a single unsalted MD5 and uses a fixed IV, so encryption is deterministic and the password is easy to brute-force.',
      remediation: 'Use createCipheriv with a random IV and an authenticated mode: const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv(\'aes-256-gcm\', key, iv); store iv + cipher.getAuthTag() with the ciphertext.',
      tags: ['weak-cipher'],
    });
  }

  const algorithmArgs = /\bcreate(?:Cipheriv|Decipheriv|Cipher|Decipher)\s*\(\s*(['"`][^'"`]+['"`])/g;
  let match;
  while ((match = algorithmArgs.exec(statement.text)) !== null) {
    const algorithm = stringLiteral(match[1]);
    if (algorithm && WEAK_CIPHER.test(algorithm)) issues.push(weakCipherIssue(algorithm));
  }
  const cryptoJs = statement.text.match(/\bCryptoJS\.(DES|TripleDES|RC4|RC4Drop)\.(?:encrypt|decrypt)\s*\(|\bCryptoJS\.mode\.(ECB)\b/);
  if (cryptoJs) issues.push(weakCipherIssue(cryptoJs[1] || 'ECB mode'));
  return issues;
}

function weakCipherIssue(algorithm) {
  const ecb = /ecb/i.test(algorithm);
  return {
    name: `Weak Cipher (${algorithm})`,
    severity: 'high',
    confidence: 0.85,
    factors: [
      ecb ? `✓ ${algorithm}: identical plaintext blocks encrypt to identical ciphertext blocks` : `✓ ${algorithm} is a broken or obsolete cipher`,
      '✓ Encrypted data can be recovered or its structure leaks',
      '? Check what is encrypted and whether old ciphertext must be re-encrypted',
    ],
    description: `${algorithm} does not protect confidentiality by today's standards.`,
    remediation: 'Use AES-256-GCM (or ChaCha20-Poly1305) with a random IV per message: crypto.createCipheriv(\'aes-256-gcm\', key, crypto.randomBytes(12)).',
    tags: ['weak-cipher'],
  };
}

function mathRandomIssues({ statement, lines, relFile }) {
  if (!/\bMath\.random\s*\(\s*\)/.test(statement.text)) return [];

  const functionName = enclosingFunctionName(lines, statement.startLine);
  let severity;
  let confidence;
  let where;
  if (SECURITY_NAME.test(statement.text)) {
    severity = 'medium';
    confidence = 0.6;
    where = '✓ Value feeds something security-related on this line (secret / token / password / salt …)';
  } else if (functionName && SECURITY_NAME.test(functionName)) {
    severity = 'low';
    confidence = 0.35;
    where = `⚠ Inside ${functionName}(), which sounds security-related`;
  } else if (SECURITY_NAME.test(path.basename(relFile))) {
    severity = 'low';
    confidence = 0.35;
    where = `⚠ In ${path.basename(relFile)}, which sounds security-related`;
  } else {
    // Shuffles, demo data, animation: not a security problem
    return [];
  }

  return [{
    name: 'Math.random() for a Security Value',
    severity,
    confidence,
    factors: [
      '✓ Math.random() is not cryptographically secure (its output can be predicted from earlier outputs)',
      where,
      '? Check whether an attacker benefits from guessing the value',
    ],
    description: 'Math.random() is a fast, predictable generator. Values used as secrets, tokens, or challenges can be guessed by an attacker who has seen a few earlier outputs.',
    remediation: 'Use the crypto module: crypto.randomBytes(32).toString(\'hex\') for tokens, crypto.randomInt(min, max) for numbers, crypto.randomUUID() for ids.',
    tags: ['weak-random'],
  }];
}

function jwtIssues({ statement, textWithLookahead, content }) {
  const issues = [];

  const verify = /\b(?:jwt|jsonwebtoken|JWT)\.verify\s*\(/g;
  let match;
  while ((match = verify.exec(statement.text)) !== null) {
    const argText = argumentText(textWithLookahead, match.index + match[0].length - 1);
    const issue = algorithmIssue(argText, splitArguments(argText)[1], 'jwt.verify');
    if (issue) issues.push(issue);
  }

  for (const name of expressJwtNames(content)) {
    const call = new RegExp(`(?<![\\w$.])${escapeRegex(name)}\\s*\\(`, 'g');
    while ((match = call.exec(statement.text)) !== null) {
      const argText = argumentText(textWithLookahead, match.index + match[0].length - 1);
      const secret = argText.match(/\bsecret\s*:\s*([^,}]+)/);
      if (!secret) continue;
      if (isLiteralKey(secret[1].trim())) issues.push(literalKeyIssue('JWT', 'anyone with the source can forge valid tokens'));
      const issue = algorithmIssue(argText, secret[1], 'express-jwt');
      if (issue) issues.push(issue);
    }
  }

  const sign = /\b(?:jwt|jsonwebtoken|JWT)\.sign\s*\(/g;
  while ((match = sign.exec(statement.text)) !== null) {
    const argText = argumentText(textWithLookahead, match.index + match[0].length - 1);
    if (/\balgorithm\s*:\s*['"`]none['"`]/i.test(argText)) issues.push(noneAlgorithmIssue('jwt.sign signs with algorithm \'none\''));
  }
  return issues;
}

// Verification without an algorithm allowlist, or with 'none' allowed
function algorithmIssue(argText, keyArg, call) {
  const allowlist = argText.match(/\balgorithms\s*:\s*\[([^\]]*)\]/);
  if (allowlist) {
    return /['"`]none['"`]/i.test(allowlist[1]) ? noneAlgorithmIssue(`${call} accepts algorithm 'none'`) : null;
  }
  if (/\balgorithms\s*:/.test(argText)) return null; // allowlist from a variable

  const publicKey = PUBLIC_KEY.test(keyArg || '');
  return {
    name: 'JWT Verified Without Algorithm Allowlist',
    severity: publicKey ? 'high' : 'medium',
    confidence: publicKey ? 0.7 : 0.5,
    factors: [
      `✓ ${call} called without an algorithms: [...] allowlist`,
      publicKey
        ? '✓ Verified with a public key: a token HMAC-signed with that public key can pass (algorithm confusion)'
        : '? Key type unclear: the risk is highest when a public (RSA/EC) key is used',
      '⚠ Older jsonwebtoken / express-jwt versions also accept alg: none (check dependency findings)',
    ],
    description: 'The token header picks the algorithm. Without an allowlist, an attacker can switch it (e.g. RS256 → HS256 using the public key as the HMAC secret, or none on old library versions) and forge tokens.',
    remediation: 'Pin the algorithms: jwt.verify(token, publicKey, { algorithms: [\'RS256\'] }) / expressjwt({ secret: publicKey, algorithms: [\'RS256\'] }), and keep jsonwebtoken ≥ 9 / express-jwt ≥ 7.',
    tags: ['jwt'],
  };
}

function noneAlgorithmIssue(what) {
  return {
    name: 'JWT Algorithm \'none\'',
    severity: 'high',
    confidence: 0.85,
    factors: [
      `✓ ${what}`,
      '✓ Unsigned tokens carry no proof of who issued them',
      '⚠ Anyone can forge a token with any claims',
    ],
    description: 'With algorithm none, a JWT has no signature, so its claims can be set to anything.',
    remediation: 'Always sign and verify with a real algorithm: jwt.sign(payload, privateKey, { algorithm: \'RS256\' }) and jwt.verify(token, publicKey, { algorithms: [\'RS256\'] }).',
    tags: ['jwt'],
  };
}

function hashidsIssues({ statement }) {
  if (!/\bnew\s+Hashids\s*\(\s*(\)|'[^']*'|"[^"]*"|`[^`$]*`)/.test(statement.text)) return [];
  return [{
    name: 'Hashids With Hardcoded Salt',
    severity: 'medium',
    confidence: 0.7,
    factors: [
      '✓ Hashids salt is a literal (or missing)',
      '✓ Hashids is reversible encoding, not encryption: with the salt, anyone can decode and mint ids',
      '? Check whether the encoded ids grant access or progress (e.g. continue codes, share links)',
    ],
    description: 'Hashids only obfuscates numbers. With the salt in the source, encoded values can be decoded and new valid ones generated.',
    remediation: 'Don\'t use Hashids for anything an attacker shouldn\'t forge. Use random tokens (crypto.randomBytes) stored server-side, or sign the value (HMAC with a key from the environment).',
    tags: ['encoding-as-crypto'],
  }];
}

const CHECKS = [weakHashIssues, literalKeyIssues, cipherIssues, mathRandomIssues, jwtIssues, hashidsIssues];

const REFERENCES = [
  'https://owasp.org/Top10/A02_2021-Cryptographic_Failures/',
  'https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html',
  'https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html',
];

// Calls to a weak-hash helper from files that import its module (or the same file), split by
// whether the call hashes a password / token / secret. Training snippets and tests don't count.
function helperCallers(helper, sources) {
  const moduleName = path.basename(helper.file).replace(/\.[^.]+$/, '');
  const importsModule = new RegExp(`(?:from\\s+|require\\(\\s*)['"][^'"]*\\b${escapeRegex(moduleName)}(?:\\.[cm]?[jt]s)?['"]`);
  const call = new RegExp(`(?<![\\w$])(?:[\\w$]+\\.)?${escapeRegex(helper.name)}\\s*\\(`);
  const sensitive = [];
  const other = [];

  for (const { relFile, content, lines, statements } of sources) {
    if (nonProductionContext(relFile)) continue;
    if (relFile !== helper.file && !importsModule.test(content)) continue;
    for (const statement of statements) {
      if (relFile === helper.file && statement.startLine === helper.startLine) continue;
      const firstLine = lines[statement.startLine].trim();
      if (firstLine.startsWith('//') || firstLine.startsWith('*')) continue;
      if (!call.test(statement.text)) continue;
      const location = `${relFile}:${statement.startLine + 1}`;
      (SENSITIVE_VALUE.test(statement.text) ? sensitive : other).push(location);
    }
  }
  return { sensitive, other };
}

const listLocations = (locations) => (locations.length > 2
  ? `${locations.slice(0, 2).join(', ')} (+${locations.length - 2} more)`
  : locations.join(', '));

// Score a weak-hash helper by what its callers pass in
function scoreHelper(issue, helper, sources) {
  const { sensitive, other } = helperCallers(helper, sources);
  if (sensitive.length > 0) {
    issue.severity = 'high';
    issue.confidence = 0.85;
    issue.factors.splice(1, 1, `✓ ${helper.name}() is called on passwords / tokens: ${listLocations(sensitive)}`);
    issue.factors.push('⚠ No salt visible (identical inputs give identical hashes)');
  } else if (other.length > 0) {
    issue.factors.push(`? ${helper.name}() callers (${listLocations(other)}) don't look like passwords or tokens`);
  } else {
    issue.factors.push(`? No callers of ${helper.name}() found in this repository`);
  }
}

// One finding per line: merge every issue found there, at the highest severity
function toFinding(relFile, line, snippet, issues) {
  const severity = issues.reduce((worst, issue) => maxSeverity(worst, issue.severity), 'low');
  let confidence = Math.max(...issues.map((issue) => issue.confidence));
  const factors = [...new Set(issues.flatMap((issue) => issue.factors))];

  const nonProduction = nonProductionContext(relFile);
  let finalSeverity = severity;
  if (nonProduction) {
    factors.push(nonProduction.factor);
    finalSeverity = 'low';
    confidence = nonProduction.adjustConfidence(confidence);
  }

  return {
    id: `crypto-${relFile.replace(/[^\w]/g, '_')}-${line}`,
    type: 'crypto-misuse',
    title: `Insecure Crypto (${issues.map((issue) => issue.name).join(' + ')})`,
    severity: finalSeverity,
    confidence: Math.round(Math.max(0.1, Math.min(0.95, confidence)) * 100) / 100,
    description: issues.map((issue) => issue.description).join(' '),
    file: relFile,
    line,
    snippet,
    context: factors,
    remediation: issues.map((issue) => issue.remediation).join(' '),
    references: REFERENCES,
    tags: ['crypto', ...new Set(issues.flatMap((issue) => issue.tags))],
  };
}

export async function scanForInsecureCrypto(targetPath) {
  const findings = [];

  try {
    // Pass 1: read every source file once (pass 2 traces weak-hash helpers across files)
    const sources = [];
    for (const file of walkDir(targetPath)) {
      if (!isSourceFile(file)) continue;
      let content;
      try {
        content = fs.readFileSync(file, 'utf-8');
      } catch {
        continue; // Unreadable (permissions, broken symlink)
      }
      const lines = content.split('\n');
      sources.push({ relFile: path.relative(targetPath, file), content, lines, statements: toStatements(lines) });
    }

    const sites = [];
    for (const source of sources) {
      const { relFile, content, lines, statements } = source;
      for (const statement of statements) {
        const firstLine = lines[statement.startLine].trim();
        if (firstLine.startsWith('//') || firstLine.startsWith('*')) continue;

        const textWithLookahead = [statement.text, ...lines.slice(statement.endLine + 1, statement.endLine + 1 + ARGUMENT_LOOKAHEAD)].join('\n');
        const issues = CHECKS.flatMap((check) => check({ statement, lines, content, relFile, textWithLookahead }));
        if (issues.length === 0) continue;

        for (const issue of issues) {
          if (issue.helper) Object.assign(issue.helper, { file: relFile, startLine: statement.startLine });
        }
        sites.push({ relFile, statement, issues });
      }
    }

    // Pass 2: score helpers by their callers, then build one finding per line
    for (const { relFile, statement, issues } of sites) {
      for (const issue of issues) {
        if (issue.helper) scoreHelper(issue, issue.helper, sources);
      }
      const snippet = statement.text.replace(/\s+/g, ' ').trim().substring(0, 120);
      findings.push(toFinding(relFile, statement.startLine + 1, snippet, issues));
    }
  } catch (error) {
    throw new Error(`Insecure crypto scanning failed: ${error.message}`);
  }

  return findings;
}
