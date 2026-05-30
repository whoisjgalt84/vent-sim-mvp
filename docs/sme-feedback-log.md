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
| SME-001 | 2026-05-30 | TBD | Needs-investigation | should-fix | investigating | Missed patient triggers when patient rate set above ~22/min, in VC-CMV and PC-CMV | simulation.js / ventilator.js (trigger logic) | Set patient effort on, raise patient RR above ~22; some efforts fail to trigger. Adjudicate bug vs. realistic ineffective triggering against Mireles-Cabodevila PVI papers before any fix. |
| SME-002 | 2026-05-30 | TBD | Usability | should-fix | new | Multiple UI notes (specifics pending) | main.js / style.css (TBD) | Awaiting detail — split each specific UI note into its own row when received. |
| SME-003 | 2026-05-30 | TBD | Needs-investigation | should-fix | new | Alarm concern (specifics pending) | alarms.js / main.js (TBD) | Awaiting detail — clarify whether alarm fired incorrectly (Bug) or alarm behavior was annoying/unclear (Usability). |

## Theme tracker (patterns across reviewers)

| Theme | Reports | Bucket | Severity | Status | Linked IDs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Missed triggers at high patient rate | 1 | Needs-investigation | should-fix | investigating | SME-001 | Leading candidate for the first real engine investigation. Watch for corroboration from other reviewers before opening trigger logic (very-high-danger file). |

## Reading the log (current priorities)
- No blockers logged yet.
- The trigger item (SME-001) is the strongest single signal so far, but it's one
  report. Hold for a pattern before touching `simulation.js`; when we
  investigate, it's read-only first.
- UI and alarm items are awaiting specifics — chase the detail so they can be
  sorted and clustered.

Last updated: 2026-05-30.
