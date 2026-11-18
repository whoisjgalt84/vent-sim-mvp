# Trigger-editor closeout - 18 November 2026

## Scope and acceptance

This isolated candidate starts at header-polish merge
`799f17da824163f591d819faa33b5724f42f6df4` (PR #63).
Flow and pressure sensitivity use the shared draft/Confirm/Cancel editor,
retaining the immediate trigger-type selector and existing threshold handlers.
The approved sensitivity tile matches the Flow control styling. Redundant
accepted-change status is hidden for trigger editing; actual adaptive pending
status remains visible for primary settings. Decimal validation and nudges
preserve the configured 0.1 grid without applying draft values.

The shared safety paths remain in force for hold attempts and adaptive feedback.
No trigger detection, alarm evaluation, physiology, or clinical threshold policy
was changed. Changes in simulation.js and ventilator.js are import cache-version
changes only. All 11 asset references use version 40.

Christian reviewed the controls and complete gallery positively, approved the
narrow test-only focus repair and its installation, and separately authorized
installation of exactly 85 reviewed reference images and an updates-disabled
pinned comparison. The remaining 77 references were byte-identical. He then
authorized this verification documentation and final scoped review. These
approvals do not authorize a branch, commit, push, PR, merge or deployment.

## Identity and retained evidence

- Base: `799f17da824163f591d819faa33b5724f42f6df4`.
- Runtime/test/runner source manifest: local
  `evidence/trigger-editor/source-manifest-colors-status.json`, SHA256
  `6e66a4b1559687929706ca64ff582beed2f1a982c69003584955d61636905bcc`.
  Its 11 source entries still identify the reviewed source; its original
  reference hashes are historical after the authorized installation.
- Full gallery manifest SHA256:
  `e1a4885d632c2011b1d3b1142d431aef9ad5f289b36527512a4428f3bcd5d0b5`.
  Its generation-time `accepted: false` remains unchanged; subsequent owner
  acceptance and installation are recorded here, not retroactively in evidence.
- Runtime `js/main.js` SHA256:
  `c28cb7e4ffbf593a20bd8276536d187f6073de1382f7ec50483c5870f68336d2`.
- Installed focus test SHA256:
  `654ea2da4c6ad1565cf3910ce01637178af05d43be8ac7b7de8f661759a7a117`.
- Local verification receipts are retained outside this checkout in
  `vent-trigger-verification-20261118/receipts` on the home workstation.
  The complete gallery is retained in `Vent-Sim Trigger Review 2026-11-17`.
  These local directories are evidence locations, not portable repository links.

| Gate | Result and boundary |
| --- | --- |
| Engine | `engine-pinned-full.log`: 526 mixed assertions/groups/fixtures, zero failures (300 original plus 226 additions), exit 0. Executed in the byte-verified disposable copy using the supported saved legacy reference root, with four pinned reference hashes enforced. Carried forward for the later test-only repair, reference installation and documentation. |
| Full browser | `browser-installed-candidate-full.log`: 176 behavior groups plus 16 layout cases, exit 0, directly against the isolated candidate after focus-test installation, Windows managed Chromium. This includes 9 trigger-editor and 8 overlay-panel groups. Carried forward for reference installation and documentation. |
| Installed-reference visual | `visual-installed-trigger-references.log`: 21/21 (18 commissioned plus 3 manual-hold), exit 0, in `mcr.microsoft.com/playwright:v1.62.1-noble`, with `--update-snapshots=none` and unchanged tolerances. `trigger-reference-install.json` verifies exactly 85 replacements, 77 unchanged files and all 162 reviewed hashes after comparison. |
| Focus regression | `overlay-fixed-1.log`, `overlay-fixed-2.log`, `overlay-fixed-3.log`: 8/8 each. `overlay-focus-mutation.log` rejects removal of the real focus handoff at the new active-element assertion. The same test bytes are installed in this candidate. |
| Trigger mutations | Local `evidence/trigger-editor/mutation-decimal.log`, `mutation-immediate.log`, `mutation-notification.log`, and `mutation-primary-validation.log` retain expected failures for deliberately broken variants, not failures of the accepted candidate. |

The original full-run focus failure was reproduced as a timing-dependent test
precondition: refresh transfers focus from the Standard canvas to Teach, so Enter
can toggle Teach before the following mouse click toggles it back. The repaired
test pauses refresh for the canvas-key check, explicitly redraws to assert the
real handoff, then tests keyboard Teach activation. No application behavior was
changed. The historical failed run had no event recording; its precise event
order remains inferred from the matching reproduction. Earlier comparisons
against old references and the preliminary missing-history engine attempt are
retained as diagnostics, not final gates.

This documentation pass verifies existing evidence and hashes, runs no simulator
gates and establishes no remote CI or deployed-build result. Full-gallery source
hashes for documentation become historical after this closeout; runtime, tests,
runners and installed reference PNGs remain unchanged.

## Publication scope and remaining boundary

The intended implementation scope is 11 modified text/runtime/test/runner files,
85 reviewed PNGs and the new `tests/trigger-editor.browser.cjs`, plus this
closeout and the current inventory/version update in `CLAUDE.md`.
Keep generated `evidence/`, `scratch/overlay-panel-evidence/` and
`scratch/primary-tile-polish/` out of the commit, preserving them locally.
The tracked `scratch/verify-batch.cjs` and `scratch/verify-ui-cleanup.cjs` changes
are verification harness inputs and belong in the implementation scope.

Read-only inspection found detached HEAD at the base above, nothing staged,
and current remote main at that same SHA. Recheck remote state at publication;
this observation is not a durable guarantee. Branch creation, commit, push and
draft PR need separate authorization, followed by exact-commit CI and review.
Merging main publishes GitHub Pages and needs explicit publication authority.
No release/tag or branch deletion is implied.

Automated browser checks and owner gallery review do not establish actual
screen-reader speech, physical-device validation, or new clinical validation.
