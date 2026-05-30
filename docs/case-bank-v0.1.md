# Case Bank v0.1

## Purpose

This starter bank is designed for the current MVP and the future case system
vision. It focuses on recognizable waveform patterns, management reasoning,
immediate reinforcement, and debrief value.

## Manual viability summary

| Case | Manual today in current MVP | Best early phase | Notes |
| --- | --- | --- | --- |
| 1. Normal VC-CMV baseline | Yes | Phase 0 | Strong orientation case |
| 2. COPD air trapping | Yes | Phase 0 | Teaching Mode helps reveal mechanism |
| 3. ARDS lung protection | Yes | Phase 0 | Uses inspiratory hold well |
| 4. PC-CMV compliance change | Partial | Phase 1 | Best with manual or automated change in mechanics |
| 5. Patient effort in VC-CMV | Yes | Phase 0 | Good for synchrony reasoning |
| 6. PC-CSV apnea / no effort | Yes | Phase 0 | Current alarms already support it |
| 7. Trigger sensitivity and failed triggering | Yes | Phase 0 | Good recognition and adjustment case |
| 8. High pressure alarm differential | Partial | Phase 1 | Best as a two-scene compare case |

## Case 1: Normal VC-CMV baseline

- Manual today in MVP: Yes
- Best roadmap phase: Phase 0
- Teaching Mode use: Off first, then optional
- Expected alarms: None

Short narrative:
An uncomplicated intubated adult is receiving routine VC-CMV. The learner's
job is to build a mental baseline for normal waveform anatomy and normal
monitored values before abnormal cases are introduced.

Setup:
- Mode VC-CMV, square flow
- VT 500 mL, RR 14, I:E 1:2, PEEP 5, FiO2 40%
- Normal lung preset
- Passive patient, no inspiratory hold at first

Primary signals:
- square inspiratory flow
- smooth pressure rise with modest PIP
- normal-looking volume return and expiratory flow return to baseline
- no alarms, stable measured RR

Distractors/noise:
- many numbers on screen may tempt the learner to memorize instead of observe
- absence of alarms may make the case feel "too easy"

What the learner should see:
- the basic shape and timing relationship of pressure, volume, and flow in a
  passive VC breath
- a stable reference for later comparison

What the learner might incorrectly conclude:
- "There is nothing to learn because everything is normal."
- "PIP alone is enough to describe the breath."

Key teaching point:
Normal cases calibrate the eye. Learners need a clean baseline before they can
recognize scalloping, air trapping, or abnormal pressure relationships.

Suggested intervention:
- No therapeutic change required
- Ask the learner to label waveform phases and name what each panel reveals

Feedback message:
"This is the reference pattern. If the learner can name flow, pressure, and
timing anatomy here, later abnormalities become easier to recognize."

Instructor notes:
- After initial observation, optionally use Teaching Mode to connect the normal
  waveform to normal measured RR, PIP, Pplat, and flow baseline.

Independent learner hints:
- Start with the flow waveform to identify inspiration and expiration.
- Then ask what pressure is telling you about the same breath.

Instructor debrief prompts:
- Which waveform panel did you read first, and why?
- What makes this breath look passive?
- Which numbers would you track over time if the patient changed?

Future simulator features needed:
- progressive waveform anatomy labeling
- optional guided "name the signal" prompts

## Case 2: COPD air trapping

- Manual today in MVP: Yes
- Best roadmap phase: Phase 0
- Teaching Mode use: Off first, then On for reveal
- Expected alarms: None required, though alarm thresholds can be adjusted for emphasis

Short narrative:
An intubated COPD patient is receiving VC-CMV with not enough time to exhale.
The learner must recognize air trapping from the flow waveform, not from a
generic disease label alone.

Setup:
- Mode VC-CMV, square flow
- VT 450 mL, RR 20, I:E 1:2, PEEP 5, FiO2 40%
- COPD preset
- Passive patient

Primary signals:
- expiratory flow does not return to baseline before the next breath
- Teaching Mode shows incomplete expiratory completion
- auto-PEEP / total PEEP trend upward

Distractors/noise:
- VT is still being delivered, which may falsely reassure the learner
- pressure may be only moderately elevated
- learner may focus on the RR number instead of Te/tau

What the learner should see:
- a classic incomplete exhalation pattern
- evidence that the problem is expiratory timing in a high-resistance patient

What the learner might incorrectly conclude:
- "Ventilation is fine because VT looks normal."
- "Increase RR to blow off more CO2."
- "This is only a pressure problem."

Key teaching point:
The signature of air trapping is persistent expiratory flow, not merely a COPD
label. In high resistance states, Te/tau matters.

Suggested intervention:
- reduce RR and/or lengthen I:E to increase expiratory time
- re-check whether expiratory flow gets closer to baseline afterward

Feedback message:
"Correct if the learner links persistent expiratory flow to incomplete lung
emptying and chooses a change that increases Te."

Instructor notes:
- Let the learner commit before turning Teaching Mode on.
- Use flow baseline and expiratory completion as the mechanism reveal.

Independent learner hints:
- Read the flow waveform first.
- Ask whether exhalation finishes before the next inspiration begins.

Instructor debrief prompts:
- Which signal told you this was trapping instead of a normal expiration?
- Why does COPD make Te/tau so important?
- Which settings changes would worsen this pattern?

Future simulator features needed:
- built-in before/after compare after RR or I:E change
- guided prompt sequence for Te/tau reasoning

## Case 3: ARDS lung protection

- Manual today in MVP: Yes
- Best roadmap phase: Phase 0
- Teaching Mode use: Optional
- Expected alarms: High pressure may occur depending on thresholds

Short narrative:
An ARDS patient is being ventilated with a tidal volume that is too generous
for a stiff lung. The learner must use plateau and driving pressure reasoning,
not just look at peak pressure.

Setup:
- Mode VC-CMV, square flow
- VT 500 mL, RR 24, I:E 1:2, PEEP 12, FiO2 60%
- Severe ARDS preset
- Passive patient
- Inspiratory hold available for plateau check

Primary signals:
- low compliance pattern with high plateau pressure
- elevated driving pressure
- relatively small gap between PIP and Pplat compared with a resistance problem

Distractors/noise:
- FiO2 and PEEP may pull attention toward oxygenation instead of mechanics
- learner may focus only on PIP and ignore plateau

What the learner should see:
- a stiff lung in which the delivered VT creates an unsafe pressure burden
- inspiratory hold helps show that the issue is compliance-driven

What the learner might incorrectly conclude:
- "Peak pressure is the only pressure that matters."
- "Increase pressure support or VT because the lungs are stiff."
- "Compliance is bad, so there is nothing to change on the ventilator."

Key teaching point:
Lung-protective ventilation depends on plateau and driving pressure reasoning,
not only on nominal VT or alarm status.

Suggested intervention:
- reduce VT toward a lung-protective target
- accept the need to re-balance RR rather than forcing the same VT
- re-check Pplat and DeltaP after the change

Feedback message:
"Correct if the learner identifies low compliance, uses plateau pressure to
frame risk, and lowers the stretch burden rather than escalating it."

Instructor notes:
- This case works well with inspiratory hold to separate peak from plateau.
- The most useful debrief is often about why the learner chose the number they
  chose, not only whether they turned VT down.

Independent learner hints:
- Use inspiratory hold if you want to know whether the problem is resistive or
  elastic.
- Ask which pressure best reflects alveolar stretch.

Instructor debrief prompts:
- Why is Pplat more informative than PIP here?
- What does DeltaP add beyond Pplat alone?
- What would improvement look like after lowering VT?

Future simulator features needed:
- automated capture of pre- and post-intervention pressures
- optional scoring for protective strategy choices

## Case 4: PC-CMV compliance change

- Manual today in MVP: Partial
- Best roadmap phase: Phase 1
- Teaching Mode use: Optional
- Expected alarms: Low VE may occur if VT falls enough

Short narrative:
A patient on PC-CMV initially looks stable, then compliance worsens. The
learner must recognize that the pressure waveform can look unchanged while VT
and VE fall.

Setup:
- Mode PC-CMV
- Pinsp 15 above PEEP, RR 14, I:E 1:2, PEEP 5, FiO2 40%
- Start with Normal lung preset
- Then manually change to ARDS severe while keeping vent settings the same

Primary signals:
- pressure waveform remains pressure-targeted and visually similar
- delivered VT falls as compliance worsens
- VE falls unless compensated

Distractors/noise:
- a stable pressure waveform may falsely reassure the learner
- alarm status may lag the underlying mechanical change

What the learner should see:
- same set pressure does not guarantee the same delivered volume
- in PC modes, the patient partly determines the VT

What the learner might incorrectly conclude:
- "The mode looks stable, so ventilation must be stable."
- "If pressure is unchanged, the patient's mechanics are unchanged."

Key teaching point:
In PC-CMV, VT is patient-dependent. Worsening compliance can quietly reduce
ventilation even when the pressure waveform still looks tidy.

Suggested intervention:
- monitor VT and VE explicitly
- increase support cautiously or reconsider mode/settings while protecting the
  lung
- verify the effect by re-checking delivered VT

Feedback message:
"Correct if the learner notices that unchanged pressure hides falling volume and
responds by checking VT rather than trusting the pressure waveform alone."

Instructor notes:
- This is best run as a compare case: before compliance change and after.
- Today, the change can be done manually by the instructor or learner.

Independent learner hints:
- In pressure control, ask what variable the ventilator controls and what
  variable the patient mechanics determine.

Instructor debrief prompts:
- Why can a pressure-targeted breath look stable while ventilation worsens?
- Which monitored value should you watch most closely after a compliance drop?
- How would this differ from the same compliance change in VC-CMV?

Future simulator features needed:
- automated mid-case compliance deterioration
- decision point and feedback after the learner responds

## Case 5: Patient effort in VC-CMV

- Manual today in MVP: Yes
- Best roadmap phase: Phase 0
- Teaching Mode use: Off first, then optional
- Expected alarms: High RR may occur if threshold is set low enough

Short narrative:
An apparently straightforward VC-CMV patient begins making spontaneous efforts.
The learner must recognize pressure scalloping and understand that actual RR
can exceed the set RR when the patient triggers breaths.

Setup:
- Mode VC-CMV, square flow
- VT 500 mL, RR 12, I:E 1:2, PEEP 5, FiO2 40%
- Normal lung preset
- Patient effort On: effort 6 to 8 cmH2O, neural Ti about 1.0 s, patient RR 20
- Trigger set easy enough to allow patient-triggered breaths

Primary signals:
- pressure scalloping during inspiration
- actual/measured RR exceeds set RR
- patient-triggered breaths appear

Distractors/noise:
- lower inspiratory pressure may look falsely "better"
- learner may think the ventilator changed rather than the patient

What the learner should see:
- patient effort unloading the pressure waveform in VC
- the patient contributing work and triggering extra breaths

What the learner might incorrectly conclude:
- "Lower pressure means compliance improved."
- "The set RR should equal the actual RR."
- "Nothing important is happening because VT is still delivered."

Key teaching point:
In VC, patient effort can create scalloped pressure without changing the
delivered flow target. The patient may be doing work the ventilator used to do.

Suggested intervention:
- identify the breath as patient-interactive rather than purely passive
- if the teaching goal is synchrony, consider reducing trigger burden or moving
  toward a mode better matched to spontaneous effort

Feedback message:
"Correct if the learner identifies scalloping as patient effort, not improved
compliance, and recognizes why actual RR can exceed set RR."

Instructor notes:
- This is a good calibration case for the phrase "the patient is doing work."
- Avoid turning it into a sedation discussion unless that is the explicit goal.

Independent learner hints:
- Compare pressure behavior with the normal VC baseline case.
- Ask why RR actual might diverge from RR set.

Instructor debrief prompts:
- What part of the waveform made you think the patient was active?
- Why does VC show the effort mainly on pressure?
- What risks come from missing this clue?

Future simulator features needed:
- guided compare against passive VC baseline
- optional feedback tied to synchrony reasoning

## Case 6: PC-CSV apnea / no effort

- Manual today in MVP: Yes
- Best roadmap phase: Phase 0
- Teaching Mode use: Optional
- Expected alarms: Apnea, then Low VE

Short narrative:
The patient is placed in a spontaneous pressure-support style mode but stops
making effective efforts. The learner must recognize that pressure support does
not create breaths by itself.

Setup:
- Mode PC-CSV
- Pressure support 10 above PEEP, cycle threshold 25%
- PEEP 5, FiO2 40%
- Normal lung preset
- No patient effort, patient RR 0 / passive
- Default alarm thresholds

Primary signals:
- no effective breaths occur
- measured RR stays at 0
- minute ventilation stays at 0
- apnea alarm then low VE alarm activate

Distractors/noise:
- a support pressure is set, which may falsely imply guaranteed ventilation
- the screen may look "quiet" rather than dramatic at first

What the learner should see:
- spontaneous mode dependence on patient effort
- alarms that reflect absent ventilation rather than obstructed ventilation

What the learner might incorrectly conclude:
- "The ventilator should still deliver supported breaths because pressure is
  set."
- "Apnea means trigger sensitivity is the main problem."

Key teaching point:
Without patient effort, this spontaneous mode does not ventilate. Support
pressure is not the same thing as backup mandatory ventilation.

Suggested intervention:
- recognize mode dependence on spontaneous effort
- switch to a mandatory mode or restore a backup ventilation strategy

Feedback message:
"Correct if the learner understands that pressure support without effort gives
no ventilation here and responds by restoring mandatory support."

Instructor notes:
- This case is strong because the alarm sequence is meaningful without being the
  diagnosis by itself.
- It is also a good contrast case for weaning-mode discussions.

Independent learner hints:
- Ask whether this mode has a machine backup breath in the current MVP.
- Watch measured RR and VE, not only airway pressure.

Instructor debrief prompts:
- Why did the support setting not save the patient here?
- Which alarm fired first, and why?
- What is the minimum safe response in the current simulator?

Future simulator features needed:
- explicit apnea countdown display
- optional backup ventilation branch for advanced cases

## Case 7: Trigger sensitivity and failed triggering

- Manual today in MVP: Yes
- Best roadmap phase: Phase 0
- Teaching Mode use: Optional
- Expected alarms: None required

Short narrative:
The patient is trying to breathe, but the ventilator is not sensing the effort
because the trigger is set too insensitive. The learner must separate "no extra
breaths" from "no patient effort."

Setup:
- Mode VC-CMV, square flow
- VT 500 mL, RR 6, I:E 1:2, PEEP 5, FiO2 40%
- Normal lung preset
- Weak patient effort On: effort about 0.5 to 1 cmH2O, neural Ti about 1.0 s,
  patient RR 20
- Trigger set intentionally insensitive, for example flow trigger 5.0 L/min or
  pressure trigger 2.0 cmH2O

Primary signals:
- visible effort-related deflection before some breaths
- machine backup breaths continue
- actual RR stays closer to the machine rate than the patient rate
- patient effort is present but not rewarded with triggering

Distractors/noise:
- absence of extra breaths may tempt the learner to assume the patient is
  passive
- the waveform deflections may be subtle

What the learner should see:
- the patient is trying, but the ventilator is not responding appropriately
- the problem is trigger sensitivity, not lack of effort alone

What the learner might incorrectly conclude:
- "No triggered breaths means no effort."
- "Increase RR instead of fixing the trigger."
- "The patient needs more volume, not a more sensitive trigger."

Key teaching point:
Patient effort can be present without successful triggering. Trigger settings
change whether the ventilator recognizes that effort.

Suggested intervention:
- make the trigger more sensitive
- then verify that patient-triggered breaths appear and actual RR rises toward
  the patient rate

Feedback message:
"Correct if the learner identifies failed triggering and fixes the trigger
threshold rather than only changing mandatory settings."

Instructor notes:
- This case pairs well with Case 5 because both involve effort, but only one
  shows effective patient triggering.

Independent learner hints:
- Look for small pre-trigger deflections.
- Ask whether the patient's effort is strong enough to cross the chosen
  threshold.

Instructor debrief prompts:
- What evidence showed that effort was present?
- Why did the ventilator fail to trigger?
- How would the waveform change after a successful adjustment?

Future simulator features needed:
- explicit failed-trigger annotations
- prompt that asks the learner to compare before and after trigger adjustment

## Case 8: High pressure alarm differential

- Manual today in MVP: Partial
- Best roadmap phase: Phase 1
- Teaching Mode use: Optional
- Expected alarms: High pressure

Short narrative:
The same alarm headline appears in two different physiologic situations. The
learner must distinguish a resistance-driven high PIP from a compliance-driven
high plateau.

Setup:
- Best taught as two linked scenes under one case
- Scene A resistance pattern:
  VC-CMV, VT 500 mL, RR 14, I:E 1:2, PEEP 5, asthma or COPD preset
- Scene B compliance pattern:
  VC-CMV, VT 500 mL, RR 14, I:E 1:2, PEEP 5, severe ARDS preset
- Lower the high pressure alarm threshold if needed so both scenes trip it
- Inspiratory hold available in both scenes

Primary signals:
- both scenes may trigger a high pressure alarm
- resistance scene shows higher PIP with less impressive Pplat rise
- compliance scene shows high Pplat and high DeltaP with a smaller PIP-Pplat gap

Distractors/noise:
- alarm label is the same in both scenes
- the learner may anchor on disease name instead of measured pressure pattern

What the learner should see:
- "high pressure" is a cue, not a diagnosis
- inspiratory hold and PIP/Pplat comparison separate resistance from compliance

What the learner might incorrectly conclude:
- "All high pressure alarms mean secretion or obstruction."
- "All high pressures should be handled the same way."

Key teaching point:
The pressure alarm is nonspecific. Management depends on whether the main issue
is resistive pressure or elastic pressure.

Suggested intervention:
- perform inspiratory hold
- compare PIP and Pplat
- if resistive, address airway resistance / flow timing logic
- if compliance-driven, reduce stretch burden and apply lung-protective thinking

Feedback message:
"Correct if the learner uses the pressure relationship, not the alarm banner
alone, to separate resistance from compliance."

Instructor notes:
- This is best framed as a differential diagnosis case, not a single-scene case.
- Today it works as a manual A/B comparison. Later it should become a guided
  branch case.

Independent learner hints:
- Which pressure best reflects alveolar stretch?
- What does a large PIP minus Pplat gap usually suggest?

Instructor debrief prompts:
- What additional clue beyond the alarm changed your interpretation?
- How did inspiratory hold help?
- Why would the first management move differ between the two scenes?

Future simulator features needed:
- case branching or side-by-side compare workflow
- answer-specific feedback for resistance vs compliance reasoning
- optional scoring on differential diagnosis accuracy
