# The model

The simulation literature is blunt about why this document exists:

> "There are no established standards or validation processes for this
> simulation software, and its accuracy depends on the creators' expertise. **Few
> simulators publish the underlying mathematical models**, which may not be an
> issue for some educational objectives but can certainly be relevant for others
> (eg, gas exchange variables in response to ventilator settings)."
> — Mireles-Cabodevila et al., *Respir Care* 2024;69(11):1468–1476

Their named example — gas exchange — is out of scope here (§10). The argument
still binds for mechanics, which is the whole of what this simulator claims to
teach.

So here it is in full: every equation the engine solves, how it integrates them,
what it approximates, and where it is knowingly wrong.

Vocabulary follows [`glossary.md`](./glossary.md). Symbols and units follow
[`README-dev.md`](../README-dev.md#-units-convention-global).

---

## 1. Governing equation

A single compartment — one resistance in series with one compliance:

```
Pvent(t) + Pmus(t) = E · V(t) + R · V̇(t)
```

with `E = 1/C`, `τ = R · C`. Volume `V` is measured **above end-expiratory
equilibrium**, not absolute lung volume, so `V = 0` at passive FRC-plus-PEEP.

Sign conventions: positive flow is inspiration; `Pmus > 0` is inspiratory
effort. Inertance is ignored, as it is in all clinical practice.

---

## 2. What the engine actually runs

⚠️ **There are two implementations, and they are not the same model.**

| | Analytical generator | Tick integrator |
| --- | --- | --- |
| Where | `Ventilator.generateBreathWaveforms()` | `SimulationEngine._computePhysics()` |
| Style | Closed-form, steady state | Forward Euler, 100 Hz |
| Assumes | Every breath identical; auto-PEEP pre-computed | Nothing; state carries breath to breath |
| Drives | `calculateMAP()`, every frame | **The screen** |
| Test coverage | ~78 of 300 assertions; mutating it fails 2 | ~127 of 300 |

The tick integrator is the simulator. The analytical path survives because mean
airway pressure is computed from a freshly generated breath each frame, and
because closed-form solutions are what the tests can check by hand.

Note the coverage asymmetry: the largest bloc of assertions — roughly 118 of 300
— tests closed-form **properties** on `LungModel` and `Ventilator` that belong to
neither generator. The analytical *breath generator* is barely tested; mutating
its VC pressure line fails 2 assertions out of 300.

**Consequence to know about:** the monitored auto-PEEP value is closed-form,
while the trapping visible in the waveform is emergent residual volume in the
integrator. They are computed by different code from different assumptions and
can disagree. Reconciling them is open work.

---

## 3. Tick integrator — the live model

State advances at `dt = 0.01 s`. Each tick computes flow, volume and airway
pressure for the current phase, then evaluates transitions.

### 3.1 Inspiration, volume control

Flow is prescribed; pressure is the dependent variable.

```
square flow:   V̇ = VT / Ti
ramp flow:     V̇ = (2 · VT / Ti) · max(0, 1 − t/Ti)

V ← V + V̇ · dt
Paw = PEEP + V/C + R·V̇ − Pmus
```

The descending ramp starts at twice the mean flow and decays linearly to zero at
`Ti`, so the delivered volume equals `VT` — the area under the triangle — **in
the continuous limit.** In the integrator, forward Euler plus an
end-of-inspiration test that fires before the clock advances over-deliver by
about `dt/Ti`: a 500 mL setting delivers 503 mL on ramp and 504 mL on square at
Ti = 1.67 s.

`− Pmus` is where **pressure scooping** comes from: in VC, effort cannot change
the delivered flow, so it shows up entirely in the pressure trace. That is the
reading rule made literal.

### 3.2 Inspiration, pressure control

Pressure is prescribed; flow is the ODE.

```
V̇ = (Pinsp + Pmus − V/C) / R          Euler step
V̇ ← max(0, V̇)                        inspiratory valve cannot reverse
V ← V + V̇ · dt
Paw = PEEP + Pinsp
```

`Pinsp` is `pressureControlLevel` — the set inspiratory pressure in PC-CMV, the
pressure-support level in PC-CSV. Both are **referenced to PEEP**, which is why
raising PEEP does not change VT in PC-CSV.

Effort here raises flow and volume rather than lowering pressure — the same
physics, read on the other waveform.

**Known simplification:** the displayed `Paw` is the set pressure exactly. A real
ventilator's pressure controller is imperfect, and effort produces a visible dip.
The literature notes ventilators are "mediocre at controlling pressure compared
to controlling flow," so some effort signal *should* appear in the pressure
trace. Ours shows none.

### 3.3 Inspiratory hold

Both valves closed, flow zero.

```
V̇ = 0
Paw = PEEP + V/C − Pmus
Pplat := PEEP + V/C            latched on the first hold sample, without Pmus
```

Pplat is captured before effort distorts it, so the measured value is the static
one. `Pmus` still moves the displayed trace during the hold — muscles pulling on
a sealed system.

### 3.4 Expiration

Passive recoil, plus whatever the patient is doing.

```
V̇ = −(V/C − Pmus) / R
V ← max(0, V + V̇ · dt)
Paw = PEEP − Pmus
```

With `Pmus = 0` this is exponential decay with time constant `τ = R·C`:
`V(t) = V₀ · e^(−t/τ)`, 63% complete at 1τ, 95% at 3τ.

If `Pmus` exceeds `V/C` late in expiration, flow reverses briefly. **That
deflection is the visible signature of an inspiratory effort** — the thing
Teaching Mode highlights in amber when the effort fails to trigger a breath.

**Known simplification:** expiration is a passive resistor. There is no
expiratory flow limitation, no airway collapse, no separate expiratory
resistance. COPD is modelled as high R and high C, which produces trapping
through a long τ but not through dynamic collapse.

---

## 4. Breath phase state machine

```
INSPIRATION ──► HOLD (if hold time > 0) ──► EXPIRATION ──► INSPIRATION
            └──► EXPIRATION (if no hold)
```

**Inspiration ends when:**
- mandatory breaths: `phaseTime ≥ Ti`
- spontaneous (PC-CSV): flow decays to `cyclePercent` of peak inspiratory flow —
  i.e. **flow cycling, which is patient cycling** — with a `max(Ti, 2·dt)`
  backstop

**Hold ends** at the effective hold duration. Hold is forced to zero in PC-CSV.

**Expiration ends** when the machine backup timer reaches `Ttot = 60/RR`, *or*
earlier if the patient triggers. A patient trigger already scheduled wins a tie
against the timer.

Settings are re-read every tick, so most changes take effect mid-breath rather
than at the next breath boundary. This is deliberate — cause and effect stay
adjacent for the learner.

---

## 5. Patient effort

`Pmus` is a **half-sine**:

```
Pmus(t) = Pmus_max · sin(π · t / Ti_neural)     for 0 ≤ t ≤ Ti_neural
Pmus(t) = 0                                      otherwise
```

driven by an independent neural oscillator with period `60 / patientRR`. The
patient's rate, effort amplitude and neural inspiratory time are set separately
from the ventilator's rate — which is the whole point. `Ti_neural ≠ Ti_vent` is
the normal case, not an edge case.

Making `Pmus` visible is the simulator's core teaching affordance. It is a
variable no real ventilator displays.

**Known simplifications:** the half-sine has no adjustable rise time or
morphology; there is no expiratory muscle activity (`Pmus < 0` is never
generated), so active expiration cannot currently be taught; effort is perfectly
periodic, with no breath-to-breath variability.

---

## 6. Trigger eligibility — three gates

Evaluated every tick during a neural inspiration. **At most one outcome is
recorded per neural inspiration** — a delivered patient breath, a failed-trigger
event, or (when the effort is absent, or lives entirely inside the lockout)
nothing at all.

```
gate 0   effort is real:  patientRR > 0 AND Pmus_max > 0 AND neural inspiration active
                          └─ otherwise: no event at all

gate a   phase is EXPIRATION
                          └─ otherwise: FAILED, gateFailed = 'ventilator_unavailable'

gate b   phaseTime > 0.10 s   (trigger lockout after expiration begins)
                          └─ otherwise: wait, do not fail

gate c   threshold:
           pressure trigger:  max(0, Pmus − V/C)  ≥  pressureTriggerCmH2O
           flow trigger:      max(0, V̇ × 60)     ≥  flowTriggerLpm
                          └─ otherwise, at neural inspiration end: FAILED, gateFailed = 'threshold'
```

The two failure modes are physiologically different and teach different things:

- **`ventilator_unavailable`** — the effort landed while the ventilator was
  still inspiring or holding. The machine was busy. The effort still bends the
  trace — measurably: ~3 cmH₂O of pressure scooping in VC, ~5 L/min of extra
  flow in PC — but it produces **no expiratory-flow deflection**, so it gets no
  amber highlight and no label. The `Ineffective N /60s` counter is the only
  place this failure is *named*.
- **`threshold`** — the ventilator was listening and the effort was too weak, or
  the sensitivity setting too low. This bends **expiratory** flow, and gets the
  amber highlight.

Both are **failed triggers** in taxonomy terms.

**Known simplification:** the flow gate reads **total net lung flow**, not a
separate patient-flow channel — the same signal a real ventilator sees at the
circuit. Correct, and confusing enough that Teaching Mode explains it explicitly.

**Known inconsistency:** the displayed expiratory `Paw` dips by the full `Pmus`,
while the pressure trigger tests `Pmus − V/C`. The gate is the physiologically
correct one; the display is the simplification.

---

## 7. Closed-form solutions (analytical path)

Used by the tests and by `calculateMAP()`. Throughout, **`ΔP = max(0,
pressureControlLevel − autoPEEP)`** — the driving pressure actually available
once trapping has raised the baseline.

| Quantity | Expression |
| --- | --- |
| Time constant | `τ = R · C` |
| Elastance | `E = 1/C` |
| Inspiratory pressure | `Paw = PEEP + autoPEEP + V/C + R·V̇` |
| Plateau pressure | `Pplat = PEEP + autoPEEP + V/C` |
| Passive expiratory flow | `V̇(t) = −(V₀/C)/R · e^(−t/τ)` |
| Volume remaining | `V(t) = V₀ · e^(−t/τ)` |
| Steady-state trapped volume, VC | `Vtrap = VT · α / (1 − α)`, `α = e^(−Te/τ)` |
| Steady-state auto-PEEP | `autoPEEP = Vtrap / C` |
| Steady-state trapped volume, PC | `Vtrap = Pinsp · C · β · α / (1 − e^(−(Ti+Te)/τ))`, `β = 1 − e^(−Ti/τ)` |
| Steady-state VT, PC | `VT = (Pinsp − autoPEEP) · C · β` |
| Delivered VT, PC | `VT = ΔP · C · (1 − e^(−Ti/τ))` |
| Peak inspiratory flow, PC | `ΔP / R` |
| Max VT, PC (infinite Ti) | `ΔP · C` |
| Mean airway pressure | integrated numerically from one generated breath |

Trapped volume returns `Infinity` when `α ≥ 0.999` — a guard against the
degenerate case where expiration is negligible relative to τ.

PC trapping needs the coupled form because trapping raises the baseline, which
lowers the driving pressure, which lowers VT, which changes trapping. **Known
discrepancy:** the code comment describes the denominator as `1 − e^(−TCT/τ)`,
but the implementation uses `Ti + Te_effective`, which is not TCT when an
inspiratory hold is set.

---

## 8. Reference parameters

Presets, following Arnal et al., *Respir Care* 2018;63(2):158–168:

| Preset | R (cmH₂O·s/L) | C (mL/cmH₂O) | τ (s) |
| --- | --- | --- | --- |
| Normal lung | 10 | 60 | 0.60 |
| ARDS, moderate | 10 | 35 | 0.35 |
| ARDS, severe | 12 | 25 | 0.30 |
| COPD | 25 | 60 | 1.50 |
| Asthma, acute | 20 | 60 | 1.20 |
| Morbid obesity | 8 | 40 | 0.32 |
| Pulmonary fibrosis | 8 | 30 | 0.24 |

Resistance includes the ETT contribution (~5–8 cmH₂O·s/L for a 7.0–8.0 mm tube
at typical flows). `LungModel.presets()` is authoritative; this table is a copy
and can drift. Literature reference time constants: normal ≈ 0.6 s, ARDS ≈
0.4 s, COPD ≈ 1.3 s.

R and C are also settable directly: R 5–40 cmH₂O·s/L, C 15–100 mL/cmH₂O.

---

## 9. Numerical properties

- **Integration:** forward Euler, `dt = 0.01 s`.
- **Stability:** Euler on the expiratory ODE is stable while `dt < 2τ`. The
  shortest preset τ is 0.24 s (fibrosis), a 48× margin. The manual sliders reach
  `R = 5, C = 15 mL/cmH₂O` → `τ = 0.075 s`, still 15×. Safe throughout the
  settable range, but the bound is worth knowing before anyone adds a stiffer
  preset or widens the sliders.
- **Accuracy:** Euler is first-order — local error `O(dt²)`, global `O(dt)`. On a
  0.5 s time constant at 100 Hz, per-step error is well under a percent, which is
  far below the resolution of anything the learner reads. Not good enough for
  research, entirely good enough for teaching.
- **Frame budget:** at most 300 ticks (3 s of sim time) per animation frame. At
  4× speed with frame gaps beyond 0.75 s, the simulation silently falls behind
  wall-clock.
- **Volume floor:** expiratory volume is clamped at zero, so the lung never
  integrates below equilibrium.

---

## 10. Deliberate omissions

Everything here is a known gap, not an oversight. Listed so nobody has to
rediscover them, and so teaching claims stay honest.

**Mechanics.** Single compartment only — no regional heterogeneity, no
recruitment or derecruitment, no pendelluft. R and C are constant within a
breath: no volume- or flow-dependent resistance, no sigmoid pressure–volume
curve, no lower or upper inflection point. No chest-wall vs lung partitioning,
so no transpulmonary pressure. No expiratory flow limitation.

**Circuit.** No tubing compliance, no leak, no ETT resistance modelled
separately from airway resistance, no humidifier or filter, no circuit
compressible volume. Inspired and expired volumes therefore match exactly, so
the "square root sign" of a leak cannot be shown.

**Ventilator.** Set-point targeting only — no adaptive, servo, dual, optimal or
intelligent schemes, so PRVC, Volume Support, NAVA, PAV and ASV are all out of
reach. CMV and CSV only; no IMV, so no SIMV. Rise time is not settable. No
apnea backup ventilation. No breath-to-breath ventilator noise.

**Patient.** No expiratory effort, no reverse triggering or entrainment, no
cough, no secretions, no variability in effort amplitude or timing.

**Gas exchange.** None. FiO₂ is a display value; there is no O₂, no CO₂, no
dead space, no shunt, no capnography. Alarms are mechanical only.

**Realism artifacts.** Waveforms are idealised — no pressure or flow noise, no
condensation artifact, no cardiac oscillation. The literature warns that
simulator waveforms often look "too perfect" and that this makes transfer to the
bedside harder. The counter-argument, also from the literature, is that the
idealised waveform should be taught *first*. Both are true, which argues for
making artifact level a learner-level-linked toggle rather than a global default.

---

## 11. Validation

Physiological behaviour is asserted in `tests/test-engine.js` — 300 assertions
covering hand-calculable pressures and volumes, time-constant decay, auto-PEEP,
waveform integrity, trigger eligibility, and clinical sanity checks.

The suite gates CI as of 2026-08-05 (`process.exitCode = 1` on failure,
mutation-verified). Green runs recorded before that date do not carry the same
guarantee — the file had no exit code and passed regardless of the tally.

No part of this model has been validated against a physical test lung or against
recorded patient data. It is validated against the equations, and the equations
are the ones in the cited literature. That is the correct claim to make about it,
and the only one.
