---
name: ship-batch
description: Verify, self-review, commit and report a batch of work on vent-sim-mvp. Use when a batch of changes is complete and ready to hand to Christian for push — or when asked to "ship", "ship this", "ship the batch", or "wrap up this batch". Uses the authorized verification scope, reviews new assertions, prepares an authorized commit and reports exact-candidate evidence. Does not grant push, merge or release authority.
---

# ship-batch

The desktop-bridge/OneDrive procedures below describe that environment and its observed limitations. Verify the selected task environment before applying them; do not infer that every current executor has the same paths, tools, connectivity or lock behavior.

The end-of-batch recipe. It exists because this sequence gets re-derived every
session and the failure modes are all silent ones.

Read `CLAUDE.md` first if you have not this session — especially §4 (standing
invariants) and §8 (git). This skill assumes them.

---

## 0. Confirm authority and clinical decisions

Follow [CLAUDE.md §3](../../../CLAUDE.md#3-approval-boundaries-and-clinical-risk).
All work needs the applicable owner authorization; Green/Yellow/Red classify
clinical risk, not unattended permission. Resolve required clinical decisions
before implementation and obtain owner acceptance before merge. This recipe
does not authorize a coding task, repository write, external message, push,
merge, release or deployment.

Read the [publication consequence](../../../CLAUDE.md#publication-consequence):
merging main publishes Pages even for documentation-only work. A release/tag
is a separate decision. Include candidate, destination, timing and fallback
when seeking publication authority.

---

## 1. Verify

Identify applicable checks within the approved task scope. Runtime/UI work
uses the complete gates below; documentation-only work may use static checks
and carried evidence when that is the authorized scope. Report what was and
was not executed rather than silently widening into a simulator test campaign.
Use the [single current inventory](../../../CLAUDE.md#current-verification-inventory--2026-11-03).

```bash
npm test                          # engine gate; inventory in CLAUDE.md §2
npm run test:browser              # self-contained browser gate
npm run test:visual:docker        # authoritative pinned-Linux visual/determinism/cache checks
node scratch/shot.cjs scratch/shots-<batch> baseline teaching effort effort-teaching
```

The two gate commands start or reuse their own server. `npm run serve` is needed
only for the diagnostic `shot.cjs` command. Never shell out to `python3` — it
is not portable to Windows.

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

If you bumped `?v=`, update every local asset/import site in the current `CLAUDE.md` §4 inventory (eleven at the inspected baseline, including the simulation import). The visual suite's cache-busting test catches misses from the network side.

---

## 4. Prepare an authorized commit in the selected environment

Follow [CLAUDE.md §8](../../../CLAUDE.md#8-git). Locate the actual authorized
checkout; do not assume historical desktop paths, bridge mounts, connectivity,
Git identity or OneDrive state apply to this executor.

Before an authorized branch or commit, inspect status and preserve unknown
changes. Reconcile the checkout with the tested candidate. Complete tree hashes
may be compared across complete checkouts; a partial manifest must disclose its
coverage and cannot be represented as complete tree equality.

```bash
git status
git rev-parse HEAD^{tree}
# Only within the owner's authorized scope:
git checkout -b <type>/<short-description>
git add <explicit approved paths>  # never git add -A
git -c user.name='Chris' \
    -c user.email='christian.striggow@outlook.com' \
    -c commit.gpgsign=false \
    commit -F <msgfile>
```

Recheck committed-versus-tested identity and status. If files cannot be read,
inspect and report the actual environment issue. If a lock blocks work, first
confirm no active Git process owns it and obtain authorization for stale-lock
cleanup. Do not move/delete locks or temporary objects after every operation.
Push and PR creation require separate explicit authority; network capability
alone is not permission.

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

1. **Exact-candidate evidence:** each applicable gate's tally and receipt using
   [the current inventory](../../../CLAUDE.md#current-verification-inventory--2026-11-03).
   Separate fresh results, carried evidence, failures and checks not run.
2. **Self-review findings**, including anything still unresolved.
3. **Clinical or scope decisions** needing owner acceptance.
4. **Candidate identity** and tested-versus-committed comparison, with coverage
   limits if only a partial manifest was available.
5. **The next action requiring approval**, if any. Do not turn a ready-for-review
   report into an instruction to merge or publish without authority.

A successful check is evidence, not permission. Preserve historical receipts;
do not report new simulator results for documentation-only validation.
