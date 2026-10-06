# Case Design Schema

## Purpose

This schema is a reusable authoring template for future ventilator simulator
cases. It is intentionally planning-oriented, not a required simulator data
contract. The same structure could later live in Markdown, JSON, YAML, or a UI
authoring tool.

No simulator data contract changes are implied by this document.

## Authoring principles

- Build each case around one main teaching concept.
- Name the signal the learner should notice first.
- Add at least one distractor or plausible wrong path.
- Make the learner do something with the observation.
- Include immediate reinforcement and debrief value.
- Mark clearly whether the case can run manually in the current MVP.

## Plain-English field definitions

### Required instructional fields

#### Case title

Short, recognizable case name used in the library and debrief.

#### Learner level

Who the case is for, such as novice, intermediate, advanced, or mixed group.
This should guide how much signal/noise and how much hinting the case uses.

#### Mode focus

The primary ventilator mode or cross-mode comparison the learner should reason
through, such as VC-CMV, PC-CMV, PC-CSV, PC-CMVa (generic educational adaptive targeting), or VC vs PC differential.

#### Core concept

The single main mechanism or teaching target. Example: "expiratory flow not
returning to baseline indicates incomplete exhalation and auto-PEEP risk."

#### Initial ventilator settings

The starting vent configuration needed to run the case. Include only the
settings that matter, such as mode, VT or Pinsp, RR, I:E, PEEP, FiO2, trigger
type, trigger sensitivity, hold state, and alarm thresholds when relevant.

#### Initial patient mechanics

The starting patient state needed for the case. Include preset or exact
resistance/compliance values when they matter.

#### Patient effort settings if applicable

Specify whether the patient is passive or active. If active, include effort
strength, neural inspiratory time, patient RR, and any other relevant effort
assumptions.

#### Alarms expected

List which alarms are expected, optional, or intentionally absent. Also note
whether the alarm is a key signal or only a cue/noise source.

#### Primary waveform signals

The waveform or monitored-parameter clues the learner is supposed to notice.
This is the "signal" section of the case.

#### Distractors/noise

Plausible but secondary information that could pull the learner toward a wrong
interpretation. This is the "noise" section of the case.

#### Learner task

What the learner is being asked to do. Examples:

- identify the mechanism
- compare two causes
- choose the first management step
- decide whether to intervene or observe

#### Expected interpretation

The correct reasoning path in plain language. This should explain why the
signals support the intended diagnosis or management concept.

#### Suggested intervention

The recommended first action or response. Some cases may intentionally use
"observe and name the pattern" as the intervention if the teaching goal is
recognition rather than knob-turning.

#### Immediate feedback

What the learner should be told right after responding. This should reinforce
the mechanism, not only say "correct" or "incorrect."

#### Debrief questions

Short prompts for reflection after the case. These should help the learner link
the scenario back to general ventilator reasoning.

#### Instructor notes

Facilitation notes, pacing tips, optional reveal points, and suggestions for
how to use Teaching Mode or alarms in a group session.

#### Independent learner hints

Hints that can be progressively revealed when no instructor is present.

#### Success criteria

Observable indicators that the learner achieved the case objective. These
should include recognition and reasoning, not only final settings.

#### Common misconceptions

Likely incorrect conclusions or habits the case is designed to surface.

#### Future simulator features needed

What future scenario functionality would improve or fully enable the case, such
as branching, timed state changes, guided hints, scoring, or built-in debrief.

### Strongly recommended supporting fields

#### Short narrative

One or two sentences that make the case clinically recognizable without turning
it into a long chart review.

#### Manual today status

Mark whether the case can run manually in the current MVP as:

- yes
- partial
- no

#### Best roadmap phase

The earliest roadmap phase where the case works well:

- Phase 0
- Phase 1
- Phase 2
- Phase 3
- Phase 4

#### Teaching Mode use

State whether Teaching Mode should be:

- off at first, then on for reveal
- on from the start
- optional

#### Verification step

What the learner should re-check after intervening. Example: "After lowering RR
and lengthening Te, expiratory flow should return closer to baseline."

## Optional JSON-like structure

```json
{
  "caseTitle": "COPD Air Trapping",
  "learnerLevel": "intermediate",
  "modeFocus": "VC-CMV",
  "coreConcept": "Expiratory flow not returning to baseline suggests incomplete exhalation and auto-PEEP risk.",
  "shortNarrative": "Intubated COPD patient is receiving mandatory ventilation and appears to be stacking breaths.",
  "manualTodayStatus": "yes",
  "bestRoadmapPhase": "Phase 0",
  "teachingModeUse": "off at first, then on for reveal",
  "initialVentilatorSettings": {
    "mode": "VC-CMV",
    "flowPattern": "square",
    "tidalVolume_mL": 450,
    "respiratoryRate_bpm": 20,
    "ieRatio": "1:2",
    "peep_cmH2O": 5,
    "fio2_percent": 40,
    "triggerType": "flow",
    "flowTrigger_Lpm": 2.0,
    "holdActive": false,
    "alarmThresholds": {
      "highPressure_cmH2O": 40,
      "highRR_bpm": 35,
      "apnea_seconds": 20,
      "lowVE_Lpm": 3.0,
      "highVE_Lpm": 20.0
    }
  },
  "initialPatientMechanics": {
    "preset": "COPD example (HME)",
    "resistance_cmH2O_s_per_L": 25,
    "compliance_L_per_cmH2O": 0.06
  },
  "patientEffortSettings": {
    "active": false
  },
  "alarmsExpected": [
    {
      "alarm": "none required",
      "role": "absence of alarm should not reassure the learner"
    }
  ],
  "primaryWaveformSignals": [
    "expiratory flow does not return to baseline",
    "expiratory completion is reduced",
    "auto-PEEP / total PEEP are elevated"
  ],
  "distractorsNoise": [
    "tidal volume is still delivered",
    "PIP may not be dramatically high",
    "learner may focus on RR number instead of Te/tau"
  ],
  "learnerTask": "Identify the cause of the abnormal expiratory flow pattern and choose the first ventilator adjustment.",
  "expectedInterpretation": "This is air trapping from inadequate expiratory time in a high-resistance patient.",
  "suggestedIntervention": "Reduce RR and/or lengthen I:E to increase Te, then re-check flow baseline.",
  "verificationStep": "Expiratory flow should return closer to baseline after Te is increased.",
  "immediateFeedback": "Correct if the learner links persistent expiratory flow to incomplete emptying rather than to low VT or a generic pressure problem.",
  "debriefQuestions": [
    "What signal told you exhalation was incomplete?",
    "Why does COPD make Te/tau important?",
    "Which change would worsen trapping?"
  ],
  "instructorNotes": [
    "Let learners commit before showing Teaching Mode.",
    "Use flow baseline and expiratory completion as mechanism reveal."
  ],
  "independentLearnerHints": [
    "Start with the flow waveform, not the pressure waveform.",
    "Ask whether exhalation finishes before the next breath starts."
  ],
  "successCriteria": [
    "Learner identifies incomplete exhalation",
    "Learner links it to high resistance and short Te",
    "Learner chooses a strategy that increases expiratory time"
  ],
  "commonMisconceptions": [
    "If VT is normal, exhalation must also be normal",
    "Increase RR to improve ventilation",
    "Any pressure issue in COPD means compliance changed"
  ],
  "futureSimulatorFeaturesNeeded": [
    "guided prompt sequence",
    "progressive hints",
    "before/after feedback panel",
    "optional scoring"
  ]
}
```

## Authoring checklist

Use this checklist when drafting a new case:

- Can I name the first signal in one sentence?
- Is there at least one believable wrong conclusion?
- Does the learner have to interpret, not only observe?
- Is there a clear first action or explicit choice not to act?
- Is the feedback mechanism-focused?
- Is the debrief worth running even after a correct answer?
- Can this case run manually today, or does it depend on future features?

## Notes on future implementation

- This schema should remain separate from simulator physics and UI logic.
- Early phases can store cases as Markdown backed by manual setup.
- Later phases can translate the same fields into structured data if needed.
- The schema should support both instructor-led and independent learner flows
  without forcing every field to be shown at once on screen.

## Authoring guardrail

Cases must name actual supported controls, units and ranges. If the required state is unavailable, mark the case blocked or propose a clearly labeled model-limited alternative for owner review. Do not silently choose the nearest available setting and preserve the original clinical interpretation.

## Implementation inventory checked against main c80da4a on 2026-10-06

### Lung presets (js/lung-model.js, LungModel.presets())

| Key | Label | R (cmH₂O·s/L) | C (L/cmH₂O) | Calculated τ (R × C) |
| --- | --- | --- | --- | --- |
| normal | Normal example | 10 | 0.060 | 0.6 s |
| ards_moderate | Low compliance (35) | 10 | 0.035 | 0.35 s |
| ards_severe | Low compliance (25) | 12 | 0.025 | 0.3 s |
| copd | COPD example (HME) | 25 | 0.060 | 1.5 s |
| asthma | High resistance (20) | 20 | 0.060 | 1.2 s |
| obesity | Reduced compliance (40) | 8 | 0.040 | 0.32 s |
| fibrosis | Low compliance (30) | 8 | 0.030 | 0.24 s |

### Alarm defaults (alarms.js, DEFAULT_ALARM_LIMITS)

| Limit | Value |
| --- | --- |
| highPressureCmH2O | 40 |
| highRR | 35 |
| apneaSeconds | 20 |
| lowMinuteVentilationLpm | 3 |
| highMinuteVentilationLpm | 20 |
| stabilizationSeconds (additional VE-only eligibility requirement) | 5 |

Low/high VE also require a valid full 30-simulation-second delivery window. High pressure, high RR and apnea are not suppressed by this five-second grace. These defaults have no general clinical-safety approval.

### Mode constants (js/ventilator.js)

| Constant | String value |
| --- | --- |
| MODE_VC_CMV | `vc-cmv` |
| MODE_PC_CMV | `pc-cmv` |
| MODE_PC_CSV | `PC-CSV` (case-sensitive legacy ID) |
| MODE_PC_CMVA | `pc-cmva` |

### VC flow patterns (js/ventilator.js, this.flowPattern)

- `square` — constant flow throughout inspiration
- `ramp` — descending ramp (linear deceleration from peak to zero)

### Operator control ranges (index.html sliders + js/main.js for PC-CSV controls)

| Control | min | max | step | default | Notes |
| --- | --- | --- | --- | --- | --- |
| Tidal Volume / Target VT (mL) | 200 | 800 | 10 | 500 | VC-CMV Tidal Volume; PC-CMVa Target VT |
| Pinsp above PEEP (cmH₂O) | 5 | 35 | 1 | 15 | PC-CMV |
| Respiratory Rate (/min) | 6 | 35 | 1 | 14 | |
| I:E ratio | — | — | — | 1:2 | buttons: 1:1, 1:1.5, 1:2, 1:3, 1:4 |
| PEEP (cmH₂O) | 0 | 24 | 1 | 5 | |
| FiO₂ (%) | 21 | 100 | 1 | 40 | |
| Flow trigger (L/min) | 0.5 | 5 | 0.1 | 2.0 | trigger-type buttons: flow, pressure |
| Pressure trigger (cmH2O) | 0.5 | 5 | 0.1 | 1.0 | |
| Hold duration (slider raw) | 3 | 20 | 1 | 5 | displayed value = slider ÷ 10 (so 0.3–2.0 s, default 0.5 s) |
| Pressure Support (cmH₂O) | 5 | 30 | 1 | 10 | PC-CSV (control injected dynamically by ensurePcCsvControls()) |
| Cycle % | 10 | 60 | 1 | 25 | PC-CSV |
| Patient R (cmH2O·s/L) | 5 | 40 | 1 | 10 | shared airway R; no separate expiratory R |
| Patient C (mL/cmH2O) | 15 | 100 | 1 | 60 | total respiratory-system compliance |
| Enabled Effort (cmH2O) | 0.25 | 12 | 0.25 | 2 | prescribed peak inspiratory Pmus |
| Neural Ti (s) | 0.4 | 2.0 | 0.1 | 1.0 | raw slider 4-20 divided by 10 |
| Patient RR (/min) | 6 | 35 | 1 | 16 | no zero slider setting |
| Adaptive maximum above set PEEP (cmH2O) | 20 | 25 | selector | 25 | exactly 20 or 25; setup-only, then Reset demonstration |
| Alarm: High Pressure (cmH2O) | 20 | 60 | 1 | 40 | |
| Alarm: High RR (/min) | 10 | 60 | 1 | 35 | |
| Alarm: Apnea (s) | 5 | 60 | 1 | 20 | |
| Alarm: Low V̇E (L/min) | 0 | 15 | 0.5 | 3.0 | |
| Alarm: High V̇E (L/min) | 5 | 40 | 0.5 | 20.0 | |

Inspected implementation reference: main `c80da4a3736d9313bcaaf8a15e4d129efc216bf3`, tree `801dc5b9424c16503d99dbf8326d36186c0ee0c1`, on 2026-10-06. This is a read-only source inventory, not a fresh execution result. Re-verify the served build before authoring or rehearsal.

### Applicability and lifecycle notes

Passive state is established with the effort control, not a nonexistent zero setting on the Patient RR or enabled Effort sliders. Verify modeled Pmus is zero. The zero-effort PC-CMVa exit input discrepancy and duplicate Pmus readouts remain deferred; the Effort-slider geometry fix does not close them. Stop rehearsal if the prescribed state is ambiguous.

Adaptive minimum is 5 cmH2O above set PEEP, initial command after reset is 10, default maximum is 25 (explicit alternative 20) and target default is 500 mL. The selected maximum is setup-only and requires **Reset demonstration**. These are educational engineering constants, not patient recommendations. Target and PEEP requests queue to a normal next adaptive breath boundary; source values and applied values remain distinct. See the [approved adaptive contract](adaptive-mode-contract.md).

A requested short hold does not guarantee a valid measurement. Measured Pplat requires an actual completed 0.5-2.0 s interval and the full [validity criteria](model.md#33-inspiratory-hold). HOLD is inapplicable in PC-CSV and PC-CMVa; measured resistance requires passive square-flow VC. There is no expiratory-occlusion maneuver.

### Required rehearsal and review fields

Record these alongside the instructional fields; none implies clinical approval:

- Served build commit/tree and launch URL or local launch.
- Browser/version, operating system, viewport and display zoom.
- Reset state, warm-up procedure and verified passive/active effort state.
- Readout provenance, availability and omitted mechanisms.
- Observation simulation time and breath/source identity.
- Exact intervention settings, order and timing.
- Expected project-default alarms, their eligibility and actual observation times.
- Numerical trace and screenshot receipt for that state.
- Per-case owner/SME approval status for objective, causal explanation and interpretation.
- Stop conditions and recovery/reset procedure.

All cases remain subject to [VSM-CLIN-010 and the current successor gates](clinical/CLIN-001/successor-index.md).
