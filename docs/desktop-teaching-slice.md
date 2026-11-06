# Bounded desktop teaching slice

Owner-approved implementation, 5 November 2026. Base: released v1.0.0,
`6e196f3b0ba089d3c8361a2587c177da5a6b4641`. Christian accepted the final design
and visual review package and separately authorized reference installation on
6 November. The reviewed references are installed and the local visual gate
passes. Staging, commit, push/PR, merge, release and deployment remain separate
actions; none has occurred for this candidate.

## Layout and sources

The desktop targets are 1440×900 and 1100×900 CSS pixels. The owner-approved
6 November revision hides the ventilator rail in Teach, giving the three
waveforms more space. Patient access remains independent. Seven existing authoritative rows move once into
Key outputs; their IDs and help triggers remain stable. There is no duplicate
engine or monitor state. Loops start off and retain their own explicit selection.
Recurring inspiratory pause moves to Maneuvers, beside the separate manual hold.

Patient starts closed at every width, per the owner's final review adjustment.
The visible Patient header button opens it with one action in Standard and Teach.
At widths of at least 1300 pixels it is a persistent panel; below that it is a
nonmodal drawer. Reset does not reapply the startup default. Teach and resize
retain the user's current choice; reload starts closed again, with no visibility
persistence in browser storage. The close button and Escape close the panel;
existing background-focus light-dismiss also applies in the drawer layout. Opening the drawer moves focus to
its close button; closing restores focus. Hiding a panel never unmounts controls.
Below 850 pixels the document scrolls; all controls remain reachable rather than
forcing every section into one viewport. Patient and Teach have independent
visibility. Visibility and resize refreshes evaluate neither detectors nor audio
policy; ordinary animation retains the existing evaluation path.

| Key position | Source and units |
| --- | --- |
| Measured PIP | Existing finalized inspiration-only signed latch, cmH₂O; missing, zero and negative remain distinct |
| Measured Pplat | Frozen last valid manual hold, cmH₂O; original mode/run source and simulated age |
| Predicted MAP | Existing configured-cycle analytical value, cmH₂O, with visible provenance/unavailable reason |
| Inspired VT | Existing completed-inspiration net modeled volume, mL; no exhaled measurement substituted |
| RR | Existing completed-breath interval rate, /min; Teach retains configured, measured and patient rows |
| Delivered VE | Existing shared completed-inspired-volume 30 s window, L/min, with its existing availability rules |
| Hold-derived driving pressure | Existing saved hold and modeled baseline, cmH₂O; no new measurement definition |

## Approved 6 November hierarchy revision

The current palette remains in use. Primary settings share the reviewed blue
surface and 2 px outline; secondary settings have unboxed rows. Existing native
controls move between groups without recreation, setting events or model writes.

| Mode | Primary settings, in order | More settings, in order |
| --- | --- | --- |
| VC-CMV | VT, Resp Rate, PEEP, FiO2 | Flow Pattern, I:E, Trigger |
| PC-CMV | Pinsp, Resp Rate, PEEP, FiO2 | I:E, Trigger |
| PC-CSV | Pressure Support, PEEP, FiO2 | I:E, Cycle %, Trigger |
| PC-CMVa | Target VT, Resp Rate, PEEP, FiO2 | Maximum pressure, I:E, Trigger |

Additional outputs use a native details/summary disclosure, closed on load.
Its selection and each inner section's selection survive Teach transitions;
keyboard activation and focus restoration work in both views. The seven key
outputs, provenance and header alarms remain outside that disclosure.
Teach focus does not dismiss the narrow Patient drawer; other background focus
retains its existing light-dismiss behavior. CSV's I:E and read-only configured
maximum-Ti provenance remain visible in Standard; no timing redesign is included.

## R03: effort selection and state

All modes permit native amplitude values 0–12 cmH₂O in 0.25 increments. The
selected amplitude is presentation-owned operator intent. While enabled it
matches the actual model setting. Off immediately invokes the released effort
interruption path and sets actual amplitude to zero while retaining selection;
On restores selection. Mode changes never normalize a real zero to 0.25.
Enabled zero is identified explicitly, and Teach shows its configured Patient RR.

Timing remains engine-owned. R-02's paired validation, requested/applied values,
next-cycle transition, interruption records and terminal guards are unchanged.
The dedicated R03 browser matrix exercises every source/destination mode pair
at zero and 7.75, Off/On, quarter steps, endpoints and trusted pointer input.
Existing native trajectory checks keep their 59 px/181-point excursion,
translated to the separate Patient panel, and retain nonvacuous input counts and
the 0.5 CSS-pixel geometry bound.

## Hold-age metadata

An integer counter records actual executed physics ticks across retained-history
runs. A manual attempt records its completion tick; only a valid result becomes
the saved measurement. Age is the tick difference times `dt`. The first receipt
is one tick (0.01 s) after the transition's completion boundary. It rounds to
0.0 s for display. Paused wall time earns no age; speed and the existing catch-up
cap affect age only through ticks actually executed. Mode/flow changes retain
age and identify the original run. Invalid attempts retain the last valid
measurement and clock. Main Reset clears history and exposes null age.

The counter is not a replacement for `globalTime`, delivered-VE identity,
detector timestamps or transport credit. It changes no physics calculation or
canonical completed-breath record.

## R05: PC-CSV presentation audit

`monitorSummary()` gates presentation only. `vent.summary()`, shared analytical
getters, detector metrics, thresholds, timing and audio policy remain unchanged.

| Surface | PC-CSV presentation |
| --- | --- |
| MAP, resistive/effective pressure prediction, total/auto-PEEP predictions | Unavailable; MAP explains the configured-cycle mismatch |
| Configured Ti/Te, time-constant ratios, predicted expiratory completion | Unavailable; no configured cycle presented as a delivered breath |
| Peak flow | Genuine existing live peak when present; no analytical fallback |
| Mechanics chips | Configured R×C and effort retained; configured-cycle ratios and predicted trapped volume suppressed |
| Header advisory badges | Configured-cycle predictions suppressed; actual alarm chips unchanged |
| Delivered-VE help | Explicit PC-CSV predicted-VE unavailable reason; real delivered VE retained |
| Teach Flow Baseline and expiratory return cue | Existing live modeled values retained |
| PIP, Inspired VT, RR, Delivered VE, live trapped volume, saved hold history | Existing authoritative measured/live/historical sources retained |
| Set PEEP and pressure-support command | Existing configured settings retained |

Maximum Ti remains `max((60 / configured RR) × I / (I + E), 2 × dt)`.
The interface shows its derived value and read-only RR/I:E provenance. Existing
I:E editing remains available. There is no new CSV RR or maximum-Ti editor,
no backup ventilation and no invented breath. Flow-cycle precedence and actual
termination are unchanged and independently checked, including simultaneous
flow-cycle and max-Ti eligibility.

## Verification and review boundary

`npm test` adds eight focused engine groups to the unreduced commissioned
inventory. `npm run test:browser` adds eight focused browser groups; the existing
R-02 and R-11 gates remain separate. New tests use strict/bounded assertions,
including an actual alarm-evaluation spy for visibility toggles. Fault injection
runs in disposable copies through `tools/check-teaching-mutations.mjs`.

`tools/check-teaching-preservation.mjs <reference checkout>` compares the candidate
against untouched v1.0.0 at identical inputs: four modes × Off/enabled-zero/positive
effort × two mechanics configurations, 3000 ticks each. This checks exact sampled
physics, canonical completions, live alarm inputs, adaptive state, buffers,
loops, triggers, delivered VE and raw analytical summaries (24 fixtures, 72,000 ticks).

`tests/teaching-slice.determinism.cjs` records 32 pinned-Linux scenarios and requires
exact repeated scalar-canvas bytes and unchanged simulation snapshots. Full-page
and output images are retained separately: Chromium can differ by a few static
help-icon/text antialiasing pixels between paints. This diagnostic does not
replace or relax the existing full visual comparison, its image bytes or tolerances.

## Accepted local candidate and evidence

Christian accepted the design, including Patient closed by default, and the
complete visual review package. After separate installation authorization,
159 same-name references were replaced, three CSV references retired and three
reviewed replacements added. The installed inventory is 146 waveform and
16 manual-hold Linux PNGs. All 162 installed SHA256 hashes match the approved
candidate-reference manifest:
`a06b28e46f97f61bcfba4eb74cef082369d7484946ac75a5e3a4d0a2f6dbb8aa`.

The retired `csv-predicted-trapping` reference maps to
`csv-configured-backstop`; `csv-predicted-header-standard` and
`csv-predicted-header-teaching` map to `csv-unavailable-header-standard` and
`csv-unavailable-header-teaching`. All names have the
`-chromium-linux.png` suffix. These are explicit semantic replacements, not
claims of equivalent crops. The original released PNGs remain in the immutable
review package; the working snapshot directory now contains the approved set.

The reviewed source identity before installation was
`660b0e9e01bf37846f47cf21185f9210f467dfc6269b3407af26516cd959a345`.
The installed candidate verified before this documentation-only closeout was
`67e53a5baac4a12bc5b9b4ce1c14118651c5d9a3549da569262f03e3c7c3a03b`.
These are source SHA256 identities, not Git commit IDs. The base commit remains
the released v1.0.0 commit above; the branch is `feat/desktop-teaching-slice`.
The final documentation-inclusive identity and exact changed-path inventory are
recorded separately in the local closeout receipt to avoid a self-referential
document hash. No runtime or image bytes change in this closeout.

| Evidence | Result and checked scope |
| --- | --- |
| Installed-reference visual gate, 6 November | Fresh for installed source `67e53a5...`: exit 0, 21/21 groups (18 waveform/determinism/cache plus 3 manual-hold), 162 unique screenshot comparisons; zero failures, skips, flakes or unexecuted groups/screenshot expectations. Runtime and references mounted read-only; updates disabled and snapshots enabled. |
| Engine and browser gates | Carried forward from Patient-default source `c2af5bb0e4e79d46ea021f85327011405aaff370c994c921a569153a19d42bfe`: engine 520/0 mixed assertions/groups/fixtures; browser 120/0 on Windows and pinned Linux. All inputs to those gates remain unchanged; later visual-test edits are covered by the installed-reference run. |
| Preservation and fault injection | Carried forward from the same Patient-default source: 24 fixtures / 72,000 exact physics ticks independently against released v1.0.0 and the prior candidate; 24/24 teaching faults detected. Later visual-expectation alignment faults were checked separately in disposable copies. |
| Supplemental repeat diagnostic | Carried forward: 32/32 pinned-Linux scenarios and 96 exact scalar-canvas comparisons with equal simulation state. It does not claim whole-page byte identity or replace the visual gate. |
| Documentation closeout | Fresh checks cover the documentation delta, links, source identity, exact changed paths and preservation hashes. No engine, browser or visual suite is rerun for documentation-only changes. No exact-commit remote CI result is claimed. |

The installed-reference run used Playwright 1.62.1, Node 24.18.1 and
`mcr.microsoft.com/playwright:v1.62.1-noble` at digest
`sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e`.
It completed in 35,307.376 ms with threshold 0.1, maxDiffPixelRatio 0.0002,
retries 0 and workers 1. The normal reproduction command is
`npm run test:visual:docker -- --update-snapshots=none`.
Unlike the normal wrapper's tag-only image and writable repository mount, the
retained invocation pins the image digest and mounts runtime/references
read-only. It also redirects JSON/state ledgers, a passive step reporter and
test output outside the repository. Local `reference-install-20261106/` receipts retain the exact
invocation, `visual.log`, `results.json`, screenshot ledger, installed source
manifest and verification summary; they are handoff artifacts outside the
repository, not committed files.

Evidence limits remain: 60 review captures have state ledgers; 102 have hashed
source/test replay evidence. Of 146 exported waveform repeat frames, 30 differ
by 2-109 raw pixels while passing the unchanged matcher. Manual-hold repeats
have native matcher evidence without exported repeat PNGs. All five Library
uploads succeeded and the saved PDF was read back; saved archive sizes matched
the validated local packages, but remote archive hashes were not independently
downloaded and compared. Frozen package labels describe its pre-acceptance
preparation state; the later owner approval and installation are recorded here.

Current gate inventories are maintained in
[CLAUDE.md](../CLAUDE.md#verification-inventory). Owner acceptance and passing
checks do not authorize publication. No staging, commit, push, PR, merge,
release or deployment is part of this closeout.

Excluded: a framework/build rewrite, general Confirm/Cancel editors, atomic mode
transactions, alarm lifecycle changes, new physiology or measurement algorithms,
loop physics, new modes, remote instructor infrastructure and deployment.
