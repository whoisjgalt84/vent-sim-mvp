# Evidence ledger

## Use rules

Only the approved local packet was used. Source files remain outside the repository. Page locators below are PDF page numbers; printed journal pages are included where useful. Claims were paraphrased rather than reproduced. A source appears in the matrix only when its listed anchor supports that row.

## Sources used

### MC2022 - normative peer-reviewed taxonomy

- **Citation:** Mireles-Cabodevila E, Siuba MT, Chatburn RL. A taxonomy for patient-ventilator interactions and a method to read ventilator waveforms. *Respir Care.* 2022;67(1):129-148. doi:10.4187/respcare.09316.
- **Local file:** `mireles-cabodevila-et-al-2021-a-taxonomy-for-patient-ventilator-interactions-and-a-method-to-read-ventilator-waveforms.pdf`
- **Domains:** TAG reading, equation of motion, VC/PC waveform interpretation, time constants, expiration, trigger/inspiratory/cycle/expiratory interactions, failed trigger, work shifting, waveform-reading method.
- **Anchors used:** PDF p.3 / journal p.131 Fig.1 and equation; p.4 / p.132 Fig.2 and opposite-control-variable rule; pp.6-8 / pp.134-136 for VC ramp, PC filling, time constants, expiration; pp.9-10 / pp.137-138 Tables 2-3 for interaction definitions; pp.12-16 / pp.140-144 for work shifting and cycling; p.17 / p.145 for multiple triggering and volume reset; p.19 / p.147 Table 4 for the systematic review sequence.
- **Role:** normative for interaction terms and supportive-to-normative for waveform mechanics.
- **Limitations/conflicts:** The PDF metadata/year differs from the repository key, but the journal issue is January 2022. Its equation table mixes volume and flow units; Vent-Sim uses a dimensionally consistent L and L/s convention. Fig.1 prints `S` for both set-point and servo; the repository correctly uses `s` and `r`. It lists “ineffective effort” as an alias for failed trigger, while later unavailable MC2026 is cited by the repository for stronger deprecation.

### H2014 - supportive peer-reviewed respiratory mechanics

- **Citation:** Hess DR. Respiratory mechanics in mechanically ventilated patients. *Respir Care.* 2014;59(11):1773-1794. doi:10.4187/respcare.03410.
- **Local file:** `2014-respiratory-mechanics-in-mechanically-ventilated-patients(1).pdf`
- **Domains:** equation of motion, PIP/Pplat, auto-PEEP, passive expiration, time constants, pressure/flow/volume/loops, compliance, resistance, MAP.
- **Anchors used:** PDF p.2 / journal p.1774 equation of motion; p.3 / p.1775 Fig.1 and plateau measurement; p.4 / p.1776 Figs.2-3, auto-PEEP and MAP; p.10 / p.1782 expiratory flow and tidal volume; pp.11-12 / pp.1783-1784 for compliance, driving pressure, and resistance.
- **Role:** supportive peer-reviewed mechanics source.
- **Limitations/conflicts:** Describes clinical measurement conditions and heterogeneous patients that the single-compartment model omits. Plateau and auto-PEEP measurements require passive conditions; analytical Vent-Sim readouts do not consistently enforce that condition.

### C2007 - normative peer-reviewed mode classification

- **Citation:** Chatburn RL. Classification of ventilator modes: update and proposal for implementation. *Respir Care.* 2007;52(3):301-323.
- **Local file:** `2007-classification-of-ventilator-modes-update-and-proposal-for-implementation(1).pdf`
- **Domains:** mode classification, control variables, breath sequences, set-point control, trigger/limit/cycle/baseline, mandatory/spontaneous breaths, flow cycling.
- **Anchors used:** PDF p.3 / journal p.303 equation and three-level mode description; p.4 / p.304 Tables 1-2 and VC-CSV exclusion; pp.5-6 / pp.305-306 for CMV/IMV and assisted/spontaneous distinctions; p.8 / p.308 for patient cycling and flow cycling; p.10 / p.310 Table 4 for VC-CMV, PC-CMV, and pressure-support PC-CSV phase variables.
- **Role:** normative peer-reviewed taxonomy source available in the packet.
- **Limitations/conflicts:** Uses an older three-level terminology and includes dual-control patterns that later controlled vocabulary refines. It supports the implemented mode families but does not validate the simulator's exact timing backstops or thresholds.

### VOCAB2019 - controlled vocabulary

- **Citation:** Chatburn RL. *Standardized Vocabulary for Mechanical Ventilation*, version 9.12.19. 2019.
- **Local file:** `@Standardized Vocabulary for MV v 9.12.19.pdf`
- **Domains:** controlled definitions for TAG, control variable, breath sequences/types, phase variables, pressure support, auto-PEEP, driving/tidal pressure, set-point targeting, time constants, trigger windows.
- **Anchors used:** PDF pp.1-2 maxims and five patterns; pp.3-5 auto-PEEP, CMV/CSV, control variable, cycle, driving pressure; pp.6-14 definitions for equation of motion, mandatory/spontaneous breaths, pressure support, sensitivity, set-point targeting, time constant, total PEEP, trigger window, and volume control.
- **Role:** controlled vocabulary.
- **Limitations/conflicts:** Not peer-reviewed in the form supplied. Its interaction vocabulary predates the unavailable MC2026 terminology cited by `docs/glossary.md`. It is controlling for definitions only where consistent with available peer-reviewed sources.

### FUND - foundational explanatory text

- **Citation:** Chatburn RL. *Fundamentals of Mechanical Ventilation.* Mandu Press. Optimized tablet edition supplied in the packet.
- **Local file:** `Chatburn-Fundamentals-of-MV-optimized-for-tablet(1).pdf`
- **Domains:** single-compartment model, phase variables, trigger sensitivity, limit/cycle distinction, pressure support, patient cycling, baseline, dynamic hyperinflation, auto-PEEP, alarms.
- **Anchors used:** PDF pp.37-40 for the equation and single-compartment limitations; pp.46-55 for trigger/limit/cycle/baseline and flow/patient cycling; pp.57-59 for dynamic hyperinflation, auto-PEEP, and total PEEP; pp.64 and 76 for PC-CSV/pressure-support classification; pp.83-84 for output alarm categories.
- **Role:** foundational text.
- **Limitations/conflicts:** Older explanatory material; it is not used to override later peer-reviewed taxonomy. Some statements describe real ventilators and circuits that Vent-Sim intentionally omits.

### C2013 - supportive peer-reviewed mode-selection framework

- **Citation:** Mireles-Cabodevila E, Hatipoglu U, Chatburn RL. A rational framework for selecting modes of ventilation. *Respir Care.* 2013;58(2):348-366. doi:10.4187/respcare.01839.
- **Local file:** `A Rational Framework for Selecting Modes of Ventilation.pdf`
- **Domains:** TAG hierarchy, mandatory/spontaneous definitions, clinical goals of safety/comfort/liberation, alarm-setting uncertainty, CSV synchrony.
- **Anchors used:** PDF pp.1-2 / journal pp.348-349 for taxonomy and breath definitions; p.7 / p.354 for the three goals; p.10 / p.357 for alarm uncertainty and patient-trigger/cycle synchrony; pp.16-17 / pp.363-364 for limitations and time-varying goal priority.
- **Role:** supportive peer-reviewed framework.
- **Limitations/conflicts:** A theoretical selection framework, not evidence for Vent-Sim alarm thresholds, case prescriptions, or outcome claims.

## Approved packet files reviewed but not used as clinical authority

- `Book - Fundamentals of MV.pdf` - archive/duplicate cross-check only; no matrix claim cites it.
- `@How to Teach Mechanical Ventilation (60 min).pdf` - historical teaching sequence; no material claim required it.
- `Slides - How to Teach Mechanical Ventilation (SHIVA).pptx` - corresponding historical deck; package was readable, but no material claim required it.

## Non-clinical traceability keys used in the matrix

- **PROJECT_OWNER_DECISION** - points to a specific entry in `owner-decision-log.md`. It is authority for approved teaching intent only, not independent clinical evidence.
- **PROJECT_DOCUMENTATION_ONLY** - points to the exact repository document, code surface, or governing invariant named in that matrix row. It records current project intent or behavior and cannot by itself support `VERIFIED_CORRECT`.
- **SOURCE_REQUIRED** - means no approved source in the supplied packet supports the material claim. The row's locator states the missing evidence needed; this is a gap marker, not a citation.

## Material cited sources missing from the packet

| Key | Repository use | Status and consequence |
| --- | --- | --- |
| C2023 | Current TAG maxims, targeting symbols, terminology | `SOURCE_REQUIRED`; available C2007/VOCAB2019 can support older definitions but cannot verify claims unique to C2023. |
| C2026 | Waveform/TAG claims and vendor-name counts | `SOURCE_REQUIRED`; no substitution made. |
| MC2024 | Simulation-training realism and validation claims | `SOURCE_REQUIRED`; no substitution made. |
| MC2026 | Discordance umbrella, updated interaction terms, maxims and thresholds | `SOURCE_REQUIRED`; terminology depending materially on it remains unresolved. |
| Arnal2018 | Arnal et al. 2018 preset parameter provenance and reference time constants | `SOURCE_REQUIRED`; presets cannot be labeled clinically verified from repository comments alone. |

## Owner-referenced follow-on evidence not reviewed

During SME disposition on 2026-08-13, Christian referred generally to Nguyen et al. regarding expiratory-occlusion quantification of auto-PEEP and Natalini et al. regarding expiratory flow limitation, expiratory timing, and auto-PEEP. Exact citations and files were not supplied in the approved packet. CLIN-001 therefore records the resulting requirements as `PROJECT_OWNER_DECISION` in CLIN-OD-014 and CLIN-OD-015 but does not cite either work as reviewed evidence. Exact Nguyen identification and review are required before VSM-CLIN-014 relies on that work for a clinical measurement claim; exact Natalini identification and review are required before VSM-CLIN-015 relies on that work for expiratory-flow-limitation or auto-PEEP interpretation. Alarm evidence is a separate missing-source stream owned by VSM-CLIN-011 and must not be inferred from either reference.

These gaps do not prevent implementation inventory. They do prevent a materially dependent claim from receiving `VERIFIED_CORRECT`.
