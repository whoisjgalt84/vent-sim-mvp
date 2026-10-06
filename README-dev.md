# Ventilator Simulator — README (Developer)

For orientation and what the app does, see [`README.md`](./README.md).
For agent conventions and standing invariants, see [`CLAUDE.md`](./CLAUDE.md).
For the full mathematical model, see [`docs/model.md`](./docs/model.md).

---

## 🫁 Core Idea

This simulator is a single-compartment implementation of the respiratory-system equation of motion. In the live integrator:

> **Paw + Pmus = B + V/C + R × Q**

Paw is patient-side airway-opening gauge pressure, B is applied PEEP, V is volume above applied-PEEP equilibrium including retained volume, and Q is inward-positive flow. The elastic load V/C already includes residual gas, so intrinsic PEEP is not added a second time. R is combined airway-plus-tube resistance; the separate inward-supply resistance Rc is used by the expiratory boundary equations.

Source formulas that add PEEPauto use a different volume reference. See [`docs/model.md`](./docs/model.md) for the phase equations and the deliberate pre-/post-integration sampling conventions.

If a feature cannot be explained through this equation, it does not belong here.

---

## 🚀 Getting Started

```bash
npm install

# Serve over HTTP — ES modules will NOT load over file://
npm run serve                      # then open http://127.0.0.1:8899

# Engine: 300 original + 22 controller + 24 integration + 22 selective legacy fixtures + 41 effort/pressure groups
npm test

# Browser gates install Playwright's managed Chromium if the cache is empty
npm run test:browser                 # 44 original + 12 adaptive + 4 effort/pressure + 5 Effort-slider groups; starts/reuses its own server
npm run test:visual:docker           # 16 authoritative pinned-Linux visual groups

# Optional current-host diagnostics require host-specific snapshots first
npm run test:visual:update
npm run test:visual
```

The repository contains only the authoritative Linux baselines. In particular,
`npm run test:visual` is not directly usable for comparison on Windows: create
non-authoritative `chromium-win32` diagnostic snapshots with the update command
before running the current-host comparison. Neither command replaces the
pinned-Linux gate.

VS Code's Live Server extension works too. `open index.html` does **not** — the
`type="module"` scripts are blocked by CORS on `file://`.

`npm run serve` runs `tools/serve.mjs`, a ~90-line Node static server. It
replaced `python3 -m http.server`, which is not portable: on Windows `python3`
is usually not a real command, and the `python3.exe` App Execution Alias opens
the Microsoft Store instead of failing — so a harness that shelled out to it
would hang rather than error.

---

## 🎯 Scope

Built outward from a **minimum viable core**: VC-CMV, square flow, passive
patient (Pmus = 0).

**Everything else is an extension**, not the foundation. Already implemented:

* PC-CMV (pressure control, continuous mandatory)
* **PC-CMVa** (pressure control, continuous mandatory, adaptive targeting): a generic breath-to-breath controller using eligible completed modeled inspired VT; see [`docs/adaptive-mode-contract.md`](./docs/adaptive-mode-contract.md)
* **PC-CSV** (pressure control, continuous spontaneous — pressure support, with
  settable PS level and cycle %)
* Descending ramp flow
* Inspiratory hold
* Auto-PEEP / air trapping
* Patient effort (Pmus), with independent neural rate and neural Ti
* Flow and pressure triggering, with a three-gate eligibility rule
* Alarms (5) with priority tiers, audio, and silence
* Teaching Mode — Set/Measured/Patient rates, failed-trigger counter,
  failed-trigger highlighting with per-gate tooltips
* Sweep rendering with a selectable 5/10/20/30 s window; P-V and F-V loops

⚠️ Rule: we do not expand features unless they preserve clarity of the core
model.

---

## 🧱 Architecture

Vanilla ES modules, loaded directly by the browser. **No build step, no bundler,
no framework, no TypeScript.** Introducing one is a change to the project's
defining constraint, not an implementation detail.

```
LungModel        → Patient mechanics (R, C, τ) + static solutions
Ventilator       → Settings, derived physiology, analytical breath generator
SimulationEngine → Time evolution (the tick integrator — this drives the screen)
WaveformDisplay  → Rendering (canvas): sweep waveforms + loops
AlarmEngine      → Alarm evaluation (pure, sim-time)
alarm-audio.js   → Alarm audio policy (pure, wall-clock)
main.js          → Integration + UI wiring (no exports; side-effect module)
```

Two modules live at the repo **root**, not under `js/`: `alarms.js` and
`alarm-audio.js`. Both are imported by `js/main.js`. `alarms.js` is *also*
script-tagged in `index.html`, where it publishes `window.AlarmEngine` — but
**nothing reads that global.** The tag is vestigial and removable; it is one of the eleven local asset/import version sites currently kept in sync. See `CLAUDE.md` §4 and the source/network checks for the current inventory.

The only devDependency is `@playwright/test`, used by the visual suite and the
`scratch/*.cjs` harnesses. (`typescript`, `tsx` and `vitest` were declared but
never used anywhere; removed 2026-08-05.)

### Responsibilities

**LungModel** — R, C, elastance, τ. Static/closed-form solutions: inspiratory
and plateau pressure, expiratory flow and decay, steady-state trapped volume and
auto-PEEP. Seven presets.

**Ventilator** - operator settings, mode applicability, analytical predictions and the analytical breath generator. `summary()` supplies configured/derived settings, configured mechanics and applicable analytical predictions; it is only one input to the monitor. Canonical PIP/VT, hold-derived mechanics, Delivered VE, live trapped volume and adaptive source/command state come from `SimulationEngine` under the source-specific availability rules in [`docs/model.md`](./docs/model.md).

**SimulationEngine** — 100 Hz tick integrator; breath phase state machine
(INSPIRATION → HOLD → EXPIRATION); the neural (patient) oscillator; trigger
eligibility and trigger-event recording; ring buffers for the traces; measured
values. **This is what the screen shows.**

**WaveformDisplay** — sweep-rendered pressure/volume/flow with an erase bar,
trigger-event marks, highlight segments, and P-V / F-V loops.

**main.js** — wires UI → ventilator → simulation → display; owns the render
frame, the monitored-value panel, alarm dispatch and audio, and Teaching Mode.

### ⚠️ Two physics implementations

`Ventilator.generateBreathWaveforms()` is an **analytical steady-state** batch
generator. `SimulationEngine._computePhysics()` is a **tick integrator**. They
are not the same model.

The tick integrator drives the display. Passive analytical predictions retain
their labeled, separate provenance; waveform trapping is emergent residual
volume and need not agree with those predictions. The legacy analytical
preview/MAP generator does not implement the live directional supply boundary
or closed delivery-valve pressure. Its active-effort results are not the
repaired live signal. Affected active-effort MAP, auto/total PEEP, trapped-volume,
predicted PC VT/VE and dependent pressure/flow/timing predictions are gated as
unavailable; adaptive fixed-pressure predictions remain unavailable. Configured
R/C/calculated RxC, canonical measured values and applicable passive analytics
retain their meanings. See [`docs/model.md`](./docs/model.md#2-what-the-engine-actually-runs).

---

## 🧠 Simulation Philosophy

### 1. Physics first

All behaviour traces back to the equation of motion. No faked waveforms, no
arbitrary curves.

### 2. Analytical when possible

VC modes have closed-form solutions; passive expiration is exponential decay.

### 3. Numerical only when necessary

PC with patient effort uses an ideal upstream command and a one-way delivery
valve. At pre-integration state Vpre:

```
D = Pinsp_applied + Pmus − Vpre/C
Q = max(0, D/R)
Paw = B + Pinsp_applied       if D >= 0
Paw = B + Vpre/C − Pmus       if D < 0
Vpost = Vpre + Q·dt
```

Integrated at **100 Hz** (`dt = 0.01 s`), forward Euler.

The closed branch has zero flow and patient-side recoil/muscle pressure, which
may exceed the upstream command. Closure does not change mandatory Ti, PC-CSV
flow/max-Ti cycling or trigger availability. Expiration in all four modes uses
d=Pmus-Vpre/C: d<=0 gives Q=d/R and Paw=B; d>0 gives Q=d/(R+Rc) and Paw=B-Rc·Q.
Rc=2 cmH2O·s/L is an accepted educational inward-supply assumption, distinct
from patient airway R; setup-only range 0.5–5 requires reset and has no learner
slider. No circuit compliance, bias flow, leak or pressure-response delay is
modeled. HOLD stays sealed; VC retains its deliberately post-integration
pressure sample. See docs/model.md for collocation and numerical limits.

### 4. Steady-state assumption in the analytical path

Auto-PEEP and trapped volume are calculated **before** waveform generation; each
generated breath represents a stable repeating system. The tick integrator makes
no such assumption — trapping there is emergent residual volume.

### 5. Modes reveal different truths

* **VC** → flow is controlled → **pressure** reveals mechanics and effort
* **PC** → during pressure-targeted inspiration, flow and volume reflect
  mechanics and effort. Patient-side Paw equals the upstream target while
  inward flow is delivered; if the delivery valve closes, flow is zero and Paw
  follows recoil and prescribed muscle pressure. The upstream command remains
  unchanged within the breath.

The clinical reading rule emphasizes the waveform opposite the control
variable. Real ventilators can show additional pressure deformation. Read flow
and volume alongside pressure. This model does not reproduce a particular
commercial ventilator, measure work of breathing, or model a patient's response
to changing assistance. See `docs/model.md` §3.2 for the accepted educational
valve/sensor contract; historical morphology records are not clinical validation.

Patient trigger: recorded event on its pressure or flow waveform. Machine
trigger: timed breath. Detection metadata, not the live trigger setting, selects
the historical patient marker; neither patient marker belongs on volume.
Paw is gauge pressure at the modeled airway opening. The dashed zero line is
atmospheric pressure, not PEEP. A pressure drop below applied PEEP can still be
above zero. Genuine negative modeled values remain visible; no pressure dip is
added for appearance.

---

## 🧪 Validation (critical)

The harness is required evidence for the implemented contracts.

```bash
npm test                              # 300 original + 22 controller + 24 integration + 22 selective legacy fixtures + 41 effort/pressure groups
npm run test:browser                  # 44 original + 12 adaptive + 4 effort/pressure + 5 Effort-slider groups; self-contained
npm run test:visual:docker            # 16 authoritative Linux visual/determinism/cache groups
node scratch/shot.cjs <outDir> [...]  # diagnostic screenshots
```

CI runs `npm test` on Node 22 and 24. A separate Node 24 job runs both browser
suites in `mcr.microsoft.com/playwright:v1.62.1-noble`. The visual suite renders frames at exact *simulated* timestamps via a
determinism hook (`window.__vsim`), so screenshots are reproducible rather than
frame-timing-dependent — see [`docs/visual-testing.md`](./docs/visual-testing.md).

`shot.cjs` scenarios: `baseline`, `teaching`, `effort`, `effort-teaching`,
`weak-csv`, `teaching-loops`, `alarm-silenced`.

The engine tests verify implemented equations, time constants, auto-PEEP,
waveform integrity and trigger eligibility. They establish implementation
conformance within their tested domains, not clinical or device validation.

### The verification layers gate CI

`npm test` sets a nonzero exit on any failure and retains the original 300/0
guard alongside the 22/24/22/41 group inventories. The 41 effort/pressure groups
comprise 40 engine groups and one renderer group with 66 subchecks. The 22 legacy
fixtures exercise 92,500 ticks: 8 passive fixtures compare 28,000 ticks exactly;
14 active fixtures independently check corrected conformance over 64,500 ticks.
No claim of 92,500 exact matches is made. The required browser inventory is
44 original + 12 adaptive + 4 effort/pressure + 5 Effort-slider groups; visual inventory is
13 existing + 3 effort/pressure groups. These are gate requirements, not a fresh
passing-run receipt. All gates propagate nonzero exits and browser gates retain
Playwright diagnostics on CI failure. The original suite's historical mutation
check multiplied `LungModel.timeConstant` by 1.5, giving 29 failures and exit 1.

For most of this project's life it did not: the file had no exit code, so the CI
badge stayed green through any number of failures. Worth knowing when reading
older green runs in the history.

### Two habits that pay for themselves

**Screenshot-verify all UI work.** Two shipped defects were invisible in the
diff and obvious in a screenshot.

**Mutation-check new assertions.** Run each one against the broken code and
confirm it goes red. Five assertions that could not fail were found this way.

---

## 🔬 Units convention (global)

| Quantity   | Internal unit       | Displayed as        |
| ---------- | ------------------- | ------------------- |
| Pressure   | cmH₂O               | cmH₂O               |
| Volume     | L                   | mL                  |
| Flow       | L/s                 | L/min               |
| Compliance | L/cmH₂O             | mL/cmH₂O            |
| Resistance | cmH₂O·s/L           | cmH₂O·s/L           |
| Supply Rc  | cmH₂O·s/L           | disclosed educational assumption; no learner slider |
| Time       | s                   | s                   |

Sign conventions: **positive flow = inspiration**; **Pmus > 0 = inspiratory
effort**, Pmus < 0 = expiratory effort.

Every pressure needs a declared reference frame — absolute, gauge, or relative
to PEEP. `Pvent` and pressure-support levels are **relative to PEEP**; `Paw` is
gauge. Paw is patient-side airway-opening gauge pressure; command is upstream
during closed delivery-valve intervals. Applied PEEP, not a queued request, is
the pressure-trigger reference. Existing PEEP-coordinate changes do not jump
V; they do not model gas redistribution or recruitment.

---

## 🗣️ Vocabulary

This project uses the **Chatburn mode taxonomy** and the **Mireles-Cabodevila
patient–ventilator interaction taxonomy**. [`docs/glossary.md`](./docs/glossary.md)
is normative — read it before naming anything.

Short version:

* Modes are **TAGs** (`PC-CSV`), not brand names. Never branch on a brand name.
* **Trigger** starts inspiration; **cycle** ends it; a **limit** does *not* end
  it. An alarm that terminates inspiration is a *backup cycling mechanism*.
* Exactly two breath types: **mandatory** and **spontaneous**. Spontaneous =
  patient-triggered **and** patient-cycled.
* Name discordances by signal, not cause: **failed trigger**, not "ineffective
  effort"; **early trigger**, not "reverse trigger". Causes belong in the
  teaching copy, where they can be plural. CLIN-OD-009 selects Failed trigger
  as the canonical learner-facing term. The familiar alias ineffective effort
  is permitted only as the first-use bridge described in glossary §9.

---

## 🚫 Non-goals (for now)

To protect clarity:

* ❌ No multi-compartment lung models
* ❌ No additional adaptive schemes, servo, dual, optimal or intelligent targeting. The implemented generic PC-CMVa controller is the exception to the original set-point-only scope; it is not a commercial-device replica.
* ❌ No IMV breath sequences (SIMV and friends)
* ❌ No vendor-specific behaviour or brand-named modes
* ❌ No build step, bundler, or framework

Note this list is about the *engine's* scope. UI polish is in scope and always
was — the SME feedback log is largely usability findings.

---

## 🧭 Development rules

1. **Start from physiology, not UI.**
2. **Every feature must map to a clinical concept.**
3. **Prefer clarity over completeness.**
4. **Tests define correctness — and must be able to fail.**
5. **Do not break the MVP mental model.**
6. **Small, careful patches over large rewrites.**
7. **Respect the standing invariants** in [`CLAUDE.md`](./CLAUDE.md) §4. Each one
   encodes a bug that already shipped once.

---

## 🫀 Clinical anchors

The simulator should always pass a clinical sniff test:

At fixed volume in the passive linear model, reducing C increases elastic pressure. Increasing R at fixed C increases calculated τ; the amount of retained volume also depends on expiratory time.

* Short Te → auto-PEEP
* Ramp flow → ↓PIP, same Pplat
* Pmus in VC → scalloped (scooped) pressure — work shifting
* Pmus in PC → ↑VT
* Failed trigger → deflection in expiratory flow, no breath delivered
* Raising PEEP in PC-CSV → **no** change in VT (support is referenced to PEEP)

The simulator calculates τ from configured R × C. Literature examples and measured expiratory time constants are separate reference quantities; see the [preset provenance record](docs/clinical/CLIN-009/preset-provenance.md).
95% of a passive exhalation completes in 3τ.

If behaviour violates these:

> The model is wrong, not the patient.

Richer worked cases are in [`docs/case-bank-v0.1.md`](./docs/case-bank-v0.1.md).

---

## 🧠 Mental model (TL;DR)

This is not just a simulator.

It is a system that answers:

> "Given these mechanics and these settings… what must happen?"

Not:

> "What should it look like?"

---

## 📚 References

Full citations in [`README.md`](./README.md#references). The load-bearing four:

* Chatburn RL. *Fundamentals of Mechanical Ventilation.*
* Chatburn RL. *Respir Care* 2007;52(3):301–323 — mode classification.
* Mireles-Cabodevila E et al. *Respir Care* 2022;67(1):129–148 — PVI taxonomy
  and the method for reading waveforms.
* Arnal J-M et al. Respir Care 2018;63(2):158–168 — passive adult mechanics measurements and simulation recommendations; COPD-HME pair provenance is documented separately from the other project examples.

---

## ✨ Final note

If you understand:

* the equation of motion
* time constants (τ)
* and how modes control variables

…you understand this simulator.

Everything else is just implementation.

The current `npm run test:browser` gate requires 44 original checks, 12 adaptive groups, 4 effort/pressure groups and 5 Effort-slider groups. These are commissioned gate inventories; a passing result requires a receipt for the checked revision.

For dated identical-tree CI evidence and remaining owner gates, see the [successor index](docs/clinical/CLIN-001/successor-index.md).
