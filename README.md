# Ventilator Simulator

[![Smoke Tests](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-test.yml/badge.svg)](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-test.yml)

A browser-based mechanical ventilator simulator for clinical education — built
so a learner can ask, of any moment on the screen: **what is the ventilator
doing, what is the patient doing, and what does the waveform reveal?**

It runs entirely in the browser. No install, no account, no build step.

---

## Run it

ES modules will not load over `file://`, so serve the folder over HTTP:

```bash
python3 -m http.server 8899
# then open http://127.0.0.1:8899
```

Any static server works — VS Code's Live Server extension is fine too.

```bash
npm test        # 300 engine assertions
```

Read the printed `Passed: N / Failed: M` tally. See
[`README-dev.md`](./README-dev.md) for the browser and screenshot harnesses.

---

## What it does today

**Modes** — three, named by taxonomy TAG rather than vendor brand name:

| TAG | What it is | Common brand names |
| --- | --- | --- |
| `VC-CMV` | Volume control, continuous mandatory | Volume A/C |
| `PC-CMV` | Pressure control, continuous mandatory | Pressure A/C, PCV |
| `PC-CSV` | Pressure control, continuous spontaneous | Pressure Support, PSV |

**Patient** — a single-compartment lung (resistance + compliance) with seven
presets: normal, moderate and severe ARDS, COPD, asthma, obesity, fibrosis.
Effort is modelled as `Pmus`, with settable strength, neural inspiratory time,
and neural respiratory rate independent of the ventilator's set rate.

**Ventilator** — square and descending-ramp flow, inspiratory hold, PEEP, FiO₂,
I:E, flow or pressure triggering with adjustable sensitivity, plus pressure
support and cycle % in `PC-CSV`.

**Waveforms** — pressure, volume and flow drawn the way a real ventilator draws
them: a sweep with an erase bar, over a selectable 5 / 10 / 20 / 30 s window.
Pressure–volume and flow–volume loops. Playback at 1× / 2× / 4×.

**Monitoring and alarms** — PIP, Pplat, delivered VT, measured rate, minute
ventilation, mean airway pressure, auto-PEEP. Five alarms (high pressure,
high rate, apnea, low and high minute ventilation) with priority tiers, audio,
and a silence toggle.

**Teaching Mode** — makes invisible physiology visible: a set / delivered /
patient rate table, an `Ineffective N /60s` counter for efforts the ventilator
never answered, amber highlighting of the expiratory-flow deflection a failed
trigger produces, air-trapping annotation, and tooltips that name *why* a
specific effort failed.

---

## Documentation

| Document | For |
| --- | --- |
| [`README-dev.md`](./README-dev.md) | The physics, the architecture, units, non-goals |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How a change gets from a branch into `main` |
| [`CLAUDE.md`](./CLAUDE.md) | Operating manual for AI coding agents |
| [`docs/glossary.md`](./docs/glossary.md) | Normative vocabulary, with citations |
| [`docs/model.md`](./docs/model.md) | The mathematical model, published in full |
| [`docs/case-design-schema.md`](./docs/case-design-schema.md) | Case authoring template; its appendix snapshots engine ground truth (ranges, presets, alarm defaults) — stale-dated, re-verify |
| [`docs/case-bank-v0.1.md`](./docs/case-bank-v0.1.md) | Authored teaching cases |
| [`docs/case-scenario-roadmap.md`](./docs/case-scenario-roadmap.md) | Where case-based learning is going |
| [`docs/sme-feedback-log.md`](./docs/sme-feedback-log.md) | What practising RTs have reported |
| [`docs/trigger-fix-design.md`](./docs/trigger-fix-design.md) | As-built record of the trigger rewrite |

---

## Philosophy

- **Physiological credibility over visual flash.** A prettier screen with
  sloppier physiology is a regression.
- **Small, careful patches over large rewrites.**
- **Teach concepts, not knobs.** The simulator should support reasoning about
  what is happening — not just changing settings and watching lines move.
- **Standard vocabulary.** Modes are classified, not branded. See the glossary.
- **Publish the model.** Educational simulators are routinely and fairly
  criticised for hiding their maths. Ours is in [`docs/model.md`](./docs/model.md).

---

## Status and scope

An MVP under active development, driven by feedback from practising respiratory
therapists (`docs/sme-feedback-log.md`).

It is a teaching tool for **cognitive** objectives — mode classification,
waveform interpretation, load identification, recognising patient–ventilator
discordance. It is deliberately not aimed at psychomotor objectives (real
knobology) or affective ones (teamwork, communication), which the simulation
literature places with mannequins and live scenarios.

**It is not a medical device**, is not validated for clinical decision-making,
and nothing in it should be used to guide the care of a real patient.

Out of scope for now: multi-compartment lung models, adaptive and servo
targeting schemes (PRVC, Volume Support, NAVA, PAV), IMV breath sequences, and
vendor-specific behaviour.

---

## References

Vocabulary and physiology follow:

- Chatburn RL. *Fundamentals of Mechanical Ventilation.* Mandu Press.
- Chatburn RL. Classification of ventilator modes: update and proposal for
  implementation. *Respir Care* 2007;52(3):301–323.
- Chatburn RL. The complexities of mechanical ventilation: toppling the tower of
  Babel. *Respir Care* 2023;68(6):796–820.
- Mireles-Cabodevila E, Siuba MT, Chatburn RL. A taxonomy for patient–ventilator
  interactions and a method to read ventilator waveforms. *Respir Care*
  2022;67(1):129–148.
- Mireles-Cabodevila E, Vaporidi K, Blanch L, Chatburn RL. Defining and
  measuring patient–ventilator interactions: 10 fundamental maxims. *Respir
  Care* 2026.
- Mireles-Cabodevila E, Catullo K, Chatburn RL. Simulation in mechanical
  ventilation training: integrating best practices for effective education.
  *Respir Care* 2024;69(11):1468–1476.
- Hess DR. Respiratory mechanics in mechanically ventilated patients. *Respir
  Care* 2014;59(11):1773.
- Arnal J-M, Garnero A, Saoli M, Chatburn RL. Parameters for simulation of adult
  subjects during mechanical ventilation. *Respir Care* 2018;63(2):158–168.
