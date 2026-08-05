---
name: ship-batch
description: Verify, self-review, commit and report a batch of work on vent-sim-mvp. Use when a batch of changes is complete and ready to hand to Christian for push — or when asked to "ship", "ship this", "ship the batch", or "wrap up this batch". Runs the full verification recipe, mutation-checks new assertions, commits through the desktop bridge with the OneDrive/lock landmines handled, and reports a tally rather than a vibe.
---

# ship-batch

The end-of-batch recipe. It exists because this sequence gets re-derived every
session and the failure modes are all silent ones.

Read `CLAUDE.md` first if you have not this session — especially §4 (standing
invariants) and §8 (git). This skill assumes them.

---

## 0. Stop if the batch touched a Red-lane thing

Asynchrony/discordance morphology, alarm thresholds or behaviour, teaching-mode
copy, what a scenario teaches. If so, **do not ship** — present the change and
get Christian's sign-off first. Yellow-lane items (anything with a testable
physiological assertion) ship with a checkpoint note in the report.

---

## 1. Verify

Run all four. Do not skip one because the change "obviously" doesn't touch it.

```bash
npm test                          # 300 engine assertions
npm run test:visual               # 9 visual + determinism checks
node scratch/verify-batch.cjs     # 44 browser assertions (needs the server)
node scratch/shot.cjs scratch/shots-<batch> baseline teaching effort effort-teaching
```

`npm run serve` must be running for the last two. `npm run test:visual` starts
its own. Never shell out to `python3` — it is not portable to Windows.

### Report the tally, not the exit code

`npm test` gates CI properly as of 2026-08-05. Still **parse the printed
`Passed: N / Failed: M` and report the numbers** — an assertion count that moved
when it shouldn't have is information a green run does not give you.

### Look at the screenshots

Actually open them. Both defects found in the 2026-07-29 batch were invisible in
the diff and obvious in a screenshot, and neither was in any ticket. Check
specifically: readouts clipped by the 208 px monitor column, controls that
change disabled state at the wrong moment, rail overflow.

---

## 2. Self-review, adversarially

Spawn a subagent to attack the diff — not to summarise it. Ask it to find what
is *wrong*, assuming the author was careless. In one batch this found two real
defects in Claude's own work plus five assertions that could not fail.

Then **mutation-check every new assertion**:

- Break the code the assertion covers. Confirm the assertion goes red.
- Revert. Confirm green.
- An assertion that stays green through its own mutation is not a test.

Two specific traps in this repo:

- `assert(label, actual, expected, tol)` takes a **relative** tolerance *or* an
  absolute 0.01, whichever is looser. For anything whose expected magnitude is
  near or below 0.01 — volumes in L, compliances — it cannot fail at all. Use
  `assertBetween`.
- Visual tolerances were mutation-checked once and failed the check. If you
  changed them, re-run the 1.8 → 2.4 stroke mutation from
  `docs/visual-testing.md` §3.

---

## 3. Check the invariants

Walk `CLAUDE.md` §4 against the diff. The ones most often broken by a
plausible-looking cleanup:

- `breathSummary.pip` (live, alarms) vs `pipLatched` (monitor) — never collapsed
- `lastBreathPIP` latched in `_startExpiration` only — one site
- alarm evaluation on `sim.globalTime`, alarm audio on wall-clock
- `#param-rr` guarded innerHTML rebuild, count written by `textContent` after
- every local asset carrying the same `?v=`, including `css/style.css`

If you bumped `?v=`, bump **all nine sites** — `index.html` ×3, `js/main.js` ×6
— plus `js/ventilator.js`'s import. The visual suite's cache-busting test
catches misses from the network side.

---

## 4. Commit through the desktop bridge

The repo lives at `C:\Users\chris\OneDrive\Desktop\vent-sim-mvp`, mounted under
`/sessions/<session-id>/mnt/vent-sim-mvp`. Find it with `device_list_dir` — do
not `find /sessions` broadly, the other entries are permission-denied.

**Before anything:** confirm his tree matches what you tested.

```bash
git rev-parse HEAD^{tree}      # on his machine
git rev-parse HEAD^{tree}      # in the cloud clone
```

Equal hashes mean branching from HEAD is safe and the PR diff will be clean.
Unequal means stop and reconcile — his local refs have been stale before.

Then:

```bash
git checkout -b <type>/<short-description>
git add <explicit paths>       # NEVER git add -A
git -c user.name='Chris' \
    -c user.email='christian.striggow@outlook.com' \
    -c commit.gpgsign=false \
    commit -F <msgfile>
```

### The landmines

1. **Never `git add -A`.** `README-dev.md`, `package-lock.json` and
   `.github/workflows/smoke-test.yml` may be OneDrive online-only placeholders
   that the VM can neither read nor write — they error `Invalid argument` and
   git cannot hash them. Check with `git hash-object <path>` before staging one.
   If it fails, ask Christian to right-click → **Always keep on this device**.
   Also skip untracked `.claude/settings.local.json` and any `~$*` Office lock
   files.
2. **No git identity on the VM.** Pass it inline as above. Never set global or
   local config.
3. **Clean the locks afterwards, every time.** Git leaves lock and temp files
   the bridge cannot delete (`rm` → "Operation not permitted"). Move them:

   ```bash
   mkdir -p .git/_stale-locks
   mv .git/index.lock .git/HEAD.lock .git/objects/maintenance.lock \
      .git/objects/*/tmp_obj_* .git/_stale-locks/ 2>/dev/null
   ```

   Then verify with `git status` and `git fsck --no-dangling`. One run left 37
   of these; the next git command blocks until they are moved.
4. **The VM has no network.** The push is Christian's. Never attempt it.

---

## 5. Commit message

Conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`, `test:`), scope where
it helps. The body says **what changed and how it was verified** — tallies, not
adjectives. Name any defect found during self-review; those are the most useful
lines in the history. Close with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## 6. Report

Give Christian, in this order:

1. **The tallies.** `300 passed / 0 failed`, `9 visual`, `44 browser`, and where
   the screenshots are.
2. **Anything found by self-review**, including in your own work.
3. **Any Yellow-lane checkpoint** he needs to rule on before merge.
4. **The tree hash**, and confirmation it matches the tested clone.
5. **His command**, exactly:

   ```
   git push -u origin <branch-name>
   ```

   Then the PR per `CONTRIBUTING.md` — read the diff, merge, and
   `git checkout main && git pull`.

Do not end with "tests pass." End with numbers.
