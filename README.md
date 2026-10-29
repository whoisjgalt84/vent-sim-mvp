# Ventilator Simulator

[![Smoke Tests](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-test.yml/badge.svg)](https://github.com/whoisjgalt84/vent-sim-mvp/actions/workflows/smoke-test.yml)

A browser-based mechanical ventilator simulator for educator-led exploration
of ventilator settings, prescribed patient effort and modeled waveforms.

It runs entirely in the browser. No install, no account, no build step.

---

## Run it

ES modules will not load over `file://`, so serve the folder over HTTP:

```bash
npm install
npm run serve      # then open http://127.0.0.1:8899
```

Any static server works — VS Code's Live Server extension is fine too.

```bash
npm test              # 300 original + 22 controller + 24 integration + 22 legacy + 41 effort/pressure + 28 reset + 43 manual-hold
npm run test:browser  # 44 original + 12 adaptive + 4 effort/pressure + 5 slider + 8 reset + 7 cleanup + 20 manual-hold
npm run test:visual:docker  # 18 existing + 3 manual-hold pinned-Linux visual groups
```

Read the printed `Passed: N / Failed: M` tally. See
[`README-dev.md`](./README-dev.md) for the browser and screenshot harnesses,
including the host-specific snapshots required for Windows visual diagnostics.

---

## What it does today

**Modes** - four, named by taxonomy TAG rather than vendor brand name:

| TAG | What it is | Common names / implementation note |
| --- | --- | --- |
| `VC-CMV` | Volume control, continuous mandatory | Volume A/C |
| `PC-CMV` | Pressure control, continuous mandatory | Pressure A/C, PCV |
| `PC-CSV` | Pressure control, continuous spontaneous | Pressure Support, PSV |
| `PC-CMVa` | Pressure control, continuous mandatory, adaptive targeting | Generic educational controller; not a commercial-device replica |

**Patient** - one linear total respiratory-system compartment (resistance + compliance). A single airway R is shared by inspiration and expiration; separate expiratory resistance, airway collapse and expiratory flow limitation are absent. There is no expiratory hold, drug-response or gas-exchange model; FiO2 is a display setting.
Seven mechanics examples are available, with per-example provenance and manual resistance/compliance controls. Disease names and severity are not inferred from R and C.
Effort is modelled as `Pmus`, with settable strength, neural inspiratory time,
and neural respiratory rate independent of the ventilator's set rate.
Effort mechanics and pressure/flow triggering use a disclosed simplified supply
boundary. Its inward supply resistance is an educational assumption, distinct
from patient airway resistance. Prescribed effort is an instructor input, not
measured work of breathing or a patient's response to changing assistance.

**Ventilator** — square and descending-ramp flow, inspiratory hold, PEEP, FiO₂,
I:E, flow or pressure triggering with adjustable sensitivity, plus pressure
support and cycle % in `PC-CSV`.

**Waveforms** — pressure, volume and flow drawn the way a real ventilator draws
them: a sweep with an erase bar, over a selectable 5 / 10 / 20 / 30 s window.
Pressure–volume and flow–volume loops. Playback at 1× / 2× / 4×.
Patient trigger: recorded event on its pressure or flow waveform. Machine
trigger: timed breath. Patient markers do not appear on volume. Paw is
patient-side gauge pressure; atmospheric zero differs from applied PEEP.
Signed pressure views retain genuine negative modeled values without adding
a pressure dip for appearance.

**Monitoring and alarms** - Measured PIP, VT and RR; valid-hold Pplat and derived mechanics; Delivered VE from a 30-simulation-second delivery window; separately labeled live modeled trapped volume and applicable analytical predictions. Active-effort and adaptive predictions that the analytical model cannot support are unavailable. Five alarms (high pressure, high rate, apnea, low and high minute ventilation) have priority tiers, audio and a silence toggle. Measured values are simulator outputs, not physical patient or device measurements.

Delivered VE and its low/high alarms remain unavailable until a full valid 30-simulation-second window has been observed.

**Teaching Mode** — shows Set, Measured, and Patient rates; a
`Failed triggers N /60s` counter for recorded efforts that did not start a breath;
existing amber flow highlights and cause-specific hover explanations; and the
existing air-trapping annotation.

---

## Documentation

| Document | For |
| --- | --- |
| [`README-dev.md`](./README-dev.md) | The physics, the architecture, units, non-goals |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | How a change gets from a branch into `main` |
| [`CLAUDE.md`](./CLAUDE.md) | Operating manual for AI coding agents |
| [`docs/glossary.md`](./docs/glossary.md) | Normative vocabulary, with citations |
| [`docs/model.md`](./docs/model.md) | The mathematical model, published in full |
| [`docs/visual-testing.md`](./docs/visual-testing.md) | The screenshot regression suite |
| [`docs/case-design-schema.md`](./docs/case-design-schema.md) | Draft authoring template with a dated implementation inventory; re-verify the served build before rehearsal |
| [`docs/case-bank-v0.1.md`](./docs/case-bank-v0.1.md) | Draft case bank; no release-wide teaching-case approval |
| [`docs/case-scenario-roadmap.md`](./docs/case-scenario-roadmap.md) | Where case-based learning is going |
| [`docs/sme-feedback-log.md`](./docs/sme-feedback-log.md) | What practising RTs have reported |
| [`docs/trigger-fix-design.md`](./docs/trigger-fix-design.md) | Historical trigger-rewrite design and decisions; current signal contract is in `docs/model.md` |
| [`docs/adaptive-mode-contract.md`](./docs/adaptive-mode-contract.md) | PC-CMVa controller, operator-setting lifecycle, shared effort/pressure successor, and evidence boundaries |
| [`docs/clinical/CLIN-001/successor-index.md`](./docs/clinical/CLIN-001/successor-index.md) | Historical October 6 snapshot, current baseline links and open claim boundaries |

---

## Philosophy

- **Physiological credibility over visual flash.** A prettier screen with
  sloppier physiology is a regression.
- **Small, careful patches over large rewrites.**
- **Support educator-directed use.** Educators choose their own objectives,
  explanations and teaching approach; the simulator does not prescribe them.
- **Standard vocabulary.** Modes are classified, not branded. See the glossary.
- **Publish the model.** Educational simulators are routinely and fairly
  criticised for hiding their maths. Ours is in [`docs/model.md`](./docs/model.md).

---

## Status and scope

The v1.0.0 release scope is the simulator itself. Educators determine how to
use it and which learning objectives, if any, to pursue. It does not prescribe
pedagogy or claim validated learning outcomes or an approved shipped bank of
teaching cases. Case documents remain drafts with separate case-specific review.

The runtime is frozen for the October 29 and November 2 formative usability
pilots. These sessions observe educators/operations staff operating the
simulator while Christian supplies RT reasoning; they do not validate pedagogy.
The package version is 1.0.0; final release approval and publication remain
separate decisions.

**It is not a medical device**, is not validated for clinical decision-making,
and nothing in it should be used to guide the care of a real patient.

Out of scope for now: multi-compartment lung models; adaptive schemes beyond the implemented generic PC-CMVa controller, including Volume Support; servo, dual, optimal and intelligent targeting; IMV breath sequences; and vendor-specific behavior. PC-CMVa adjusts the next breath's pressure command from eligible completed inspired VT. It does not guarantee a target volume or reproduce a commercial PRVC algorithm.

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

## Verification inventory and carried evidence

At main `395c0dc6e8338036e1ae46ab38572cb23a424ef8`, the commands above require
480 engine assertions/groups, 100 browser groups and 18 existing plus three
manual-hold visual groups (21 total). The original 300 assertions, added groups
and 22 legacy fixtures are separate inventories; nested checks are not extra
top-level groups. Sources: [engine runner](tools/run-engine-tests.mjs),
[browser/visual runner](tools/run-browser-tests.mjs),
[shared reset contract](docs/demonstration-reset-contract.md) and
[manual-hold contract](docs/manual-inspiratory-hold-contract.md).

Carried evidence from the October 12 [exact-main CI run 38201279689](https://github.com/whoisjgalt84/vent-sim-mvp/actions/runs/38201279689)
records those inventories passing with zero failures: separate
[Node 22](https://github.com/whoisjgalt84/vent-sim-mvp/actions/runs/38201279689/job/114655033660) and
[Node 24](https://github.com/whoisjgalt84/vent-sim-mvp/actions/runs/38201279689/job/114655033594) engine jobs, and the
[pinned-Linux browser/visual job](https://github.com/whoisjgalt84/vent-sim-mvp/actions/runs/38201279689/job/114655033410).
This is historical verification of that revision, not a fresh test run for
these documentation corrections or clinical, pedagogical or release approval.
