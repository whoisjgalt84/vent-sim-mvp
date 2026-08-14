# Implementation backlog proposals

These are downstream proposals only. CLIN-001 changes no runtime, tests, existing documents, copy, or baselines. Proposals marked **owner-gated** are not approved implementation work.

## VSM-CLIN-002 - reconcile live VC tidal-volume boundary behavior

- **Source claims:** B-010, C-002, C-003, C-004, G-004
- **Clinical intent:** Make documentation and regression expectations accurately describe the commissioned 100 Hz live integrator before deciding whether its small square over-delivery and ramp under-delivery warrant runtime correction.
- **Likely files:** `docs/model.md`, `tests/test-engine.js`; `js/simulation.js` only in a later separately approved runtime phase.
- **Autonomy lane:** Yellow for characterization/documentation; Yellow with clinical checkpoint for any runtime change.
- **Required tests and mutation check:** Add an explicit 100 Hz grid or representative assertions for square/ramp, VT, Ti, startup versus steady breaths, and display/measured agreement. Mutate the inspiration boundary or sample equation to prove the assertions fail on the preselected wrong behavior.
- **Visual review:** Expected only if runtime behavior changes enough to affect waveform/loop pixels; not required for documentation/assertion-only work.
- **Dependencies/sequencing:** First correct the inaccurate statement; then land characterization assertions; then obtain a separate owner decision on runtime correction.
- **Non-goals:** Do not call the current live deviation correct, accepted, or defective; do not change analytical VT; do not combine with mode, alarm, or copy work.

## VSM-CLIN-003 - preserve PC-CSV cycle agent and individual-breath classification

- **Source claims:** A-001, A-006, A-009, E-003, E-004, E-005
- **Clinical intent:** Implement CLIN-OD-004: retain PC-CSV as the configured mode; preserve whether each breath ended by `flowCycle` or `maxTiReached`; and classify a patient-triggered but maximum-Ti machine-cycled breath as a mandatory exception.
- **Likely files:** `js/simulation.js`, `js/main.js`, `docs/glossary.md`, `docs/model.md`, tests.
- **Autonomy lane:** Yellow for conformance to CLIN-OD-004; Red for any interaction-morphology label.
- **Required tests and mutation check:** Assert configured mode, trigger agent, cycle agent, termination reason, and individual breath type at both flow-cycle and backstop-cycle exits. Mutate `maxTiReached` to report `flowCycle` and require failure; separately mutate the backstop classification to spontaneous and require failure.
- **Visual review:** Required if waveform timing or labels change.
- **Dependencies/sequencing:** Clinical specification is approved in CLIN-OD-004. Define exact monitor/teaching representation before UI implementation; obtain separate SME review before labeling early cycle, late cycle, or another interaction.
- **Non-goals:** Do not add apnea backup ventilation or a new mode. Do not adjudicate or change the project-defined minimum inspiratory interval in E-003 until applicable evidence is reviewed and Christian records a separate decision.

## VSM-CLIN-004 - separate PC-CSV measured and predicted readouts

- **Source claims:** B-005, E-007, G-008, G-011, G-013, G-015
- **Clinical intent:** Implement CLIN-OD-005: measured/delivered values follow live behavior; per-breath measurements remain null before the first breath; and analytical values appear only under explicit predicted/calculated labels.
- **Likely files:** `js/main.js`, `js/ventilator.js`, UI copy, browser tests.
- **Autonomy lane:** Yellow for conformance to CLIN-OD-005; Red for new teaching explanations beyond the approved measured-versus-predicted distinction.
- **Required tests and mutation check:** Assert initialization, no-breath, first-breath, reset, and mode-switch state for measured RR, delivered VE, measured VT/PIP/Pplat, live trapped volume, MAP, and each permitted prediction. Mutate the state selection to the current unqualified analytical fallback and require failure.
- **Visual review:** Required for standard and Teaching Mode, including weak/no-effort PC-CSV.
- **Dependencies/sequencing:** Clinical specification is approved in CLIN-OD-005. Define a per-value state table and visual distinction before implementation; treat a future MAP integrated from live apneic pressure separately from generated-breath analytical MAP.
- **Non-goals:** Do not add backup breaths or change trigger mechanics.

## VSM-CLIN-005 - implement valid live hold-derived mechanics

- **Source claims:** C-006, D-005, G-003, G-009, G-010, G-014, H-006
- **Clinical intent:** Implement CLIN-OD-006: measured Pplat comes from a valid live hold interval; static compliance uses same-breath delivered VT and live PEEP/total-PEEP baseline; and measured resistance is limited to valid passive constant-flow same-breath inputs.
- **Likely files:** `js/main.js`, `js/ventilator.js`, `js/simulation.js`, `index.html`, tests.
- **Autonomy lane:** Yellow for conformance to CLIN-OD-006; Red for a new measurement method or teaching interpretation.
- **Required tests and mutation check:** Exercise passive and active square VC, ramp VC, and PC with and without hold. Assert hold duration, zero flow, pressure stability, effort invalidation from the interval itself, same-breath matching, live baseline, null/stale behavior, reset, and mode switch. Mutate the UI selector back to analytical or prior-breath values and require failure; separately permit a brief effort-free hold in a breath with effort elsewhere when the interval criteria pass.
- **Visual review:** Required for hold panels and parameter column.
- **Dependencies/sequencing:** Clinical specification is approved in CLIN-OD-006. Define numerical stability tolerances and sampling window before implementation; any method for ramp VC or PC resistance requires separate validation.
- **Non-goals:** Do not add an expiratory hold maneuver or multi-compartment measurement model.

## VSM-CLIN-006 - align delivered minute-ventilation display and alarm provenance

- **Source claims:** G-006, G-007, G-016, J-004, J-005
- **Clinical intent:** Implement CLIN-OD-007: delivered VE display and VE alarms share live completed-breath provenance and one defined averaging window; set or predicted VE remains separately labeled.
- **Likely files:** `js/main.js`, `alarms.js`, tests.
- **Autonomy lane:** Yellow for conformance to CLIN-OD-007; Red for threshold changes or new safety claims.
- **Required tests and mutation check:** Assert shared signal provenance across startup/warm-up, no-breath, first completed breath, reset, mode switch, stale state, VC, PC, and PC-CSV while permitting separately specified display refresh and alarm delay. Mutate either consumer to restore analytical/set fallback and require failure.
- **Visual review:** Required if display or alarm timing changes.
- **Dependencies/sequencing:** Clinical specification is approved in CLIN-OD-007. Define averaging window, signal validity, display cadence, alarm arming, and delay before implementation; threshold selection remains outside this ticket.
- **Non-goals:** Do not select new VE thresholds.

## VSM-CLIN-007 - disclose and separately adjudicate pressure-control effort morphology

- **Source claims:** D-004, D-006, F-011, H-001, H-004
- **Clinical intent:** Implement the disclosure portion of CLIN-OD-008 without treating the morphology as accepted: identify the trace as idealized set-point pressure control and remove any universal claim that patient effort is invisible on real PC pressure waveforms. Preserve morphology until a separate state-specific target is approved.
- **Likely files:** `js/simulation.js`, `js/ventilator.js`, `js/waveforms.js`, tests, visual baselines.
- **Autonomy lane:** Yellow for the explicitly approved disclosure; Red for morphology or interaction-label changes.
- **Required tests and mutation check:** Exact disclosure and copy assertions plus the current numerical trace contract. If a later morphology is approved, add state-specific numerical assertions and owner-reviewed screenshots; mutate effort coupling back to the prior trace and require failure.
- **Visual review:** Mandatory pinned-Linux baseline and direct clinical inspection.
- **Dependencies/sequencing:** Disclosure is approved in CLIN-OD-008. A morphology change remains deferred and requires a precise target state, evidence, and direct SME screenshot review.
- **Non-goals:** Do not claim device-specific controller fidelity.

## VSM-CLIN-008 - adopt canonical failed-trigger terminology

- **Source claims:** A-008, E-008, F-007, F-008, F-009, I-012
- **Clinical intent:** Implement CLIN-OD-009: use `Failed trigger` canonically, permit `Failed trigger (ineffective effort)` at first teaching exposure, and retain cause-specific explanations.
- **Likely files:** `js/main.js`, `js/waveforms.js`, `docs/glossary.md`, tests, snapshots.
- **Autonomy lane:** Yellow for conformance to CLIN-OD-009; Red for new causal or interaction claims.
- **Required tests and mutation check:** Exact label, counter, tooltip, and optional first-use bridge assertions plus browser hover persistence. Mutation restores `Ineffective effort` as the standalone canonical label and must fail; engine event output must remain unchanged.
- **Visual review:** Required for Teaching Mode and weak-trigger scenarios.
- **Dependencies/sequencing:** Owner specification is approved in CLIN-OD-009 despite unavailable MC2026. Preserve the CLIN-OD-002 visual boundaries.
- **Non-goals:** Do not change trigger detection or add markers/banners rejected by CLIN-OD-002.

## VSM-CLIN-009 - obtain and adjudicate preset provenance

- **Source claims:** I-001, I-002, I-003, I-004, I-005, I-006, I-007, I-008
- **Clinical intent:** Satisfy CLIN-OD-010 by obtaining and reviewing Arnal et al. 2018 or an explicitly approved replacement, then adjudicate Normal, ARDS, COPD, asthma, obesity, and fibrosis values and causal notes one preset at a time.
- **Likely files:** `js/lung-model.js`, preset UI copy, `docs/model.md`, tests.
- **Autonomy lane:** Red until source review and per-preset owner decisions; Yellow for numeric conformance after approval.
- **Required tests and mutation check:** Exact approved parameter table, ranges, units, and provenance labels; mutate each preset independently.
- **Visual review:** Required if labels or controls change.
- **Dependencies/sequencing:** Source is required before decision under CLIN-OD-010. Record population context and model applicability before owner approval; chest-wall claims require special care because the model does not partition chest wall from lung.
- **Non-goals:** Do not model regional disease physiology or claim population norms from a single parameter pair.

## VSM-CLIN-010 - adjudicate draft cases individually

- **Source claims:** I-009, I-010, I-011, I-012, I-013, I-014, I-015, I-016, I-017, I-018, I-019, I-020, I-021, I-022, I-023, I-024
- **Clinical intent:** Implement the review process approved in CLIN-OD-011: keep the bank in draft status and adjudicate each case's learning objective, causal explanation, expected alarm behavior, and intervention independently.
- **Likely files:** `docs/case-bank-v0.1.md`, `docs/case-design-schema.md`, future case runtime.
- **Autonomy lane:** Red.
- **Required tests and mutation check:** Per-case setup contracts and numerical traces after approval; mutate the defining mechanism or expected observation.
- **Visual review:** Required for any waveform-based case.
- **Dependencies/sequencing:** Preset provenance, monitored-value policies, morphology, and applicable alarm specifications first. No case inherits approval from another case or from the bank's draft status.
- **Non-goals:** Do not implement assessment/scoring or redesign the curriculum in this ticket.

## VSM-CLIN-011 - obtain evidence and establish an alarm clinical specification

- **Source claims:** J-001, J-002, J-003, J-004, J-005, J-006, J-007, J-008, J-011, J-012
- **Clinical intent:** Satisfy CLIN-OD-012 by obtaining applicable alarm evidence and then defining supported purposes, signals, thresholds, delays, priority, silence, reset, and mode applicability without implying device safety equivalence.
- **Likely files:** `alarms.js`, `js/main.js`, `alarm-audio.js`, `index.html`, tests, clinical docs.
- **Autonomy lane:** Red until source review and per-alarm owner decisions; Yellow for conformance after approval.
- **Required tests and mutation check:** One direct assertion per alarm signal/comparator/delay/reset plus clock separation; mutate thresholds, timing source, live PIP, and silence state independently.
- **Visual review:** Required for banner, chips, silence, mute, and priority behavior.
- **Dependencies/sequencing:** Sources are required before decision under CLIN-OD-012. Preserve CLIN-OD-003 live-PIP timing, CLIN-OD-007 VE provenance, and the dual-clock invariant while evaluating—not approving—the current defaults.
- **Non-goals:** Do not select thresholds from generic references or claim regulatory alarm compliance.

## VSM-CLIN-012 - document analytical/live monitor provenance at point of use

- **Source claims:** A-005, A-007, A-010, B-008, B-009, B-011, E-001, E-009, G-013, G-016, H-005, I-014
- **Clinical intent:** Make prediction, set value, live measurement, rendering cue, and clinical measurement distinguishable to learners and maintainers.
- **Likely files:** `js/main.js`, `index.html`, `docs/model.md`, tests.
- **Autonomy lane:** Red for learner copy; Green for internal developer labels after approval.
- **Required tests and mutation check:** Data-source contract for each monitor row; mutation swaps an analytical/live source and must fail.
- **Visual review:** Required if learner-facing provenance labels are introduced.
- **Dependencies/sequencing:** Complete CLIN-004 through CLIN-006 decisions first.
- **Non-goals:** Do not merge the analytical and tick implementations.

## VSM-CLIN-013 - adjudicate effort-model and teaching-threshold parameters

- **Source claims:** B-014, F-001, F-002, F-003, G-012
- **Clinical intent:** Implement the disclosure portion of CLIN-OD-013 and review the half-sine Pmus shape/categories, deterministic periodicity, 100 ms trigger lockout, and 0.5 L/min tail metric as separate clinical questions.
- **Likely files:** `js/simulation.js`, `js/main.js`, `js/ventilator.js`, `index.html`, `docs/model.md`, tests.
- **Autonomy lane:** Yellow for explicit project-choice disclosure; Red for parameter, morphology, or teaching-meaning changes.
- **Required tests and mutation check:** Preserve exact current behavior while disclosure-only work lands. For each later approved change, add a focused trace and mutate only that parameter or shape back to the prior choice to prove detection.
- **Visual review:** Required for effort-shape or tail-cue presentation changes; not required for developer-only provenance documentation.
- **Dependencies/sequencing:** Obtain evidence and owner decisions separately for effort waveform/categories, variability, lockout, and tail metric. Do not infer approval across them.
- **Non-goals:** Do not change trigger detection, patient-effort physiology, or auto-PEEP measurement in the disclosure phase.

## VSM-CLIN-014 - reconcile analytical and integrated trapped-volume calculations

- **Source claims:** B-012, B-013, G-015, H-007
- **Clinical intent:** Implement the calculation-review portion of CLIN-OD-014 without combining it with prediction-label work: derive a hold-aware analytical recurrence from explicit phase timing and compare it with live modeled trapped volume under identical assumptions.
- **Likely files:** `js/ventilator.js`, `js/simulation.js`, focused tests, calculation documentation.
- **Autonomy lane:** Red for the intended recurrence and tolerance; Yellow for implementation after owner approval.
- **Required tests and mutation check:** Define inspiratory-flow time, hold, actual expiration, total cycle time, trapped-volume reference state, initialization/reset, convergence criterion, and tolerance. Compare at 100 Hz across representative R/C, timing, effort-off, leak-off, no-flow-limitation, and hold conditions. Mutate the approved phase denominator or reference state back to each prior competing expression and require failure.
- **Visual review:** Not required for calculation-only reconciliation; required if changed values alter learner-visible traces or readouts.
- **Dependencies/sequencing:** First identify and review the exact Nguyen et al. source if it will support a clinical measurement claim. Owner approves the derived recurrence and tolerance before runtime correction. VSM-CLIN-004 handles labels separately.
- **Non-goals:** Do not call the integrated state measured; do not infer quantitative auto-PEEP from tail shape; do not add an expiratory-occlusion maneuver in this ticket.

## VSM-CLIN-015 - conduct state-specific morphology reviews

- **Source claims:** C-007, E-008, H-002, H-003, H-007, I-021
- **Clinical intent:** Implement CLIN-OD-015 disclosure and review VC effort, weak PC-CSV, passive expiration, and trapping morphologies one state at a time without treating PNG stability as clinical approval.
- **Likely files:** `js/simulation.js`, `js/waveforms.js`, `js/main.js`, teaching copy, focused tests, visual baselines only after approval.
- **Autonomy lane:** Yellow for approved disclosure; Red for morphology or interaction-label changes.
- **Required tests and mutation check:** For every state, capture the complete numerical breath trace plus screenshot and record PEEP, mode, flow target, R/C, Pmus magnitude/timing, and trigger/cycle state. Separate equation-of-motion assertions from owner morphology approval. Each later approved change must include a mutation restoring the prior state-specific trace.
- **Visual review:** Mandatory direct SME review for every morphology before baseline approval.
- **Dependencies/sequencing:** Identify and review the exact Natalini et al. source if it will support expiratory-flow-limitation or auto-PEEP interpretation. Acknowledge omitted controller, circuit, flow-limitation, noise, and variability effects.
- **Non-goals:** Do not assign a unique diagnosis or interaction label from a tail, non-return, or isolated Paw depression; do not treat Paw below PEEP as a mere rendering artifact.

## VSM-CLIN-016 - specify pressure- and flow-trigger signal semantics

- **Source claims:** F-004, F-005
- **Clinical intent:** Define what the project pressure-trigger and flow-trigger signals represent, distinguish modeled lung-flow and muscle-pressure demand from a device circuit signal, and disclose the absent bias-flow and circuit-pressure dynamics before stronger teaching claims.
- **Likely files:** `js/simulation.js`, `js/main.js`, `docs/model.md`, trigger tooltips, focused tests.
- **Autonomy lane:** Red for clinical naming or equivalence claims; Yellow for conformance after evidence and owner approval.
- **Required tests and mutation check:** Directly assert signal sign, units, recoil subtraction, threshold crossing, and the non-triggering expiratory return-to-zero state. Mutate each signal to the clinically rejected interpretation and require failure.
- **Visual review:** Required if learner-facing labels or trigger tooltips change.
- **Dependencies/sequencing:** Obtain applicable evidence and an owner decision for the intended teaching semantics. Preserve current trigger detection until that specification is approved.
- **Non-goals:** Do not add a circuit, bias flow, leak model, or device-equivalence claim in the specification ticket.
