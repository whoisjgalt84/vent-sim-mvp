# SME Feedback Log — MVP Ventilator Simulator

Purpose: turn a trickle of SME feedback into visible patterns. Every piece of
reviewer feedback gets one row in the Intake ledger; recurring themes get tracked
separately so convergence becomes obvious. This log is for triage and
prioritization — it is not a commitment to build everything in it.

## How to use this log
1. When feedback arrives, add a row to the **Intake ledger** with the next
   SME-### id. Capture it even if details are incomplete — mark status `new` and
   note "awaiting detail."
2. Pick a **bucket** and a **severity**. If it doesn't sort cleanly, use the
   `Needs-investigation` bucket rather than forcing it.
3. When two or more reviewers raise the same thing, add or update a row in the
   **Theme tracker** and link the item ids. Patterns — not single opinions —
   drive what we fix.
4. Update **status** as items move: new → investigating → confirmed → planned →
   done (or wont-fix).
5. Fix order, per project policy: blockers and clear bugs first, then
   physiology/waveform concerns, then usability, then feature requests.

## Conventions

### Buckets
- **Bug** — broken or incorrect behavior the app shouldn't do.
- **Physiology** — waveform / mechanics / monitored-value concerns about clinical correctness.
- **Usability** — navigation, layout, labels, controls, discoverability.
- **Feature** — requests for new capability or future ideas.
- **Needs-investigation** — doesn't sort cleanly yet; could be bug vs. correct physiology, or detail still pending.

### Severity
- **blocker** — prevents teaching use or actively misleads learners.
- **should-fix** — meaningful problem; fix before a learner pilot.
- **nice-to-have** — polish or enhancement; safe to defer.

### Status
`new` · `investigating` · `confirmed` · `planned` · `done` · `wont-fix`

### Implicated layer (danger map)
Where the change would likely live, so we can gauge review risk early:
`lung-model.js` (high) · `ventilator.js` (high) · `simulation.js` (very high) ·
`waveforms.js` (medium) · `main.js` (med-high) · `alarms.js` · `style.css`
(low-med) · `test-engine.js` (high importance) · `docs` · `unknown`

## Intake ledger

| ID | Logged | Reviewer (role) | Bucket | Severity | Status | Summary | Implicated layer | Reproduction / detail |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SME-001 | 2026-05-30 | Christian (self, RT) | Needs-investigation | should-fix | confirmed | Missed patient triggers when patient rate set above ~22/min, in VC-CMV and PC-CMV | simulation.js / ventilator.js (trigger logic) | Set patient effort on, raise patient RR above ~22; some efforts fail to trigger. Adjudicate bug vs. realistic ineffective triggering against Mireles-Cabodevila PVI papers before any fix. CORROBORATED by SME-004 (Scott Mahoney) independently. Mechanism located: js/simulation.js:352 phase-gated trigger latch; efforts whose neural onset lands during machine INSPIRATION/HOLD are silently dropped. Read-only recon complete; awaiting parametric sweep to pin the cliff. |
| SME-002 | 2026-05-30 | TBD | Usability | should-fix | confirmed | Patient-effort sliders (Pmus/T-neural) run off-screen out of sidebar; units hidden unless hovered | style.css / main.js | Reported by Denis C and Scott Mahoney. Pmus/T-neural sliders extend past the sidebar edge; units only visible on hover. See also SME-010 (slider precision). |
| SME-003 | 2026-05-30 | TBD | Needs-investigation | should-fix | done | Audible alarm not heard when alarms trip (may be user error / missing arm gesture) | alarm-audio.js / main.js | Reported by Rebecca Downs and Karen/Sarah; John C. Frostad noted a no-sound environment. Visual alarm fires but no audible tone. Diagnose user-error / missing arm-gesture vs. real defect before confirming. See SME-007. RESOLVED (real defect, not user error): volume raised + urgency-tiered tones added (PR #12, commit 4ea15c1/eea373d); time-base phantom silence fixed (commit 078975c, SME-008). See "Audible alarm not heard" theme. |
| SME-004 | 2026-06-11 | Scott Mahoney (RT, Dir. Clinical Ed, 20+ yr) | Bug | blocker | confirmed | Trouble capturing patient effort in PC-CMV and VC-CMV; trying to make patient overbreathe set rate produced severe dyssynchrony he did not expect | simulation.js (trigger logic) | Independent corroboration of SME-001. Same root cause suspected. Exact I:E/hold not recorded. |
| SME-005 | 2026-06-11 | Andrea Ritz (RN, 11+ yr) | Bug | blocker | confirmed | PC-CSV with patient RR set to 35: apnea alarm fired AND monitor displayed RR as 6 instead of ~35 | simulation.js / main.js (measured RR in spontaneous mode) | Likely related to trigger-drop bug since PC-CSV breaths are all patient-triggered. Reviewer expected measured RR near 35 and no apnea. |
| SME-006 | 2026-06-11 | Karen LaRoche & Sarah Malyon (Clinical Specialists, RT, 30+/15+) | Bug | blocker | confirmed | Measured rate did not match patient rate in spontaneous mode | simulation.js / main.js (measured RR) | Second report of the measured-RR-in-spontaneous-mode defect (with SME-005). Screenshot in email. |
| SME-007 | 2026-06-11 | Rebecca Downs (RN, Sim Educator, 16 yr) | Bug | blocker | done | Triggered high-pressure alarm visually but no audible alarm | alarm-audio.js / main.js | Corroborates SME-003. Reviewer flagged possible user error. Diagnose before confirming. RESOLVED (real defect, not user error): volume raised + urgency-tiered tones added (PR #12, commit 4ea15c1/eea373d); time-base phantom silence fixed (commit 078975c, SME-008). See "Audible alarm not heard" theme. |
| SME-008 | 2026-06-11 | Scott Mahoney (RT, Dir. Clinical Ed) | Bug | should-fix | confirmed-fixed | Switching modes occasionally auto-silenced alarms for ~400-1300 s; reproduced in Chrome and Firefox | main.js / alarms.js | Possible learner-mislead (could mask apnea during a demo). Wide random-seeming range suggests a units/variable error. Hard to reproduce reliably. RESOLVED: Root cause was alarm-audio timers on sim-time; sim.reset() (mode/flow switch) stranded them. Fixed by moving getAlarmNowSec() to wall-clock (performance.now()). Confirmed live by Christian (mode switch no longer strands the silence timer); not covered by npm test (browser audio). Commit 078975c. |
| SME-009 | 2026-06-11 | Denis C (CHSOS) | Bug | should-fix | confirmed | Inspiratory hold in PC-CSV will not release after activation; VC-CMV and PC-CMV release correctly | simulation.js / main.js (hold logic, PC-CSV path) | Mode-specific, cleanly reproducible. |
| SME-010 | 2026-06-11 | Denis C (CHSOS) + Scott Mahoney | Usability | should-fix | confirmed | Trigger pressure slider too short/coarse (jumps 0.5 to 5.0, little precision); especially small in PC-CSV | main.js / style.css | Two reporters. |
| SME-011 | 2026-06-11 | Joel (RT educator) | Usability | nice-to-have | new | Set vs. measured parameters are intermixed; should be grouped like a real vent screen (set together, measured together) | main.js / style.css | Greg touched on this too. |
| SME-012 | 2026-06-11 | Scott Mahoney | Usability | nice-to-have | new | Loops only display when Teaching Mode is OFF; wants loops available regardless | main.js |  |
| SME-013 | 2026-06-11 | Greg Carter (Program Dir, 30+ yr) + Scott Mahoney | Usability | nice-to-have | new | Want ventilator mode shown alongside measured values in Teaching Mode (for a vent/patient system check view) | main.js | Two reporters. |
| SME-014 | 2026-06-11 | Scott Mahoney | Usability | nice-to-have | new | Peak-pressure number scaling is visually distracting (draws the eye) | main.js / style.css |  |
| SME-015 | 2026-06-11 | Greg, Scott, Karen & Sarah, Joel (4 senior RTs) | Feature | should-fix | new | Want I-time and/or flow as a settable variable instead of (or alongside) I:E ratio; I:E-only is uncommon on modern vents and limits synchrony/intrinsic-PEEP teaching | ventilator.js / main.js | DEFERRED to feature-review pass. Logged now because 4 independent senior-RT reports is itself the finding. |
| SME-016 | 2026-06-11 | Engine investigation (Vesper + parametric sweep) | Physiology | should-fix | new | Failed/ineffective patient efforts are dropped SILENTLY — no waveform marker, no counter — in both the phase-gate case (VC/PC-CMV overbreathing) and the trigger-insensitivity case (PC-CSV). Mireles-Cabodevila taxonomy treats ineffective triggering as a VISIBLE, diagnosable event. | simulation.js / waveforms.js / main.js | Unifying fix candidate for the trigger themes: render failed triggers as visible ineffective efforts (Pmus present, no Pvent). Addresses SME-001/004 (make drops honest+visible) and the SME-005/006 UX gap (show efforts failing the threshold). Design decision pending: (a) correct the phase-gate so drops occur only for physiological timing/threshold reasons, AND (b) surface failed triggers visually. Validate any fix across the full patientRR x I:E x hold space, not one operating point. |
| SME-017 | 2026-06-16 | Christian (self, RT) | Bug | blocker | confirmed-fixed | Switching VC→PC spuriously fires an APNEA alarm on a non-apneic patient (backup rate 14, measured RR 14). Reproduced with the LOW-VE alarm on VC→PC switch too. The high-pressure alarm CLEARING on the switch is correct physiology (PC defaults PIP 20, below threshold) — the false apnea/low-VE firing is NOT. | alarms.js / simulation.js / main.js (alarm evaluation + sim.reset timing) | FIXED — root cause was a regression from the time-base PR (#13): getAlarmNowSec moved to wall-clock for the audio policy, but alarm EVALUATION differences nowSec against sim-time lastBreathStartSec, so wall−sim read as false apnea (and false low-VE via the stabilization grace not re-arming on reset). Fix: decoupled the two clocks in main.js — evaluation now uses sim.globalTime, audio keeps getAlarmNowSec() wall-clock. Confirmed live by Christian: VC→PC switch no longer fires false apnea, and SME-008 audio silence still holds across mode switch. Commit 921a469 (branch fix/alarm-eval-timebase). |
| SME-018 | 2026-06-16 | Christian (self, RT) | Usability | should-fix | new | No way to CANCEL an active alarm silence — once Silence is pressed, user must wait the full 120 s for it to expire; no un-silence/reset control. | main.js (silence control) | Add a toggle/reset so Silence can be cleared on demand. |
| SME-019 | 2026-06-16 | Christian (self, RT) | Usability | should-fix | new | Medium/low-urgency alarm is still too quiet and its repeat cadence too slow to draw attention. | main.js (medium volume) / alarm-audio.js (mediumRepeatSec) | Tuning: raise medium volume; shorten mediumRepeatSec (~30s→~12s). Couples with the deferred repeat-interval retune + TEST 52 update. High-priority alarm tuning is fine as-is per live testing. |
| SME-020 | 2026-06-16 | Christian (self, RT) | Bug | nice-to-have | new | Residual minor LOW-VE flicker: brief VE=0 blips at the stabilization-grace boundary and at VE-recompute gaps just after a mode switch (seen even on the correct sim-time base). Distinct from SME-017 (the false-apnea blocker, fixed) — this is a small pre-existing transient, deliberately scoped out of the SME-017 fix. | main.js (low-VE evaluation) / alarms.js (stabilization grace) | Polish: gate low-VE on "≥1 completed breath since reset" rather than a bare time threshold, so the grace can't expose a momentary VE=0. Low priority. |

## Theme tracker (patterns across reviewers)

| Theme | Reports | Bucket | Severity | Status | Linked IDs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Missed triggers at high patient rate | 2 | Needs-investigation | should-fix | confirmed | SME-001, SME-004 | Confirmed by two independent reviewers. Mechanism located (simulation.js:352). Next: read-only parametric sweep, then fix-design decision. SWEEP COMPLETE (scratch harness vs real engine). Cliff is NOT fixed-rate — it slides with machine inspiratory dead-window: I:E 1:2 no-hold cliff ~RR 30; I:E 1:1 cliff ~RR 22; hold 0.5s cliff ~RR 24; PC-CMV ~RR 30. Reconciles SME-001's '~22' as an I:E 1:1 / hold condition (default settings would not show it until ~30). Mechanism = line-352 phase-gate; above cliff, dropped efforts are silent (no failed-trigger marker). |
| Measured RR wrong in spontaneous mode | 2 | Bug | blocker (reclassifying) | investigating | SME-005, SME-006 | Sweep did NOT reproduce SME-005 via the line-352 phase gate — PC-CSV tracks set rate under default effort. The single-digit-RR + apnea profile IS reproduced by TRIGGER INSENSITIVITY vs effort (weak Pmus or stiff Ptrig): e.g. Ptrig 5.0 at set-35 -> measRR 0 + apnea. Likely CORRECT physiology lacking a visible cue, not a measured-RR calculation bug. Separate root cause from SME-001/004. Capture reviewers' actual trigger type/sensitivity + effort settings (not recorded). |
| Audible alarm not heard | 3 | Bug | blocker | done | SME-003, SME-007 (+ John C. Frostad noted no-sound environment) | RESOLVED. Volume raised (PR #12, commit 4ea15c1/eea373d) and urgency-tiered tones added (square triplet high / sine 2-note chime medium); time-base phantom silence fixed (PR fix/alarm-timebase, commit 078975c — resolves SME-008). Status: audible + tiered + reliable. Remaining: medium-alarm tuning (see new row). |
| Effort/trigger sliders off-screen or too coarse | 2 | Usability | should-fix | confirmed | SME-002, SME-010 |  |
| I-time / flow control instead of I:E | 4 | Feature | should-fix | new | SME-015 | Four senior RTs; revisit in feature pass. |
| Alarm bugs surfaced in deep testing | 1 (self, deep testing) | Bug+Usability | mixed | mixed (17 confirmed-fixed; 18-20 new) | SME-017, SME-018, SME-019, SME-020 | Found while stress-testing the alarm subsystem. SME-017 false apnea/low-VE blocker FIXED (commit 921a469). Residual: SME-020 minor low-VE flicker (nice-to-have), plus SME-018 silence-reset and SME-019 medium-alarm tuning (usability). |

## Reading the log (current priorities)
- Trigger sweep complete (scratch harness vs real engine). The trigger blocker
  (SME-001/004) is confirmed: a sliding cliff (slides with machine inspiratory
  dead-window, ~RR 22 at I:E 1:1 up to ~RR 30 at default I:E 1:2) plus a
  silent-drop defect (no failed-trigger marker).
- The measured-RR theme (SME-005/006) is reclassifying from blocker-bug toward
  correct-physiology-needing-a-visible-cue: PC-CSV tracks set rate under default
  effort, and the single-digit-RR + apnea profile comes from trigger
  insensitivity vs effort, not a measured-RR calculation bug.
- Both point to one unifying fix (SME-016): render ineffective efforts visibly
  (Pmus present, no Pvent).
- Audible alarm (SME-003/007) is RESOLVED: volume, urgency-tiering, and the
  time-base phantom-silence fix shipped (PRs #12, #13). What remains in the alarm
  area is the round-2 cluster — the false-apnea-on-mode-switch blocker (SME-017,
  needs investigation) plus silence-reset (SME-018) and medium-alarm tuning
  (SME-019).

Last updated: 2026-06-16.
