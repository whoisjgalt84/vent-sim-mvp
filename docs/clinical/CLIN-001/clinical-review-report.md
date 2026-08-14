# Clinical review report

## Review boundary

The review covers the required commit and tree, the A-K clinical domains, normative/design documents, live and analytical implementations, UI/Teaching Mode, alarms, cases, engine/browser/visual expectations, and the six approved Linux snapshots as rendering evidence only. Source review used only the approved local packet listed in `evidence-ledger.md`.

The defensible validation boundary is: **an equation- and evidence-based educational single-compartment model, checked against selected closed-form mechanics and implementation expectations, not validated against a physical test lung, a commercial ventilator, recorded patient data, or clinical outcomes.**

## Material agreements

- The governing linear single-compartment equation, sign convention, unit conversions, elastance/compliance relation, and tau = R x C agree among available mechanics sources, code, and direct tests.
- VC-CMV prescribes flow/volume and exposes load/effort primarily in pressure; PC-CMV prescribes airway pressure and exposes load/effort primarily in flow and volume.
- Passive expiration is exponential in the model; end-expiratory non-return and residual volume emerge in the live integrator.
- The implemented mode families VC-CMV, PC-CMV, and PC-CSV are consistent with the available Chatburn classification; VC-CSV is excluded by the adopted taxonomy.
- PC-CSV has no inspiratory hold or apnea backup breath in the live engine. With zero effort it produces no breath; with adequate effort it patient-triggers and flow-cycles.
- Live PIP remains available to the high-pressure alarm while the monitor shows a completed-breath latch. This is directly protected and explicitly owner-approved.
- Trigger evaluation uses simulation time while alarm audio/silence uses wall time. Tests protect the separation.
- Flow-triggering uses positive total net lung flow at the lung/circuit signal, consistent with the available foundational description of a wye flow signal; negative expiratory flow moving toward baseline can remain sub-threshold.
- Visual baselines assert deterministic pixels and layout only; the review assigns no clinical morphology approval from those images.

## Material divergences and candidate issues

### Live VC delivered VT, analytical VT, and model documentation

At 100 Hz, 18 representative square/ramp x VT x Ti conditions were run three times in fresh deterministic engine instances. The passive model used R 10 cmH2O/L/s, C 0.05 L/cmH2O, PEEP 5 cmH2O, no hold, no effort, no leak, and no expiratory-flow-limitation model. The grid used VT 200, 500, and 800 mL and Ti 0.857143 s (RR 20, I:E 1:2.5), 1.666667 s (RR 12, I:E 1:2), and 2.5 s (RR 8, I:E 1:2). Stable results were sampled after six cycles. Every repeated run was numerically identical. The waveform volume at the inspiration-to-expiration boundary equaled internal `measuredVT_mL`; the displayed VT was the defined integer rounding of that same value.

After the startup breath:

- square flow over-delivered by approximately 0.2-0.4% (0.4-3.2 mL across 200-800 mL);
- descending-ramp under-delivered by approximately 0.4-1.164% (0.8-9.311 mL);
- error percentage depended on Ti and flow pattern and scaled linearly with VT;
- the analytical path returned the set VT exactly; and
- the first breath after reset used one additional inspiratory sample and had a different error from subsequent breaths.

For set VT 500 mL and Ti approximately 1.67 s, stable breaths were approximately 501 mL square and 497.004 mL ramp. The analytical path was 500 mL. `docs/model.md` instead says approximately 504 mL square and 503 mL ramp and characterizes both as over-delivery. Christian authorized `INTERNAL_INCONSISTENCY`; this does not decide whether the live deviation is correct, accepted, or defective.

The temporary condition-level characterization was intentionally not committed, per owner direction. The summarized grid definition, extrema, determinism, direction of error, breath-boundary behavior, and display/internal agreement above are the retained CLIN-001 evidence. VSM-CLIN-002 owns a focused committed regression table or assertions.

### Dual analytical/live physiology

- MAP is recomputed from `generateBreathWaveforms()` rather than live pressure history.
- Auto-PEEP and trapped volume shown in the standard parameter panel are closed-form steady-state predictions; waveform trapping is live modeled residual volume carried by the Euler integrator, not a clinical measurement. Representative COPD conditions differed materially during convergence and under a PC hold. CLIN-OD-014 requires explicit inspiratory-flow, hold, actual-expiration, and total-cycle timing; reference state; initialization/reset; convergence criterion; and tolerance before comparing paths. The recurrence must be derived from that contract under identical leak, effort, flow-limitation, and hold assumptions rather than choosing between the current comment and implementation.
- In PC-CSV with no effort, the live engine has zero breaths, zero measured VT, and zero measured RR, while analytical helpers can still return nonzero predicted VT, VE, MAP, auto-PEEP, and trapped volume. The UI substitutes live VT/VE in CSV but continues to show some analytical pressure/trapping values. CLIN-OD-005 requires delivered RR and VE to remain zero, per-breath measurements to remain null, live trapped volume to remain zero, and every permitted analytical value to be visually and textually identified as a prediction. A future MAP integrated from live apneic pressure would be a separate live measurement, not the current generated-breath analytical MAP.
- Non-CSV displayed VE uses analytical VT x set RR, whereas alarm VE prefers completed-breath VT x measured RR. In a traced VC-CMV condition with set RR 12/min, measured RR 20/min, and delivered VT 504 mL, those paths produced 6.0 versus approximately 10.1 L/min. CLIN-OD-007 requires delivered display and alarm signals to share live completed-breath provenance and a defined averaging window. Update cadence and alarm delay may differ, but neither path may silently substitute set or predicted ventilation. Threshold selection remains unresolved and outside CLIN-001.

### Measurement labels and timing

- Pplat is sampled by the live engine during hold, but the parameter panel and hold-result panel display analytical `summary().pressures.pplat_cmH2O` rather than a validity-qualified live hold result. CLIN-OD-006 requires a completed zero-flow hold with stable pressure and no active inspiratory or expiratory effort during the measurement interval. Validity is interval-specific; effort elsewhere in the breath does not by itself invalidate an otherwise qualifying interval.
- Driving pressure, static compliance, and resistance in `summary()` are analytical/set-mechanics calculations. CLIN-OD-006 requires same-breath live inputs for measured mechanics: valid Pplat and live PEEP/total-PEEP baseline for driving pressure; live delivered VT for static compliance; and passive constant square flow plus same-breath PIP, Pplat, and flow for measured resistance. Ramp VC and PC resistance remain unmeasured without a separately validated method. Invalid, unstable, stale, reset, or mode-switched measurements must be null rather than analytically substituted.
- Main mechanics rows display the set model R and C, not estimates derived from live pressure/flow/volume.
- Tail/baseline-return uses a project-defined 0.5 L/min threshold and a derived percentage; it is a teaching metric, not a sourced auto-PEEP measurement.

### PC and PC-CSV semantics

- PC pressure is displayed perfectly flat at PEEP + target despite patient effort. In the representative trace, Pmus 10 cmH2O increased delivered VT from 706.2 mL to approximately 918-920 mL and peak flow from 89.7 to approximately 94 L/min while inspiratory Paw remained exactly 20 cmH2O. CLIN-OD-008 defers morphology approval: preserve the trace pending a state-specific target, disclose it as idealized set-point pressure control, and do not teach that effort is generally invisible on real PC pressure waveforms. No early-cycle, late-cycle, or other interaction label may be inferred without separate review.
- PC-CSV normally flow-cycles at a percent of peak, but `maxTiReached` can terminate inspiration first. CLIN-OD-004 retains PC-CSV as the configured mode while classifying that individual patient-triggered but machine-cycled breath as a mandatory exception. The runtime does not preserve or expose the actual cycle agent or termination reason, so the current unconditional presentation is a candidate defect. `maxTiReached` alone must not be labeled early cycle, late cycle, or another interaction without state-specific SME review.
- The PC trapping comment cites a total-cycle-time denominator, while implementation uses Ti + effective Te and omits hold time from that denominator. A representative COPD/hold calculation produced approximately 360.1 mL from the implemented expression versus 337.8 mL from the comment's TCT expression. CLIN-OD-014 deliberately does not select either result as correct; label repair and calculation reconciliation remain separate downstream tickets.

### Terminology and teaching

- Engine event type `failed` aligns with MC2022's failed-trigger category. Learner copy says `ineffective effort`, which MC2022 recognizes as familiar alias language while `docs/glossary.md` uses failed trigger canonically and cites unavailable MC2026 for stronger deprecation. CLIN-OD-009 resolves the teaching choice: use `Failed trigger` canonically, optionally bridge once with `Failed trigger (ineffective effort)`, and preserve cause-specific explanations and CLIN-OD-002 presentation boundaries.
- The PC-CSV header tag says `flow-cycled`, describing a phase variable rather than the strict set-point targeting suffix. It is intelligible but not a complete TAG.
- Some tests and case text still use legacy `Assist/Control`, pressure-support, or causal teaching language. Vendor/legacy labels must not become code types.
- Failed-trigger tooltips are explicitly pending RT sign-off in `docs/sme-feedback-log.md`; current PNGs cannot approve the wording.

## Candidate and accepted simplifications

No new Red-lane simplification was accepted in CLIN-001. Existing explicit owner decisions preserve the failed-trigger presentation boundaries, stacked RR table/tooltips, and live-versus-latched PIP semantics.

Candidate simplifications awaiting owner judgment include the half-sine perfectly periodic Pmus model, the 100 ms trigger lockout, idealized noise-free waveforms, and disease preset labels. CLIN-OD-008 deliberately defers rather than accepts perfect PC pressure morphology and requires disclosure. CLIN-OD-004 rejected treating PC-CSV backstop cycling as an undifferentiated spontaneous-breath simplification, and CLIN-OD-005 rejected unqualified analytical values before a live PC-CSV breath. Explicit omissions such as a single compartment, constant R/C, absent gas exchange, no circuit model, and set-point-only targeting are recorded as out of scope rather than hidden realism.

CLIN-OD-015 also defers VC effort, weak PC-CSV, passive-flow, and incomplete-expiration morphology. In fixed-flow VC, Paw falling below PEEP is meaningful equation-of-motion behavior—patient effort contributes pressure while ventilator flow remains constrained—and can support work-shifting or possible under-assistance teaching. It is neither a unique diagnosis nor an incidental pixel artifact. Approval requires the complete trace and state, numerical data plus screenshot, and an explicit distinction between verified equation behavior and approved teaching morphology. Tail or non-return alone cannot establish a unique cause, especially because expiratory flow limitation and other omitted behavior can alter clinical interpretation.

## Evidence gaps

- C2023, C2026, MC2024, MC2026, and Arnal et al. 2018 were not supplied.
- Preset provenance is therefore not sufficient for `VERIFIED_CORRECT`. CLIN-OD-010 requires review of Arnal et al. 2018 or an explicitly approved replacement before any per-preset disposition; passing value-conformance tests cannot substitute.
- Later discordance terminology and simulator-transfer claims that depend on MC2026/MC2024 remain `SOURCE_REQUIRED`.
- No approved source establishes Vent-Sim's alarm thresholds, priorities, repeat cadence, two-minute silence duration, 5-second VE grace, or 0.5 L/min teaching threshold.
- The half-sine Pmus amplitude categories and precise lockout duration are project choices without sufficient independent source support in the packet.
- No source or experiment validates physical test-lung, device, patient, or outcome accuracy.

## Test-coverage gaps

- Existing broad VT convergence assertions use very loose relative tolerances and do not directly characterize square/ramp direction, startup differences, or the VT/Ti grid.
- MAP is range-tested but not compared with live pressure integration.
- Analytical auto-PEEP has direct tests and live trapping has indirect convergence tests, but their divergence is not a protected contract.
- Pplat source selection, hold validity under effort, and stale/null hold-result behavior lack direct browser assertions.
- Parameter-panel versus alarm VE provenance is not directly asserted.
- Visual tests cover only selected VC effort/Teaching and weak PC-CSV states; pixels are not clinical morphology assertions.
- The matrix now inventories the central assertion of each of the eight authored cases separately. None has an executable setup contract. CLIN-OD-011 classifies the entire bank as draft curriculum and explicitly withholds batch approval; each case requires its own setup, trace, alarm expectation, causal explanation, and owner-approved objective after prerequisite specifications settle.

## Alarm inventory conclusion

The simulator implements high pressure, high RR, apnea, low VE, and high VE. Evaluation is instantaneous each frame except VE arms after 5 seconds; alarms auto-reset when conditions clear. High pressure uses the maximum of live breath PIP and current Paw. Apnea uses simulation time since last breath start. RR uses smoothed completed-breath intervals. VE prefers delivered completed-breath VT x measured RR. High pressure and apnea are assigned high priority; high RR, low VE, and high VE are medium. Alarm audio is separately muted/silenced on wall time; high-priority audio repeats at 12 s, medium at 30 s, and silence is a cancelable 120-second toggle.

These implementation facts are traceable and tested. CLIN-OD-012 requires applicable sources before adjudicating thresholds, grace periods, latching/reset, priority, audio cadence, silence duration, or mode applicability. They remain characterized project defaults rather than clinically validated or device-equivalent alarm behavior. CLIN-OD-003 and CLIN-OD-007 govern live pressure timing and VE provenance only; neither approves a threshold.

## Deferred project-defined numerical choices

CLIN-OD-013 preserves the perfectly periodic half-sine Pmus shape and qualitative amplitudes, absence of effort variability, 100 ms post-transition trigger lockout, and 0.5 L/min tail threshold only as disclosed project-defined educational parameters pending separate evidence and review. They are not accepted as patient-reference behavior, device timing, diagnostic thresholds, or measured auto-PEEP. Later work must adjudicate the four choices independently.

## Recommended downstream order

1. VSM-CLIN-002: correct and protect the live VC VT characterization before any runtime decision.
2. VSM-CLIN-003 and VSM-CLIN-004: preserve PC-CSV cycle agent/breath type and separate measured from predicted no-breath values under CLIN-OD-004/005.
3. VSM-CLIN-005 and VSM-CLIN-006: implement valid same-breath hold mechanics and shared delivered-VE provenance under CLIN-OD-006/007.
4. VSM-CLIN-008: adopt canonical failed-trigger terminology while preserving the approved visual boundaries.
5. Obtain missing sources, especially Arnal 2018 and the exact Nguyen/Natalini works referenced during owner review; then execute VSM-CLIN-009 and VSM-CLIN-011 without inferring preset or alarm approval.
6. VSM-CLIN-010: adjudicate cases individually after their preset, monitor, morphology, and alarm prerequisites settle.
7. VSM-CLIN-013: disclose and independently adjudicate effort-model, lockout, and tail-metric choices.
8. VSM-CLIN-014: derive and approve the trapped-volume recurrence separately from prediction-label repair.
9. VSM-CLIN-007 and VSM-CLIN-015: conduct state-specific morphology reviews with complete numerical traces and direct screenshots before any baseline or interaction-label change.
10. VSM-CLIN-012: consolidate approved analytical/live/set/predicted provenance at point of use after the value-specific tickets define their contracts.
11. VSM-CLIN-016: specify pressure- and flow-trigger signal semantics before describing the modeled signals as device-equivalent trigger measurements.

## Commissioned verification record

The documentation revision was verified on 2026-08-13 without changing production code, tests, configuration, workflows, cases, existing documentation, or visual baselines:

- `npm test`: 300 passed / 0 failed.
- `npm run test:browser`: 44 passed / 0 failed.
- `npm run test:visual:docker`: 9 passed / 0 failed in the pinned Linux container.

The six approved Linux PNG SHA-256 values remained:

- `baseline-chromium-linux.png`: `8c54dc35cc1484da9eb0643024342a4551f964c2bba1c87b7608d36c6b19a2d6`
- `effort-chromium-linux.png`: `d3081684d33f7b5b461bdc58551b7a46f8bb1191e6dbeb32936efb1d804ee566`
- `effort-teaching-full-chromium-linux.png`: `481374533271842d55ede7cd9705a8b5c2d47246b22ec236b2e6d14f9d2580d1`
- `params-teaching-effort-chromium-linux.png`: `e0623f5bb73c28ce46a421024c07a31e8848d9cb4b1ce6783a68e2e27ef76fe6`
- `teaching-full-chromium-linux.png`: `b8ad20f66bf2be674dc4d90624b60453873bc03eae19c449382f198bca79cca7`
- `weak-csv-chromium-linux.png`: `99958f4d1883f167cc48cf0a0e0ffca97c1446556e525b985c74faf01d4a05a1`

These gates establish unchanged repository expectations and rendering only. They are not clinical, device, patient, or outcome validation. Final documentation commit and tree identifiers remain external Git metadata for the independent-review and handoff records, avoiding a self-referential tracked hash.

## Limits of the validation claim

CLIN-001 makes the current claims auditable. It does not make the simulator clinically validated. Rows marked verified are limited to the stated equation, taxonomy, implementation, display, and test scope with an available sufficient source. Internal consistency, rendering stability, and test conformance are necessary but not equivalent to bedside validity.
