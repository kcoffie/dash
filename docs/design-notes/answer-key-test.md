# Design note: answer-key regression test

Status: **approved design** (2026-10-07), being built in 3 PRs. Architect review done; the user decided the open questions (below).

## Problem
dash's main promise is "finds the known vulnerabilities in Juice Shop and DVNA, at the right severity". The recall figures in the PRD and README (SQLi 3/3, XSS 8/9 + 3/3, crypto 5/6 + 1/1, async 15 on DVNA) were checked by hand and live only as tables in `HANDOFF.md`. Secrets, the biggest pattern scanner, has no key at all. Nothing checks any of this automatically: a scanner change that loses a real finding, or moves its severity, passes `npm test`, lint, build and both mutation gates.

## Design
**Answer keys as data** in `answer-keys/{juice-shop,dvna,express}.json`. Each file owns its target: repo URL and the **full** pinned commit (`1618a611b173b4bf114028e6e02549950606e29d`, `9ba473add536f66ac9007966acb2a775dd31277a`, `7ef98448f8b38099ab1ded55e458538ad47a51e7`). `public/demo/index.json` is not the source: `demo:export` rewrites it from whatever commit the target folder is on.

Unknown fields in a key or an entry are rejected, so a misspelling (`rule`, `nonproduction`, `challenge`) can't switch a check off. Each entry has `file` (or a file `pattern` for "not flagged"), `type`, `lines: [start, end]` (hand-written range), `severity`, `status`, `challenges: []`, and `why` (the rule or user decision the expected value comes from, e.g. "req.* feeds the promise → high (session 7)"). Never snippets, ids or descriptions. Statuses:
- **found**: reported in the range, with this type and severity.
- **reviewed**: not a challenge, but read by hand; reported with this type and severity (pinned so a change shows up). Has a `reason`.
- **not flagged**: deliberate non-finding (a line range or a file pattern like `{ "endsWith": "_correct.ts" }`; patterns are objects, never glob strings), for the given type.
- **known miss**: still absent (CSP Bypass, `routes/userProfile.ts:73`). If it starts being found, the check fails with "update the answer key".

**The comparison** is a pure function in `src/utils/answer-keys.js` with unit tests, one per failure reason, each seen failing once: missing, wrong severity, moved (same type elsewhere in the same file: reported separately from missing), not-flagged appears, known miss appears, scanner errors present, unkeyed high/critical. Being under `src/utils/`, it is mutation-tested like everything else.

**Two callers:**
1. `npm test`, offline, against `public/demo/*.json` (milliseconds): guards what the live site shows and catches an export that drops findings.
2. CI job `answer-keys` on PRs **and** pushes to `main`: fetches each target with `actions/checkout` (`repository`, `ref` = full commit, `path`, `persist-credentials: false`), checks `git rev-parse HEAD` equals the key's commit and the tree is clean, checks that `index.json`'s short commit is a prefix of it, runs `scanPatterns`, and compares. `timeout-minutes` set. Cache only if measurement shows the fetch is slow. Job-level `if:` (no workflow-level `paths:` filter), so it can become a required check later without blocking.

## Acceptance criteria
- Given the targets at the keys' commits, every **found** and **reviewed** entry is reported in its range with the expected type and severity; otherwise the check fails and names the entry (missing / moved / wrong severity).
- Every **not flagged** entry is absent for its type; every **known miss** is absent.
- **Fail closed:** any non-empty `errors` from `scanPatterns` fails; every file named in the keys must exist and be readable before scanning; every scanner type has at least one **found** entry across the keys (so a crashed or empty scan can't pass the "absent" checks).
- **Spec rules, not snapshots:** Express has 0 SQLi, 0 crypto, 0 async findings and all its findings are low (DESIGN / HANDOFF); findings in non-production code (`test/`, `codefixes/`, examples) are low, **except provider-format secrets**: DESIGN says they keep their severity anywhere, and they are always high or critical, so a high/critical secret there is left to the unkeyed-high rule (it needs an entry), while a **medium** secret there fails the cap: it can only be a generic value that escaped the test/example → LOW rule (user decision 2026-10-08). Non-production paths are written by hand per key (`nonProduction`), not taken from the scanner's own helper.
- **Every high or critical finding in production code has a key entry** (user decision). High/critical **secrets** need one in non-production code too: only provider formats may stay high there (DESIGN), so each is a reviewed decision.
- **Every key has at least one found entry of its own**, so an empty scan of one target can't pass on the strength of another key. The 7 high/critical findings that had no entry when this was designed are all keyed now: DVNA `server.js:24` (PR 1) and Juice Shop `lib/insecurity.ts:21`, `infrastructure/terraform/networking.tf:171`, `terraform/networking.tf:171`, `frontend/src/app/login/login.component.ts:63`, `frontend/src/app/data-export/data-export.component.ts:58`, `routes/verify.ts:125` (PR 2).
- Recall is printed per type, per challenge and per site, the way the PRD counts it (e.g. Juice Shop XSS 8/9 challenges, 8/9 sites). A challenge is recalled when every found entry of that type tagged with it is reported at its severity; one tagged only on known-miss / not-flagged entries counts as not recalled; sites are found + known-miss entries (user-confirmed criteria, 2026-10-08). The demo test fails if a challenge with a found entry isn't recalled.
- Infrastructure failures (fetch, wrong commit, dirty tree) are reported separately from key failures. A failed fetch fails; it never passes.
- Output prints only file:line, type, severity and target-relative paths. No snippets, no descriptions, no raw-report artifacts (CI logs on a public repo are public).
- The first Linux CI run is compared finding by finding against `public/demo` (measured so far on macOS only).
- Out of scope: dependency CVEs (no target commits a lockfile; advisories drift); precision / false-positive rate (separate PRD item); total counts (rule 5). Counts against `public/demo` are printed as information only.

## Where expected values come from
Transcribed by hand, never from scanner output: Juice Shop `data/static/challenges.yml` and `vuln-code-snippet` markers, DVNA `docs/solution/*.md`, the answer-key tables in HANDOFF, and the user's recorded severity decisions. Groups the tables give only as totals (DVNA's 15 async chains, Juice Shop's 10 browser chains, 5 captcha lines) are worked out by reading the target code. The reviewer agent re-works a sample of entries independently.

## User decisions (2026-10-07)
1. **Secrets:** key the anchors only: challenge-backed and high/critical secrets (about 5 entries). The 23 Juice Shop seed passwords stay unkeyed (precision, measured separately).
2. **Unkeyed high/critical in production code fails the check.**
3. **Reviewed findings get keyed** with a pinned severity: the 5 debatable Juice Shop XSS findings and DVNA `views/common/footer.ejs:7`. `footer.ejs:7` was read by hand (real sink; all 36 `.markdown` elements are DVNA's static lesson pages with no EJS output tags) and keyed as reviewed at medium (user, 2026-10-07).
4. **Every sink site is its own entry** (losing any one fails); recall is still reported per challenge.
5. **Built as 3 PRs:** (1) comparison + unit tests + DVNA and Express keys + the offline check on `public/demo`; (2) the Juice Shop key; (3) the CI job against the live targets.
Still the user's call later: making `answer-keys` a required check (repo setting).

## Options considered
1. **Keys as data + separate CI job + offline run on the demo files** (chosen).
2. **Inside `npm test` against the live targets.** Rejected: `npm test` must stay offline and fast; Stryker runs it thousands of times, and network inside it is what made earlier scores invalid.
3. **Vendor the referenced target files.** Rejected: the crypto scanner traces password callers across 6 files and async needs `server.ts` for wrapper detection, so partial copies test a different program. (Licences would allow it: all three targets are MIT, checked.)

## Measured cost (2026-10-07, macOS)
- Partial clones at the pinned commits: Juice Shop 13 s / 65 MB, DVNA 4 s / 8 MB, Express 4 s / 6 MB.
- Pattern scan: Juice Shop 96 s (crypto scanner **94 s** of it; logged as a separate TODO), DVNA 0.04 s, Express 0.4 s. Expect slower on a GitHub runner.
- A fresh scan today matches `public/demo` exactly for every pattern type on all three targets, with 0 errors (checked independently by the architect too).

## What breaks
- A target repo deletes the pinned commit: fetch fails, the job fails and says so. Mitigation then: a fork under the user's account.
- GitHub unreachable: the job fails (infrastructure failure), never passes.
- A deliberate scoring change fails the check until the key is updated in the same PR, which puts the decision in front of review.

## What could leak
Key files hold no snippet text (secret entries would trip push protection, or worse, slip past it). Output prints key fields only. No raw scanner output is uploaded; if an artifact is ever needed, it goes through `toDemoReport` / `keyMaterialIn` (`src/scanner/demo-export.js`) first.
