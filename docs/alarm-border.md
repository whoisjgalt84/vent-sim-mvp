# Alarm-border presentation closeout

## Scope and owner review

The isolated candidate is based on `35ea2bddd7a60c2861df7a4c0a9b2f8389177ecd`.
Christian selected the 4 px border, reviewed the targeted preview and interactive
simulator, then accepted the full 162-image comparison gallery. He separately
authorized reference installation and an updates-disabled visual run on
12 November 2026 UTC (11 November Pacific). This documentation-only closeout was
separately authorized on 13 November UTC (12 November Pacific).

The perimeter follows the existing active-alarm list and highest-priority
selector. High priority is red; medium and low retain the existing amber banner
mapping. The low-priority chip remains unchanged. With no active alarm the
perimeter is hidden. The fixed, steady, pointer-transparent border does not
consume layout space. A textual priority indicator provides a non-color cue;
its live-region text updates only when its content changes. Forced colors use
CanvasText. Silence and mute do not suppress the visible cue.

Alarm thresholds, evaluation timing, persistence, audio clocks, physiology,
canonical measurements and patient-trigger semantics are unchanged. Asset
references use version 38 at all 11 sites. The simulation/ventilator import
changes are cache-version changes, not a model change.

The proposed patient-trigger indicator relocation and consistent alarm-button
sizing are a separate header-polish follow-up. The pilot video showing alarms
clearing and returning between breaths is a separate deferred question about
behavior or learner explanation; neither its cause nor remedy is settled here.

## Candidate identity and retained evidence

The [source manifest](evidence/alarm-border/source-manifest.json) records nine
candidate runtime/test/runner files. It is not a complete Git tree or a commit.
The gallery's source identity is
`f5e0d40e2159b47ecf37ca6cfcf104b45ace8fc85471971639627b11fed660ca`.
The current main.js SHA256 is
`60e8b1ecd5d8de0b1e21c5289b5e621e8ce5211eb16c44e9b125568f022ee618`.

| Gate | Retained result and scope |
| --- | --- |
| Engine | [526 mixed assertions/groups/fixtures, zero failures](evidence/alarm-border/engine-final.log); carried forward, not rerun for references or documentation. |
| Browser | [161 behavior groups plus 16 layout cases](evidence/alarm-border/browser-final.log), including 15 alarm-border groups; carried forward, not rerun for references or documentation. |
| Installed-reference pinned-Linux visual | [21/21 groups, exit 0](evidence/alarm-border/installed-visual.log), Playwright v1.62.1-noble, updates disabled and tolerances unchanged. |
| Priority mutation | [Broken priority rejected](evidence/alarm-border/mutation-priority-final.log). |
| Repeated live-region mutation | [Repeated content writes rejected](evidence/alarm-border/mutation-repeat-final.log). |

Mutation logs contain expected assertion failures against deliberately broken
variants, not failures of the accepted candidate. The first installed-reference
run reported passed in Playwright's result file but its console capture was
incomplete. After it ended, a single updates-disabled repeat produced the full
retained 21/21, exit-0 receipt above. This documentation pass runs no simulator
gates and establishes no new CI result.

## Reference acceptance and integrity

The [gallery manifest](evidence/alarm-border/gallery-manifest.json) was generated
as an unaccepted candidate and is retained byte-for-byte. Its `approved: false`
field records generation-time status; subsequent owner acceptance is recorded
above, not retroactively written into that evidence.

The [installation receipt](evidence/alarm-border/reference-install-receipt.json)
records exactly 161 changed PNGs installed and one identical reference retained.
All 162 installed hashes match the approved gallery. Its retained manifest SHA256
is `936919ec95729fecf4ebb81d1e17dfcd0996f72f2588125902a53fc15052b1a4`.
The earlier 3/21 comparison against old references is superseded by the accepted
installation and complete passing run; it was not a passing release gate.

## Limits and publication boundary

Owner interactive review and browser keyboard/forced-color checks are not a
comprehensive screen-reader or physical-device evaluation. On narrow screens,
the textual priority can scroll out of view while the perimeter stays visible.
The neutral status and existing banner may repeat wording. No new clinical
alarm contract is established.

The initial sandboxed Git invocation could not enter the candidate path
(`Permission denied`), although ordinary file reads and hashes succeeded.
Approved read-only commands through the supported escalation path then reported
a normal non-bare work tree and returned status/diff successfully, with optional
locks disabled. This identifies an execution-access limitation, not a damaged
repository. No Git configuration, permissions or repository structure changed.
The final inventory includes unrelated untracked evidence; stage only explicitly
reviewed paths under separate authorization.

No staging, commit, push, PR, merge, release or deployment is authorized by this
record. Obtain the applicable next approval, preserve unrelated modifications,
and recheck exact source identity and remote state before publication. Merging
to main publishes GitHub Pages under the established configuration.