# VSM-CLIN-009 — mechanics-example provenance

On 2026-09-18 the owner approved Phase A decisions D1–D13, their exact copy and the bounded Phase B implementation plan. This records product decisions, not disease-wide clinical validation. Seven legacy keys and all R/C values remain unchanged. Constructor compliance remains 0.050 L/cmH₂O; app initialization loads `normal` at 0.060 L/cmH₂O and now displays 60 mL/cmH₂O consistently. Asset references use the coordinated `v=17` token at the existing 10 sites.

## Approved independent numeric and label oracle

| Decision/key | Approved label | R (cmH₂O·s/L) | C (L/cmH₂O) | Calculated τ (s) | Disposition |
| --- | --- | ---: | ---: | ---: | --- |
| D1 / `normal` | Normal example | 10 | 0.060 | 0.60 | Illustrative project pair; not Arnal's recommended Normal pair. |
| D2 / `ards_moderate` | Low compliance (35) | 10 | 0.035 | 0.35 | Neutral example; remove severity and baby-lung claims. |
| D3 / `ards_severe` | Low compliance (25) | 12 | 0.025 | 0.30 | Neutral example; remove severity and management-directed note. |
| D4 / `copd` | COPD example (HME) | 25 | 0.060 | 1.50 | Limited support: Table 9 COPD recommendation with heat-and-moisture exchanger. |
| D5 / `asthma` | High resistance (20) | 20 | 0.060 | 1.20 | Neutral example; acute-asthma validity unsupported. |
| D6 / `obesity` | Reduced compliance (40) | 8 | 0.040 | 0.32 | Neutral total-system example; obesity/chest-wall attribution unsupported. |
| D7 / `fibrosis` | Low compliance (30) | 8 | 0.030 | 0.24 | Neutral example; pulmonary-fibrosis validity unsupported. |

Parenthetical numbers identify the configured C in mL/cmH₂O or R in cmH₂O·s/L. Point-of-use help states the pair and units. All displayed model time constants use current R × C, with C in L/cmH₂O. HME is source context, not separately modeled hardware.

D8–D10 remove blanket Arnal/heated-humidifier attribution and the isolated ETT 5–8 claim, distinguish measured source quantities from model calculations, retain manual exploration limits, and add the approved selection disclosure/help. D11 reconciles the startup display only. D12 uses “Custom mechanics” after any manual R/C edit, retains that presentation across resets, and identifies the selector as the last loaded example. Reloading an example restores its label and note. D13 corrects current documentation and adds separate exact tests; it does not change historical evidence or approve case narratives.

## Source findings and limits

Primary reference: Arnal J-M, Garnero A, Saoli M, Chatburn RL. *Parameters for simulation of adult subjects during mechanical ventilation.* Respiratory Care. 2018;63(2):158–168. [DOI 10.4187/respcare.05775](https://doi.org/10.4187/respcare.05775).

Phase A reviewed the author-uploaded full text through p.168 on [ResearchGate](https://www.researchgate.net/publication/320468373_Parameters_for_Simulation_of_Adult_Subjects_During_Mechanical_Ventilation), not just an abstract. Primary PDF/table images could not be retrieved; independent primary-table image confirmation remains missing. The accessible Table 9 ARDS RC cells conflict with calculated R × C. That discrepancy remains unresolved and has not been corrected or used to change the equation. Owner approval accepts limited provenance treatment despite these explicit limits.

Printed pp.159–161 Methods and Tables 1–2: single-ICU, passive, deeply sedated, intubated adults, invasive ventilation under 48 h; BMI above 30 and mixed conditions excluded. N=359 (138 Normal, 40 COPD, 181 ARDS); both HH and HME used. Compliance is static total respiratory-system compliance, not isolated chest-wall or lung compliance. Inspiratory resistance and measured expiratory time constant use different measurement methods. Measured RCexp uses volume/flow at 75% of expiratory VT; it is not the product of group-median inspiratory R and C.

Printed p.161 Table 3 gives separate group summaries, not individual paired R/C observations. Printed p.163 Table 5 and Fig.3 do not support a deterministic ARDS severity-to-compliance ladder (C P=.16; R P=.74; RCexp P=.08). Printed p.166 Table 9 supplies simulation recommendations: COPD HME R25/C60 matches the retained pair; COPD HH uses R20/C60. Numerical coincidence with a different source column does not establish disease-specific provenance. Table 4's total resistance by ETT size/humidification does not establish an isolated additive 5–8 tube contribution.

No asthma or fibrosis cohort supports these legacy disease labels; obesity is excluded. No replacement source was silently substituted. Study limitations on pp.165–166 include single center, one ventilation mode, passive measurements and management/PEEP influences. Current effort, mode, timing and manual-range behavior does not inherit clinical validation from this paper.

The immutable Phase A report, exact copy and detailed locator/value ledger remain under `scratch/shots-vsm-clin-009-phase-a/`. In particular, `source-to-claim-ledger.md` separates population measurements, author recommendations, interpretation and proposed product decisions. This record supplements [CLIN-OD-010 and related owner decisions](../CLIN-001/owner-decision-log.md); it does not rewrite that historical packet. CLIN-OD-017 model omissions and CLIN-OD-016 external-validation limits remain in force.

## Coverage correction and remaining scope

Historical TEST 9 in `tests/test-engine.js` prints the preset table but has **zero assertions**. Adjacent clinical sanity output and the TEST 13 ramp/square grid do not establish disease validity. Historical CLIN-001 evidence is preserved; any broader wording there must be read with this correction. `tests/preset-provenance.test.mjs` supplies an independent exact key/pair/label/note oracle, separate from the existing 300-check engine gate. `scratch/verify-preset-provenance.cjs` verifies actual rendered text, startup, selection, custom state, history retention, help and resets, separately from the existing 44-check gate. Tests establish implementation conformance only.

Case selector references are maintained; clinical narratives, interventions and learning judgments remain draft under VSM-CLIN-010, including the unverified Case 3 ARDSnet comparison. Case 4 changes both R and C. Responsive layout, general contextual-help standardization, waveform annotation placement, clinical morphology, source-table correction research and disease-specific restoration remain separate work.

Phase B prepares isolated Linux visual candidates for owner inspection. Accepted baseline installation and Git publication require separate authorization.
