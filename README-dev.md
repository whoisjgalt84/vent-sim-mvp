# Ventilator Simulator — README (Developer)

## 🫁 Core Idea

This simulator is a **single-compartment implementation of the equation of motion for the respiratory system**:

> **Pmus + Pvent = E × V + R × V̇**

Where:

* **E × V** → elastic load (lung/chest wall)
* **R × V̇** → resistive load (airways + ETT)

Everything in this project flows from this equation.

If a feature cannot be explained through this equation, it does not belong here.

---

## 🎯 MVP Scope (Strict)

This project is built outward from a **minimum viable core**:

**Primary Mode (MVP):**

* VC-CMV (Volume Control, Continuous Mandatory Ventilation)
* Square flow
* Passive patient (Pmus = 0)

**Everything else is an extension**, not the foundation.

Current extensions (already implemented):

* PC-CMV (pressure control)
* Descending ramp flow
* Inspiratory hold
* Auto-PEEP / gas trapping
* Patient effort (Pmus)

⚠️ Rule:
We do not expand features unless they preserve clarity of the core model.

---

## 🧱 Architecture

The system is intentionally modular and physiologically aligned:

```
LungModel        → Patient mechanics (R, C, τ)
Ventilator       → Settings + derived physiology
SimulationEngine → Time evolution (breath + continuous)
WaveformDisplay  → Rendering (canvas)
main.js          → Integration + UI wiring
```

### Responsibilities

**LungModel**

* Implements physics (equation of motion)
* Calculates pressure, flow, expiration, auto-PEEP

**Ventilator**

* Applies mode logic (VC vs PC)
* Computes derived values (PIP, Pplat, ΔP, etc.)
* Generates breath waveforms (analytical + numerical)

**SimulationEngine**

* Advances time (real-time stepping)
* Maintains state across breaths
* Handles patient-triggered breaths

**WaveformDisplay**

* Renders scrolling waveforms (P, V, Flow)
* Renders loops (P-V, F-V)

**main.js**

* Wires UI → ventilator → simulation → display

---

## 🧠 Simulation Philosophy

### 1. Physics First

* All behavior must trace back to the equation of motion
* No “faked” waveforms
* No arbitrary curves

---

### 2. Analytical When Possible

* VC modes → closed-form solutions
* Passive expiration → exponential decay

---

### 3. Numerical Only When Necessary

* PC + patient effort (Pmus) requires time-stepping:

```
V̇(t) = [Pinsp + Pmus(t) - E·V(t)] / R
```

* Integrated using discrete time steps (100 Hz)

---

### 4. Steady-State Assumption

* Auto-PEEP and trapped volume are calculated **before waveform generation**
* Each breath represents a stable repeating system

---

### 5. Modes Reveal Different Truths

* **VC-CMV** → Flow is controlled → pressure reveals mechanics
* **PC-CMV** → Pressure is controlled → flow/volume reveal mechanics

---

## 🧪 Validation (Critical)

The test harness is not optional—it is the **ground truth**.

Run:

```bash
node test-engine.js
```

The tests verify:

* Hand-calculable physiology
* Time constants (τ)
* Auto-PEEP behavior
* Waveform integrity
* Clinical sanity checks

If these fail:

> The simulator is wrong.

---

## 🔬 Units Convention (Global)

| Quantity   | Unit                |
| ---------- | ------------------- |
| Pressure   | cmH₂O               |
| Volume     | L (display mL)      |
| Flow       | L/s (display L/min) |
| Compliance | L/cmH₂O             |
| Resistance | cmH₂O·s/L           |
| Time       | seconds             |

---

## 🚫 Non-Goals (For Now)

To protect clarity:

* ❌ No multi-compartment lung models
* ❌ No spontaneous modes (PSV, SIMV, etc.)
* ❌ No UI polish beyond functional
* ❌ No machine-specific quirks

---

## 🧭 Development Rules

1. **Start from physiology, not UI**
2. **Every feature must map to a clinical concept**
3. **Prefer clarity over completeness**
4. **Tests define correctness**
5. **Do not break the MVP mental model**

---

## 🫀 Clinical Anchors

The simulator should always pass a “clinical sniff test”:

* ARDS → ↓C → ↑Pplat
* COPD → ↑R → ↑τ → gas trapping
* Short Te → auto-PEEP
* Ramp flow → ↓PIP, same Pplat
* Pmus in VC → scalloped pressure
* Pmus in PC → ↑VT

If behavior violates these:

> The model is wrong, not the patient.

---

## 🚀 Getting Started

```bash
# run locally (Live Server recommended)
open index.html

# run validation
node test-engine.js
```

---

## 🧠 Mental Model (TL;DR)

This is not just a simulator.

It is a system that answers:

> “Given these mechanics and these settings… what must happen?”

Not:

> “What should it look like?”

---

## 📚 References

* Chatburn RL. *Fundamentals of Mechanical Ventilation*
* Mireles-Cabodevila et al. *Respiratory Care (2022)*
* Arnal et al. *Respiratory Care (2018)*

---

## ✨ Final Note

If you understand:

* the equation of motion
* time constants (τ)
* and how modes control variables

…you understand this simulator.

Everything else is just implementation.
