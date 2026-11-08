# Usability follow-up: accepted local candidate

**Later successor:** the [accepted overlay help panel](overlay-help-panel.md) replaces native waveform hover help with an app-controlled panel. This record retains its historical scope, identities, acceptance state and results.

## Scope and identity

This follow-up is based on `19085369ceb04402a66dd3932eb628cc5e50c653` (PR #57), in local branch `fix/usability-followup-20261107`. It has not been committed or published by this closeout. The reviewed 15-file source manifest identity is `6d26446e569ea5b1e0f72ddef78036d5f1421e55f4201705e48003dedccb3f9d`; this is a changed-file manifest identity, not a Git commit or a hash of the entire repository. Exact paths and SHA256 values are retained in the [source manifest](evidence/usability-followup/source-manifest.json).

The implemented scope is:

- Teach mode exposes stable explanations when hovering actual expiratory-flow segments while an air-trapping or failed-trigger overlay is visible. Both explanations are combined when both overlays are visible. Copy describes visible highlighted intervals, not an assertion that the breath under the pointer experienced the event. Event-specific highlighting and keyboard/touch help remain.
- All five Additional outputs subgroups start collapsed and retain user choices within the session.
- Timed machine-trigger symbols are omitted and legend/help wording is updated. Underlying trigger records, patient-trigger symbols, failed-trigger cues and physiology remain.

## Display-only phase contract

`sim.buffers.expiration` records the phase used to solve each waveform sample, captured before transition handling. Values are 1 for expiration and 0 otherwise; prefilled history uses NaN for unknown. Time, flow and phase histories use aligned ring positions and the same display slice. Hover does not infer expiration from flow sign: positive, zero and negative flow can qualify when the recorded phase is expiration. Missing, misaligned, nonfinite or unknown metadata must not create an expiration claim. Reset, mode clearing, ring overwrite, sweep gaps and display-window changes retain these boundaries.

This record is presentation metadata. No breathing-model equation, trigger criterion, alarm decision or canonical measurement is changed. Tests cover transition samples including holds, all four modes, history slicing and independence of physiology from corrupted display metadata. The pre-existing historical failed-effort span/provenance limitation described in [the earlier overlay repair](teaching-overlay-help-repair.md) is not claimed fixed here.

## Owner acceptance and installed references

Christian reviewed all 162 gallery comparisons and explicitly approved them. His confirmation included:

- #58: waveform remains easy to read despite the 320px high-DPI legend wrapping and plot reflow.
- #120 and #131: curves and labels remain clear in the narrow PC-CSV and PC-CMV teaching layouts.
- #88 and #162: amber failed-trigger cues remain distinguishable, including positive-flow failed effort.
- #60: revised trigger-symbol wording accepted.

He then separately authorized installing the reviewed references and running the full visual suite with updates disabled. The [reference manifest](evidence/usability-followup/reference-manifest.json) retains prior and installed hashes for every path: 146 waveform and 16 manual-hold references, 162 total. Exactly 130 changed images were installed (119 waveform, 11 manual-hold); 32 byte-identical references were untouched. There are no additions or retirements. All 162 installed hashes and all 15 source hashes were verified before and after the installation run. Independent audit confirmed the same scope, empty staging and unchanged configuration/tolerances.

## Verification provenance

These are retained local results for the exact reviewed source, not new executions during this documentation-only closeout and not CI results:

| Gate | Result and provenance |
| --- | --- |
| Engine | 526 mixed top-level assertions/groups/fixtures, 0 failures: prior 520 plus 6 phase-history groups. [Retained engine log](evidence/usability-followup/engine.log). Counts are not 526 equivalent unit tests. |
| Browser | 124 groups, 0 failures: prior 120 plus 4 usability groups. [Retained browser log](evidence/usability-followup/browser.log). |
| Candidate visual generation and comparison | Generation and three updates-disabled comparisons each passed 21 groups. An independent built-in trace audit verified 162 successful unique screenshot assertions with no missing or extra references. [Candidate execution audit](evidence/usability-followup/candidate-execution-audit.json). This audit precedes installation and must not be described as a new post-install trace. |
| Installed-reference visual gate | 21/21 groups: 18 waveform/determinism/cache groups plus 3 manual-hold groups, 46.1 seconds. [Post-installation log](evidence/usability-followup/installed-visual.log). Engine/browser gates were not rerun for the PNG-only installation. |

Visual commands used the pinned `mcr.microsoft.com/playwright:v1.62.1-noble` Linux image and Chromium. Comparison used `--update-snapshots=none`, snapshots enabled, existing `maxDiffPixelRatio: 0.0002` and `threshold: 0.1`, animations disabled, caret hidden, one worker and zero retries. CSS scale is the default; the two high-DPI scenarios explicitly use device scale. Group counts differ from PNG counts.

The implementation-stage receipt also records ten mutation checks failing as intended (collapse, broad help, machine markers, wrap, nonfinite gap, sign inference, phase slice offset, post-transition phase, prefill and missing metadata push). Those mutation logs and supplemental pointer screenshots remain local diagnostics under ignored `scratch/shots-usability/`; they are not included in this tracked evidence set. Independent source review found no blocking defect.

## Evidence limits and next actions

The 320px changes include actual legend wrapping and plot reflow, not solely marker removal; owner acceptance includes those tradeoffs. Exact RGBA pixel differences in the review package are diagnostics, not Playwright's perceptual tolerance metric. Automated repeatability is not clinical validation.

Native pointer inspection reached the positive-expiration help and observed stable title text across ten further ticks while the segment remained visible. Native tooltip appearance itself was not captured by the screenshot. Static gallery images do not establish hover, keyboard or touch behavior; corresponding interaction checks are in the browser suite. No claim of an exhaustive device or assistive-technology review is made.

This document supersedes the obsolete pending-visual-acceptance section of the earlier local `phase-receipt.md`; that receipt remains historical. Earlier tracked slice documents retain their historical identities and counts. The current required inventory in [CLAUDE.md](../CLAUDE.md) is updated separately.

This closeout changes documentation/evidence only. No runtime, test recipe, installed PNG or tolerance change is authorized here. Staging, local commit, push/PR, merge, release and deployment require their applicable separate authority. Merging to main publishes GitHub Pages under the established configuration. Remote main freshness must be checked before proposing a PR; no remote-freshness claim is made here.
