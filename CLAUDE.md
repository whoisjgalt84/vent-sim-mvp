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
npm run serve                      # node tools/serve.mjs — then http://127.0.0.1:8899

# Engine: 300 original + 22 controller + 24 integration + 22 selective legacy fixtures + 41 effort/pressure + 28 reset groups
npm test

# Authoritative visual regression + determinism + cache-busting (18: 16 existing + 2 shared reset), pinned Linux
npm run test:visual:docker

# Browser behaviour (44 original + 12 adaptive + 4 effort/pressure + 5 Effort-slider + 8 reset), self-contained server lifecycle
npm run test:browser

# Screenshots — the only reliable UI verification
node scratch/shot.cjs <outDir> [scenario...]
```

`shot.cjs` scenarios: `baseline`, `teaching`, `effort`, `effort-teaching`,
`weak-csv`, `teaching-loops`, `alarm-silenced`. With no scenario argument it
runs all of them. Output goes to `<outDir>/<scenario>.png` plus a `--params`
crop, and — only when the element is present and visible — `--rail` and
`--effort` crops. The rail crop is absent in Teaching Mode; the effort crop is
absent until effort is enabled. `scratch/shots-*/` is gitignored.

After `npm ci`, `npm run test:browser` uses Playwright's managed Chromium and
installs that pinned browser automatically if its cache is empty. It starts
`tools/serve.mjs` only when needed, reuses a healthy server, and cleans up only
the process it started. `CHROMIUM_PATH` remains an explicit override, not a
required setup step.

The authoritative comparison is `npm run test:visual:docker`, which uses
`mcr.microsoft.com/playwright:v1.62.1-noble`, the same pinned image as CI. See
[`docs/visual-testing.md`](docs/visual-testing.md); every changed baseline still
requires direct human inspection and intentional approval.

`npm run test:visual` compares only the current host's platform-tagged
snapshots. The repository contains Linux baselines, not Windows baselines, so it
is not directly usable for comparison on Windows. Optional Windows diagnostics
require generating host-specific, non-authoritative snapshots first with
`npm run test:visual:update`; only then can `npm run test:visual` compare them.

### Read the tally anyway

`npm test` exits nonzero on any assertion failure and also enforces the
commissioned original `300 passed / 0 failed` tally plus the separate 22 controller,
24 integration, 22 selective legacy and 41 effort/pressure group inventories, so
an accidental test-count drop is a failure. The 41 groups comprise 40 engine
groups and one renderer group with 66 subchecks. Selective legacy preservation
retains 92,500 exercised ticks: 28,000 exact passive ticks across 8 fixtures and
64,500 active conformance ticks across 14 fixtures; these are not 92,500 exact
matches. These inventories specify the required gate; passing results require
fresh run receipts. Mutation-verified on the original suite: multiplying `LungModel.timeConstant` by 1.5 gives
29 failures and exit 1.

Before 2026-08-05 it had no exit code at all and CI stayed green through any
number of failures. Keep reading the printed `Passed: N / Failed: M` — a count
that moves unexpectedly is information even when the run is green.

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
   tooltips survive hover-dwell. The failed-trigger **count** is written by
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
7. **Every local asset carries the same `?v=`, including `css/style.css`.**
   Currently `?v=23`, at **11** sites: `index.html` ×3, `js/main.js` ×6,
   `js/ventilator.js` ×1, and `js/simulation.js` ×1. A returning browser that pairs new markup and new JS
   with a cached old stylesheet fails **silently** — this shipped. Asserted two
   ways: `verify-batch.cjs` reads the source, and the visual suite's
   cache-busting test watches the **network**, which is what caught
   `js/ventilator.js` importing `lung-model.js` un-versioned and making the
   browser fetch it twice on every load.
8. **Mode ID strings are `'vc-cmv'`, `'pc-cmv'`, `'PC-CSV'`, `'pc-cmva'` — the third is
   capitalised.** Never lowercase a mode string, never compare
   case-insensitively, and prefer the exported `MODE_*` constants over literals.
   `js/main.js` currently mixes both styles.
9. **Per-breath monitor availability uses `lastCompletedBreath !== null`, never
   `breathCount > 0`, running pressure, or an analytical fallback.** VSM-CLIN-004
   prevents the shipped pre-breath predicted/running PIP and set/predicted VT
   masquerading as measurements, and provisional VT resetting at the next
   inspiration. Read finalized VT from that record, retain the existing PIP
   latch, and synchronously refresh display values on reset/mode switch without
   adding alarm evaluations. Predictions must retain visible provenance.
10. **Hold-derived mechanics require a valid completed HOLD interval and their
    own generation identity.** A nonzero hold setting is not measurement proof.
    Pplat uses the mean of the final 20 genuine HOLD-physics samples only after
    0.5–2.0 s, at least 50 samples, exact zero flow, passive effort, and stable
    finite pressure are established. Driving pressure, compliance, and measured
    resistance retain separate dependency-specific status and reasons. The
    selector clears their availability on a new breath or incompatible setting
    change without erasing the canonical prior VT/PIP record.
11. **Hold-mechanics help uses one body-level popover and static triggers.**
    Monitor refreshes may update its text or close it when its trigger becomes
    hidden, but must not rebuild the trigger DOM. This preserves hover transfer,
    keyboard focus, click/tap state, and the existing RR tooltip behavior.
12. **Delivered VE uses one shared `sim.deliveredVentilation` snapshot.**
    VSM-CLIN-006 counts actual canonical publications in `(now - 30 s, now]`,
    using unrounded modeled inspiratory volume and simulation tick boundaries.
    Both VE alarms remain ineligible and the readout remains unavailable until
    30 s of valid observed history exists; a full empty window is available zero.
    Preserve the existing 5 s grace, with no additional delay after availability.
    Age prior delivery without new completions. Reset clears its generation;
    ordinary settings changes retain history. Never substitute predicted/set
    ventilation, provisional VT, or interval RR. Display rounds to one decimal;
    alarms compare raw values. RR's existing calculation and the live PIP/audio
    clock invariants remain separate. Static help triggers must survive refresh,
    and Escape focus restoration must not reopen the dismissed popover.
    The owner refined D7 to **Measured RR** (Standard) and **Measured**
    (Teaching), retaining precise completed-breath interval/smoothing/retention
    help and independence from delivered VE. Preserve the existing RR tooltip
    nodes and capitalization styling when updating this wording.

13. **PC-CMVa pressure and PEEP latch at the actual breath start.** The pure
    controller consumes raw canonical inspired VT once per eligible source; it
    has no model-state inputs. Operator target/PEEP requests are atomic and
    queued, while explicit reset/exit resolves both before initialization.
    Re-entry uses retained current settings and initial pressure, never stale
    requests or feedback. Manual Pinsp/PS remain independent. Relevant edits,
    including edit/revert, invalidate the separate adaptive epoch. A delivered
    but adaptation-ineligible breath still belongs to VE. Preserve source-target
    display pairing, applied-versus-next bounds, pause state and unavailable
    fixed-pressure predictions. See docs/adaptive-mode-contract.md for the
    approved owner clarification; do not infer new clinical behavior from tests.

14. **Pressure/flow physics and detection share one sampled state.** Expiration
    uses applied B and pre-step V: d=Pmus-V/C; d<=0 gives Q=d/R, Paw=B;
    d>0 gives Q=d/(R+Rc), Paw=B-Rc*Q. Rc defaults to 2 cmH2O·s/L, is a
    setup-only 0.5–5 educational assumption, and is distinct from airway R.
    This prevents the original expiration defect: separately computed Paw and
    Q failed the declared EOM by -Pmus. Check pre-state residual separately
    from the expected -Q*dt/C post-Euler staggering. Preserve 100 Hz Euler,
    supported UI R/C, and VC's deliberate post-step pressure collocation.
    No volume jump on PEEP edits or hidden volume-floor loss is allowed.

15. **PC command and patient-side Paw differ behind a closed delivery valve.**
    With D=Pinsp+Pmus-Vpre/C, open/neutral flow is D/R at Paw=B+Pinsp;
    D<0 closes the one-way valve, Q=0 and Paw=B+Vpre/C-Pmus. This prevents
    retaining commanded pressure with clamped flow in violation of the EOM.
    Closed Paw/PIP may exceed the command bounds. It is neither a HOLD nor a
    controller update nor new trigger eligibility. Preserve PC-CSV cycle and
    max-Ti rules, live PIP/alarm inputs and the single expiration-start latch.

16. **Patient-trigger history owns immutable detection provenance.** Pressure
    uses max(0,Bsample-Pawsample); flow uses max(0,Qsample*60), with existing
    inclusive thresholds and eligibility. Freeze variable, threshold/units,
    signed signal, sampled PEEP, time/index and settings/neural identities at
    detection; copy them to delivery with separately recorded delivery PEEP.
    Queues and live-setting edits must not relabel old events. Clear pending
    data on reset/exit/cancellation. Pressure patient markers belong on pressure,
    flow patient markers on flow, neither on volume; unknown legacy provenance
    gets no variable marker. Failed events never acquire a delivered symbol.

17. **Pressure rendering preserves signed raw physics, and unsupported active
    analytical predictions stay unavailable.** Scalar/P-V pressure geometry
    includes negative samples and atmospheric zero without a synthetic dip or
    zero-floor clipping; nonfinite paths lift the pen. Keep applied PEEP distinct
    from gauge zero. Configured active effort gates affected legacy MAP,
    auto/total PEEP, trapped volume and pressure/flow-dependent predictions;
    preserve applicable passive analytics, configured mechanics and canonical
    measured outputs. Null is unavailable, never fabricated zero. This prevents
    unrepaired legacy predictions and live-setting tooltips from claiming the
    corrected live signal. See docs/model.md for the accepted successor contract.

New invariants belong in this list, with the failure they prevent.

18. **Demonstration reset starts a fresh run with retained selections.** The
    header Reset is the single reset control in all four modes. Resolve
    pending adaptive target/PEEP and selected maximum before initialization;
    preserve transport and wall-clock mute/Silence semantics. Clear old measured
    outputs, traces/loops and alarm presentation synchronously without adding an
    alarm evaluation. A CMV prefill machine event is new startup history; CSV
    waits for a new trigger. Help must distinguish a new run from a treatment
    effect. See [the approved reset contract](docs/demonstration-reset-contract.md).

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
`calculateMAP()` and as the tests' target. The standard monitor's **Predicted steady-state auto-PEEP** is a passive closed-form prediction, unavailable with configured active effort or PC-CMVa. Teaching Mode uses that row for the live **Flow Baseline** cue. **Predicted steady-state trapped volume** is an applicable analytical prediction; **Live modeled trapped volume** is the residual volume latched immediately before the current breath started. It is not a continuously updated volume or an expiratory-hold measurement. These paths have different assumptions and can disagree; VSM-CLIN-014 reconciliation remains open.

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

CLIN-OD-009 approves Failed trigger as the canonical learner-facing term. The
approved first-use bridge and presentation rules are documented in
`docs/glossary.md` §9. Preserve cause-specific explanations and CLIN-OD-002
boundaries.

If a new term is needed, add it to the glossary with a citation in the same PR.

---

## 7. Owner decisions that override the design docs

`docs/trigger-fix-design.md` is a historical design and decision record, not a specification to finish. The current model contract and these later owner decisions supersede its affected sections:

- **No failed-trigger marker above the trace.** The amber waveform highlight and
  the `Failed triggers N /60s` counter carry it.
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
- **Report each gate and its checked revision.** Separate the original 300-assertion tally from added engine groups, list all browser groups and the pinned-Linux visual tally, and link receipts. Distinguish fresh results from carried-forward evidence and unavailable checks.

---

## 10. Map

| Path | What it is |
| --- | --- |
| `README.md` | Orientation for anyone arriving at the repo |
| `README-dev.md` | Physics, architecture, units, non-goals |
| `CONTRIBUTING.md` | The human loop — branch, push, PR, merge, sync |
| `docs/glossary.md` | Normative vocabulary, with citations |
| `docs/model.md` | The published mathematical model |
| `docs/visual-testing.md` | The screenshot suite: determinism hook, baselines, tolerances |
| `.claude/skills/ship-batch/` | The end-of-batch recipe — invoke with `/ship-batch` |
| `tools/serve.mjs` | Static server for dev and the harnesses (`npm run serve`) |
| `docs/sme-feedback-log.md` | SME findings ledger — the work queue |
| `docs/case-design-schema.md` | Draft authoring template and dated implementation inventory; re-verify the served build before rehearsal |
| `docs/case-bank-v0.1.md` | Authored teaching cases |
| `docs/case-scenario-roadmap.md` | Aspirational — phases 0–4, mostly unbuilt |
| `docs/trigger-fix-design.md` | Historical trigger-rewrite design; current signal contract is in `docs/model.md` |
| `scratch/` | Diagnostics and one-off harnesses; not part of the app |
