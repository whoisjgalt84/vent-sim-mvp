# Owner decision log

Only explicit decisions from Christian Striggow are recorded. Visual approval, silence, green tests, and general encouragement are not approval of clinical meaning.

## CLIN-OD-001 - classify the VC VT reconciliation as an internal inconsistency

- **Affected claims:** B-010, C-003, C-004, G-004
- **Evidence summary:** At 100 Hz, a representative grid showed deterministic live boundary effects. At set VT 500 mL and Ti approximately 1.67 s, stable post-startup breaths delivered approximately 501 mL with square flow and 497 mL with descending-ramp flow; the analytical path returned 500 mL. `docs/model.md` predicts approximately 504 and 503 mL of live over-delivery. Displayed waveform VT and `measuredVT_mL` agreed.
- **Options presented:** stop; or continue while classifying the documentation/live/analytical disagreement as `INTERNAL_INCONSISTENCY` without deciding whether live behavior is correct, simplified, or defective.
- **Selected disposition:** Continue with `INTERNAL_INCONSISTENCY`.
- **Rationale/teaching intent:** Characterize before adjudicating; do not infer that the small live deviation is correct, accepted, or defective.
- **Date:** 2026-08-12
- **Downstream consequence:** Propose a documentation correction, focused live-integrator characterization/regression assertions if absent, and a separate decision on whether runtime correction is warranted.

## CLIN-OD-002 - failed-trigger presentation boundaries already approved

- **Affected claims:** F-009, F-010, H-008
- **Evidence summary:** Repository operating instructions record owner decisions superseding `docs/trigger-fix-design.md`.
- **Options presented:** add a failed-trigger marker and pre-apnea banner; or rely on the amber waveform highlight and 60-second counter without a pre-apnea banner.
- **Selected disposition:** No failed-trigger marker above the trace; no pre-apnea banner.
- **Rationale/teaching intent:** The amber waveform highlight and counter carry the presentation.
- **Date:** 2026-08-05 (first repository record; the original approval date is not separately available)
- **Downstream consequence:** CLIN-001 does not propose adding either element.

## CLIN-OD-003 - Teaching Mode RR layout and PIP latch semantics approved

- **Affected claims:** G-001, G-002, G-005, J-009
- **Evidence summary:** Repository operating instructions record approval of the stacked Teaching Mode RR table, both existing tooltip strings, and per-breath monitor PIP latching.
- **Options presented:** continuously changing PIP versus completed-breath monitor PIP while retaining live alarm pressure; compact versus stacked RR presentation.
- **Selected disposition:** Approved stacked Teaching Mode RR table, tooltip strings, and per-breath PIP latch semantics.
- **Rationale/teaching intent:** Maintain a stable monitor readout while preserving immediate high-pressure alarm evaluation and expose set/delivered/patient rate distinctions.
- **Date:** 2026-07-29
- **Downstream consequence:** Preserve live `breathSummary.pip` for alarms, `pipLatched` for the monitor, and the guarded RR DOM rebuild.

## CLIN-OD-004 - classify maximum-Ti PC-CSV breaths by their actual cycle agent

- **Affected claims:** A-001, A-004, A-006, A-009, E-004, E-005
- **Evidence summary:** Under the adopted taxonomy, a spontaneous breath is both patient-triggered and patient-cycled. In an allowed 100 Hz trace with cycle threshold 10%, configured Ti 0.857 s, and obstructive mechanics, inspiration ended after approximately 0.87 s while flow remained 32.06 L/min, above the 4.98 L/min flow-cycle threshold. `maxTiReached`, rather than patient flow cycling, terminated that breath.
- **Options presented:** revise the clinical specification to classify each breath by its actual trigger and cycle agents; approve all breaths delivered while PC-CSV is configured as an intentional spontaneous-breath simplification; defer with disclosure; or require another source before decision.
- **Selected disposition:** `REVISE_CLINICAL_SPEC`.
- **Rationale/teaching intent:** Retain PC-CSV as the configured mode. A patient-triggered and flow-cycled breath is spontaneous. If `maxTiReached` terminates inspiration first, the ventilator cycled that individual breath and it is a machine-cycled mandatory exception. Configured mode and individual-breath classification must not be conflated. `maxTiReached` alone does not establish early cycle, late cycle, or another interaction morphology.
- **Date:** 2026-08-12
- **Downstream consequence:** Preserve and expose cycle agent and termination reason, including at least `flowCycle` and `maxTiReached`; distinguish configured mode from delivered-breath classification in teaching or monitor copy; require separate state-specific SME review before assigning an interaction morphology.

## CLIN-OD-005 - separate measured and predicted values before the first PC-CSV breath

- **Affected claims:** B-005, E-007, G-008, G-011, G-013, G-015, I-022
- **Evidence summary:** After 15 simulated seconds with zero effort, the live engine had zero breaths, measured RR 0, and delivered VT 0, while the analytical path returned predicted VT 459 mL, VE 5.5 L/min, MAP 8.4 cmH2O, and trapped volume 0.3 mL under the traced settings.
- **Options presented:** revise the clinical specification so delivered values reflect live behavior and analytical values are explicitly predictive; retain unqualified analytical values as an intentional simplification; defer with disclosure; or require another source before decision.
- **Selected disposition:** `REVISE_CLINICAL_SPEC`.
- **Rationale/teaching intent:** Before any breath, measured RR and delivered VE are zero; per-breath measured VT, PIP, and Pplat are null or shown as `—`; live trapped volume is zero; and generated-breath analytical MAP must not be presented as measured. Predictions may remain only under unambiguous labels such as Predicted VT, Predicted VE, Predicted steady-state auto-PEEP/trapped volume, and Predicted breath MAP. A future MAP integrated from live pressure during apnea would be a different live measurement.
- **Date:** 2026-08-12
- **Downstream consequence:** Define initialization, no-breath, first-breath, reset, and mode-switch behavior for every monitored value; prohibit ambiguous shared labels or presentation for predicted and measured values.

## CLIN-OD-006 - require live same-breath validity for measured hold mechanics

- **Affected claims:** C-006, D-005, G-003, G-009, G-010, G-014, H-006, I-019, I-024
- **Evidence summary:** In a passive hold trace, delivered VT was 500.5 mL, live Pplat was 15.096 cmH2O, and analytical Pplat was 15.1 cmH2O. With effort during the hold, live hold pressure varied from 14.24 to 17.53 cmH2O while the UI continued to display analytical Pplat 15.1 cmH2O, compliance 50 mL/cmH2O, and resistance 10 cmH2O/L/s.
- **Options presented:** revise the clinical specification to require valid live same-breath measurements; approve the analytical substitution as an intentional simplification; defer with disclosure; or require another source before decision.
- **Selected disposition:** `REVISE_CLINICAL_SPEC`.
- **Rationale/teaching intent:** Measured Pplat requires a completed end-inspiratory hold with zero flow, stable pressure, and no active inspiratory or expiratory effort during the measurement interval. Validity is determined from that interval, not merely from whether effort is enabled elsewhere. Invalid or unstable holds display null or `—` with an invalid-under-effort explanation and may not substitute analytical or stale values. Close passive numerical agreement does not make an analytical value a measurement. Static compliance requires valid measured Pplat, live delivered VT, and the defined live PEEP/total-PEEP baseline from the same breath. Resistance derived from PIP, Pplat, and flow is measured only for a valid passive constant-flow breath using same-breath inputs; descending-ramp VC and pressure-control require a separately validated method.
- **Date:** 2026-08-12
- **Downstream consequence:** Specify hold duration, sampling window, pressure-stability criteria, effort invalidation, breath matching, same-breath baseline, stale-value handling, reset, and mode-switch behavior. Set compliance, set resistance, and predicted Pplat may remain only under separate unambiguous labels.

## CLIN-OD-007 - align displayed and alarm delivered minute ventilation provenance

- **Affected claims:** G-006, G-007, J-004, J-005
- **Evidence summary:** In a VC-CMV trace with set RR 12/min, patient and measured RR 20/min, and delivered VT 504 mL, the generic display showed analytical/set VE 6.0 L/min while the alarm path derived approximately 10.1 L/min from live completed-breath delivery.
- **Options presented:** revise the clinical specification so delivered display and VE alarms share live completed-breath provenance; approve the split as an intentional simplification; defer with disclosure; or require another source before decision.
- **Selected disposition:** `REVISE_CLINICAL_SPEC`.
- **Rationale/teaching intent:** Delivered VE shown to learners and evaluated by VE alarms must share the same live completed-breath provenance and defined averaging window. Display-update and alarm-delay behavior may differ, but neither may silently substitute set or predicted ventilation. The 6.0 L/min trace value is set/predicted ventilation and cannot occupy a measured/delivered label; set or predicted VE may remain separately labeled.
- **Date:** 2026-08-12
- **Downstream consequence:** Define breath boundary, averaging window, startup/warm-up, no-breath behavior, reset, mode switch, stale handling, alarm arming, and alarm delay before implementation. CLIN-001 neither selects nor changes alarm thresholds.

## CLIN-OD-008 - defer PC effort morphology with explicit idealization disclosure

- **Affected claims:** D-004, D-006, F-011, H-001, H-004, I-020
- **Evidence summary:** At identical PC-CMV settings, passive breaths held inspiratory Paw exactly at 20 cmH2O while delivering 706.2 mL with peak flow 89.7 L/min. With Pmus 10 cmH2O, Paw remained exactly 20 cmH2O while delivered VT increased to approximately 918-920 mL and peak flow to approximately 94 L/min. The directional flow/volume response agrees with pressure-control mechanics, but the current teaching statement that effort is invisible on the pressure waveform generalizes an ideal controller morphology.
- **Options presented:** defer the morphology with disclosure; accept it as an intentional simplification; revise the clinical specification now; or require another source before decision.
- **Selected disposition:** `DEFER_WITH_DISCLOSURE`.
- **Rationale/teaching intent:** Preserve the current morphology pending a state-specific target and direct screenshot review, but identify it as idealized set-point pressure control. Do not teach that patient effort is generally invisible on real pressure-control waveforms. The current trace is neither approved as clinically correct nor accepted as an intentional simplification.
- **Date:** 2026-08-12
- **Downstream consequence:** Add explicit disclosure and revise the universal teaching statement in a separate ticket. Any pressure deformation or early/late/other interaction label requires separate state-specific SME adjudication and morphology review.

## CLIN-OD-009 - use failed trigger as the canonical learner-facing term

- **Affected claims:** A-008, E-008, F-007, F-008, F-009, I-012, I-023
- **Evidence summary:** The engine records `type: 'failed'` with a failure reason, while learner labels, tooltips, and the rolling counter say `ineffective effort`. MC2022 supports the failed-trigger event category and recognizes ineffective-effort terminology as an alias; the repository glossary uses failed trigger canonically while its stronger deprecation cites unavailable MC2026.
- **Options presented:** revise the clinical specification to use failed trigger canonically with an optional first-use bridge; retain ineffective effort as an intentional exception; defer with disclosure; or require MC2026 before decision.
- **Selected disposition:** `REVISE_CLINICAL_SPEC`.
- **Rationale/teaching intent:** Use `Failed trigger` as the canonical UI label. At first teaching exposure, `Failed trigger (ineffective effort)` may bridge familiar language. Continue naming the actual cause, including threshold failure or ventilator unavailability. Terminology must not alter detection behavior.
- **Date:** 2026-08-12
- **Downstream consequence:** Revise labels, counter, and tooltips under VSM-CLIN-008 while preserving CLIN-OD-002: amber highlight and counter, no added marker, and no pre-apnea banner.

## CLIN-OD-010 - require source review before adjudicating disease presets

- **Affected claims:** I-001 through I-008, I-019, I-020, I-024
- **Evidence summary:** The runtime provides Normal, Moderate and Severe ARDS, COPD, Acute Asthma, Morbid Obesity, and Pulmonary Fibrosis presets with fixed R/C pairs and causal notes. Tests preserve the constants, but the cited Arnal et al. 2018 source was not supplied. Disease labels compress heterogeneous physiology into one linear R/C pair; the obesity note specifically implies chest-wall mechanics that the model does not partition.
- **Options presented:** require the cited source before decision; defer with disclosure; revise the clinical specification without the source; or confirm presets out of scope.
- **Selected disposition:** `SOURCE_REQUIRED_BEFORE_DECISION`.
- **Rationale/teaching intent:** Do not classify any preset as clinically verified from implementation comments or passing tests. Source review and per-preset SME adjudication are required before approving disease-reference values or causal notes.
- **Date:** 2026-08-12
- **Downstream consequence:** Retain matrix disposition `EVIDENCE_GAP`; obtain and review Arnal et al. 2018 or an explicitly approved replacement; then specify provenance, population context, intended teaching role, and point-of-use disclosure per preset.

## CLIN-OD-011 - defer the case bank as draft curriculum

- **Affected claims:** I-009 through I-024
- **Evidence summary:** Eight cases contain learning objectives and expected observations, but most lack executable setup contracts and independently approved numerical traces. Several depend on unresolved preset, monitored-value, morphology, and alarm specifications.
- **Options presented:** defer with disclosure; require another source before any decision; revise the clinical specification now; or confirm the case bank out of scope.
- **Selected disposition:** `DEFER_WITH_DISCLOSURE`.
- **Rationale/teaching intent:** Treat the case bank as draft curriculum rather than approved clinical truth. No individual case is approved by this batch and the cases must not be approved as a group.
- **Date:** 2026-08-12
- **Downstream consequence:** Review each case separately after its prerequisite specifications settle. Require an executable setup, numerical trace, expected alarms, causal explanation, and owner-approved learning objective for every case.

## CLIN-OD-012 - require sources before adjudicating alarm defaults and semantics

- **Affected claims:** J-001 through J-008, J-011, J-012, I-019, I-022, I-024
- **Evidence summary:** Current project defaults are High Pressure greater than 40 cmH2O using max live PIP/current Paw; High RR greater than 35/min using smoothed measured RR; Apnea after 20 s of simulation time since breath start; Low VE below 3 L/min and High VE above 20 L/min after a 5 s grace; condition-based auto-reset; and cancelable 120 s wall-time audio silence. The packet supports broad alarm categories but not these exact thresholds, delays, latching policy, priority, or silence duration.
- **Options presented:** require sources before decision; defer with disclosure; revise the clinical specification from owner judgment alone; or confirm alarms out of clinical scope.
- **Selected disposition:** `SOURCE_REQUIRED_BEFORE_DECISION`.
- **Rationale/teaching intent:** Preserve the characterized implementation as project defaults without describing it as clinically validated, device-equivalent, or an approved safety specification. CLIN-OD-003 remains controlling for live pressure signal timing and CLIN-OD-007 for VE provenance; neither approves thresholds.
- **Date:** 2026-08-13
- **Downstream consequence:** Obtain applicable sources and create a per-alarm specification for threshold, input signal, averaging, arming, delay, priority, reset/latching, audio, silence, and mode applicability. Do not select or change thresholds in CLIN-001.

## CLIN-OD-013 - defer project-defined effort and teaching thresholds with disclosure

- **Affected claims:** F-001, F-002, F-003, G-012
- **Evidence summary:** The simulator uses a perfectly periodic half-sine Pmus model and qualitative amplitude categories, no breath-to-breath effort variability, a fixed 100 ms post-transition trigger lockout, and a 0.5 L/min tail/baseline-return teaching threshold. The supplied evidence does not establish these exact shapes, categories, timings, or threshold as patient-reference or device-reference values.
- **Options presented:** defer with disclosure; require sources before any decision; accept all as intentional simplifications; or revise the specification now.
- **Selected disposition:** `DEFER_WITH_DISCLOSURE`.
- **Rationale/teaching intent:** Preserve the deterministic choices pending evidence and focused review, identify them as project-defined educational-model parameters, and do not present them as patient-reference behavior, device timing, diagnostic thresholds, or measured auto-PEEP. This is not acceptance of the four choices as one clinically validated construct.
- **Date:** 2026-08-13
- **Downstream consequence:** Decompose later review by clinical meaning. Require separate evidence and owner decisions for effort waveform/categories, effort variability, trigger lockout, and tail/baseline-return metric before stronger teaching claims.

## CLIN-OD-014 - defer trapped-volume reconciliation under a complete timing and state contract

- **Affected claims:** B-012, B-013, B-014, G-015, H-007, I-018
- **Evidence summary:** Live residual volume carried by the 100 Hz integrator and analytical steady-state trapping are different model paths. In a representative COPD/hold condition, the implemented analytical expression produced approximately 360.1 mL while applying the code comment's total-cycle-time expression produced approximately 337.8 mL. The comment and implementation use different phase timing, and neither was independently adjudicated as correct.
- **Options presented:** defer with disclosure and derive the recurrence from a complete contract; require another source before decision; revise the formula now; or accept the implementation as an intentional simplification.
- **Selected disposition:** `DEFER_WITH_DISCLOSURE`.
- **Rationale/teaching intent:** Call the integrator result `live modeled trapped volume`, not measured trapped volume. Define inspiratory-flow time, hold time, actual expiratory time, and total cycle time; derive the analytical recurrence from those definitions rather than choosing between comment and code. Define reference state, initialization/reset, steady-state convergence, and numerical agreement tolerance. Compare analytical and integrated paths only under identical assumptions for leak, effort, expiratory flow limitation, and holds. Failure of expiratory flow to return to zero is evidence of incomplete expiration, not a quantitative auto-PEEP measurement; clinical quantification generally requires a separately modeled maneuver such as expiratory occlusion.
- **Date:** 2026-08-13
- **Downstream consequence:** Keep prediction-label correction in VSM-CLIN-004 separate from a new calculation-reconciliation ticket. The exact Nguyen et al. work mentioned by the owner was not supplied and remains follow-on `SOURCE_REQUIRED`, not reviewed CLIN-001 evidence.

## CLIN-OD-015 - defer remaining morphology with complete state-specific review

- **Affected claims:** C-007, E-008, H-002, H-003, H-007, I-018, I-021, I-023
- **Evidence summary:** In the representative fixed-flow VC trace at 0.5 s, Pmus 10 cmH2O reduced Paw from 12.03 to 2.03 cmH2O while flow remained 21 L/min and volume 175 mL. Weak PC-CSV and passive incomplete-expiration traces also reproduce selected model mechanisms, but the approved PNGs establish rendering stability only.
- **Options presented:** defer with disclosure and state-specific review; accept the morphologies as intentional simplifications; revise the morphology specification now; or require another source before decision.
- **Selected disposition:** `DEFER_WITH_DISCLOSURE`.
- **Rationale/teaching intent:** Paw below PEEP during fixed-flow VC is not a unique diagnosis and is not merely an incidental graphical artifact. Within this model it means patient effort contributes pressure while ventilator flow remains constrained, a potentially important work-shifting or under-assistance teaching state. Every review requires the complete breath trace; PEEP; mode; flow target; mechanics; Pmus magnitude/timing; trigger/cycle state; numerical trace plus screenshot; and an explicit distinction between equation-of-motion behavior verified and clinical teaching morphology approved. Reviews must acknowledge omitted controller response, circuit behavior, expiratory flow limitation, noise, and variability. No unique interaction label may be inferred from a tail, non-return, or isolated pressure depression alone.
- **Date:** 2026-08-13
- **Downstream consequence:** Preserve current traces with disclosure pending state-specific reviews. The exact Natalini et al. work mentioned by the owner was not supplied and remains follow-on `SOURCE_REQUIRED`, not reviewed CLIN-001 evidence.

## CLIN-OD-016 - retain the explicit CLIN-001 model and validation boundaries

- **Affected claims:** E-006, J-010, K-007, K-009
- **Evidence summary:** The owner-authored CLIN-001 ticket explicitly makes backup-ventilation inventory, omitted interaction mechanisms, and external-validation boundaries part of the contract while prohibiting new modes, runtime behavior, physical test-lung or patient-data validation, device-equivalence claims, and clinical-outcome claims.
- **Options presented:** implement an omitted capability in CLIN-001; imply external validation from the commissioned gates; or retain the ticket's explicit boundary and inventory the omission.
- **Selected disposition:** `OUT_OF_SCOPE_CONFIRMED` for CLIN-001 and the current simulator contract.
- **Rationale/teaching intent:** The documentation batch must state what the simulator does not model and must not turn internal conformance tests into device, patient-safety, or outcome evidence. This scope decision does not clinically approve any omitted mechanism; it prevents the current product from implying that capability or validation exists.
- **Date:** 2026-08-12
- **Downstream consequence:** Keep the omissions and validation boundary visible. Any future backup ventilation, interaction expansion, external validation, or safety-performance claim requires a separately authorized ticket and applicable evidence.

## Decisions still required

PC effort morphology remains deliberately unresolved under CLIN-OD-008, and other effort/expiration morphologies remain unresolved under CLIN-OD-015; current traces are preserved only with disclosure and must not be described as approved clinical morphology. Preset and alarm adjudication are stopped for missing evidence under CLIN-OD-010 and CLIN-OD-012, every case remains draft curriculum under CLIN-OD-011, project-defined effort/tail parameters remain deferred under CLIN-OD-013, and trapping calculation reconciliation remains deferred under CLIN-OD-014. CLIN-OD-004 through CLIN-OD-007 and CLIN-OD-009 resolve the clinical specifications for PC-CSV maximum-Ti breath classification, pre-breath measured-versus-predicted values, valid hold-derived measurements, delivered-VE provenance, and failed-trigger terminology; their runtime and UI repairs remain downstream work.
