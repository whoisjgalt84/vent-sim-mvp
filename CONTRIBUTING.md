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
npm test                           # 300 engine assertions
```

The browser commands use Playwright's managed Chromium and install it
automatically if the local cache is empty:

```bash
npm run test:browser               # 44 checks; starts/reuses its own server
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

- [ ] `npm test` — 300 engine assertions; exits nonzero on failure.
- [ ] `npm run test:browser` — 44 browser-behavior checks.
- [ ] `npm run test:visual:docker` — 9 authoritative Linux visual,
      determinism, and cache-busting checks. A host-specific diagnostic run is
      not a substitute for this pinned-Linux comparison.
- [ ] Screenshots — **mandatory for any UI change.** Compare before and after.
      Two shipped defects were invisible in the diff and obvious in a screenshot.
- [ ] New assertions mutation-checked: break the code, confirm the test goes red.
- [ ] No standing invariant broken — [`CLAUDE.md`](./CLAUDE.md) §4.
- [ ] Vocabulary matches [`docs/glossary.md`](./docs/glossary.md).
- [ ] If you bumped an asset, **every** local asset in `index.html` and every
      import in `js/main.js` carries the same `?v=`.

---

## Who does what

| Step | Who |
| --- | --- |
| Write the code | Agent |
| Run tests + screenshot checks | Agent |
| Create the branch | Agent |
| Make the commit, with the full message | Agent |
| **Push to GitHub** | **Owner** |
| **Open, review and merge the PR** | **Owner** |
| **`git checkout main && git pull`** | **Owner** |

The push is the owner's because the shell agents use on his machine has no
network access. Reviewing the diff is the owner's because that is where the
clinical judgment lives.

---

## The owner's loop, every time

Run these in the VS Code terminal with the `vent-sim-mvp` folder open.

**1. Check what you're about to push**

```bash
git status
git log --oneline -3
```

`git status` should say *nothing to commit, working tree clean* — apart from the
three OneDrive files noted below, which always look modified. `git log` should
show the agent's new commit on top. If the branch name isn't the one you were
told, stop and ask.

**2. Push the branch**

```bash
git push -u origin <branch-name>     # first push of a new branch
git push                             # every push after that
```

**3. Open the pull request**

Go to the repo on github.com. The yellow *"had recent pushes — Compare & pull
request"* banner is the fast path; otherwise **Pull requests → New pull request**
with `base: main`, `compare: <branch-name>`.

**Read the diff.** This is the real value of the step — every changed line, file
by file. Then **Create pull request**. Smoke tests start automatically. Wait for
the green check, then **Merge pull request → Confirm merge**. **Delete branch**
is safe to click.

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

**`Another git process seems to be running` / `index.lock` exists** — left over
from an agent committing through the desktop bridge, which can't delete its own
lock files. Agents normally move them into `.git/_stale-locks/`. If one slips
through, delete `.git/index.lock` in File Explorer and retry. (`.git` is hidden:
View → Show → Hidden items.)

**Asked to sign in to GitHub** — normal on a new machine or after credentials
expire. Follow the browser prompt.

---

## The three files that always look modified

`README-dev.md`, `package-lock.json` and `.github/workflows/smoke-test.yml` show
as modified even when nothing changed. They are **OneDrive online-only
placeholders** — the file isn't fully stored on disk, so git can't read it.

Harmless. To clear it: in File Explorer, right-click each → **Always keep on
this device**.

This is also why agents stage explicit paths rather than `git add -A`, which
would fail on these three.

---

## Commit messages

Conventional-commit prefixes. In use today: `docs:`, `feat:`, `fix:`, `chore:`,
`test:`. `refactor:` is permitted but so far unused. Scope in parentheses —
`feat(waveforms):`. The body should say what changed **and how it was
verified** — the test tally, the browser checks, the screenshots.

Author is `Chris <christian.striggow@outlook.com>` to match repo convention.
