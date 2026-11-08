# Overlay help: premerge persistence and accessibility fixes

## Candidate and authorization

This is a focused successor to the [original panel closeout](overlay-help-panel.md), based on commit `742ef20c403d622abf32339d32ead542f8dc3b7b` in [PR #59](https://github.com/whoisjgalt84/vent-sim-mvp/pull/59). The fixes are uncommitted local changes. The [source manifest](evidence/overlay-help-premerge/premerge-fix-source-manifest.json) records 12 runtime/test/runner file hashes, including unchanged inputs retained from the original panel manifest. Seven of these paths changed from the base. This is not a full repository tree or commit identity; this documentation is outside the runtime manifest.

Final independently reviewed main.js SHA256: `6bad29efac6c08cbc8f4fe88cbd00be7655cd56b2ab61762e79a88ebe5773838`.

Christian approved fixing both premerge findings and adding regression checks, then separately approved this documentation-only update. His earlier preview acceptance applies to the original panel; it is not claimed as a separate acceptance of these later fixes or permission to publish them. No staging, commit, push, merge, release or deployment is authorized by this closeout.

## Findings and corrected behavior

Fresh adversarial review of the original candidate reproduced two issues despite its green checks:

1. Hovering another help trigger could replace a pinned explanation. If keyboard focus was inside the panel, replacement could hide the focused controls and drop focus to the document body.
2. Standard mode advertised waveform activation, but the Teach-only lifecycle immediately dismissed the requested explanation.

Passive hover now leaves shared help unchanged while it is pinned or contains keyboard focus. This applies to both static help triggers and genuine waveform cue hover. Deliberate activation can still switch help; explicit dismissal, outside click and focus restoration remain. The permanent regression covers pinned-only, pinned-and-focused, and unpinned-but-focused reading across both static triggers and canvas cues.

Standard mode now gives the canvas the plain label "Flow waveform." and tabindex -1, with no overlay keyboard activation. Teach enables tab access and the activation instruction. Turning Teach off dismisses obsolete context and restores focus to Teach when needed. The accessibility state changes synchronously with the toggle rather than waiting for the next paint. Installed Chrome testing exposed that timing edge during implementation; the final checks were rerun after its correction.

All eleven local asset references use version 34. Simulation and ventilator edits only update those imports. Clinical wording, cue-type absence status, no-misattribution sentence, event provenance, physics, alarms and canonical measurements are unchanged. No approved screenshot baseline or tolerance was changed.

## Final retained verification

These are local execution receipts from the final source, retained during this documentation-only update. No simulator gates were rerun for documentation changes, and these are not new CI results. Earlier CI for commit 742ef20 does not cover these uncommitted fixes.

| Gate | Final result |
| --- | --- |
| Engine | [526 mixed assertions/groups/fixtures, zero failures](evidence/overlay-help-premerge/premerge-fix-engine.log). These are not equivalent unit tests. |
| Full browser | [132 checks/groups, zero failures](evidence/overlay-help-premerge/premerge-fix-browser-final.log): prior 130 plus two regression groups; eight overlay groups total. |
| Pinned-Linux visual | [21 groups passed](evidence/overlay-help-premerge/premerge-fix-visual.log): 18 commissioned plus three manual-hold groups, Playwright 1.62.1 noble, snapshot updates disabled. |
| Installed Chrome | [Eight focused groups passed](evidence/overlay-help-premerge/premerge-fix-chrome.log). |
| Installed Edge | [Eight focused groups passed](evidence/overlay-help-premerge/premerge-fix-msedge.log). |
| Passive-hover mutation | [Disabled protection rejected](evidence/overlay-help-premerge/premerge-fix-mutation-passive.log). |
| Standard-mode mutation | [Incorrect tab order rejected](evidence/overlay-help-premerge/premerge-fix-mutation-standard.log). |

The mutation receipts intentionally contain assertion failures; they show the new regressions reject broken code, not failures of the final candidate. The browser-final receipt supersedes the earlier in-progress browser run that overlapped the synchronous toggle correction. Older mutation and CI receipts retain their original candidate scope. The authoritative current inventory is in [CLAUDE.md](../CLAUDE.md#verification-inventory).

Independent targeted Chromium review verified passive-hover protection, deliberate switching, Escape and Teach-off focus, Standard-mode behavior, and ten immediate Teach toggles with unchanged simulated time and no page errors. Initialization has the required simulation and DOM available. Final review found no remaining issue; it did not independently rerun every aggregate gate.

## Integrity and limits

The 12 source hashes match the retained final manifest. All 162 installed reference hashes still match the [existing reference manifest](evidence/usability-followup/reference-manifest.json). Earlier panel documents, source manifest and receipts remain historical and unchanged except for the successor link. This closeout adds text/JSON evidence only; local screenshots and scratch previews are excluded.

Physical touch devices and actual NVDA/Narrator or other screen-reader sessions remain untested. Touch coverage is browser emulation; zoom coverage is 150% CSS zoom. Controlled cue disappearance does not prove natural event aging. Keyboard/accessibility-tree checks and owner preview approval are not exhaustive accessibility or clinical validation.

This documentation update makes no claim of current remote freshness or new owner acceptance. Before any later publication, recheck exact candidate identity and remote state. Staging, committing, pushing and merging need their applicable authorization. Merging main publishes GitHub Pages under the established configuration, including documentation merges.
