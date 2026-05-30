# Case Scenario Roadmap

## Purpose of case scenarios

Case scenarios should turn the simulator from a settings sandbox into a
teaching-ready learning system. The goal is not only to let someone change VT,
RR, PEEP, or mechanics, but to help them:

- recognize clinically familiar waveform patterns
- connect what they see to respiratory mechanics and ventilator mode logic
- choose a management response
- get immediate reinforcement about why the response was right or wrong
- leave with a debriefable teaching moment

The best cases should feel like "interpret, reason, act, re-check," not
"load preset, admire waveform."

## Instructor-led vs independent learner use

### Instructor-led use

Instructor-led cases should support:

- live bedside-style teaching with shared observation of the waveform screen
- Socratic questioning before any explanation is revealed
- flexible pacing, including pause-and-discuss moments
- deliberate introduction of signal and noise by the instructor
- side-by-side comparison of incorrect and correct adjustments
- debrief prompts that connect simulator behavior to real ventilator reasoning

Instructor-led cases do not need heavy automation at first. A strong case card
plus the current simulator controls already supports meaningful teaching.

### Independent learner use

Independent learner cases should support:

- a clear task statement
- progressive hints instead of immediate answer reveal
- immediate feedback after a decision or interpretation
- repeated practice without needing a facilitator
- reset/replay to compare before and after states
- optional scoring and summary after completion

Independent learner mode needs more structure than instructor-led mode because
the simulator has to replace the teacher's prompting, calibration, and debrief.

## How cases should use existing simulator strengths

The current MVP already has strong teaching raw material. Future cases should
orchestrate these strengths rather than replace them:

- real-time pressure, volume, and flow waveforms
- VC-CMV, PC-CMV, and PC-CSV mode behavior
- patient mechanics presets and manual R/C adjustment
- patient effort and trigger sensitivity
- inspiratory hold, PIP, Pplat, DeltaP, auto-PEEP, and measured RR
- Teaching Mode metrics such as flow baseline and expiratory completion
- active alarm logic for high pressure, high RR, apnea, low VE, and high VE

In practice, a good case should ask the learner to use the existing simulator
screen to answer a question such as:

- "What is the primary signal here?"
- "What mechanism explains it?"
- "What single adjustment would you make first?"
- "What would you expect to change if you are right?"

## How cases should avoid becoming simple settings presets

A preset alone is not a case. A case should include at least five elements:

1. A short clinical frame.
2. A signal the learner is supposed to notice.
3. A distractor or plausible wrong interpretation.
4. A learner task that requires interpretation or management reasoning.
5. Feedback and debrief value after the decision.

If a "case" only says "load COPD preset," it teaches recognition weakly and
management almost not at all. Cases should instead ask the learner to interpret
what the preset means on waveforms and numbers, then respond.

Useful anti-preset guardrails:

- Every case should name a primary signal and at least one distractor.
- Every case should include an expected wrong conclusion.
- Every case should include a suggested intervention or explicit "do not
  change anything yet" task.
- Every case should explain what the learner should re-check after acting.

## Relationship to Teaching Mode

Teaching Mode should be treated as an instructional overlay, not as the case
system itself.

Recommended role of Teaching Mode in cases:

- In instructor-led sessions, Teaching Mode can be toggled on after learners
  first commit to an interpretation.
- In independent learner mode, Teaching Mode metrics can appear as hints or
  reinforcement after an attempt.
- Teaching Mode is especially useful for cases involving flow baseline,
  expiratory completion, auto-PEEP risk, measured RR, Pplat, and DeltaP.

Important guardrail:

- A learner should not need Teaching Mode to start observing.
- Teaching Mode should clarify the mechanism, not replace waveform reading.

## Relationship to alarms

Alarms should be part of the teaching ecology, not the answer key.

Good alarm use in cases:

- as attention cues that something matters
- as noise when an alarm is real but nonspecific
- as reinforcement that a physiologic problem has crossed a safety threshold
- as a prompt to distinguish cause from alarm label

Poor alarm use in cases:

- treating the alarm banner as the diagnosis
- designing every case so that an alarm must fire
- scoring learners only on alarm acknowledgment

Example:

- "High pressure" is a useful cue.
- It is not enough to decide between resistance and compliance without further
  waveform interpretation and, when appropriate, inspiratory hold.

## Relationship to future assessment and scoring

Future scoring should evaluate reasoning, not just final settings.

Recommended scoring domains:

- Recognition: Did the learner notice the key signal?
- Interpretation: Did they correctly explain the mechanism?
- Prioritization: Did they choose a sensible first action?
- Verification: Did they re-check the expected response after acting?
- Efficiency: Did they avoid unnecessary or harmful changes?

Scoring should stay optional. The simulator's teaching value remains high even
without formal assessment if feedback and debrief are strong.

## Suggested implementation phases

### Phase 0: Manual case cards only

Goal:

- Use the current MVP exactly as it is.

Experience:

- A Markdown case card tells the instructor or learner how to set up the case,
  what to look for, and what to discuss.

What this phase uses:

- existing ventilator controls
- existing patient presets and manual mechanics
- current Teaching Mode
- current alarms

What this phase avoids:

- no simulator code changes
- no scenario engine
- no scoring logic

Best use:

- SME review
- classroom facilitation
- rapid case iteration before product decisions harden

### Phase 1: Case presets with setup instructions

Goal:

- Reduce setup friction while keeping cases mostly manual.

Experience:

- The user chooses a case from a library and receives a prepared starting state
  plus setup notes and task instructions.

What this phase adds:

- a case library
- case start/reset
- prefilled settings and mechanics
- visible case instructions

What remains manual:

- instructor prompts
- learner interpretation
- debrief

Guardrail:

- A preset load should start a case, not finish it.

### Phase 2: Guided cases with prompts and expected observations

Goal:

- Add scaffolded learning without full interactivity.

Experience:

- The case presents prompts such as "What waveform signal matters most?" and
  reveals hints or expected observations in sequence.

What this phase adds:

- progressive hints
- staged observation prompts
- optional reveal of expected interpretation
- independent learner guidance without full scoring

Good first targets:

- waveform anatomy baseline
- COPD air trapping
- ARDS lung protection

### Phase 3: Interactive cases with decision points and feedback

Goal:

- Make the simulator respond as a structured scenario experience.

Experience:

- The learner reaches checkpoints, makes a decision, and gets immediate
  feedback tied to that choice.

What this phase adds:

- explicit learner actions and branching
- success/fail feedback messages
- timed or state-based case progression
- optional scenario events such as worsening compliance or changing effort

Best educational value:

- cases where the learner must distinguish similar-looking problems
- cases where re-checking after intervention matters

### Phase 4: Assessment mode with scoring and debrief summary

Goal:

- Support independent evaluation, remediation, and repeatable practice.

Experience:

- The learner completes a case, sees score components, and receives a debrief
  summary of key signals, decisions, and missed opportunities.

What this phase adds:

- optional scoring
- decision logging
- debrief summary
- case completion records
- calibrated challenge levels

Guardrail:

- scoring should not flatten teaching into "guess the slider values"

## Recommended product guardrails

- Keep the case layer separate from the physics engine.
- Reuse the existing screen and metrics before adding scenario-only UI.
- Preserve manual free-play alongside cases.
- Prefer one strong teaching concept per case over overloaded scenarios.
- Treat signal/noise design as deliberate authorship, not accidental clutter.
- Keep debrief value as important as the correct intervention.

## Current MVP fit

Cases that can already run manually today with the current MVP:

- Case 1: Normal VC-CMV baseline
- Case 2: COPD air trapping
- Case 3: ARDS lung protection
- Case 5: Patient effort in VC-CMV
- Case 6: PC-CSV apnea / no effort
- Case 7: Trigger sensitivity and failed triggering

Cases that are partially runnable today but work best with future scenario
support:

- Case 4: PC-CMV compliance change
- Case 8: High pressure alarm differential

Future functionality that will improve the full case vision:

- case library and start/reset workflow
- progressive hints
- immediate answer-specific feedback
- time- or state-triggered case progression
- branching decision points
- optional scoring and debrief summary

## Summary

The long-term goal is not to bolt a quiz onto the simulator. The goal is to
wrap the simulator's current physiologic strengths in an instructional layer
that helps learners see, think, act, and reflect more like they would during
real ventilator management.
