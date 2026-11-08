# Overlay help panel: accepted local candidate

**Later successor:** the [premerge persistence and accessibility fixes](overlay-help-premerge.md) address two subsequently reproduced interaction defects. The original candidate was committed as `742ef20c403d622abf32339d32ead542f8dc3b7b`; this earlier closeout retains its original acceptance, identities and evidence, not a claim about the corrected candidate.

## Scope and candidate identity

This focused successor to the [usability follow-up](usability-followup.md) is based on `f7cb9d84be87942390365068f38b522b8da34f8b` (PR #58). The candidate is uncommitted. The [12-file source manifest](evidence/overlay-help-panel/source-manifest.json) identifies the reviewed runtime, tests and runner inputs by SHA256; it is not a whole-repository tree or commit identity. Documentation added by this closeout is not part of that runtime manifest. The source hashes still match the tested candidate.

The waveform's native title is replaced by a compact app-controlled panel using the existing body-level help infrastructure and stable legend help buttons. Hover discovers an explanation and pointer transfer into the panel keeps it readable. Click, tap, Enter or Space pins it; Keep open, Close and Escape remain available. Focus restoration avoids immediately reopening a dismissed panel. There is no fixed reading deadline. Reset, mode changes and Teach off dismiss obsolete context safely.

Explanations remain separate from current cue-type visibility. When every explained cue type is visible, there is no status line. Missing types alone produce a concise `Not currently visible:` notice. This status describes cue types, not the identity of a particular historical event. Both explanations remain available, including cause-specific failed-trigger wording. The retained sentence is: "These explanations describe highlighted intervals, not necessarily the breath under the pointer." Both failed-trigger variants now use `Failed trigger:`; the flow explanation retains `Flow baseline cue:`. Other clinical wording is unchanged.

Actual stroke/label hit geometry, positive expiratory-flow eligibility, phase-history and sweep boundaries remain. No physics, event detection, alarms or canonical measurement is changed. The simulation and ventilator file changes only update asset references. All eleven local asset references use version 33. The historical failed-effort span/provenance limitation in the [earlier overlay repair](teaching-overlay-help-repair.md) is not fixed by this panel.

## Owner acceptance

Christian approved the focused implementation plan, then approved hiding the normal visible-status line and standardizing the punctuation while retaining the disclaimer and clinical wording. After reviewing the revised local preview, he said, "This looks perfect!" He separately authorized this documentation-only closeout. That preview acceptance does not authorize staging, commit, push, PR creation, merge, release or deployment.

Before/refined previews remain local and are not included here. No screenshot or visual reference is added, replaced or retired by this closeout. The 162 installed references in the [existing reference manifest](evidence/usability-followup/reference-manifest.json) remain byte-identical.

## Retained verification

These receipts were produced after the approved refinement, before this documentation-only closeout. No simulator gates were rerun for these documentation changes, and these are local results, not CI results.

| Gate | Retained result |
| --- | --- |
| Engine | [526 mixed top-level assertions/groups/fixtures, zero failures](evidence/overlay-help-panel/refinement-engine.log). Counts are not equivalent unit tests. |
| Browser | [130 checks/groups, zero failures](evidence/overlay-help-panel/refinement-browser.log): prior 124 plus six overlay-panel groups. |
| Pinned-Linux visual | [21 groups passed](evidence/overlay-help-panel/refinement-visual.log): 18 commissioned plus three manual-hold groups, using Playwright 1.62.1 noble with snapshot updates disabled. No tolerance or baseline change. |
| Installed Chrome | [Six focused groups passed](evidence/overlay-help-panel/refinement-chrome.log). |
| Installed Edge | [Six focused groups passed](evidence/overlay-help-panel/refinement-edge.log). |
| Refined absence notice mutation | [Deliberately broken notice rejected](evidence/overlay-help-panel/refinement-status-mutation.log); this expected failing receipt is mutation proof, not a failed candidate gate. |

The authoritative current gate inventory remains in [CLAUDE.md](../CLAUDE.md#verification-inventory). Focused groups cover RR24/RR35 hover/re-entry, pointer transfer, pinning, retained text nodes, keyboard and touch access, focus/Close/Escape, reset/mode/Teach-off lifecycle, missing/mixed/returning cues, both failed-trigger variants, narrow layouts and zoom. Existing usability checks cover positive expiratory flow and 5/10/30-second sweep windows.

Earlier local mutations rejected broken discovery, stale visibility, text-node churn, broken pinning and broken first re-entry. Only the status mutation was rerun after the refinement; the other mutation receipts apply to the preceding candidate. Full interaction and aggregate gates were rerun after refinement. Those older diagnostic receipts remain local, not part of this evidence set.

Independent static and targeted Chromium review verified the fixes for pointer transfer, text-selection churn, explicit touch hit-testing and first hover re-entry. Final refinement review found no remaining substantive issue, including absent/mixed/returned cues and retained text. This was not an independent execution of all aggregate gates or clinical validation.

## Limits and publication boundary

Touch checks use browser touchscreen emulation. Zoom coverage is 150% CSS zoom, not a physical browser-menu zoom session. Disappearance/mixed/return fixtures deliberately control renderer visibility; they do not establish natural physiological event aging. Keyboard and accessible dialog-tree checks passed, but no actual NVDA/Narrator or other screen-reader session was performed. Static preview approval is not exhaustive accessibility, device or clinical validation.

The original checkout remains separate from this isolated candidate. Local source hashes and installed-reference hashes were checked during closeout; remote main freshness was not checked. Recheck remote state and exact tested-versus-committed identity before proposing publication. Stage explicit approved paths only; generated screenshots and scratch previews are excluded. Push and a draft PR need explicit authority; merge needs separate authority and publishes GitHub Pages under the established configuration. No staging, commit, push, PR, merge, release or deployment is performed by this closeout.
