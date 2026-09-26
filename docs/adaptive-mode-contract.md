# VSM-ADAPT-001: approved PC-CMVa contract

Owner: Christian Striggow. Consolidated 2026-09-22 from the approved Phase A recommendations and the Phase B queued-setting clarification. A1-A6 are approved; this document does not reopen them. It defines required behavior, not a claim that implementation or verification has passed.

PC-CMVa is a generic educational pressure-controlled continuous mandatory ventilation mode with adaptive targeting. It is conventional deterministic feedback control, not machine learning, autonomous clinical reasoning, clinical validation, or replication of a commercial ventilator. Numerical constants are educational engineering choices. Existing VSM-CLIN ticket identities and deferred decisions remain intact.

The current authorization covers bounded implementation, verification, independent review and isolated Linux visual candidates. Its endpoint is **OWNER_DECISION_REQUIRED — PC-CMVa VISUAL ACCEPTANCE**. Unseen PNGs are not accepted. Accepted-baseline installation, staging, commit, remote publication and deployment require their later applicable authorization.

## Authority and preserved evidence

The authoritative owner request is preserved at `scratch/shots-vsm-adapt-001-phase-b/owner-authorization.txt`. The consolidated evidence copy is `scratch/shots-vsm-adapt-001-phase-b/consolidated-contract.md`; the exact combined UI copy and section-level supersession map are `exact-copy.md` and `supersession-map.md` in the same directory.

The six reviewed Phase A documents and their evidence remain byte-preserved under `scratch/shots-vsm-adapt-001-phase-a/`. Their proposal-status language, prototype results and 2026-09-20 source review describe that earlier phase. The Phase B authorization supersedes approval prerequisites and the specific queued-transition ambiguities; it does not retrospectively alter Phase A findings or approve later images.

| Decision | Approved selection |
| --- | --- |
| A1 | Canonical unrounded modeled inspired VT at expiration-start publication; one decision per eligible source; bounded incremental error correction. No expired-volume claim or hidden model-state inputs. |
| A2 | Gain 0.01 cmH2O/mL; maximum change 2 cmH2O per eligible inspiration; inclusive ±10 mL deadband; initial command 10 cmH2O above set PEEP; no smoothing or hidden unconstrained accumulator. |
| A3 | Default command bounds 5-25 cmH2O above set PEEP; explicit maximum 20 for the limit demonstration. Bounds and tuning are validated setup-only configuration followed by reset. No added absolute-Paw cap or alarm-driven breath termination. |
| A4 | Separate adaptive eligibility epoch; target/PEEP queue at ordinary breath boundaries; other listed edits act immediately and invalidate mixed feedback; reset/mode transition initialize before prefill; adaptive HOLD excluded. The atomic transition rules below control queued settings. |
| A5 | Approved Phase A copy plus the authorized pending-transition help sentence; target, achieved VT, applied/next command, source context, bounds and availability remain distinct. Unsupported fixed-pressure predictions are unavailable. Target mismatch is teaching status, not a new alarm. |
| A6 | The approved 20-path implementation scope, up to four justified conditional paths, isolated Linux candidates, exact legacy preservation and required controller/integration/browser/mutation/independent-review gates. Owner visual acceptance is the next checkpoint. |

## Equation, units and information boundary

For one eligible completed inspiration `n`, `Vn` is its exact unrounded modeled inspired VT in mL and `Pn` is the adaptive pressure actually applied to that source breath, in cmH2O above its applied set PEEP:

```text
error_mL = sourceTargetVT_mL - Vn
increment_cmH2O = 0                                  if abs(error_mL) <= 10
increment_cmH2O = clip(0.01 * error_mL, -2, +2)        otherwise
pendingPressure_cmH2O = clip(Pn + increment_cmH2O, minimum, maximum)
```

Default target is 500 mL; initial pressure 10; minimum 5; maximum 25. The limit demonstration explicitly sets maximum 20. The existing target-control range, 200-800 mL, is operator-interface reuse, not a source-derived patient prescription. Use mL for the controller signal and L for `vent.tidalVolume`, with an explicit factor of 1000 at the boundary.

This is incremental correction from the actual applied command, not a memoryless pressure law. The applied command is the only accumulated control state. No hidden unconstrained pressure/error sum grows behind a bound. The inclusive deadband requests no change; there is no smoothing or pressure quantization in feedback. Do not clamp delivered VT or change prescribed effort to make a target attainable.

The pure controller accepts only declared operator target/bounds/tuning, applied-command metadata, simulated VT measurement, identity, validity and simulation-time metadata. It has no simulator/LungModel reference and no access to true R, C, Pmus, residual volume, future samples, analytical predictions, rounded display VT, RR or VE. No estimator is included. Physics/oracles/diagnostic traces may know model parameters; the controller may not. Invalidation conveys event/epoch metadata, not numerical patient parameters.

## Canonical feedback and eligibility

The feedback source is `sim.lastCompletedBreath.measuredVT_mL`, published once by `_startExpiration`. It is the unrounded net modeled volume gained since inspiration start, `(volumeAboveEq - volumeAtBreathStart) * 1000`. The record is finalized when expiration starts, after any hold; it does not represent completed exhalation, a physical circuit sensor or compensated expired VT. Adaptive HOLD is excluded, so the initial mode has no hold interval in this path.

Subscribe to the publication event. The retained presence of the same canonical record on a later tick/render is not a new measurement. No record means unavailable feedback, not zero. An explicitly valid finite measured zero is a real signal and can request at most +2 cmH2O for the following breath.

Adaptive validity is a separate envelope captured before current-breath context is cleared. Preserve the existing canonical measurement fields and old-mode semantics. A genuine completed delivery rejected for adaptation remains a delivery for Measured RR and Delivered VE under their existing rules.

| Metadata | Required meaning |
| --- | --- |
| Mode and existing identity | Exact new mode ID `pc-cmva`; current simulation/mode generations, settings generation and monotonically ordered breath ID. Preserve exact legacy IDs, including `PC-CSV`. |
| Adaptive epoch | Separate context revision advanced by relevant accepted operator edits, including effort edits and edit-then-revert. Equal final numbers do not rehabilitate a mixed breath. |
| Source time/sample | Finite ordered start/completion times and publication sample index in simulated time; current engine publication provenance, no future or replayed source. |
| Volume and validity | Exact canonical inspired mL; finite and nonnegative; full eligible inspiration; no mixed input epoch, invalid physics or excluded HOLD. Reasons accompany rejection. |
| Applied command | Immutable source-breath pressure, command version and source identity. A later operator edit or queued correction cannot replace the source's actual command. |
| Applied settings/context | Immutable applied PEEP, source target and epoch, retained for display and audit. PEEP metadata does not become a hidden mechanics estimator. |

Only the trusted engine publication supplies an eligible envelope. Browser rendering cannot construct one from an arbitrary object. Partial, invalid, duplicate, stale, wrong-mode/generation, out-of-order or impossible-time sources cause no adjustment. A rejected current identity is consumed and cannot later be repaired/replayed into a second decision. No synthetic completed record is created for an interrupted inspiration.

## Operator ownership and atomic resolution

Operator requests and controller output have different lifecycles:

- The retained operator volume target belongs to `vent.tidalVolume` in L. The adaptive controller uses its mL equivalent. The target applies to VC-CMV's established volume-setting semantics on exit; it does not become a pressure setting in PC-CMV or PC-CSV.
- PEEP belongs to shared operator configuration `vent.peep` in cmH2O. During an ordinary adaptive breath, the applied PEEP remains its latched value through inspiration and expiration until the next start.
- Manual PC-CMV inspiratory pressure belongs to `vent.inspiratoryPressure`; manual PC-CSV pressure support belongs to `vent.psPressure`. Adaptive pressure must never overwrite either.
- Requested, retained operator, applied breath and feedback-source values are distinct state. A queued PEEP cannot be displayed as already applied; an old source VT cannot be assessed against a new target.

Maintain at most the latest valid request for each of target and PEEP. The queue is not a sequence of future breaths. Validate requests before accepting them, and validate the complete pair before committing the configuration. An invalid request must not partially overwrite a valid target/PEEP configuration. For a combined request, reject an invalid pair without accepting only its valid member. Repeated valid edits replace that setting's request; an invalid later request does not erase a prior valid one. An unchanged member is retained when only its partner changes.

For explicit reset or mode transition involving adaptive mode, use this order:

```text
validate requests
resolve both latest operator values into retained configuration
cancel obsolete adaptive correction, observation and context
initialize the selected mode/controller
start any breath required by that mode's existing reset/prefill path
```

An explicit reset/transition is an interruption, not a mid-inspiration controller adjustment. Preserve transport running/paused state according to the existing operation; do not introduce an unrequested resume. Legacy-to-legacy transitions retain their existing behavior.

## Event ordering and lifecycle

Persistent adaptive state includes initialization/current context, configured constants, consumed source identity/time, current applied command/version, pending command/source, pending operator requests and feedback/status. Trace each decision with target, source identity/time, raw VT/validity, applied/pending command, clipping/bound and reason. Prescribed effort can appear in separate diagnostic context but is not a controller input.

1. **Initialize before prefill.** Resolve queued operator values when applicable, initialize pressure to 10 within validated bounds, and clear feedback/source/pending correction before synchronous reset/construction prefill starts a mandatory breath. Initial achieved VT is unavailable.
2. **At every ordinary adaptive start**, centrally apply latest target and PEEP together, clear their pending indicators, latch the resulting context, and select the valid pending pressure or retained applied pressure before the first physics sample. A superseded old-context pressure correction cannot apply. Both machine-triggered and patient-triggered mandatory starts use this path.
3. **During inspiration**, use immutable applied pressure above immutable applied set PEEP. No controller, render, playback or ordinary target/PEEP edit changes that pressure. Immediate mechanics/effort/timing edits keep their established physical effect but invalidate mixed adaptive feedback.
4. **At canonical publication**, finalize VT/PIP and ordinary RR/VE bookkeeping, consume the source once, and calculate the next command only if eligible. Rejection does not remove its genuine delivered volume.
5. **During expiration**, distinguish the source's achieved VT/applied pressure from a pending next command. A new incompatible edit cancels the pending correction and old band/miss assessment. Retain the last delivered command until a fresh eligible source authorizes another, or an explicit reset/reentry initializes it.

| Event | Operator settings | Adaptive state / display |
| --- | --- | --- |
| Normal next adaptive breath | Apply latest valid requested target and PEEP together before its first sample; retain the member that did not change. | Latch new context; clear corresponding indicators; discard superseded pending pressure. |
| Reset while adaptive selected | Resolve both queued settings into retained configuration before reset/prefill. Never preserve requested target while dropping requested PEEP. | Clear consumed IDs, feedback, pending correction and old bound/miss status; create context and initialize before prefill. Achieved VT starts unavailable. |
| Exit adaptive before queue applies | Resolve both settings as part of transition before destination initialization. Do not wait for another adaptive breath. Destination uses only applicable settings under its established ownership. | Cancel adaptive pressure/records/status and pending indicators. No adaptive command or eligible source crosses modes. |
| Adaptive reentry | Use current retained target/PEEP, including applicable edits made while outside adaptive mode. Clear any dormant queue so it cannot overwrite newer configuration. | Initialize from 10, not the old adaptive pressure. Establish context before prefill and await fresh feedback. |
| Multiple edits or edit/revert | Last valid request wins separately for target and PEEP. | Each relevant accepted edit advances eligibility; reverted numbers do not resurrect a mixed source or old correction. |
| Pause/resume only | Keep requests queued until an actual next breath start. | Pause alone applies no setting/correction and creates no decision. Reset/mode change still performs its explicit transition while paused, without resuming. |
| Target or PEEP edit during any phase | Queue for next ordinary adaptive start; retain applied values for the current breath. | Immediately invalidate current observation context and obsolete pending correction. Show pending request separately; suppress prior band/miss assessment. |
| R/C, RR/I:E, trigger, effort amplitude/rate/duration edits | Preserve established immediate input effects. | Notify epoch synchronously; invalidate a mixed inspiration and cancel pending correction. A change during expiration does not require discarding the following complete unmixed breath. Do not send numerical effort/mechanics values to the controller. |
| FiO2 / otherwise inert fingerprint edits | Preserve current setting behavior. | Conservatively invalidate when an existing measurement fingerprint changes; this is bookkeeping, not gas-exchange physiology. |
| Gain, step, deadband, initial pressure or bounds | Validated setup-only configuration followed by reset before a new demonstration. | No silent in-run clamp or hidden change that bypasses the per-source step rule. |
| HOLD in adaptive | Unavailable in controls and enforced by mode applicability; unexpected programmatic HOLD makes feedback ineligible. | Hold-derived mechanics stay unavailable. Existing-mode HOLD is unchanged. |
| No eligible/new source | No automatic setting change. | Retain actual command and identifiable last feedback; no repeated decisions or wall-time pressure ramp. |
| Display/help/Teaching/window/speed changes | No operator physiologic configuration change solely from these operations. | No new epoch, reset or controller decision. Simulated events, not wall-clock time, govern adaptation. |

Direct programmatic mode changes must route through the controlled transition or be rejected. Deterministic test `tick`/seek hooks may intentionally advance a paused engine; those explicit steps are not evidence that ordinary transport resumed. Test actual pause/resume separately.

## Pressure reference, limits and saturation

`Paw_target = applied set PEEP + applied adaptive pressure`. The adaptive command is above set PEEP, not total PEEP, alveolar driving pressure or transpulmonary pressure. Residual volume affects the unchanged physics but is not secretly subtracted by the controller.

Bounds constrain this above-set-PEEP command, not absolute Paw. PEEP 5 plus command 20 yields idealized inspiratory Paw 25; PEEP 24 plus command 25 yields 49 and can activate the existing High Pressure alarm. These examples explain coordinates and alarm coexistence; they are not clinical settings or safety assurances. An active command bound does not end inspiration. No absolute-Paw cap or new alarm-derived cycling is added.

At saturation, keep achieved VT and signed error visible. Once the error reverses, the next valid correction starts from the actual saturated command, with at most 2 cmH2O change and no accumulated backlog. Physical overshoot after a mechanics change can still occur. Validate finite ordered bounds containing initial pressure and valid tuning; reject malformed setup instead of coercing nonfinite/impossible values.

## Presentation and interpretation

Use the final exact wording in `scratch/shots-vsm-adapt-001-phase-b/exact-copy.md`. Compact values have fuller static accessible help, preserving existing hover/focus/Escape behavior. Keep Target VT, Achieved VT, Adaptive pressure, Next pressure, applied PEEP, source breath/time and source target distinguishable. Measured PIP remains the existing canonical measurement, not the adaptive command.

Retain achieved VT with its immutable source target/epoch. An input edit suppresses old target-band/miss status and shows `Awaiting feedback for new settings` until eligible feedback matches current applied context. Do not retrospectively compare old volume against the requested target. An applied bound and a next command newly reaching that bound are distinct; `Next pressure: maximum` or `Next pressure: minimum` must not imply that pressure has already been delivered.

Status precedence remains configuration error/inapplicable mode, unavailable/invalid/context-mismatched feedback, applied bound with miss, within band, otherwise adjusting. A bound miss is teaching status after the first eligible out-of-band result. No new audio, priority, arming interval, persistent-failure threshold, alarm latch or automatic cycling is created.

`Paused — no new feedback` is secondary transport text only while paused; it does not replace the latest result. Ordinary running intervals retain the latest identifiable feedback/status. No elapsed-age timeout or wall-time decision is added. Reset/reentry clears old adaptive feedback and starts unavailable.

Unsupported fixed-pressure analytical predictions are unavailable everywhere they appear, including help, mechanics chips and teaching badges. Do not render null as measured zero, `<1`, predicted MAP/VE or a fixed-pressure auto-PEEP claim. Retain configured/calculated mechanics that remain applicable and label their provenance.

The pressure waveform remains the disclosed idealization: Paw is held at the latched pressure/PEEP during adaptive inspiration while effort can change flow and volume. Prescribed effort is an instructor-selected input, not a physiological response to reduced assistance, measured WOB, fatigue, injury or clinical appropriateness. No additional effort trace, WOB, work-fraction, pleural-pressure, transpulmonary-pressure, gas-exchange or respiratory-drive model is required.

## Demonstrations and evidence boundaries

The approved scenarios retain Phase A's exact reproducible settings, completion-indexed edits and fixture acceptance bounds in `scratch/shots-vsm-adapt-001-phase-a/demo-scenarios.md`. All use target 500 mL, initial pressure 10, default bounds 5-25, PEEP 5, FiO2 .40, RR 12, I:E 1:4, HOLD 0 and flow trigger 2 L/min unless specified there:

1. Mechanics adaptation: R10, C50 to C25 mL/cmH2O immediately after completion 10, no effort; volume falls at the retained pressure and pressure rises on later breaths.
2. Patient contribution: R10/C50, prescribed patient RR12 and neural Ti1 s; amplitude 0 to 8 cmH2O after completion 10, with oscillator phase retained; initial volume rises, later pressure falls.
3. Controller limit: R10/C15, no effort, configured maximum 20; pressure saturates and achieved VT remains below 500 mL.

Repeat these through the integrated production path, not only the disposable surrogate. Preserve lower-bound excess VT, saturation release and incomplete-expiration/mistimed-effort stress evidence. Broader tuning/operating-range checks must report actual behavior rather than infer broad convergence from three favorable fixtures. Phase A numeric outcomes remain historical prototype characterization, not fresh Phase B results or clinical acceptance.

The source-to-claim ledger was reviewed on 2026-09-20. Its full local taxonomy/vocabulary/fundamentals readings support classification and qualitative interpretation; the two requested research articles were abstract-only, with full-text limitations. No new source review is claimed here. Study-specific circuit compensation, sensors, work calculations and commercial behavior are not simulator capabilities. The controller constants and lifecycle are owner-approved engineering decisions, not source-prescribed universal values.

## Scope and required verification

Approved tracked scope: runtime `js/adaptive-controller.js`, `js/simulation.js`, `js/ventilator.js`, `js/main.js`, `index.html`; engine tests `tests/adaptive-controller.test.mjs`, `tests/adaptive-integration.test.mjs`, `tests/legacy-mode-preservation.test.mjs`, `tests/test-engine.js`; browser/visual tests `scratch/verify-adaptive.cjs`, `scratch/verify-batch.cjs`, `tests/visual/waveforms.spec.js`; verification integration `tools/run-engine-tests.mjs`, `tools/run-browser-tests.mjs`, `.github/workflows/smoke-test.yml`; documentation `docs/adaptive-mode-contract.md`, `docs/model.md`, `docs/glossary.md`, `docs/visual-testing.md`, `CLAUDE.md`.

Conditional paths need a recorded reason: `css/style.css`, `tests/visual/helpers.js`, `tools/playwright-tally-reporter.mjs`, `tools/create-visual-review-bundle.mjs`. New evidence and isolated candidate PNGs belong under `scratch/shots-vsm-adapt-001-phase-b/`. No accepted baseline bytes may change during this authorization. Additional tracked scope or a changed clinical/physics/alarm contract needs a concrete scope-delta resolution.

Required checks include:

- Independently derived error/deadband/step/bound expectations; invalid/missing versus measured-zero feedback; duplicate/stale/order/context rejection; restricted controller inputs; once-per-publication and next-start application on both trigger paths.
- Target-only, PEEP-only and combined queues followed by reset, each destination mode and reentry; inspiration/expiration and paused transport; repeated/edit-revert requests; obsolete pending pressure. Check ownership, first-sample pressure/PEEP, prefill ordering, cleared indicators, unavailable old feedback and no unrequested resume.
- Meaningful mutants for dropping queued PEEP on reset, stale queue replay on reentry, adaptive-to-manual pressure copying, wrong signal/units/sign/deadband, missed cap/bound, hidden truth access, duplicate/mid-breath update, source-target mismatch and removed genuine VE delivery.
- Exact legacy matched-input traces against the recorded checkpoint for pressure/flow/volume, phases, trigger/cycle outcomes, canonical measurements, holds, Measured RR, Delivered VE and alarms. Legacy mode-pair transitions are tested separately from the new adaptive transitions. New metadata must be absent or inert for old modes.
- Identifiable retained engine/browser/visual coverage with explicit newly commissioned groups/totals and intact count guards; common asset-version/import/network validation; actual browser controls and transport, stable help nodes and prediction-unavailable states.
- Integrated demonstrations, broader operating-range/stress traces and independent adversarial code/trace review.
- Pinned `mcr.microsoft.com/playwright:v1.62.1-noble` comparison before visual edits with updates disabled; unchanged tolerances; isolated candidate generation/repeat results; full-resolution gallery and exact SHA-256 manifest mapping scenario/source/change reason. Candidate generation is not acceptance.

If Linux is unavailable, continue useful authorized work and report that gate unavailable; Windows output does not replace it. Do not reduce required verification to preserve dates. September 25 contract closure, October 4 integrated demonstrations, October 11 verification/visual review, October 17 freeze/backups and October 24 presentation remain planning targets. Publication is not authorized.

The implementation report records fresh results, carried-forward evidence, exact changed paths, review resolutions, candidate identities and any unavailable gate. Preserve index, Phase A evidence and accepted baseline bytes. Stop at the visual-acceptance handoff; later exact-byte installation/finalization and Git actions are separate authority.
