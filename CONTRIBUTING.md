# Contributing

Most code here is written by AI coding agents working from tickets, then
reviewed and merged by the repo owner. This document describes that loop. If you
are an agent, read [`CLAUDE.md`](./CLAUDE.md) first — it has the rules that will
bite you.

---

## Setup

```bash
git clone https://github.com/whoisjgalt84/vent-sim-mvp.git
cd vent-sim-mvp
npm ci

npm run serve                      # serve; open http://127.0.0.1:8899
npm test                           # current inventory: CLAUDE.md §2
```

The browser commands use Playwright's managed Chromium and install it
automatically if the local cache is empty:

```bash
npm run test:browser               # self-contained browser gate
npm run test:visual:docker         # authoritative Linux visual gate

# Optional host diagnostics (not an authoritative comparison):
npm run test:visual:update         # first create snapshots for this host
npm run test:visual                # then compare against those host snapshots

# Diagnostic screenshots still use a separately started server:
npm run serve
node scratch/shot.cjs scratch/shots-mywork baseline teaching effort
```

Playwright's managed installation is the default. `CHROMIUM_PATH` is available
only as an explicit override for a custom local Chromium. Authoritative visual
baselines are generated and compared in the pinned Linux image described in
[`docs/visual-testing.md`](./docs/visual-testing.md), not with that override.
The repository does not contain Windows baselines, so `npm run test:visual`
fails closed on Windows until host-specific diagnostic snapshots have first
been created with `npm run test:visual:update`.

---

## Before you open a PR

- [ ] Identify affected checks within the approved task scope. Use the
      [current inventory and receipts](CLAUDE.md#current-verification-inventory--2026-11-03)
      for engine, browser and pinned-Linux visual gates. Report the checked
      revision, fresh/carried evidence and any unavailable checks separately.
      A host-specific visual diagnostic is not the authoritative comparison.
- [ ] Screenshots — **mandatory for any UI change.** Compare before and after.
      Two shipped defects were invisible in the diff and obvious in a screenshot.
- [ ] New assertions mutation-checked: break the code, confirm the test goes red.
- [ ] No standing invariant broken — [`CLAUDE.md`](./CLAUDE.md) §4.
- [ ] Vocabulary matches [`docs/glossary.md`](./docs/glossary.md).
- [ ] If you bumped an asset, **every** local asset in `index.html` and every
      import in `js/main.js` carries the same `?v=`.

---

## Who does what

Follow the [shared approval boundaries](CLAUDE.md#3-approval-boundaries-and-clinical-risk).
The owner agrees scope and acceptance criteria and authorizes implementation.
Agents may create branches, edit, verify and commit only within that authority.
Push/PR creation needs explicit authority; owner acceptance and separate
merge/release/deployment authority are not implied by successful checks.
Clinical decisions remain Christian's. Inspect actual environment capabilities;
a historical shell's missing network access is not a universal rule.

**Before merge, read the [publication consequence](CLAUDE.md#publication-consequence):
merging main publishes Pages, including documentation merges.**

---

## The owner's loop, every time

Run these in the VS Code terminal with the `vent-sim-mvp` folder open.

**1. Check what you're about to push**

```bash
git status
git log --oneline -3
```

Inspect every modified or untracked path; preserve unexplained changes and
resolve them before proceeding. There is no permanent OneDrive exception.
`git log` should show the reviewed commit. If the branch or candidate differs
from the approved one, stop and reconcile.

**2. Push the branch**

```bash
git push -u origin <branch-name>     # first push of a new branch
git push                             # every push after that
```

**3. Open the pull request**

Go to the repo on github.com. The yellow *"had recent pushes — Compare & pull
request"* banner is the fast path; otherwise **Pull requests → New pull request**
with `base: main`, `compare: <branch-name>`. Agents use a draft PR unless the
owner explicitly requests otherwise, and only after PR creation is authorized.

**Read the diff.** This is the real value of the step — every changed line, file
by file. Then **Create pull request**. Smoke tests start automatically. Wait for
the exact-candidate checks and owner acceptance. Only with separate merge
authority proceed to **Merge pull request → Confirm merge**; this publishes
Pages. A formal release/tag and branch deletion remain separate actions.

**4. Sync your local copy — don't skip this**

```bash
git checkout main
git pull
```

This is what keeps local and GitHub in step. Skipping it is how local `main`
silently falls behind.

**5. Optional cleanup**

```bash
git branch -d <branch-name>
```

---

## If something goes wrong

**`fatal: not a git repository`** — the terminal isn't in the project folder.
File → Open Folder → `vent-sim-mvp`, then open a new terminal.

**`src refspec ... does not match any`** — branch name typo. `git branch`, copy
it exactly.

**`Updates were rejected because the remote contains work you do not have`** —
`git pull`, then push again.

**`Another git process seems to be running` / `index.lock` exists** — inspect
whether an active Git process owns the lock. Do not delete or move a live or
uncertain lock. Follow [the shared Git guidance](CLAUDE.md#8-git); agents need
authorization for stale-lock cleanup and must not automate it after operations.

**Asked to sign in to GitHub** — normal on a new machine or after credentials
expire. Follow the browser prompt.

---

## OneDrive or unreadable-file diagnostics

A historical bridge checkout had online-only placeholders at `README-dev.md`,
`package-lock.json` and `.github/workflows/smoke-test.yml`. Inspect current status,
diffs and readability; do not assume those files are unchanged or harmless.
If hydration is needed, the owner can use File Explorer's **Always keep on this
device**. Preserve unknown modifications and stage only explicit approved paths.

---

## Commit messages

Conventional-commit prefixes. In use today: `docs:`, `feat:`, `fix:`, `chore:`,
`test:`. `refactor:` is permitted but so far unused. Scope in parentheses —
`feat(waveforms):`. The body should say what changed **and how it was
verified** — the test tally, the browser checks, the screenshots.

Author is `Chris <christian.striggow@outlook.com>` to match repo convention.

For current gate counts, runners, receipts and legacy tick distinctions, use
[CLAUDE.md §2](CLAUDE.md#current-verification-inventory--2026-11-03).
The [shared reset contract](docs/demonstration-reset-contract.md) and
[UI cleanup contract](docs/ui-cleanup-batch-a.md) retain their original scope
and image-acceptance requirements; this process reconciliation does not
reapprove or regenerate baselines.
