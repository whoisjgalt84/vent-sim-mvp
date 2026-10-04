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

The live pressure coordinate is `Paw + Pmus = B + V/C + RQ`, where Paw is
gauge pressure at the airway opening on the patient side of the delivery valve,
B is applied PEEP, and Q is inward-positive flow in L/s. R is the existing
airway-plus-tube resistance; the expiratory inward supply impedance Rc is
separate (§3.4). Residual elastic load is already included in V/C; do not add
a second intrinsic-PEEP term to this live equation.

---

## 2. What the engine actually runs

⚠️ **There are two implementations, and they are not the same model.**

| | Analytical generator | Tick integrator |
| --- | --- | --- |
| Where | `Ventilator.generateBreathWaveforms()` | `SimulationEngine._computePhysics()` |
| Style | Closed-form, steady state | Forward Euler, 100 Hz |
| Assumes | Every breath identical; auto-PEEP pre-computed | Single compartment and ideal directional boundaries; state carries breath to breath |
| Drives | Passive analytical predictions; active-effort predictions are unavailable | **The screen** |
| Historical coverage in the original 300-assertion suite | ~78 assertions; mutating it failed 2 | ~127 assertions |

The tick integrator is the simulator. The analytical path survives because mean
airway pressure can be computed from a generated passive breath, and
because closed-form solutions are what the tests can check by hand.

The legacy analytical preview/MAP generator does not implement the corrected
live directional boundary or closed delivery-valve pressure. Its active-effort
results are not the repaired live signal. A configured prescribed Pmus greater
than zero gates affected analytical MAP, auto/total PEEP, trapped volume,
predicted PC VT/VE and dependent pressure/flow/timing predictions as unavailable.
Adaptive mode retains its existing fixed-pressure prediction unavailability.
Passive analytics, configured mechanics and canonical measured outputs remain
distinct and available where applicable.

This historical original-suite coverage breakdown is separate from the current
group inventory in Section 11. In that breakdown, the largest bloc — roughly 118 of 300
— tests closed-form **properties** on `LungModel` and `Ventilator` that belong to
neither generator. The analytical *breath generator* is barely tested; mutating
its VC pressure line failed 2 assertions out of 300.

**Consequence to know about:** the monitored auto-PEEP value is closed-form,
while the trapping visible in the waveform is emergent residual volume in the
integrator. They are computed by different code from different assumptions and
can disagree. Reconciling them is open work.

---

## 3. Tick integrator — the live model

State advances at `dt = 0.01 s`. Each tick computes flow, volume and airway
pressure for the current phase, then evaluates transitions.

The order is neural advance, settings synchronization, old-phase physics,
mechanics observation, trigger detection, phase transitions, buffer recording,
clock advance and scheduled patient-breath publication. Physics identity refers
to the sampled phase and applied settings, not mutable phase bookkeeping after
a transition. Detection time and delivery time can differ by one dt. PC-CMVa
uses its latched applied PEEP throughout the breath, including expiration;
other modes retain immediate PEEP semantics. A PEEP edit does not jump V: the
existing model reinterprets its equilibrium coordinate without modeling gas
redistribution, recruitment or circuit storage.

### 3.1 Inspiration, volume control

Flow is prescribed; pressure is the dependent variable.

```
square flow:   V̇ = VT / Ti
ramp flow:     V̇ = (2 · VT / Ti) · max(0, 1 − t/Ti)

V ← V + V̇ · dt
Paw = B + Vpost/C + R·V̇ − Pmus
```

The descending ramp starts at twice the mean flow and decays linearly to zero at
`Ti`, so the delivered volume equals `VT` — the area under the triangle — **in
the continuous limit.** The analytical VC path therefore returns set VT.

The commissioned live path samples at 100 Hz. On each tick it evaluates flow at
the current phase time, applies the explicit forward-Euler update
`Vnext = Vcurrent + flow × 0.01 s`, evaluates the inspiration boundary, records
the sample, and then advances the clocks. The initial breath begins at phase
time zero; subsequent machine breaths reach their first physics tick after the
phase clock has advanced to 0.01 s. That ordering produces deterministic
startup-specific and repeated post-startup boundary samples.

VC pressure deliberately uses the updated volume Vpost. Its EOM check therefore
uses that post-integration state; an old-volume pressure residual is not the
contract for this sample.

For passive VC-CMV with no hold, I:E 1:2, set VT 500 mL, and Ti = 5/3 s
(approximately 1.67 s), the characterized results are:

| Flow | First/startup completed breath | Repeated post-startup breath | Analytical VT |
| --- | ---: | ---: | ---: |
| Square | 504.000 mL | 501.000 mL | 500 mL |
| Descending ramp | 503.004 mL | 497.004 mL | 500 mL |

Here, "repeated post-startup" means the selected third completed mandatory
breath; the second and third completed breaths have the same characterized
boundary result after the startup phase alignment has passed. It does not mean
physiological steady state. At each tested completion boundary, the live volume
waveform/loop sample and the engine's finalized `measuredVT_mL` agree. These
observations characterize the current discrete implementation without deciding
whether its deviation from set VT should be retained or corrected.

`− Pmus` is where **pressure scooping** comes from: in VC, effort cannot change
the delivered flow, so it shows up entirely in the pressure trace. That is the
reading rule made literal.

### 3.2 Inspiration, pressure control

Delivered PC inspiration uses an ideal upstream command and a unidirectional
delivery valve. Define D using pre-integration volume Vpre:

```
D = Pinsp_applied + Pmus − Vpre/C
Q = max(0, D/R)
Paw = B + Pinsp_applied                when D >= 0 (open/neutral)
Paw = B + Vpre/C − Pmus                when D < 0 (closed)
Vpost = Vpre + Q · dt                   explicit Euler
```

`Pinsp_applied` is `pressureControlLevel`: set inspiratory pressure in PC-CMV,
Pressure Support in PC-CSV, or the latched adaptive command in PC-CMVa. Commands
are **referenced to applied set PEEP**. They are upstream targets, not a hard cap
on every patient-side Paw sample.

While inward flow is being delivered, airway pressure is held at the target.
If the delivery valve closes because inward flow would reverse, flow is zero
and airway pressure follows lung recoil and prescribed muscle pressure until
the valve can reopen or inspiration ends. Paw is modeled at the airway opening
on the patient side of the delivery valve. The pressure target is upstream of
that valve; it is not a guarantee that patient-side pressure remains at the
target when the valve is closed. Reverse flow is not allowed during delivered
inspiration in this model. Both formulas agree at D=0; reopening is algebraic,
without delay or hysteresis.

Valve closure does not end mandatory inspiration or make the ventilator
available to trigger. PC-CSV retains its existing flow and maximum-Ti cycling
rules, including zero-flow cycling after an established positive peak and the
maximum-Ti fallback without one. A closed delivery valve is not a HOLD phase.
No successful PC-CSV trigger means no supported breath; holds remain
inapplicable in PC-CSV and PC-CMVa.

This is a selected educational valve/sensor architecture, not a universal
device description. Real ventilators can show additional pressure deformation.
Read flow and volume alongside pressure. This model does not reproduce a
particular commercial ventilator, measure work of breathing, or model a
patient's response to changing assistance. The 2026-10-02 Phase B authorization
accepts this bounded successor contract; historical CLIN-OD-008 morphology
records remain intact and are not converted into clinical/device validation.

Source: [MC2022](https://doi.org/10.4187/respcare.09316), PDF p.4 / journal p.132.

### 3.3 Inspiratory hold

Both valves closed, flow zero.

```
V̇ = 0
Paw = B + V/C − Pmus
```

The trace continues to show `Pmus` acting on a sealed system. A measured Pplat is
published only after a completed 0.5–2.0 s interval containing at least 50 actual
HOLD-physics samples. The entry-boundary INSPIRATION sample is excluded and the
last HOLD-physics sample at the completion boundary is included. Flow must be
finite and exactly zero throughout the interval; finite `|Pmus|` must be no more
than `1e−9 cmH₂O`; and the unrounded Paw range over the final 20 samples must be
no more than `0.1 cmH₂O`. Pplat is the arithmetic mean of those final 20
unrounded Paw samples. These are simulator measurement criteria, not universal
clinical thresholds.

At breath start, the engine freezes set PEEP, integrated residual volume, and
configured compliance. The hold baseline is
`set PEEP + residual volume / configured compliance`, with provenance
`live-modeled-total-peep-at-breath-start`. Hold-derived driving pressure is
valid Pplat minus that baseline, and hold-derived static compliance is the
same-breath delivered VT divided by that driving pressure. Measured resistance
additionally requires passive constant-flow square VC and uses same-breath
unrounded `(PIP − Pplat) / final INSPIRATION flow`; the zero HOLD flow is never
used. Ramp VC and pressure-control resistance are inapplicable.

### 3.4 Expiration

Expiration uses a directional supply boundary at the common pre-integration
state. Define d = Pmus − Vpre/C:

```
d <= 0: Q = d/R;         Paw = B
d >  0: Q = d/(R + Rc);  Paw = B − Rc·Q
Vpost = max(0, Vpre + Q·dt)
```

Q is L/s and both R and Rc are cmH2O·s/L. Rc is inward supply resistance,
distinct from patient airway resistance; outflow remains ideal. The accepted
default is Rc=2, an educational engineering assumption, with setup-only
exploration range 0.5–5 and reset before changing it. No learner Rc slider is
provided. Rc=10 is diagnostic only. No supplied source calibrates this default,
and no circuit-compliance, bias-flow, leak, storage or pressure-delay state is
modeled. The branches agree continuously at zero demand. Effort cessation
returns Paw to B with passive outflow; no persistent artificial dip is retained.

With `Pmus = 0` this retains passive decay with time constant `τ = R·C`:
`V(t) = V₀ · e^(−t/τ)`, 63% complete at 1τ, 95% at 3τ.

If Pmus exceeds recoil, inward demand can lower Paw below applied PEEP. A dip
below PEEP need not be below atmospheric zero: genuine negative Paw requires
Rc·Q > B. Resolved/unavailable efforts still contribute mechanically through
Pmus, without becoming eligible again. Failed eligible efforts retain their
existing applicable amber flow highlights.

**Known simplification:** expiration is a passive resistor. There is no
expiratory flow limitation, no airway collapse, no separate expiratory
resistance. The COPD example uses higher resistance than the Normal example and the same configured compliance. Gas retention in this model depends on the configured mechanics and available expiratory time; expiratory flow limitation is not modeled.

---

## 4. Breath phase state machine

```
INSPIRATION ──► HOLD (if hold time > 0) ──► EXPIRATION ──► INSPIRATION
            └──► EXPIRATION (if no hold)
```

**Inspiration ends when:**
- mandatory breaths: `phaseTime ≥ Ti`
- PC-CSV: either flow decays to `cyclePercent` of peak inspiratory flow, or the
  `max(Ti, 2·dt)` maximum-inspiratory-time backstop fires first

At that boundary, `SimulationEngine.lastCompletedBreath` is the canonical
completed-breath record. Its classification fields are `configuredMode`,
`triggerAgent`, `cycleAgent`, `terminationReason`, and `breathType`. A
patient-triggered PC-CSV breath that reaches the flow criterion records patient
cycling, `flowCycle`, and `spontaneous`. If the maximum-Ti backstop fires first,
the configured mode remains `PC-CSV`, but the breath records machine cycling,
`maxTiReached`, and `mandatory`. The maximum-Ti reason is a phase-transition
fact, not an early-, late-, delayed-cycle, or other interaction diagnosis.

The same record includes its waveform/loop boundary coordinates and numerical
state: `startedAt_s`, `completedAt_s`, `inspiratoryTime_s`,
`boundarySampleIndex`, `measuredVT_mL`, `flowAtTermination_Lpm`, and
`flowCycleThreshold_Lpm`. It also owns the frozen `holdMechanics` record with
separate Pplat, driving-pressure, compliance, and resistance status, value, and
reasons. A provisional collector exists only for the current breath. A pure
selector rejects pending, released, reset, mode-inapplicable, or stale-generation
results without erasing finalized VT or PIP. The boundary sample is written
later in the same 100 Hz tick; no waveform or integration timing is changed by
recording it.

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
           pressure trigger:  max(0, B_sample − Paw_sample) ≥ pressureTriggerCmH2O
           flow trigger:      max(0, Q_sample × 60)         ≥ flowTriggerLpm
                          └─ otherwise, at neural inspiration end: FAILED, gateFailed = 'threshold'
```

The two failure modes are physiologically different and teach different things:

- **`ventilator_unavailable`** — the effort was resolved during INSPIRATION or
  HOLD, when it could not start another breath. Mechanical effort remains
  active. During delivered PC inward flow, Paw follows the upstream target;
  during a closed delivery-valve interval or HOLD, flow is zero and patient-side
  Paw follows recoil and muscle pressure. Such an event is not reconsidered
  later in its neural cycle. It receives no expiratory-flow highlight; the
  `Failed triggers N /60s` counter includes it.
- **`threshold`** — the ventilator was listening and the effort was too weak, or
  the sensitivity setting too low. This bends **expiratory** flow, and gets the
  amber highlight.

Both are **failed triggers** in taxonomy terms.

Both detectors use the same solved pre-integration state as the pressure/flow
trace sample. A queued PEEP is not the current reference. The first eligible
sample at or above threshold triggers; there is no interpolation or new
rising-edge requirement after refractory. The old effort-minus-recoil pressure
proxy is retired; changed delivery counts/timing are intentional consequences
of using the modeled signal. The flow signal is simulator net lung flow, not a
separately modeled commercial bias-flow sensing channel.

The prior expiration pressure and flow expressions were mutually inconsistent
under the declared EOM. The coupled boundary restores that algebra, while its
directional supply behavior and Rc remain reviewed educational assumptions.
Prior results and accepted visual baselines do not validate repaired physiology.

### Recorded events and signed pressure views

A patient-trigger symbol marks the start of a delivered breath. It appears only
on the pressure or flow waveform used to detect that trigger, using the
configuration recorded at detection. The trace shows the modeled signal; the
symbol does not replace the signal or measure effort. No patient-trigger symbol
appears on volume. Machine-trigger symbols keep their existing appearance on
all three waveforms. Failed triggers have no delivered-breath symbol; their
counter and applicable flow highlights remain.

Detection freezes trigger variable, threshold/units, signed Paw/flow, sampled
reference PEEP, sample time/index and setting/neural-cycle identities. Delivery
retains that snapshot and separately records its actual applied PEEP. Queued
settings, later edits, pause and mixed visible history never relabel old events.
Reset, interruption and cancellation clear pending metadata. Unknown legacy
patient provenance has no variable-specific marker and is disclosed as:
"Some earlier patient-trigger events have no recorded trigger variable; their
waveform markers are omitted."

Paw is gauge pressure at the modeled airway opening. The dashed zero line is
atmospheric pressure, not PEEP. A pressure drop below applied PEEP can still be
above zero. Genuine negative modeled values remain visible; no pressure dip is
added for appearance. Scalar and P-V pressure axes include zero and all finite
visible samples, with signed outward-rounded bounds for negative values.
Positive-only scalar geometry retains its established lower bound. Trace,
highlight, tooltip and loop geometry share the signed transform; nonfinite
samples lift the pen, and canvas clipping does not pin data to a zero floor.

---

## 7. Closed-form solutions (analytical path)

Used by historical analytical tests and passive predictions. This legacy
analytical preview/MAP generator does not implement the live directional
boundary or closed delivery-valve pressure. Its active-effort results are not
the repaired live signal and do not drive learner predictions. Throughout the
passive formulas, **`ΔP = max(0,
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

These seven pairs are starting mechanics for the simulator. They are not disease-wide reference values. The COPD pair matches the HME simulation recommendation in Arnal et al. (2018), Table 9; the other pairs are retained illustrative project examples. R is combined airway-plus-tube resistance, C is total respiratory-system compliance, and every τ in this table is calculated as R × C. The model does not separate lung and chest-wall mechanics or simulate humidification hardware.

| Example | R (cmH₂O·s/L) | C (mL/cmH₂O) | Calculated τ (s) |
| --- | --- | --- | --- |
| Normal example | 10 | 60 | 0.60 |
| Low compliance (35) | 10 | 35 | 0.35 |
| Low compliance (25) | 12 | 25 | 0.30 |
| COPD example (HME) | 25 | 60 | 1.50 |
| High resistance (20) | 20 | 60 | 1.20 |
| Reduced compliance (40) | 8 | 40 | 0.32 |
| Low compliance (30) | 8 | 30 | 0.24 |

Arnal's population measurements, recommended simulation settings and measured expiratory time constants have different provenance. A reported population time constant must not be substituted for this model's R × C. The source does not establish a separate 5–8 cmH₂O·s/L tube contribution for these examples. The constructor defaults to C = 50 mL/cmH₂O; app initialization loads the Normal example at C = 60 mL/cmH₂O. These are distinct defaults.

Manual exploration limits are R = 5–40 cmH₂O·s/L and C = 15–100 mL/cmH₂O. These are project input limits, not validated disease-reference ranges.

See [the owner-approved provenance record](clinical/CLIN-009/preset-provenance.md) for source-access limits and deferred claims.

---

## 9. Numerical properties

- **Integration:** forward Euler, `dt = 0.01 s`.
- **Passive-expiratory stability:** Euler on the passive expiratory ODE is
  mathematically stable while `dt < 2τ`. The
  shortest preset τ is 0.24 s (Low compliance (30)), a 48× margin. The manual sliders reach
  `R = 5, C = 15 mL/cmH₂O` → `τ = 0.075 s`, a 15× margin. This condition
  addresses stability of that ODE only; it is not an accuracy bound and does not
  establish accuracy for inspiration, phase transitions, or other modes.
- **Characterized domain:** focused regression assertions cover passive VC-CMV,
  no hold, R = 10 cmH₂O·s/L, C = 50 mL/cmH₂O, I:E 1:2, square and
  descending-ramp flow, set VT 300 and 500 mL, and Ti 1.0 and 5/3 s. They
  protect the 100 Hz timestep, the explicit-Euler VC volume update, the
  identified startup/post-startup boundary behavior, and completed-boundary
  agreement. Euler is a first-order method, but this matrix is not a global
  numerical-error characterization and does not validate device or patient
  behavior.
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
compressible volume, so the "square root sign" of a leak cannot be shown.
This does not establish a separately measured expired-volume record: during
transitions, changing retained volume and pretrigger flow can separate the
integrals over the inspiratory and expiratory phases. The completed VT record
is the modeled inspiratory increase above breath-start residual volume.

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

For all three PC modes, the accepted one-way delivery/sensor idealization is
disclosed in §3.2. The selected equations and copy are an educational model
contract; neither general teaching-waveform discussion nor regression checks
establish clinical morphology or device validation. Historical CLIN-OD-008
records remain historical evidence.

---

## 11. Validation

`tests/test-engine.js` contains 300 regression assertions covering implemented
equations, numerical properties, waveform integrity, trigger eligibility, and
other commissioned behavior. Passing them establishes conformance to those
tested implementation contracts, not clinical validation of the simulator.

The current `npm test` inventory also requires 22 controller groups, 24 adaptive
integration groups, 22 selective legacy fixtures and 41 effort/pressure groups
(40 engine groups plus a renderer group with 66 subchecks). The unchanged legacy
fixture inventory exercises 92,500 ticks: 28,000 exact passive comparisons in
8 fixtures and 64,500 corrected active conformance ticks in 14 fixtures. Browser
verification requires 44 original, 12 adaptive and 4 effort/pressure groups;
the pinned-Linux visual inventory is 16 groups (13 existing plus 3 effort/pressure).
Fresh receipts establish passing results; this paragraph records required scope.

The VC characterization assertions establish deterministic numerical behavior
only for the parameter domain listed in Section 9. Clinical evidence for the
underlying mechanical-ventilation concepts is a separate matter represented by
the cited literature; regression conformance does not strengthen that evidence.

The suite gates CI as of 2026-08-05 (`process.exitCode = 1` on failure,
mutation-verified). Green runs recorded before that date do not carry the same
guarantee — the file had no exit code and passed regardless of the tally.

No part of this model has been validated against a physical ventilator or test
lung, or against recorded patient behavior. The current validation is limited
to conformance with implemented equations and numerical characterization in
explicitly tested domains. It does not establish device equivalence, patient
fidelity, or global numerical accuracy.
# Readout provenance and availability (VSM-CLIN-004)

These readouts are educational-model outputs, not device or patient
measurements. Their visible labels distinguish five categories: **Set**
(operator settings or directly derived settings), **Measured/Delivered**
(live integrator and valid breath state), **Live modeled** (internal residual
state), **Predicted** (analytical generated-breath or steady-state calculation),
and **unavailable/inapplicable** (`—`). Color and tooltips are not provenance.
The existing analytical header badges also say **Predicted Pplat** and
**Predicted steady-state auto-PEEP** when present. Their existing values,
conditions, thresholds, severity and timing remain unchanged when passive
analytics are applicable; active-effort pressure/flow-dependent predictions
are unavailable under the accepted finite-boundary contract. They remain
separate from the live `AlarmEngine` consumers.

| Visible label | Source and availability |
| --- | --- |
| Set PEEP | Configured PEEP, available immediately. |
| Measured PIP | `sim.breathSummary.pipLatched`, only when `lastCompletedBreath !== null`; otherwise `—`. |
| Measured VT | `lastCompletedBreath.measuredVT_mL`, rounded to mL; otherwise `—`. |
| Measured Pplat | Final-20 sample mean from a valid completed hold interval in `lastCompletedBreath.holdMechanics.pplat`; otherwise `—` with visible status. |
| Hold-derived driving pressure | Valid measured Pplat minus live modeled total PEEP frozen at breath start; otherwise `—`. |
| Hold-derived static compliance | Same-breath delivered VT divided by valid hold-derived driving pressure; otherwise `—`. |
| Measured inspiratory resistance | Same-breath unrounded `(PIP − Pplat) / final inspiratory flow`, only for passive constant-flow square VC; otherwise `—` with an applicability explanation. |
| Measured RR (standard); RR / Measured (Teaching) | Existing completion-timestamp interval rate; zero until two completions, then the first interval initializes it. Later updates blend 70% prior rate and 30% rate from up to ten timestamps. It retains its last value without new completions and is not used to compute VE. |
| Delivered VE (all modes) | Sum of canonical delivered inspiratory volumes in the last 30 simulated seconds, multiplied by 2 to L/min. Unavailable until a full valid window; a full empty window is zero. Display rounds to one decimal; VE alarms use the identical raw snapshot. |
| Predicted VE (VE help, mandatory modes only) | Passive analytical `summary().volumes.minuteVentilation`, explicitly separate from delivery and VE alarms. Affected active-effort predictions and adaptive fixed-pressure predictions are unavailable. Omitted in CSV because configured RR does not schedule breaths there. |
| Predicted breath MAP | Passive `calculateMAP()` over generated analytical breath samples; not live pressure-history integration. Unavailable with configured active effort or adaptive mode. |
| Predicted steady-state auto-PEEP | Passive analytical auto-PEEP in standard mode; unavailable with configured active effort or adaptive mode. Teaching retains live Flow Baseline and Exp completion cues. |
| Predicted total PEEP | Passive analytical configured PEEP plus predicted auto-PEEP; unavailable with configured active effort or adaptive mode. |
| Predicted steady-state trapped volume | Passive analytical `summary().volumes.trappedVolume_mL`, in the Patient mechanics strip; unavailable with configured active effort or adaptive mode. |
| Live modeled trapped volume | `sim.volumeAtBreathStart * 1000`, rounded to mL, separately displayed in the monitor. |

Hold-mechanics rows keep only the current value, units, a compact unavailable
state when needed, and a readable **Modeled baseline** cue beside driving
pressure/compliance. The valid Pplat success sentence and repeated baseline
paragraphs are omitted from the default view. Static information buttons open
one viewport-constrained help surface on hover, focus, click, or tap; it contains
the full measurement criteria, source provenance, applicability, and current
machine-readable reasons. Escape dismisses it and restores focus.

`lastCompletedBreath` is finalized at the existing `_startExpiration` boundary
and is the canonical completed-breath indication. `breathCount` increments at
the **start** of inspiration and cannot prove completion. PIP continues to use
the existing single `_startExpiration` latch; the live `breathSummary.pip`
remains the high-pressure alarm source. VT stays at the finalized value during
the next inspiration even though provisional `measuredVT_mL` resets to zero.

Initialization, reset, and mode switches clear the completed record: PIP, VT,
and Pplat show `—`, measured RR shows zero, delivered VE shows `—` with
`Collecting 30 s`, and live
modeled trapped volume is zero. The mode/reset handlers refresh display values
synchronously, without waiting for the next animation frame or adding an alarm
evaluation. Applicable passive analytical predictions can remain numeric under
their labels; unavailable active/adaptive predictions do not become zero.
No-effort or unsuccessful-trigger PC-CSV does not create a delivered breath or
backup ventilation. After the first completed breath, VT and PIP are available
but RR remains zero until two completions and delivered VE remains unavailable
until the full 30 s window is observed; no analytical warm-up fallback is used.

`volumeAtBreathStart` is the modeled end-expiratory residual **immediately
before the current breath began**, copied from `volumeAboveEq` by
`_startNewBreath`. It stays latched through that breath, including expiration,
until the next breath begins. It is not the current continuously changing
volume, a physical measurement, or `Ventilator.trappedVolume`. Reset and
initialization set it to zero; PC-CSV with no successful trigger leaves it zero.
The live and steady-state analytical paths remain independent even when their
numbers happen to agree. No timing, reference-state, convergence, or formula
equivalence is asserted here.

VSM-CLIN-005 defines hold validity, same-breath latching, dependency-specific
hold-derived mechanics, and visible unavailability. VSM-CLIN-006 implements
the owner-approved delivered-VE contract below. VSM-CLIN-011 retains broader
alarm policy and threshold adjudication. VSM-CLIN-014
controls analytical/live trapped-volume reconciliation. This change selects
sources and labels; it does not adjudicate those deferred calculations or
clinical interpretations.

### Delivered VE: owner-approved VSM-CLIN-006 contract

Approved D1–D7 on 2026-09-07 as a project-specific educational-model contract.
The owner subsequently refined D7 to **Measured RR** in Standard Mode and
**Measured** in Teaching Mode, superseding the earlier Interval labels.
The exact completed-breath timing/smoothing/retention help, RR calculation and
high-RR alarm behavior remain unchanged; D1–D6 remain in force.
This is not a device-equivalence or clinical alarm-safety claim. Both low- and
high-VE alarms are deliberately ineligible throughout a full 30-simulation-second
warm-up, even if delivery is absent or excessive. The existing five-second grace
also remains required; it does not add a second delay after window availability.
Apnea, high pressure, high RR, priorities, limits and audio policy remain separate.

`sim.deliveredVentilation` is an immutable version-1 snapshot with source
`live-completed-breath-volume`, volume definition
`inspiratory-volume-above-breath-start-residual`, and estimator
`rolling-volume-sum`. Its identity contains simulation/mode generation, as-of tick
and history revision; its metadata includes original simulation seconds, window
endpoints, observed seconds, event identities, count, last completion time,
summed volume and unrounded L/min. Both consumers receive the same object once
per existing render/evaluation. A stale or missing snapshot is never a numeric
fallback. The alarm engine checks source, validity and current context independently.

Count only actual canonical publications at expiration start, after any HOLD,
using unrounded `measuredVT_mL / 1000`. Include all trigger/cycle classifications
and all four modes; neither failed efforts nor incomplete breaths count. HOLD
validity is independent of delivered VT. Exclude positive pretrigger flow while
still in expiration. This signal is not a separate measurement of exhaled volume.

Membership is `(now - 30 s, now]`, using `round(seconds / dt)` for both endpoints
and completion times while retaining original timestamps as provenance. Tick
publication ordering remains unchanged: a stored boundary timestamp alone never
creates an event that the engine has not yet published. No ten-breath cap or
additional smoothing applies. Sum L × 2 gives L/min; prior contributions expire
even when no new breath completes. This differs from latest VT × smoothed RR
during irregular or changing ventilation.

Before 30 s of continuous valid observation, status is `warming`, reason
`INSUFFICIENT_HISTORY`, numeric value null. Afterwards, a full empty window is
`available` zero; no first-breath gate suppresses low-VE evaluation. Reset, mode
selection, and the existing flow-pattern reset clear history and restart warm-up.
Ordinary setting, patient effort and mechanics changes retain actual prior
delivery with its original identity. Pausing freezes simulation time/history;
speed changes affect its wall-time rate only. The existing frame cap is unchanged.

Malformed delivery produces `unavailable/INVALID_HISTORY`; known contamination
lasts until its event leaves the window, and unknown-time gaps require a fresh
30 s of continuous observation. Mode drift requires reset (`MODE_MISMATCH`).
Clock gaps or reversal yield `CLOCK_DISCONTINUITY`. Unavailable means null, not
zero, and removes VE alarms at the next existing evaluation; the UI discloses
that loss of availability rather than implying restored delivery. Reset handlers
refresh display synchronously without introducing extra alarm evaluations, so
old alert presentation can persist until the next normal frame.

The compact row reads **Delivered VE**, one decimal and L/min, with **30 s**,
**Collecting 30 s**, or **Unavailable**. One static information trigger shares
the existing popover and explains source, warm-up, rounding, and retained prior
delivery. Mandatory-mode predictions appear only there. Alarms compare raw
values using unchanged strict low/high thresholds; equality clears on the next
evaluation. VE chips say **Low VE · below {limit} L/min** or
**High VE · above {limit} L/min**, avoiding false rounded comparisons such as
`3 < 3`. No new persistence, hysteresis, or wall-time evaluation is introduced.

Existing VSM-CLIN-004 verification strengthens four engine composites (passive PC-CSV,
finalized waveform/loop agreement, reset metadata, and mode-transition metadata)
by adding initialization, first-breath RR, next-inspiration VT retention, and
zero-reset predicates. Their prior predicates remain intact. The existing
browser mode-tracking composite additionally exercises rendered provenance and
state transitions; its mode predicate remains. The existing cache composite
adds the transitive import and exact ten-site version inventory. Existing
visual cases add screenshots and geometry assertions without removing their
original screenshots, scenario guards, determinism, or network checks. These
historical VSM-CLIN-004 extensions preserved its commissioned 300/44/9 check
counts; the current successor inventory is recorded in Section 11. They do not replace
the existing alarm, tooltip, waveform, loop, or clipping coverage.

VSM-CLIN-006 adds focused publication/window/lifecycle/invalid-history and raw
alarm-boundary predicates to the existing low-VE engine composite, retaining
its original predicate and all other commissioned assertions. Existing VE alarm
fixtures now supply valid shared-snapshot provenance. Browser composites cover
the revised readout lifecycle and hover-transfer/Escape behavior. Independent
canonical-ledger, exact checkpoint numerical, and isolated mutation checks
supplement these gates; they do not replace pinned-Linux visual comparison or
owner acceptance of changed baseline bytes.

## PC-CMVa educational controller (VSM-ADAPT-001)

The fourth mode uses the existing pressure-targeted tick integrator with a
separate conventional feedback controller. The approved contract, transitions,
units, eligibility rules and copy are in [adaptive-mode-contract.md](adaptive-mode-contract.md).
This is a generic educational implementation, not a commercial-device model.

For each eligible canonical expiration-start publication, let `e` be the
operator target minus unrounded modeled inspired VT, in mL. The requested
increment is zero when `abs(e) <= 10`; otherwise it is `clip(0.01*e, -2, 2)`
cmH2O. Add it to the command actually delivered to that source breath and clamp
to the configured bounds (default 5–25 cmH2O above set PEEP). Initialize at 10.
These constants and bounds are educational engineering choices. There is no
integral accumulator, volume clamp, learned model, or R/C/effort input to the
controller. Maximum 20 is an explicit setup/reset option for the limit demo.

The next command is applied only at the next actual machine- or patient-triggered
breath start. The applied pressure command and set PEEP remain latched;
patient-side Paw is computed from the active boundary/valve state. Target/PEEP
requests are validated atomically and queued; the
latest valid request for each setting wins. Explicit reset or exit resolves both
operator values before destination initialization, clears controller history,
and preserves pause state. Re-entry uses current retained settings and initial
pressure; it cannot resurrect old queued requests or alter manual Pinsp/PS.

Other relevant input edits immediately invalidate the adaptive eligibility
epoch, including edit/revert. A mixed or otherwise ineligible publication still
contributes its genuine delivered volume to the existing VE window. No interrupted
inspiration is synthesized as completed. HOLD is unavailable in this mode.

Target, achieved inspired VT, its source target/breath, applied pressure, next
pressure, applied PEEP and requested settings are distinct display values.
Old feedback remains identified but cannot support a current target-band/miss
assessment after an edit. A pending command reaching a bound is not an already
delivered bound. Prescribed effort remains an instructor input with no drive,
work-of-breathing, fatigue or injury response model. Fixed-pressure steady-state
predictions are unavailable while pressure changes between breaths; numerical
R/C, calculated R×C and timing ratios retain their existing meanings.

Verification distinguishes equation/controller checks, exact legacy numerical
preservation, browser behavior and visual comparison from clinical/source
validity. Tests do not establish clinical validity or guarantee convergence over
the full UI range. The approved demonstrations and operating-range evidence
retain bound-limited, trapping and prescribed-effort limitations.
