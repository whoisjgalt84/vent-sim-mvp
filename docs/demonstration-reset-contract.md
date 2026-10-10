# Shared demonstration reset

Owner-authorized implementation contract, 2026-10-07. The header **Reset** is
available in VC-CMV, PC-CMV, PC-CSV and PC-CMVa, in Standard and Teaching Mode.
It is the single reset control in all four modes. The redundant PC-CMVa
**Reset demonstration** button was removed with owner approval on 2026-10-10;
adaptive maximum changes still apply through the header **Reset**.

Reset starts a fresh run with the current operator selections: mode, ventilator
settings, R/C, prescribed effort amplitude and timing, trigger configuration,
alarm limits, playback speed, waveform window, loops/display style, and current
paused or running state. Custom-mechanics presentation remains selected.

It clears simulated time, integrated residual/trapped volume, waveform and loop
history, breath/trigger/delivery history, pending patient-trigger data and prior
measured outputs. The existing engine prefill supplies only a new PEEP baseline:
CMV modes start their first machine inspiration at time zero; PC-CSV waits in
expiration for a new eligible trigger. An unavailable measurement stays
unavailable. Measured RR returns to its existing startup zero, and delivered VE
requires a fresh 30 s observation window.

PC-CMVa uses the existing validated setup/reset path: pending target/PEEP edits
resolve together, the currently selected maximum becomes configured, and the
controller restarts at its configured initial pressure. Old feedback, pending
corrections and source identities are discarded. Reset does not copy adaptive
pressure into manual Pinsp/PS. The shared handler avoids rerunning mode-entry
effort synchronization; a valid zero-amplitude adaptive prescription stays zero.

Old alarm chips clear synchronously. The normal frame evaluates the new run using
the existing rules, limits, simulation-time grace and eligibility. Reset adds no
alarm evaluation or policy. Audio remains governed by wall-clock time: mute,
active Silence deadline and cancellation behavior are retained. An initial
trusted user gesture may arm audio through the established gesture handler.

Static header help explains that clearing trapped volume represents a new run,
**not a treatment effect**. Native Reset supports pointer and keyboard activation.
The responsive header prevents its controls from overlapping speed/window or
alarm controls at the verified widths.

Verification adds 28 engine groups, eight browser groups and two pinned-Linux
visual groups to the existing commissioned inventories. Aggregate runners keep
strict counts. Visual candidates require owner review of exact image bytes;
candidate generation never updates the working checkout's accepted snapshots.
See [visual testing](visual-testing.md) for the acceptance workflow.

The deferred adaptive-to-PC-CMV zero-effort input discrepancy and duplicate
Pmus readouts remain outside this change. Shared reset is pilot preparation;
it provides no clinical validation or permission to conduct a pilot rehearsal.
