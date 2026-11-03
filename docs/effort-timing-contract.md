# Patient effort timing and interruption (R-02)

Owner-approved successor, 3 November 2026, after the pilot coding pause ended.
The owner selected next-cycle timing updates with visible queued settings and
immediate effort-Off interruption, retaining the existing Off/On clock behavior.

## Supported active pair

Patient RR is finite and 6–35/min; neural Ti is finite and 0.4–2.0 s, with
Ti <= 60/RR. Equality is allowed. No minimum neural expiratory interval is added.
Invalid proposals reject the changed value and retain the entire last valid
selected pair, including a valid pending pair. Single-field requests use the
other field from that last accepted selection. A paired request/setup validates
both before mutation. There is no hidden clamp or companion-control adjustment.
Zero RR remains the explicit legacy Effort Off seam, not a valid active pair.

## Applied and selected timing

An established patient cycle uses its starting RR/Ti pair through its full
period. Valid edits queue a complete immutable pair for the next patient-cycle
boundary. The ending effort is finalized under its old pair before a new cycle
starts. Fractional tick remainder is retained; the physics step is unchanged.
Initial setup before the first clock advance uses the selected pair directly.
Pause freezes progress; it does not apply a queued pair early.

The RR/Ti controls show the accepted selection. A visible notice in Standard
and Teaching modes separately names Applied and Waiting pairs, and explains
rejection while showing retained values. A canceled/reverted pending selection
does not move the applied pair or rescale the active half-sine. Ordinary edits
to effort amplitude retain their existing immediate behavior.

Reset and mode change start a fresh run with accepted operator selections;
resolve a pending RR/Ti pair atomically before initialization. Preserve transport
and Effort On/Off state. New-run history, including interruptions, is cleared.
The explicit configureEffortTiming setup seam likewise starts a fresh run only
after validation; invalid setup leaves the previous run intact.

## Effort Off/On

Off immediately stops Pmus. Retain neural timer/activity exactly as the previous
Off/On clock behavior did; On may resume mechanical effort at that retained
phase. A real unfinished effort receives an interrupted administrative
disposition rather than a failed-trigger event. Its terminal guard survives Off
and On until the next full cycle, preventing a second outcome for that cycle.

If a patient/failed outcome already exists, preserve its immutable provenance.
Record the mechanical interruption separately with terminal=false, without a
second terminal disposition. Repeated Off/On can record mechanical interruptions
but cannot reopen eligibility. Zero-amplitude cycles produce no invented effort
interruption. Pending timing remains queued during Off; it applies only at the
next resumed full-cycle boundary or an explicit fresh-run reset.

Interruption records are immutable and separate from triggerEvents, failed
counts, delivered markers and delivered-ventilation accounting. They identify
run, mode, neural cycle, time/phase, applied pair and terminal/nonterminal status.
Existing trigger eligibility, failure reasons and explicit queued-delivery
cancellation semantics remain unchanged.
In particular, Off does not revoke a valid detector decision already scheduled
for delivery; retain that delivery and its frozen detection provenance.

Relevant timing input events immediately disarm or invalidate/release a manual
hold, including edit/revert and rejected UI proposals. This is not deferred
until the pair takes effect, and Pmus is never suppressed to make a hold valid.

## Verification and expectation adjudication

Seventeen new engine groups cover the exact invalid RR35/Ti2 6000-tick fixture
and valid Ti1 control in all four modes, independent eligible-cycle accounting,
waveform step bounds, equality/sub-tick neighborhoods and exact end/start order,
mid-cycle/boundary edits, invalid requests, Off/On, reset, mode and hold behavior.
Three additional browser groups cover the same UI boundaries and visible states.

The original NT4 RR42 diagnostic exceeds the newly approved native domain. RR42
is now explicitly rejected in the new suite; NT4 accounting uses supported RR35.
The original 300-assertion inventory is unchanged. Active legacy fixtures compare
operator selections to the requested pair; they no longer require the old
immediate neural clock. New independent timing oracles enforce the replacement
contract, while fixed base clocks, passive exact physics and existing inventories
remain required. No accepted image or tolerance is changed automatically.
The amplitude-slider harness now uses an explicit shared Reset after selecting
RR12, resolving the accepted queued timing before amplitude-only checks. It
retains the original applied-RR12 assertion and all five group inventories.

The optional 24-fixture cross-baseline comparison permits only a fixed per-run
inputRevision offset from the new explicit setup notifications. It checks that
offset on every sampled/detected source and compares all physical values, clocks,
hold results/reasons and other identities exactly; it does not erase later drift.
