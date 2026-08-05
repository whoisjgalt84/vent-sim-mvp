# Ventilator Simulator — README (Developer)

For orientation and what the app does, see [`README.md`](./README.md).
For agent conventions and standing invariants, see [`CLAUDE.md`](./CLAUDE.md).
For the full mathematical model, see [`docs/model.md`](./docs/model.md).

---

## 🫁 Core Idea

This simulator is a **single-compartment implementation of the equation of
motion for the respiratory system**:

> **Pmus + Pvent = E × V + R × V̇**

Where:

* **E × V** → elastic load (lung/chest wall)
* **R × V̇** → resistive load (airways + ETT)

With gas trapping made explicit, the form the engine actually implements is:

> **Pmus + Pvent = E × V + R × V̇ + PEEPauto**

Everything in this project flows from this equation.

If a feature cannot be explained through this equation, it does not belong here.

---

## 🚀 Getting Started

```bash
# Serve over HTTP — ES modules will NOT load over file://
python3 -m http.server 8899        # then open http://127.0.0.1:8899

# Engine assertions (300)
npm test
```

VS Code's Live Server extension works too. `open index.html` does **not** — the
`type="module"` scripts are blocked by CORS on `file://`.

---

## 🎯 Scope

Built outward from a **minimum viable core**: VC-CMV, square flow, passive
patient (Pmus = 0).

**Everything else is an extension**, not the foundation. Already implemented:

* PC-CMV (pressure control, continuous mandatory)
* **PC-CSV** (pressure control, continuous spontaneous — pressure support, with
  settable PS level and cycle %)
* Descending ramp flow
* Inspiratory hold
* Auto-PEEP / air trapping
* Patient effort (Pmus), with independent neural rate and neural Ti
* Flow and pressure triggering, with a three-gate eligibility rule
* Alarms (5) with priority tiers, audio, and silence
* Teaching Mode — set/delivered/patient rates, ineffective-effort counter,
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
**nothing reads that global.** The tag is vestigial and removable; it is one of
the nine `?v=` sites currently maintained by hand.

`package.json` still declares `typescript`, `tsx` and `vitest` as
devDependencies. None is used — no `.ts` files, no config, no imports. They are
vestigial and slated for removal; `npm ci` installs them on every CI run.

### Responsibilities

**LungModel** — R, C, elastance, τ. Static/closed-form solutions: inspiratory
and plateau pressure, expiratory flow and decay, steady-state trapped volume and
auto-PEEP. Seven presets.

**Ventilator** — settings and mode logic (VC vs PC, mandatory vs spontaneous).
Derived physiology: Ti/Te, peak flows, driving pressure, PIP, Pplat, auto-PEEP,
minute ventilation, τ ratios. `summary()` is the monitor's whole contract.
Also holds the analytical breath generator.

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

The tick integrator drives the display. The analytical path survives as
`calculateMAP()`, called every frame. Consequence: the monitor's auto-PEEP is
closed-form while the waveform's trapping is emergent, and **the two do
disagree** — COPD at RR 20, I:E 1:1 gives a monitored 5.82 cmH₂O against the
integrator's 6.59. Know which one you are changing. Test coverage is lopsided
too: see [`docs/model.md`](./docs/model.md#2-what-the-engine-actually-runs).

---

## 🧠 Simulation Philosophy

### 1. Physics first

All behaviour traces back to the equation of motion. No faked waveforms, no
arbitrary curves.

### 2. Analytical when possible

VC modes have closed-form solutions; passive expiration is exponential decay.

### 3. Numerical only when necessary

PC with patient effort requires time-stepping:

```
V̇(t) = [Pinsp + Pmus(t) − E·V(t)] / R
```

Integrated at **100 Hz** (`dt = 0.01 s`), forward Euler.

### 4. Steady-state assumption in the analytical path

Auto-PEEP and trapped volume are calculated **before** waveform generation; each
generated breath represents a stable repeating system. The tick integrator makes
no such assumption — trapping there is emergent residual volume.

### 5. Modes reveal different truths

* **VC** → flow is controlled → **pressure** reveals mechanics and effort
* **PC** → pressure is controlled → **flow and volume** reveal mechanics and effort

This is the reading rule from the literature: *look at the waveform opposite the
control variable.*

---

## 🧪 Validation (critical)

The harness is not optional — it is the **ground truth**.

```bash
npm test                              # 300 engine assertions
node scratch/verify-batch.cjs         # 44 browser assertions (needs the server + playwright)
node scratch/shot.cjs <outDir> [...]  # screenshots
```

`shot.cjs` scenarios: `baseline`, `teaching`, `effort`, `effort-teaching`,
`weak-csv`, `teaching-loops`, `alarm-silenced`.

The engine tests verify hand-calculable physiology, time constants, auto-PEEP,
waveform integrity, trigger eligibility, and clinical sanity. If these fail:

> The simulator is wrong.

### ⚠️ `npm test` currently exits 0 even when assertions fail

`tests/test-engine.js` has no `process.exit`. Verified by mutation: multiplying
`LungModel.timeConstant` by 1.5 yields **29 failures and exit code 0**, so the CI
badge stays green. Until that is fixed, **read the printed tally.** A green check
proves only that nothing threw.

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
| Time       | s                   | s                   |

Sign conventions: **positive flow = inspiration**; **Pmus > 0 = inspiratory
effort**, Pmus < 0 = expiratory effort.

Every pressure needs a declared reference frame — absolute, gauge, or relative
to PEEP. `Pvent` and pressure-support levels are **relative to PEEP**; `Paw` is
gauge.

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
  teaching copy, where they can be plural. ⚠️ The shipped UI currently says
  "ineffective effort" — a known, open conflict, see glossary §9.

---

## 🚫 Non-goals (for now)

To protect clarity:

* ❌ No multi-compartment lung models
* ❌ No adaptive, servo, or dual targeting schemes (PRVC, Volume Support, NAVA,
  PAV, ATC) — everything here is set-point targeting
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

* ARDS → ↓C → ↑Pplat
* COPD → ↑R → ↑τ → air trapping
* Short Te → auto-PEEP
* Ramp flow → ↓PIP, same Pplat
* Pmus in VC → scalloped (scooped) pressure — work shifting
* Pmus in PC → ↑VT
* Failed trigger → deflection in expiratory flow, no breath delivered
* Raising PEEP in PC-CSV → **no** change in VT (support is referenced to PEEP)

Reference time constants: normal ≈ 0.6 s, ARDS ≈ 0.4 s, COPD ≈ 1.3 s.
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
* Arnal J-M et al. *Respir Care* 2018;63(2):158–168 — standardised simulation
  parameters.

---

## ✨ Final note

If you understand:

* the equation of motion
* time constants (τ)
* and how modes control variables

…you understand this simulator.

Everything else is just implementation.
