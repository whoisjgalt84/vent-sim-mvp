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
through, such as VC-CMV, PC-CMV, PC-CSV, or VC vs PC differential.

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
    "preset": "COPD",
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
