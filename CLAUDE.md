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

# Engine: see the current verification inventory below
npm test

# Authoritative visual regression + determinism + cache-busting, pinned Linux
npm run test:visual:docker

# Browser behaviour; self-contained server lifecycle
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

<a id="verification-inventory"></a>
<a id="current-verification-inventory--2026-11-03"></a>

### Current verification inventory - 2026-11-07

The inventory is defined by the [engine runner](tools/run-engine-tests.mjs)
and [browser/visual runner](tools/run-browser-tests.mjs), not workflow job titles.
The following inventory includes the bounded desktop teaching slice, usability follow-up and overlay help panel. It is not
the inventory of the historical release CI run below.

| Gate | Required inventory |
| --- | --- |
| Engine | 300 original assertions; 22 adaptive controller; 24 adaptive integration; 22 selective legacy fixtures; 41 effort/pressure; 28 demonstration-reset; 43 manual-hold; 15 R01/R11; 17 R02 groups. Plus 8 teaching-slice and 6 phase-history groups. Total: 526 mixed top-level assertions/groups/fixtures, not 526 equivalent tests. |
| Browser | 44 original; 12 adaptive; 4 effort/pressure; 5 Effort-slider; 8 reset; 7 UI cleanup; 20 manual-hold; 4 R01/R11; 3 R02 groups. Plus 8 teaching-slice, 5 hierarchy, 4 usability and 8 overlay-panel groups. Total: 132. |
| Pinned-Linux visual | 18 existing groups plus 3 manual-hold groups. Total: 21, including determinism and cache-busting. |

**Overlay-panel premerge-fix evidence:** local engine 526/0, browser 132/0 and pinned-Linux visual 21/21 receipts cover the targeted persistence/focus and Standard-mode accessibility fixes. This documentation-only update carries those results forward without rerunning gates. See [the premerge-fix closeout](docs/overlay-help-premerge.md) for exact source identity, retained receipts and limits.

**Historical overlay-panel evidence:** local engine 526/0, browser 130/0 and pinned-Linux visual 21/21 receipts cover the owner-accepted panel candidate. This documentation-only closeout carries those results forward without rerunning simulator gates. See [the overlay-panel closeout](docs/overlay-help-panel.md) for source identity, retained receipts, acceptance and limits.

**Historical usability follow-up evidence:** local engine 526/0 and browser 124/0 receipts cover the reviewed source; after separately authorized reference installation, pinned-Linux visual passed 21/21. This documentation-only closeout carries those results forward without rerunning simulator gates. See [the usability closeout](docs/usability-followup.md) for exact source/reference manifests, retained logs, acceptance and limitations.

**Historical local slice evidence, 6 November:** owner-approved references were installed
and the full pinned-Linux gate passed 21/21 groups and 162/162 screenshot
comparisons at source SHA256
`67e53a5baac4a12bc5b9b4ce1c14118651c5d9a3549da569262f03e3c7c3a03b`.
Updates were disabled, snapshots enabled, and tolerances unchanged. Engine
520/0 and browser 120/0 receipts are carried forward from Patient-default source
`c2af5bb0e4e79d46ea021f85327011405aaff370c994c921a569153a19d42bfe`:
their runtime, test and runner inputs remain byte-identical. Later changes were
visual assertions and reviewed PNGs. This documentation closeout changes only
documentation; it runs no simulator gate and does not establish new CI results.
See [the slice closeout](docs/desktop-teaching-slice.md#accepted-local-candidate-and-evidence)
for identities, acceptance, installation and evidence limits.

**Historical release evidence:** candidate
`9dafc934fbe7891feee96c0d37fedb4cd7814538` and
[exact-main CI run 41697146820](https://github.com/whoisjgalt84/vent-sim-mvp/actions/runs/41697146820)
recorded zero failures for the pre-slice inventory: 512 mixed engine
assertions/groups/fixtures, 107 browser groups and 21 pinned-Linux visual groups,
on Node 22.23.4 and 24.22.1 and Playwright v1.62.1-noble. Those results do not
cover the later slice additions. The separate CLIN-006 focused tally is 884/0 in each
engine log; nested checks are not additional top-level groups. The 41
effort/pressure groups include 40 engine groups and one renderer group with
66 subchecks. Selective legacy preservation exercises 92,500 ticks: 28,000
exact passive ticks across 8 fixtures and 64,500 active conformance ticks across
14 fixtures, not 92,500 exact matches. The separate retained PR 55 preservation
receipt covers 24 fixtures and 144,000 ticks; do not combine these counts.

These are receipts for the named candidate, not fresh results for later edits.
For a changed candidate, identify affected verification, preserve earlier
receipts as historical, and distinguish fresh, carried-forward and unavailable
checks. Documentation-only work must not imply new simulator execution.
See the [release status](docs/clinical/CLIN-001/successor-index.md) and
[R01/R11](docs/review-remediation.md) and [R02](docs/effort-timing-contract.md)
contracts for scope and evidence boundaries.

`npm test` exits nonzero on failure and rejects a reduced commissioned tally.
Still read the printed `Passed: N / Failed: M`; an unexpected count change is
information even when the run is green. Before 2026-08-05 the original suite
had no failure exit code. Multiplying `LungModel.timeConstant` by 1.5 was shown
to produce 29 failures and exit 1 in the original suite.

### Screenshot-verify all UI work

Not optional. Two defects in the last batch were invisible in the diff and
obvious in a screenshot: Teaching-Mode readouts clipped by a 208 px column
(unreadable since PR #11), and a Silence button that greyed out mid-countdown
and became uncancellable.

---

## 3. Approval boundaries and clinical risk

Christian's prior approval is required before repository writes, starting new
coding tasks, sending messages to others, merging, releasing or deploying.
Approval is specific to the action and scope. A plan, successful check or risk
category does not grant implementation or publication authority.

Use this sequence: agree scope and acceptance criteria; obtain implementation
authority; verify and independently review the exact candidate within the
approved scope; obtain owner acceptance; then obtain separate authority for
publication. Record any changed candidate identity and affected evidence.

Clinical risk categories guide review depth, not permission:

| Category | Scope | Review emphasis |
| --- | --- | --- |
| Green | Rendering, performance, state management, refactors, accessibility, UI polish, test harness, docs, tooling | Verify the authorized change and report. |
| Yellow | Testable physiological assertions: decay, VT, PIP/Pplat, auto-PEEP, trigger thresholds | Verify assertions and obtain clinical acceptance before merge. |
| Red | Asynchrony/discordance morphology, alarms, teaching copy, scenario intent, learner assessment | Propose clinical decisions for Christian; do not decide them independently. |

Risk follows what a change means clinically, not its line count. A one-character
alarm-threshold change is Red; a renderer refactor may be Green but still needs
authorization.

### Publication consequence

Under the established configuration, **merging to `main` publishes GitHub
Pages**. This includes documentation merges. Name the exact candidate,
destination, timing and fallback when requesting publication authority. A
successful merge or Pages run is not separate approval for a release or tag.
The [PR 55 Pages run](https://github.com/whoisjgalt84/vent-sim-mvp/actions/runs/41697145180)
is evidence of deployment, not served-byte, cache or recovery verification.

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
   Currently `?v=34`, at **11** sites: `index.html` ×3, `js/main.js` ×6,
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
    per-breath diagnostic selector clears current-generation availability without
    erasing canonical VT/PIP. SME-026/027 display instead selects frozen manual
    history, labeled Last valid hold with its old source mode/settings. Recurring
    pauses never overwrite it; invalid attempts retain it; shared Reset clears it.
    See docs/manual-inspiratory-hold-contract.md. This prevents ordinary breaths
    or current-mode labels from silently erasing or relabeling historical results.
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

19. **Hold age counts executed physics ticks across retained-history runs.**
    `_elapsedPhysicsTicks` is metadata only. The saved manual result owns its
    completion tick; invalid attempts never replace it. Mode/flow transitions
    retain that source and age, pause earns no age, and capped transport counts
    only executed ticks. Main Reset clears the saved result and exposes null age.
    Do not subtract per-run `globalTime` from a hold saved in a previous run.

20. **Visibility and effort selection are separate from physiology.** Patient,
    Teach and loops retain independent visibility; visibility/resize repaints add
    no alarm evaluations. Selected effort amplitude survives Off and mode changes;
    Off immediately disables effort and sets actual amplitude to zero. Enabled
    zero is distinct from Off in the native control and Teaching Patient RR.
    Preserve R-02's engine-owned requested/applied timing pair and interruption rules.

21. **PC-CSV presentation gates configured-cycle predictions without changing
    analytics or alarm inputs.** Use the presentation selector for monitor
    predictions, mechanics chips and advisory badges. Keep genuine completed,
    live and historical values. The visible maximum Ti is read-only and uses
    the existing `max(vent.inspiratoryTime, 2*dt)` backstop; I:E remains editable.
    See [the bounded teaching slice](docs/desktop-teaching-slice.md).

---

## 5. Traps that have already cost time

R-01/R-11 remediation adds 15 engine groups and four browser groups to the
existing inventories. Signed finalized PIP is tracked separately from the
unchanged running alarm peak: canonical/latched PIP and nested hold-source PIP
use the finite INSPIRATION-only maximum, or null if absent. Zero/negative peaks
are measurements. Fractional transport credit survives pause/speed changes,
clears on reset, and never stores whole-tick cap debt. Browser transport time
must not move backward when a rAF timestamp predates a control settlement.
R-02 adds 17 engine groups and three more browser groups. Valid RR/Ti selections
queue until the next full patient-cycle boundary; keep the starting pair and
finalize an ending effort first, including equality. Off freezes the established
clock/activity and preserves terminal guards, with separate interrupted records
rather than failed triggers. Reset/mode change resolve accepted queued selections
before starting a fresh run. See docs/effort-timing-contract.md.

**Patient visibility.** Effort and mechanics live in the separate `#patient-panel`,
closed initially at every width. Patient opens a persistent panel at >=1300 CSS
px and a nonmodal drawer below that width. Reset/Teach/resize retain the choice;
a reload starts closed again.
Patient and Teach are independent. Header actions can light-dismiss the narrow
drawer through focus leaving it; reopen Patient before driving its inputs.
Teach hides ventilator settings; Patient remains independent. Additional outputs
start collapsed with native keyboard disclosure. Loops start off and must be enabled
explicitly before asserting loop geometry.

**Runtime-injected DOM.** The PC-CSV mode button and the `#ps-control` /
`#cycle-percent-control` elements do **not** exist in `index.html` — `js/main.js`
injects them. `syncMonitorLayout()` moves seven existing readout rows and the recurring-pause control at init, so DOM
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

Work only within the owner's authorized scope. Pushes and PR creation require
explicit authority; merges, releases and deployments require their own
approval. See [publication consequences](#publication-consequence) and
[CONTRIBUTING.md](CONTRIBUTING.md). Connectivity is an environment fact, not a
substitute for permission: inspect the selected executor rather than assuming
it has or lacks network access.

- Inspect status and diffs before changes; preserve unknown modifications.
  Never dismiss a modified file as a permanent placeholder exception.
- Stage explicit paths only, never `git add -A`. On a OneDrive-backed checkout,
  inspect readability if a file cannot be hashed. `README-dev.md`,
  `package-lock.json` and `.github/workflows/smoke-test.yml` were affected in a
  historical bridge environment; that does not establish their current state.
  Ask the owner to hydrate an inaccessible file when needed.
- Use the established author identity for an authorized commit. If identity is
  absent, pass it per command rather than changing global/local configuration:
  `git -c user.name='Chris' -c user.email='christian.striggow@outlook.com' -c commit.gpgsign=false commit -F <msgfile>`.
- If a Git lock blocks work, identify it and establish that no active Git
  process owns it. Do not move or delete locks or temporary objects routinely.
  Obtain authorization for any stale-lock removal/movement; preserve uncertain
  state and report an access failure rather than bypassing it.
- Prove tested-versus-committed identity. Compare tree hashes where complete
  checkouts exist; otherwise use an explicit changed-file/source manifest and
  disclose its limits. Equal complete tree hashes establish content identity,
  not clinical or release approval. Recheck status after an authorized commit.

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

The current complete gate inventory is in §2 above; do not maintain a second
competing inventory here.
