# CLAUDE.md — operating manual for AI agents on vent-sim-mvp

Read this before touching anything. It contains the rules that are not visible in
the code and that a plausible-looking refactor will silently break.

`AGENTS.md` points here. This is the single source of truth for agent conventions.

---

## 1. What this is

A real-time, browser-based mechanical ventilator simulator for clinical
education — respiratory therapists, nurses, physicians, students. It is not a
device, not a product demo, and not a game.

**Vanilla JavaScript ES modules. No build step, no bundler, no framework, no
TypeScript.** The browser loads the source files as written. Any proposal that
introduces a compile step needs the owner's explicit approval — it is a
change to the project's defining constraint, not an implementation detail.

The bar is physiological credibility. A change that makes the UI nicer and the
physiology sloppier is a regression, even if every test passes.

---

## 2. Run and verify — the real commands

```bash
# Serve. ES modules will NOT load over file:// — you need HTTP.
python3 -m http.server 8899        # from repo root, then open http://127.0.0.1:8899

# Engine assertions (300, currently all passing)
npm test

# Browser behaviour assertions (44), requires the server above + playwright
node scratch/verify-batch.cjs

# Screenshots — the only reliable UI verification
node scratch/shot.cjs <outDir> [scenario...]
```

`shot.cjs` scenarios: `baseline`, `teaching`, `effort`, `effort-teaching`,
`weak-csv`, `teaching-loops`, `alarm-silenced`. With no scenario argument it
runs all of them. Output goes to `<outDir>/<scenario>.png` plus a `--params`
crop, and — only when the element is present and visible — `--rail` and
`--effort` crops. The rail crop is absent in Teaching Mode; the effort crop is
absent until effort is enabled. `scratch/shots-*/` is gitignored.

Both browser harnesses resolve Playwright by normal Node resolution (repo
`node_modules`, then any global install), and Chromium from `$CHROMIUM_PATH` —
falling back to a **hard-coded** `/opt/pw-browsers/chromium-1194/…` if that is
unset. Anywhere but this sandbox, set `CHROMIUM_PATH` explicitly:

```bash
npm i -D playwright && npx playwright install chromium
export CHROMIUM_PATH="$(node -e "console.log(require('playwright').chromium.executablePath())")"
```

### ⚠️ `npm test` does not gate CI

`tests/test-engine.js` contains **no `process.exit`**. It prints
`Passed: N / Failed: M` and exits 0 either way. Verified by mutation:
multiplying `LungModel.timeConstant` by 1.5 produces **29 failures and still
exits 0**, so the GitHub Actions smoke test stays green.

Until that is fixed (see the open ticket), **read the printed tally yourself
after every `npm test` run.** A green CI check proves only that nothing threw.

### Screenshot-verify all UI work

Not optional. Two defects in the last batch were invisible in the diff and
obvious in a screenshot: Teaching-Mode readouts clipped by a 208 px column
(unreadable since PR #11), and a Silence button that greyed out mid-countdown
and became uncancellable.

---

## 3. Autonomy lanes

Christian is a respiratory therapist. He is **out of the mechanical loop, in on
the clinical loop.** His RT judgment is the scarce input; his time as a
copy-paste relay is not a resource to spend.

| Lane | Scope | Rule |
| --- | --- | --- |
| 🟢 **Green** | Rendering, performance, state management, refactors, accessibility, UI polish, test harness, docs, tooling | Run unattended. Verify and report. |
| 🟡 **Yellow** | Anything with a physiological assertion that can be tested — τ = R×C decay, VT accuracy, PIP/Pplat, auto-PEEP, trigger thresholds | Build it, assert it, **then checkpoint** before merge. |
| 🔴 **Red** | Asynchrony/discordance morphology, alarm thresholds and behaviour, teaching-mode copy, what a scenario should teach, learner assessment logic | **Never unattended.** Propose; do not decide. |

The lane is set by what the change *means clinically*, not by how many lines it
touches. A one-character change to an alarm threshold is Red. A 400-line
renderer refactor is Green.

---

## 4. Standing invariants — do not break these

Each of these encodes a bug that already shipped once.

1. **`breathSummary.pip` is LIVE and belongs to the alarm path. The monitor
   reads `breathSummary.pipLatched`.** Never collapse the two. Collapsing them
   re-opens SME-014 *and* delays the high-pressure alarm by a full breath.
2. **`lastBreathPIP` is latched in `_startExpiration` only** —
   `js/simulation.js`. One latch site. Latching in `_startNewBreath` instead
   makes the monitor show the previous breath's peak for the whole expiratory
   phase (~3.2 s of measured alarm-vs-readout disagreement).
3. **Alarm EVALUATION uses `sim.globalTime`; alarm AUDIO uses wall-clock
   `getAlarmNowSec()`.** Decoupled deliberately (SME-008 / SME-017).
   Re-coupling reproduces a shipped blocker.
4. **`#param-rr`'s innerHTML rebuilds only on content change** so native `title`
   tooltips survive hover-dwell. The ineffective **count** is written by
   `textContent` *after* the guarded rebuild, deliberately outside the guarded
   string. Removing the guard kills tooltips silently, with no error.
5. **`assert(label, actual, expected, tol)` takes a RELATIVE tolerance *or* an
   absolute 0.01, whichever is looser.** The predicate is
   `diff <= tol * |expected| || diff < 0.01`. So `0.5` means ±50%, not ±0.5 —
   and for anything whose expected magnitude is near or below 0.01 (volumes in
   L, compliances in L/cmH₂O, small pressure differences) **`assert` cannot
   fail at all**, whatever tolerance you pass. Use `assertBetween` for absolute
   bounds. Five unfailable assertions were found and replaced in one batch.
6. **`reset()` clears `triggerEvents`, then `_prefill()` re-adds exactly one
   `machine` event — but only in CMV modes.** `_prefill()` starts no breath in
   PC-CSV, so the array stays empty there. Assert on *failed* events, and do not
   assume a baseline event exists in CSV.
7. **Every local asset in `index.html` carries the same `?v=`, including
   `css/style.css`.** Currently `?v=9`, at 9 sites: `index.html` ×3 and
   `js/main.js` ×6. A returning browser that pairs new markup and new JS with a
   cached old stylesheet fails **silently** — this shipped. `verify-batch.cjs`
   asserts it. Known gap: `js/ventilator.js` imports `./lung-model.js` with no
   `?v=`; harmless today only because `LungModel` is unused there. (Confirmed
   live: every page load fetches `lung-model.js` twice, once with and once
   without the query string.)
8. **Mode ID strings are `'vc-cmv'`, `'pc-cmv'`, `'PC-CSV'` — the third is
   capitalised.** Never lowercase a mode string, never compare
   case-insensitively, and prefer the exported `MODE_*` constants over literals.
   `js/main.js` currently mixes both styles.

New invariants belong in this list, with the failure they prevent.

---

## 5. Traps that have already cost time

**The left rail.** Effort controls live inside a **collapsed "Patient" group**,
and the entire left rail is `display:none` in Teaching Mode. Any script that
touches the rail must leave Teaching Mode first, then expand the group.

**Runtime-injected DOM.** The PC-CSV mode button and the `#ps-control` /
`#cycle-percent-control` elements do **not** exist in `index.html` — `js/main.js`
injects them. `syncMonitorLayout()` reparents the RR and VE rows at init, so DOM
order in the HTML is not runtime order. Grepping the HTML and concluding a
feature is missing is a false negative.

**Unguarded `getElementById`.** Many handlers have no null check. Renaming one
id throws inside `init()` and the entire app dies after `DOMContentLoaded` with
a single console error and a blank-ish page.

**Two physics implementations.** `ventilator.js` has an analytical
steady-state batch generator; `simulation.js` has the tick integrator. **The
tick integrator is what the screen shows.** The analytical path survives as
`calculateMAP()` and as the tests' target. Auto-PEEP on the monitor is closed-form
from the analytical path while waveform trapping is emergent from the
integrator — they are different models and can disagree.

**Sweep rendering.** The visible slice must be **≤ one sweep period** or old
samples wrap on top of new. The pen lifts on `px < prevPx` in three separate
places in `waveforms.js`; miss one and a horizontal line streaks the plot.

**"The change didn't take" is not automatically a code bug.** Check asset
versioning first, then check whether the files were actually applied to the
machine you are looking at.

---

## 6. Vocabulary

This project follows the **Chatburn mode taxonomy** and the
**Mireles-Cabodevila patient–ventilator interaction taxonomy**. See
`docs/glossary.md` — it is normative, not background reading.

The three rules that matter most in code review:

- **Never branch on a vendor brand name.** PRVC, AutoFlow, Volume Support and
  friends are display labels keyed to a TAG, never types. PRVC looks like volume
  control and is `PC-CMVa`.
- **A limit does not end inspiration; a cycle does.** An alarm threshold that
  terminates inspiration is a *backup cycling mechanism*, not a limit.
- **Name discordances by signal, not by cause.** `failedTrigger`, not
  `ineffectiveEffort`; `earlyTrigger`, not `reverseTrigger`. Causes go in the
  tooltip and the teaching copy, where they can be plural.

⚠️ The shipped UI says "ineffective effort" where the taxonomy says "failed
trigger". That conflict is **open and owner-assigned** — see the exception note
in `docs/glossary.md` §9. Do not resolve it in either direction unattended.

If a new term is needed, add it to the glossary with a citation in the same PR.

---

## 7. Owner decisions that override the design docs

`docs/trigger-fix-design.md` is an as-built record of intent, not a spec to
finish. These decisions supersede it:

- **No failed-trigger marker above the trace.** The amber waveform highlight and
  the `Ineffective N /60s` counter carry it.
- **No pre-apnea banner.**
- Approved 2026-07-29: the stacked Teaching-Mode RR table, both tooltip strings,
  and the PIP per-breath latch semantics.

An agent reading only the design doc would build the first two. Don't.

---

## 8. Git

**Agents do not push.** Christian pushes and opens the PR — see
`CONTRIBUTING.md`. This is not a policy preference; the shell available to
agents on his machine has no network access.

When committing through the desktop bridge:

- The VM has **no git identity**. Do not set global or local config — pass it
  inline: `git -c user.name='Chris' -c user.email='christian.striggow@outlook.com' -c commit.gpgsign=false commit -F <msgfile>`
- **Never `git add -A`.** Three files are OneDrive online-only placeholders the
  VM cannot read — `README-dev.md`, `package-lock.json`,
  `.github/workflows/smoke-test.yml`. They show as permanently modified and
  error on hash. Stage explicit paths only.
- Git leaves lock and temp files the bridge cannot delete. `rm` returns
  "Operation not permitted". **`mv` them into `.git/_stale-locks/`** after every
  git operation, then verify with `git status` and `git fsck --no-dangling`.
- Prove what landed: compare `git rev-parse HEAD^{tree}` on his machine against
  the tested clone. Equal hashes prove the committed bytes are exactly what the
  suites ran against.

---

## 9. How to work here

- **Small, careful patches over large rewrites.** This is a project value, not a
  style preference.
- **Reproduce a symptom before believing your explanation of it — and check that
  the explanation covers all the evidence.** A stale-stylesheet theory was once
  reproduced pixel-exactly and declared solved; it was wrong, because the one
  screenshot that would have discriminated the two hypotheses had the relevant
  feature switched off. Ask for the state that discriminates.
- **Self-review with an adversarial subagent, then mutation-check the tests.**
  Run every new assertion against the broken code to confirm it goes red. In one
  batch this found two real defects in Claude's own work plus five assertions
  that could not fail.
- **Report the tally, not the vibe.** "300 passed, 0 failed; 44 browser checks
  passed; screenshots in scratch/shots-x/" — not "tests pass".

---

## 10. Map

| Path | What it is |
| --- | --- |
| `README.md` | Orientation for anyone arriving at the repo |
| `README-dev.md` | Physics, architecture, units, non-goals |
| `CONTRIBUTING.md` | The human loop — branch, push, PR, merge, sync |
| `docs/glossary.md` | Normative vocabulary, with citations |
| `docs/model.md` | The published mathematical model |
| `docs/sme-feedback-log.md` | SME findings ledger — the work queue |
| `docs/case-design-schema.md` | Case authoring template; appendix snapshots engine ground truth — stale-dated, re-verify before trusting |
| `docs/case-bank-v0.1.md` | Authored teaching cases |
| `docs/case-scenario-roadmap.md` | Aspirational — phases 0–4, mostly unbuilt |
| `docs/trigger-fix-design.md` | As-built record of the trigger rewrite |
| `scratch/` | Diagnostics and one-off harnesses; not part of the app |
