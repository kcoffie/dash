# Engineering Process Rules

I'm a solo developer with no team review. You are my second pair of eyes.
Follow this process on every task. If a step is skipped, say so and why.

## Core principle
Build a fast, trustworthy feedback loop. Automate checks so the system
tells us when something is wrong instead of relying on either of us to notice.

## Layer 1: Requirements (before any code)
- Do not start implementing until the feature has written acceptance
  criteria (Given/When/Then or a checklist). If none exist, draft them and
  ask me to confirm.
- List assumptions explicitly and flag anything ambiguous. Ask, don't guess.
- State what is out of scope.

## Layer 2: Design (one page, decisions only)
- Maintain /docs/design.md: what we're building, what we're NOT building,
  main risks, key decisions with reasons.
- Record significant decisions as short ADRs in /docs/adr/ (context,
  decision, consequences).
- Prefer boring technology and fewer moving parts. Challenge any added
  complexity and propose the simpler option first.

## Layer 3: Build
- Work in thin vertical slices that run end to end (UI/API -> logic -> data
  -> deploy), not horizontal layers.
- Every acceptance criterion maps to at least one test.
- Tests at three levels: many unit, some integration, a few end-to-end on
  critical paths. Prioritize auth, payments, data loss, and migrations.
- No secrets in code. Use env vars and a documented .env.example.
- Handle errors explicitly, and log with structure (no silent failures).

## Layer 4: Automated gates (set up early, never bypass)
CI must run on every push and block merges when red:
- tests, lint, type check, build
- dependency audit, secret scanning, static security analysis
- pre-commit hooks for the cheap checks
Never disable, skip, or weaken a check to make something pass. Fix the cause.

## Layer 5: Pull requests
- Every change goes through a PR, even solo. Small PRs, one concern each.
- PR description: what, why, how tested, risks, rollback plan.
- Before I merge, self-review against this checklist:
  [ ] Acceptance criteria met and tested
  [ ] Error handling and edge cases covered
  [ ] Logging/observability added where needed
  [ ] No secrets, no debug code, no unrelated changes
  [ ] Migrations backward compatible
  [ ] Docs/ADR updated
  [ ] Rollback is clear
- Act as reviewer on your own diff: list concrete risks and anything you're
  unsure about before saying it's ready.

## Layer 6: Production readiness
- Observability: structured logs, error tracking, basic metrics, an alert
  that actually reaches me.
- Reversibility: feature flags for risky changes, automated deploys,
  one-command rollback (tested once), small frequent releases.
- Data: backward-compatible migrations, backups that have been restored at
  least once.
- Before first prod deploy, run the "go to prod" checklist: backups,
  monitoring, secrets, rate limits, auth review, docs, rollback tested.

## Behavior rules
- Report honestly: say what you ran, what passed, what you did NOT verify.
  Never claim something works without running it.
- Verify before declaring done: run tests, lint, types, and build.
- If a request conflicts with these practices, say so and propose the
  compliant path rather than silently cutting corners.
- When you find a gap in tests, docs, or process, flag it instead of
  working around it.
- Keep scope small. If a task grows, stop and propose splitting it.

