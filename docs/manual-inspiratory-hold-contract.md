# Manual inspiratory hold and retained measurements (SME-026/027)

Owner-approved successor to the hold lifecycle in VSM-CLIN-005, 2026-10-11.
The owner approved implementation and verification as an uncommitted diff with
isolated visual candidates. Image acceptance and installation remain separate.

## Maneuver and pause

VC-CMV and PC-CMV support the momentary manual button. A primary pointer/touch
press or held Space/Enter arms the end of the current inspiration, without
cycling inspiratory delivery early. During expiration it arms the next eligible
end-inspiration. Release before HOLD cancels arming without a measurement
attempt. The display distinguishes Armed from Holding; elapsed occlusion uses
genuine HOLD samples and simulated seconds, never button or wall time.

Manual release during HOLD starts expiration at the next sampled simulation
boundary, including that boundary's final HOLD sample. A rapid fresh press
between release and this boundary cannot rescind expiration: it arms the next
eligible breath only. Each continuous manual occlusion ends at the earlier of
2 seconds or the cycle's remaining time minus 0.2 seconds of expiration. The
engine rounds the allowance down to whole ticks, so it cannot spend the reserved
expiration time. Timing-limit completion is visible. A still-held button cannot
rearm; release and a fresh press are required. Timing-limited attempts can be
too short for measurement, including zero available samples.

The separate **Recurring insp pause** setting lives under Ventilator Settings,
defaults to 0.0 seconds and applies on subsequent breaths. Manual ownership
overrides its duration for the current breath; release ends that pause without
changing the recurring setting. Pressing during a scheduled pause takes over
the existing collector, entry boundary and continuous occlusion, without valve
reopening, restarting elapsed duration or throwing away scheduled samples.
PC-CSV and PC-CMVa controls explicitly remain unavailable.

Pointer cancellation/lost capture, window blur, hidden tab, keyboard focus loss,
transport pause and mode change cancel/disarm. An actual cancellation releases
occlusion immediately at the current simulation boundary and marks the collector
interrupted; it cannot publish success. Resume does not rearm. Relevant settings
or mechanics edits cancel an armed press; during actual manual occlusion they
invalidate and release the attempt. Explicit input events detect edit/revert,
including effort edits between ticks. Pmus is never suppressed for the maneuver.

## Results and source provenance

The four displayed hold readouts start at `--`. Only a completed manual-owned
interval with valid Pplat replaces `lastValidManualHold`. The entire frozen
record is from one breath; unavailable resistance does not borrow an older VC
value. Pressure control and ramp VC can publish valid plateau/compliance while
resistance stays unavailable. Ordinary breaths, recurring pauses, release,
settings edits, flow-pattern resets and mode switches retain the exact prior
record. Shared Reset clears it and all maneuver/attempt states, preserving the
existing retained settings, transport and audio contract.

The panel says **Last valid hold** and identifies source mode, simulation run,
breath, completion time, actual continuous duration, configured VT/Pinsp/RR/I:E,
PEEP/R/C/flow pattern and same-breath modeled total PEEP. The main Pplat status
also names the historical source mode, including after switching to an
unsupported current mode. A separate newest-attempt message reports invalid
holds, timing-limit completion or cancellation. Canceled arming is explicitly
not an attempted hold. These messages do not relabel the old values as current
settings. Static help triggers retain their existing shared popover behavior.

`lastCompletedBreath.holdMechanics` remains the canonical per-breath diagnostic
collector record, including recurring pauses. `sim.holdMechanics` remains its
current-generation availability selector for diagnostics and legacy numerical
tests. The UI deliberately reads `sim.retainedHoldMechanics`, which selects only
the frozen manual history. Analytical ventilator summaries are predictions and
do not establish manual measurement availability.

## Numerical criteria and limitations

The VSM-CLIN-005 numerical estimator is unchanged: actual 0.5–2.0 simulated
seconds, at least 50 contiguous HOLD samples at 100 Hz, finite samples, exactly
zero flow and negligible Pmus throughout (`|Pmus| <= 1e-9 cmH2O`). Final 20
unrounded pressures must span at most 0.1 cmH2O; their arithmetic mean is Pplat.
Driving pressure subtracts same-breath frozen modeled total PEEP; compliance
uses that breath's inspired VT. Resistance requires passive square-flow VC and
same-breath PIP/final inspiratory flow. Each value retains its dependency-specific
status and reason codes. Modeled total PEEP is not an expiratory-hold measurement.
These are educational simulator criteria, not clinical or device validation.

## Verification and acceptance

New gates: 43 manual-hold engine groups, 20 manual-hold browser groups and three
manual-hold pinned-Linux visual groups, separately tallied from all existing
inventories. Fault injection and independent adversarial review supplement
these gates. Visual generation/comparison and diagnostic harnesses run only in
isolated evidence checkouts; accepted snapshots and ignored historical ledgers
remain unchanged. Fresh receipts, exact source manifests and image hashes belong
in the local review package, not in these required-inventory statements.
