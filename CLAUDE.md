## Git commits

- After finishing any piece of work, always create a detailed git commit: stage the relevant files and write a message that explains what changed and why, not just "update files".
- Do not push unless explicitly asked.

## Checking and verification

- Delegate all checking work to a subagent: page walkthroughs, browser screenshots, responsive and accessibility checks, code review, and build or test verification.
- The main agent implements and fixes. It should not run these checks itself or get stuck in a self-review loop.
- When a check fails, hand the evidence back to the main agent, fix it there, and send the next check to a subagent.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`NmouZh/hydwind-web`) via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
