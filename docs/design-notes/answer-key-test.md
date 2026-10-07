# Design note: answer-key regression test

Status: proposed (2026-10-07), waiting for the user's sign-off. No code yet.

## Problem
dash's main promise is "finds the known vulnerabilities in Juice Shop and DVNA, at the right severity". The recall figures in the PRD and README (SQLi 3/3, XSS 8/9 + 3/3, crypto 5/6 + 1/1, async 15 on DVNA) were checked by hand and are written down only as tables in `HANDOFF.md`. Nothing checks them automatically. A scanner change that loses a real finding, or moves its severity, passes `npm test`, lint, build and the mutation gates, and is only noticed if someone regenerates the demo data and reads the diff.

## Acceptance criteria
- Given the three targets at the commits in `public/demo/index.json`, when the check runs, then every answer-key entry marked **found** is reported at its file and line with the expected type and severity; otherwise the check fails and names the entry.
- Every entry marked **not flagged** (deliberate non-findings, e.g. Juice Shop `*_correct.ts` codefixes, z85 coupons, `utils.ts:80` HMAC-SHA1, Express's `pbkdf2-password`) is absent; otherwise it fails.
- Every entry marked **known miss** (XSS CSP Bypass `routes/userProfile.ts:73`) is still absent. If it starts being found, the check fails with "update the answer key", so the key never goes stale in a good direction either.
- Expected values are transcribed by hand from the answer-key tables (the challenge lists `data/static/challenges.yml`, `vuln-code-snippet` markers, DVNA's `docs/solution/*.md`) and the user's recorded severity decisions. They are never copied from scanner output.
- Out of scope: dependency CVEs (no target commits a lockfile, so advisories drift daily); precision / false-positive rate (PRD's open item, measured separately); total counts per target (asserting them would be a snapshot, which `ENGINEERING_PROCESS.md` rule 5 forbids). The check prints count differences against `public/demo` as information only.

## Options
1. **Answer keys as data + a separate CI job (proposed).** `answer-keys/{juice-shop,dvna,express}.json`, one entry per sink: `file`, `line`, `type`, `severity`, `status` (found / not flagged / known miss), `source` (which challenge or doc it comes from). `scripts/check-answer-keys.js` clones each target at its pinned commit (partial clone), runs the pattern scanners, and compares. A new CI job `answer-keys` runs it on every PR, with clones cached by commit.
2. **Inside `npm test`.** Simplest wiring, but `npm test` must stay offline and fast: it's the command Stryker runs thousands of times, and the network inside it is what made earlier scores invalid. Rejected.
3. **Vendor the target files into the repo** (only the files the keys reference). Offline and fast, but it copies third-party code into a public repo (licences: Juice Shop MIT, DVNA MIT, Express MIT, so allowed), and it loses cross-file behaviour (e.g. the crypto scanner traces password callers across 6 files; async needs `server.ts` for wrapper detection). Partial copies would test a different program than the real scan.

## Measured cost (2026-10-07, this laptop)
- Partial clones at the pinned commits: Juice Shop 13 s / 65 MB, DVNA 4 s / 8 MB, Express 4 s / 6 MB.
- Pattern scan: Juice Shop **96 s**, DVNA 0.04 s, Express 0.4 s. Of Juice Shop's 96 s, the crypto scanner takes **94 s** (others: secrets 0.6 s, SQLi 0.04 s, XSS 0.07 s, async 0.6 s). That's a separate performance bug (logged in Open TODOs); the check works without fixing it, at about 2 minutes per CI run.
- A fresh scan today matches the committed demo data exactly for every pattern type on all three targets, so the answer keys describe current behaviour.

## What breaks
- A target repo is deleted or force-pushed: the pinned commit disappears and the job fails to clone (it says so; it doesn't pass). Mitigation if it ever happens: a fork under the user's account.
- GitHub is unreachable in CI: the job fails, it never passes silently.
- A deliberate scoring change (user decision) fails the check until the key is updated in the same PR. That's intended: the key change shows up in review as the record of the decision.

## What could leak
Nothing new is published. The check prints file:line, type and severity of entries in public repos; it writes no snippets to disk outside the CI workspace and uploads no artifacts.

## Decisions for the user
1. Run on every PR (proposed) or only on `main` after merge.
2. Whether `answer-keys` becomes a required check (repo setting; can come later, like `mutation-changed`).
3. Whether a known miss that starts being found fails the check (proposed) or only warns.
