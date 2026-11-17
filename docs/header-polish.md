# Header-polish closeout - 16 November 2026

## Scope and owner review

This isolated candidate is based on PR #62 merge
`14509d42a15c690f9feee5bbdc0a75847879aaf5`. The patient-trigger indicator is
beneath the mode tag, outside the alarm area. Its original visibility predicate
and wording are retained. Hidden status reserves its footprint without exposing
hidden content to accessibility snapshots. Silence and sound controls use
30 px height, a 74 px minimum width, matching monospace typography, and an
explicit focus-visible ring; the countdown may expand instead of clipping.

This is presentation work, not a change to trigger detection, alarm evaluation,
thresholds, audio timing or physiology. Asset version is 39 at all 11 sites.
The deferred question about alarms clearing and returning between breaths is
not resolved by this slice.

Christian accepted the interactive candidate with patient-triggered breaths and
an active alarm, then reviewed all 162 comparison images. He separately
authorized installation of those references and an updates-disabled visual run.
On November 16 he authorized this documentation-only closeout. These approvals
do not authorize a branch, commit, push, PR, merge, release or deployment.

## Candidate identity and evidence

Evidence remains in the isolated candidate's local `evidence/header-polish/`
directory. Generated galleries and logs are not part of this documentation
change or proposed commit contents. The source manifest records nine changed
runtime/test/runner files; it is not a complete Git tree or commit identity.
The full comparison manifest records 156 source files and 162 images.

- Base: `14509d42a15c690f9feee5bbdc0a75847879aaf5`.
- Reviewed full-comparison manifest SHA256:
  `a44c4083384d6c95b2de70507def67e6542e53d74577d0aa845a7a17493470d5`.
- Candidate `js/main.js` SHA256:
  `90ead01c98a827d7e5bdda53df1f5c4994b6879815820826f01d7c27e5a75a1b`.
- `reference-installation.json` records installation at
  `2026-11-16T05:51:20.350Z`: 161 changed images, one identical image retained,
  all 162 installed hashes matching the reviewed manifest.
- The manifest's `approved: false` and unaccepted classification describe its
  generation-time state. It remains unchanged; subsequent acceptance is
  recorded here rather than retroactively editing evidence.

| Gate | Retained result and limits |
| --- | --- |
| Engine | `engine.log`: 526 mixed assertions/groups/fixtures, zero failures (300 original plus 226 additions). Carried forward; not rerun for reference installation or this documentation pass. |
| Full browser | `browser-final.log`: 167 behavior groups plus 16 primary-tile layout cases, 183 mixed checks on Windows. Includes six header-polish groups covering 32 mode/Standard/Teach/viewport combinations. Carried forward; not rerun for references or documentation. |
| Installed-reference visual | `installed-visual.log`: 21/21 groups, exit 0, using `npm run test:visual:docker -- --update-snapshots=none` and `mcr.microsoft.com/playwright:v1.62.1-noble`. Tolerances unchanged; 162 reference hashes and 156 source hashes verified after that run. |
| Mutation checks | `mutation-location-final.log`, `mutation-size-final.log`, `mutation-reserve-final.log` and `mutation-predicate-final.log` reject the corresponding intentionally broken variants. Their expected failures are not failures of the accepted candidate. |

The earlier 3/21 visual comparison against old references was diagnostic, not
acceptance; the reviewed installation and 21/21 result supersede it. This
documentation pass verifies existing receipts and source/reference integrity,
but runs no simulator gate and establishes no new CI or deployed-build result.
The source manifest includes documentation; its pre-closeout documentation
hashes become historical after these edits. Runtime, tests, runners and reviewed
reference PNGs are unchanged.

## Limits and next boundary

Automated keyboard, hidden-content and responsive checks plus owner interactive
review do not establish actual screen-reader speech or physical-device testing.
No new clinical validation claim is made. Preserve the generated local evidence,
but keep galleries and logs out of the commit. Before separately authorized
publication, recheck the exact candidate and remote state; merging to main
publishes GitHub Pages under the established configuration.
