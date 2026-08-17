# VSM-CLIN-001 clinical contract baseline

## Purpose

This directory establishes traceability for clinically meaningful behavior in Vent-Sim at commit `b3c895c914070920d8122d3b88134d03107f1e51` (tree `5b5e7dfc8322b911aae1ad4c2b70bf1737262133`). It separates four kinds of truth that must not be treated as interchangeable:

1. **Evidence truth** - what an available clinical source supports.
2. **Implementation truth** - what the live tick integrator, analytical helpers, alarms, renderer, and UI do.
3. **Expectation truth** - what current tests and project documents require.
4. **Approved teaching truth** - what Christian Striggow has explicitly accepted.

The traceability chain is: source -> atomic claim -> implementation -> display/output -> test -> disposition -> downstream action.

## Non-claims

CLIN-001 does not change runtime behavior, tests, existing documentation, workflows, configuration, cases, teaching copy, or visual baselines. It does not establish device equivalence, clinical-outcome validity, test-lung validity, or patient-data validity. Vent-Sim remains an equation- and evidence-based educational model with explicit simplifications.

A green engine test, browser test, or PNG comparison proves conformance to a current expectation or stable rendering only. It does not independently establish clinical correctness or morphology approval.

## Artifacts

- `evidence-ledger.md` records the source packet actually used, exact anchors, roles, limitations, and missing cited evidence.
- `clinical-truth-matrix.csv` contains one adjudicable clinical claim per row and traces it through evidence, implementation, display, test, disposition, and action.
- `clinical-review-report.md` summarizes agreements, divergences, limitations, and recommended downstream order.
- `owner-decision-log.md` records only explicit decisions by Christian; silence and visual approval are not decisions.
- `implementation-backlog.md` proposes bounded downstream work without implementing it.

## Status vocabulary

Matrix dispositions are restricted to `VERIFIED_CORRECT`, `ACCEPTED_SIMPLIFICATION`, `CANDIDATE_DEFECT`, `INTERNAL_INCONSISTENCY`, `TERMINOLOGY_CONFLICT`, `TEST_COVERAGE_GAP`, `EVIDENCE_GAP`, `OUT_OF_SCOPE`, and `OWNER_DECISION_REQUIRED`.

Evidence strength is restricted to `NORMATIVE_PEER_REVIEWED`, `SUPPORTIVE_PEER_REVIEWED`, `FOUNDATIONAL_TEXT`, `CONTROLLED_VOCABULARY`, `HISTORICAL_TEACHING_MATERIAL`, `PROJECT_OWNER_DECISION`, `PROJECT_DOCUMENTATION_ONLY`, and `SOURCE_REQUIRED`.

Test strength is restricted to `DIRECT_NUMERIC_ASSERTION`, `DIRECT_BEHAVIOR_ASSERTION`, `INVARIANT_ASSERTION`, `VISUAL_RENDERING_ONLY`, `INDIRECT_COVERAGE`, and `NOT_TESTED`.

Unknown or inapplicable fields use `NOT_APPLICABLE`, `NOT_TESTED`, `SOURCE_REQUIRED`, or `OWNER_DECISION_REQUIRED`; blank cells are prohibited.

## Evidence precedence

1. Current explicit owner decisions govern approved teaching intent and Red-lane choices.
2. The most recent applicable peer-reviewed source in the approved packet governs terminology, taxonomy, mechanics, and interaction definitions.
3. `docs/glossary.md` is normative repository vocabulary, but claims that materially depend on an unavailable citation remain `SOURCE_REQUIRED`.
4. `docs/model.md` describes project intent and known limitations; it is not independent validation.
5. Runtime code is authoritative for implementation behavior. `SimulationEngine` is primary for on-screen physiology; `Ventilator.generateBreathWaveforms()` and closed-form properties are separate analytical paths.
6. Tests establish current expectations, not clinical authority.
7. Approved Linux PNGs establish rendering stability only.
8. Historical teaching material is supportive, never controlling when later peer-reviewed taxonomy differs.
9. Manufacturer terms are not normative; TAGs and controlled vocabulary are.

Conflicts are recorded, not resolved by majority vote.

## Documentation revision provenance

The reviewed implementation base above is immutable. The final documentation commit and tree are Git metadata reported by the independent reviewer and the handoff, rather than embedded here: inserting a commit or tree identifier into a tracked file would change that same commit and tree and create an impossible self-reference. The review report records the commissioned gate tallies and the six baseline hashes for the documentation revision.

## Maintaining traceability

Every later clinical ticket should:

1. cite affected `claim_id` values;
2. state the intended clinical disposition and owner decision when Red-lane;
3. update evidence locators when adding or replacing a source;
4. distinguish live and analytical paths;
5. specify calculation timing, display timing, null/stale behavior, and alarm consumers;
6. add a focused regression assertion and prove it fails against the pre-change behavior;
7. require direct screenshot review for UI or morphology changes;
8. identify the applicable K-row limitation when a learner-facing claim, preset, case, or waveform interpretation depends on an omitted mechanism, and obtain separate scope-expansion approval before clinical approval; and
9. update this contract in the same downstream ticket after the behavior is approved and verified.

An `OUT_OF_SCOPE_CONFIRMED` K row defines the current MVP and CLIN-001 contract, not a permanent roadmap exclusion. It does not require a standalone implementation ticket unless separately authorized.

Existing files should not be retrospectively edited to make an unresolved matrix row appear settled. A disposition changes only when the evidence, implementation, test, display, and owner-decision record justify it.
