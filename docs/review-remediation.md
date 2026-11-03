# Independent review remediation: R-01, R-02, R-11

Authorized scope: implement and test the three fixes under the owner-approved
31 October 2026 narrow plan, after the pilot coding pause was lifted. The full
plan was supplied through Library read, version 0,
`libfile_b5a8513836d88191aaf5f6f469202fb3`; its local DOCX transfer failed because
Windows Python lacks `os.setxattr`. The delegating owner thread explicitly
removed the local-materialization precondition and supplied all four pages.
This does not remove any behavior or contract gate.

Baseline: `95679d4005f822df96a07fe1edec33623b59545f`, also verified as remote main.
Work lives in an isolated local clone/branch. The prior review checkout and
owner checkout are untouched. The owner checkout is clean on
`test/vsm-clin-002-vt-characterization` at
`060b0b7efb84e725e1ece7bfaf7a42129e1d2959`; it is not the remediation base.
Initial implementation/verification estimate was 4–8 hours, with environment
availability and the R-02 owner gate flagged as limits.

## Local coding task R-01: cadence-independent transport

Implemented fractional simulation-second credit while retaining the 0.01 s
physics tick and 300-tick per-call cap. Excess whole ticks are discarded; only
sub-tick credit survives. This matches model.md section 9; the inspected rAF
caller had no additional elapsed-time cap. Pause preserves credit and accrues
no paused time; speed changes preserve old credit without rescaling; reset
clears it. Existing mode changes reset the engine and retain transport state.

The browser settles elapsed time at the old speed/running state before a control
change, rebases after reset/resume, and ignores older rAF timestamps without
moving its wall-clock reference backward. Independent review found that last
edge case and independently verified the correction.

## Local coding task R-02: paired effort timing

The owner subsequently approved next-cycle application and immediate Effort Off
interruption, explicitly allowing the added queued-setting scope. Implemented
contract: [effort timing and interruption](effort-timing-contract.md).

Validate RR6–35/min and Ti0.4–2.0 s with Ti<=60/RR at engine and UI boundaries.
Retain the last valid selected pair on rejection. Applied RR/Ti remain unchanged
until the old full patient cycle finishes; end its effort before starting the
next, including equality. Standard/Teaching notices distinguish Applied and
Waiting values and explain invalid proposals. Reset/mode change resolve accepted
queued selections atomically for the fresh run.

Off stops Pmus immediately while preserving the established neural clock and
activity. Record an unfinished real effort as interrupted, without a failed
trigger. If an immutable outcome already exists, retain it and record only a
mechanical interruption. Keep the terminal guard across Off/On until a new cycle;
repeated toggling cannot create duplicate outcomes. Zero-amplitude cycles receive
no invented interruption. Relevant input events still immediately invalidate or
release a manual hold, including rejection/edit/revert.

The original 6000-tick invalid RR35/Ti2 reproduction remains retained evidence.
New rejection/control tests and independent eligible-cycle/waveform oracles run
in all four modes. No overlapping-effort model was added.

## Local coding task R-11: signed finalized PIP

A separate null-or-finite signed maximum observes exactly the existing
INSPIRATION physics samples: the startup sample and final inspiration transition
sample are included; HOLD and EXPIRATION physics are excluded. The maximum
survives HOLD and is latched once at `_startExpiration`. Canonical completed
PIP, the display latch and nested hold-source PIP refer to that same peak.
No finite included sample means null/unavailable, never a previous peak.

The existing running `measuredPIP` and `breathSummary.pip` remain unchanged on
the live alarm path. Pressure physics, Pplat and hold-derived estimator equations,
validity rules/reasons, alarm evaluation and audio clocks are unchanged.
The exact no-hold VC fixture retains patient RR10 and Ti2 independently of R-02.
Breath 22's independent peak is -0.3466659288246299 cmH2O; the displayed value is
-0.3, while the unchanged live alarm input for that breath remains 0.

## Individually adjudicated test differences

- First-breath, passive CSV and reset assertions previously encoded missing PIP
  as numeric zero. They now require strict null; measured zero has separate tests.
- The pinned legacy checkpoint bytes are unchanged. Its two pre-completion
  missing-PIP fields are explicitly checked as old zero/current null and mapped
  only for comparison. Every completed passive value, physics tick, live alarm
  input, hold result and waveform buffer remains subject to exact comparison.
- The source cache version advances from 27 to 28 at all eleven sites, including
  CSS. Its browser assertion advances to 28; accepted image bytes are unchanged.
- Corrected playback changes where the wall-time hover sweep meets canvas
  highlights. The pressure-trigger assertion now checks each failed-event tooltip
  separately from the existing independent `Flow baseline cue:` tooltip. It
  retains the required failed-event wording; no product help text changes.

## Verification and remaining gates

Durable new gates: 15 R-01/R-11 plus 17 R-02 engine groups in `npm test`, and seven browser groups in
`npm run test:browser`. The engine matrix covers 30 s at 60/120/144/240 Hz and
0.5/1/2/4x in all four modes, direct-tick equality, jitter/sub-5ms intervals,
equivalent partitions, lifecycle/cap edges, signed/zero/missing PIP, sample
ownership, holds and neighboring mechanics. Browser checks cover deterministic
control/rAF ordering, real animation in all modes and the exact displayed R-11
reproduction. Fault injection is in `tools/check-review-mutations.mjs`.

The first completed pinned-Linux run found a stale literal version-27 visual
assertion and two adaptive snapshot differences. The latter exposed wall-time
accrual when the deterministic test hook stopped animation but retained the
engine's running state. Transport settlement now respects that frozen interval;
normal animation/control settlement remains unchanged. A fourth browser group
checks Pause, speed changes, Resume and subsequent real animation after the
frozen hook. It failed before this correction (1.5 s became 4.5 s on Pause) and
must pass afterward. The visual cache assertion alone advances from 27 to 28;
snapshot expectations and tolerances remain unchanged.

Fresh receipts and source/image manifests are retained in the task's `evidence`
directory, outside the source patch. The complete baseline engine
regressions fail 11/15 and browser regressions fail 3/3; those failures preserve
the original symptoms. The early exploratory baseline run failed 12/15 before a
CSV fixture was corrected to exercise actual delivered breaths with flow trigger.

Closure requires fresh final combined engine/browser and pinned-Linux visual
receipts. The R-02 owner-policy gate is resolved. Do not treat passing legacy suites as closure or clinical
validation. Accepted baseline installation, push, PR, merge, release, deployment,
external messages and other findings remain outside authorization.
