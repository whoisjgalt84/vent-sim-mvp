# Setting editor implementation history

The current isolated candidate is the **Primary tile successor** described below.
That section supersedes the earlier bounded interaction and verification scope.
The earlier record is retained as history, not as the current UI specification.

## Earlier bounded candidate

Implementation scope approved by Christian on 8 November 2026: VT in VC-CMV, Target VT in PC-CMVa, and PEEP in all four modes. This is an uncommitted local candidate, not acceptance or publication authority.

## Interaction contract

Click or keyboard-activate an underlined value to open the nonmodal editor. The existing VT and PEEP sliders also propose a draft, rather than writing immediately. Their thumb follows a valid draft while open and returns to the accepted selection on dismissal. The displayed control value remains the accepted selection. All unrelated controls retain their behavior.

The editor separates applied settings, accepted adaptive requests waiting for the next breath, and the unconfirmed draft. Numeric text and +/- use the existing VT 200–800 mL / 10 mL step and PEEP 0–24 cmH2O / 1 cmH2O step. Blank, nonnumeric, out-of-range and off-step values cannot be confirmed. Invalid text is retained for correction rather than coerced or clamped into an accepted value.

Opening, focusing, navigation, unchanged input and unchanged Confirm do not send a setting notification. Each actual draft change does send the existing measurement-settings notification, even invalid/blank text or an edit followed by a revert. It can cancel an armed/active hold and invalidate adaptive feedback immediately. Cancel/Escape discards only the unconfirmed value and cannot undo those consequences. Existing hold focus-loss and pointer cancellation rules remain intact.

Confirm alone uses the existing setting callbacks. Nonadaptive changes synchronize the existing measurement fingerprint; adaptive changes call requestAdaptiveSettings, retaining atomic queue and breath-start application. No simulator/controller law or patient RR/neural Ti behavior is changed. An intervening breath can apply an already accepted request but does not confirm the open draft.

Reset, mode/flow transitions, other setting edits, mechanics-example loads, Effort On/Off and entering Teach dismiss a stale draft. Confirm additionally checks mode, simulation generation and accepted selection. Closing restores focus to its visible trigger for explicit Cancel/Escape/Confirm; unrelated context changes retain their own focus.

## Verification

The browser runner commissions 12 new setting-editor groups, in addition to the existing 132. Existing setting-control helpers explicitly confirm VT/PEEP, with their original behavioral assertions retained. The cache version is 35 at all eleven sites. Four response-only mutants exercise missing draft safety notification, immediate draft writes, side effects from unchanged Confirm, and missing step validation; mutations never modify runtime files.

Full candidate receipts, exact source hashes, screenshots and review status are retained separately in local scratch evidence. The existing Linux visual baselines are unchanged. Comparison failure due to intentional UI changes is not a passing visual gate or owner acceptance. Commit, push, PR, merge, release and deployment remain separately unauthorized.


## Primary tile successor candidate (8 November 2026)

Christian authorized extending the shared editor to the primary setting family.
Christian accepted the final visual review and separately authorized reference
installation on 8 November 2026. This remains an uncommitted isolated candidate.
The earlier evidence above describes its earlier source; the current closeout
below identifies the reviewed successor and its retained verification.

- VC-CMV: VT, Resp Rate, PEEP, FiO2.
- PC-CMV: Pinsp, Resp Rate, PEEP, FiO2.
- PC-CSV: Pressure Support, PEEP, FiO2; no ventilator RR tile.
- PC-CMVa: Target VT, Resp Rate, PEEP, FiO2.

A tile shows the applied value and unit. Adaptive accepted Target VT and PEEP
waiting for the next breath appear separately, including in the tile's
accessible description. Selecting a tile only opens the editor. Numeric entry,
plus/minus and the editor range slider change an unconfirmed New value; there
is no visible immediate-write primary slider. Existing hidden source controls
also route input through the draft path and cannot bypass Confirm.

Confirm validates the existing range/step and invokes the original setting
callback. RR, FiO2, Pinsp and PS are accepted immediately on Confirm, with no
new breath-boundary queue. Only adaptive Target VT and PEEP retain their existing
requestAdaptiveSettings queue. Every actual draft change still sends the
existing edit-attempt notification, including invalid/blank/edit-revert input;
Cancel cannot reverse a canceled hold or invalidated adaptive context. Opening,
focus/navigation and unchanged Confirm send no edit notification. Existing
hold pointer/focus cancellation is independent and unchanged.

The desktop editor is positioned next to the settings rail and clamped to the
viewport. Narrow layouts use a scrollable bottom sheet with reachable actions;
the selected tile is scrolled above it on opening when needed. The complete
waveforms, outputs, alarms and secondary controls remain in the page. Secondary
and patient setting behavior is unchanged. Asset version is 37 at all 11 sites; the mode-notice closeout below records the later cache-only version update.

No accepted snapshot installation, commit, push, PR, merge, release or deployment
is authorized by this implementation approval. Final candidate evidence and
owner visual acceptance are separate requirements.


## Accepted local candidate and evidence (8 November 2026)

### Owner review and scope

Christian tested setting changes and Cancel across all modes and settings, then
approved the polished tiles and editor. He reviewed the complete comparison
gallery and reported no issues, specifically examining images 140, 148, 144,
28, 69, 12 and 106. That acceptance includes pressure-mode tiles, adaptive
pending values, the narrow layout and monitor/hold-panel crops; it is not
exhaustive clinical or accessibility validation.

The final polish replaces the remaining visible "draft" warning with
"Changing this value" while retaining its hold/adaptive safety consequences.
Tile labels remain 12px and numbers 16px; units are separate 12px spans.
Pressure Support has a deliberate two-line label. Equal-height rows and
minimum-height content slots preserve complete units and pending-state text
without forcing a fixed-height crop. The final inline-block unit rule corrects
a reproduced missing painted unit after repeated edits. The regression check
rejects removal of that rule; geometry assertions alone are not proof of paint.

### Candidate and reference identities

The local base is commit cda77473739f950d540b572196758e7be88c2c13.
The [reviewed source manifest](evidence/setting-editor/reviewed-source-manifest.json)
records 78 explicit files with canonical-entry SHA256
780b4d81de4774b7d7d4c7e527350891b1786b48024a95f38bc86983e6f1362b.
This identifies the reviewed evidence copy, not a full Git tree or commit.
Its CLAUDE.md entry records the pre-closeout document; this documentation-only
pass changes that entry but leaves every runtime/test/runner input unchanged.

Final main.js SHA256: 92c703914c4e661eef6aaefa5f477c7716a3f87dff02e30325eedb49e4451f98.
Final style.css SHA256: 9ce4b98b63c9e5b378da592200336612c7eb089d3f185604eca2b7b317d3b5a1.

The [generation manifest](evidence/setting-editor/reviewed-gallery-manifest.json)
records all 162 reviewed image paths and hashes. Its accepted:false flag and
acceptedReferencesPreserved field describe generation before owner review and
installation; they are retained historical facts, not the current acceptance
status. The [closeout record](evidence/setting-editor/acceptance.json) records the
later owner acceptance and installation without rewriting that history.

Exactly 98 reviewed changed PNGs were installed: 83 waveform and 15 manual-hold
references. The other 64 identical files were retained. All 162 installed files
match the generation manifest's candidateSha256 values. The 16 supplemental
editor/responsive previews were reviewed aids, not installed snapshot baselines.
The complete original gallery remains local scratch evidence, not a published
artifact. Earlier focused galleries are stale for this final polish.

The closeout record preserves each receipt's original local-byte `sha256` and
adds `gitNormalizedSha256` for the Git blob after the repository's LF text
normalization. Verify committed receipts against the latter; the original
hashes remain historical capture evidence. This changes no receipt content
beyond Git's existing line-ending normalization and does not rerun tests.

### Retained verification

This documentation-only pass runs no simulator gate and establishes no new CI
result. It carries forward the following named local receipts:

| Gate | Result and scope |
| --- | --- |
| Engine | [526 mixed assertions/groups/fixtures, zero failures](evidence/setting-editor/engine.log), including the original 300 assertions. Run before the final CSS-only unit fix and carried forward; it was not rerun for that fix, reference installation or documentation. |
| Full pinned-Linux browser | [144 existing groups plus 16 responsive layout cases passed](evidence/setting-editor/browser-linux-final.log) on final unit-fix source. Includes the 12 setting-editor groups; the 16 layout cases are not 16 equivalent clinical tests. Carried forward through reference installation and documentation. |
| Pinned-Linux visual after installation | [21/21 groups passed](evidence/setting-editor/installed-visual.log), including 18 commissioned and three manual-hold groups, against the 162 installed references. Updates disabled, snapshots enabled and tolerances unchanged; pinned Playwright v1.62.1-noble. This final receipt supersedes the earlier 7/21 comparison against old slider references. |

The browser coverage includes maximum applied values, queued adaptive values,
uniform tile heights, containment, typography, editor copy and repeated edit
flows. Direct Windows and Linux captures verified the Pressure Support unit.
Before installation, the isolated generation and two update-disabled comparison
runs also passed 21/21. Passing image comparisons establish conformance within
existing tolerances, not exact-byte repeatability across executions.

### Remaining boundaries

Actual assistive-technology sessions and physical touch-device behavior have not
been comprehensively verified. Browser emulation and layout/accessibility checks
do not establish universal readability or accessibility. Prior runtime evidence
is not a new remote CI result. The central gate inventory is maintained in
[CLAUDE.md](../CLAUDE.md#verification-inventory).

No staging, commit, push, PR creation, merge, release or deployment was performed
or authorized by this documentation closeout. Before those separately authorized
steps, inspect the exact Git diff/status and preserve unrelated work. Under the
existing configuration, merging to main publishes GitHub Pages.


## Editor live-status accessibility fix (8 November 2026)

This later local fix supersedes the earlier runtime identity and browser count,
while retaining the earlier owner visual acceptance and all 162 references.
The base is commit e1298854466adda79930b5eea5848897a98fe8b0 (PR #60).
The three editor status regions now replace their text only when its content
changes. This prevents identical messages from producing live-region mutations
on every animation frame, without changing Confirm, Cancel or edit-attempt
safety behavior. Only main.js and the editor browser test changed at runtime.

A running-loop regression observes all three statuses across 20 real animation
frames, verifies no unchanged-text mutations, then checks invalid-to-valid
validation, adaptive edit consequences and accepted-waiting-to-applied updates.
Removing the exact guard produces 20 mutations in each region and correctly
fails the regression. Actual screen-reader speech has not been tested; absence
of redundant DOM mutations is not comprehensive assistive-technology validation.

Fresh local checks on the fixed runtime passed:
- Windows editor checks: 13/13, including the new status group.
- [Focused live-status check](evidence/setting-editor/status-fix/focused.log): 1/1.
- [Guard-removal mutation](evidence/setting-editor/status-fix/mutation.log): expected failure, exit 1.
- [Full pinned-Linux browser and visual receipt](evidence/setting-editor/status-fix/browser-visual-linux.log): 145 behavior groups plus 16 layout cases; 21/21 visual groups, snapshots enabled, updates disabled and unchanged tolerances.
- All 162 installed references still match the reviewed gallery manifest.

The [fix verification record](evidence/setting-editor/status-fix/verification.json)
identifies both runtime files and receipts with local and Git-normalized SHA256
values. Original receipts are retained byte-for-byte; use normalized hashes for
committed-file verification. An independent diff review found no further blocker.
Prior engine evidence is carried forward, not rerun for this status-rendering fix.
The previous 144-group browser receipt remains historical, not the fixed runtime's
fresh result. The remote CI results for e129885 do not cover this uncommitted fix.

This documentation-only closeout runs no simulator gates. No staging, commit,
push, merge or deployment was performed by this pass. Physical touch-device and
screen-reader verification limitations remain as described above.


## Mode-specific notice closeout (8 November 2026)

Christian reviewed the isolated notices and reported: "Wording and placement feel just right!"
He then authorized documentation and cache-version closeout. This is acceptance of
this notice presentation, not comprehensive clinical or assistive-technology validation.
The candidate is based on merged main fde79973ab13bb0997435841fc92b4ff2e586b47.

The pre-edit messages now match the active mode:
- VC-CMV and PC-CMV: "Changing this value can cancel an armed or active manual hold. Cancel discards the new value but does not restore the hold."
- PC-CSV: "The new value takes effect when you select Confirm. Cancel discards the new value."
- PC-CMVa: "Changing this value clears the controller’s current feedback. It will use feedback from subsequent eligible breaths for future adjustments. Cancel discards the new value but does not restore the cleared feedback."

An actual canceled-hold notice remains explicit. After an adaptive edit, the
notice switches to "This edit cleared the controller’s current feedback" and
retains the fresh-eligible-breath and cancellation explanation. "Cleared" means
invalidated for current/future control decisions, not erased historical records,
changed applied pressure, or an accepted operator setting. In PC-CMVa all four
primary edit attempts retain this behavior, including RR and FiO2. Opening an
editor remains inert. Blank, invalid, and edit/revert attempts still notify;
Cancel discards the new value without restoring invalidated control feedback.

Only rendering copy and selection changed. No hold or adaptive-controller logic,
operator-request timing, Confirm/Cancel path, or measurement behavior changed.
The existing content-change guard prevents repeated unchanged live-region writes.
The new regression covers every primary setting in all four modes, mode transitions,
real edit/cancel consequences, stable live regions, and both actions at 1440x500
and 390x500. Two browser-side mutations that break the hold/adaptive notice
conditions fail this regression. Desktop and narrow previews were inspected.

All eleven existing asset version sites advance together from 36 to 37. This is
cache coordination only; accepted PNG references and tolerances remain unchanged.
The final [verification record](evidence/setting-editor/mode-notices/verification.json)
identifies the changed runtime/test files and retained receipts. Local hashes
identify original receipt bytes; Git-normalized hashes identify the LF-normalized
committed form. Previous tile/status-fix receipts above remain historical.

Final v37 local verification passed:
- [Engine receipt](evidence/setting-editor/mode-notices/engine-v37.log): 526 mixed top-level checks, zero failures.
- [Focused all-mode notice check](evidence/setting-editor/mode-notices/focused-v37.log): 1/1.
- [Hold-condition mutation](evidence/setting-editor/mode-notices/mutation-modeNotice-v37.log) and [adaptive-condition mutation](evidence/setting-editor/mode-notices/mutation-adaptiveNotice-v37.log): both fail as expected.
- [Full pinned-Linux browser and visual receipt](evidence/setting-editor/mode-notices/browser-visual-linux-v37-final.log): 146 behavior groups plus 16 layout cases, including 14 editor groups; 21/21 visual groups, updates disabled and tolerances unchanged.
- All 162 installed reference hashes remain unchanged. Independent review found no blocker.

The first cache-version browser attempt stopped at an obsolete v36 expectation.
Both explicit release assertions were aligned with v37, then the final full run
passed. The earlier pre-cache notice checks remain historical; the receipts above
cover final v37 runtime/test source. The visual suite does not baseline every open
notice, so separate inspected desktop/narrow previews and short-window checks
supplement it. This is local verification, not new remote CI.

No staging, commit, push, PR, merge, release or deployment was performed by this
closeout. Actual screen-reader speech and physical touch-device sessions remain
untested; automated DOM/layout checks are not exhaustive accessibility validation.
