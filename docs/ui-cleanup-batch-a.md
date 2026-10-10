# Approved UI cleanup batch A - 2026-10-10

Christian approved synchronization to merged PR #50 and the five presentation changes in this batch on 2026-10-10 (Sentinel_f348a1c5a23c81918011364505d1e386). The starting commit is `b017fedb695b41892e976376fc7d76f7bcd0baf3`. Feedback intake is SME-024 through SME-031 in [the feedback ledger](sme-feedback-log.md).

The Trigger help icon has an explicit 8 px gap. Trigger type buttons and the selected sensitivity slider retain their behavior; the slider's inline value and units are the only sensitivity readout. Both sliders have accessible names and descriptions.

Mechanics examples use native groups: Reference (Normal), Compliance examples (40, 35, 30, 25), and Resistance examples (20, 25). All seven stable keys, approved labels, paired R/C values and source notes remain unchanged. The ordering describes the named quantity; selecting a compliance example can also change R. The selector identifies the last loaded example. Manual R or C edits show **Custom mechanics**, including after Reset, even if a value is edited back to the preset value. Loading the selected example again restores its exact pair and removes that warning. There is no second preset-name readout.

The existing disclaimer, "Simulation examples; not disease reference values.", is the first paragraph of Mechanics examples help. It also remains in the selector's accessible description through its hidden description node. Existing source links, custom-state explanations and units help remain.

Patient effort has one Passive/Active toggle with an accessible Patient effort name and pressed state. The Effort slider retains its inline value, units, label, range and native input behavior. The redundant Pmus max/value and Off row and all of its DOM bindings are removed. Existing adaptive zero-effort mode-exit synchronization remains deferred.

## Deferred contract decisions

SME-026 requests a manual inspiratory maneuver held only while the operator presses, released on pointer/key release, separate from an operator-set recurring inspiratory pause on every breath with a default of 0.0 seconds. This batch changes neither maneuver controls nor engine timing. A later contract must define supported modes, keyboard/pointer cancellation, transport/reset interaction and valid measurement intervals.

SME-027 requests measured Pplat, hold-derived driving pressure/static compliance and measured inspiratory resistance to start at `--` and retain the result of a completed hold until the next hold. This is a proposed successor to the current hold-mechanics contract, not authorization to relax its validity criteria. Unresolved decisions include valid-hold criteria and quantity-specific dependencies, historical-result identification after setting changes, reset clearing/retention, whether an invalid next hold clears or preserves the prior result, and applicability in each mode/effort state. No measurement lifecycle changes are implemented here.

SME-031 requests a future light/dark theme, including canvas, alarm and help contrast. This batch does not implement a theme.

## Verification

Run the unchanged aggregate engine gate (`npm test`) and existing browser inventories plus seven batch-A groups (`npm run test:browser`). The focused preset-provenance browser harness and independent 87-check preset oracle remain separate supporting checks. New presentation checks are in `scratch/verify-ui-cleanup.cjs`; they own an ephemeral server, accept an optional source root for mutation checks, and do not write baselines. Run `node scratch/verify-ui-cleanup.cjs` directly for its seven-group tally.

Run the pinned Linux visual gate against accepted images with updates disabled. Intentional presentation changes require isolated candidate generation, a second comparison against those candidate bytes, and an unchanged-inventory review manifest. Accepted images and tolerances remain untouched. Local implementation and passing candidate comparisons do not constitute owner visual acceptance, staging, a commit or publication.

## Owner spacing refinement — 2026-10-10

Christian conditionally approved the batch pending a little more vertical space between the mechanics dropdown and Compliance (Sentinel_f4bcfbe15fa08191a40e633c2b11bf78). The selector now has an 8 px bottom margin, verified with normal and custom mechanics at 1440, 1000 and 800 px. Prior candidate bytes remain archived and unaccepted; this refinement requires regenerated visual candidates. Christian subsequently approved matching FiO2/Trigger cards at 21:08 UTC (Sentinel_1e2d2f7a11648191b8f0ec85fa13a329), recorded as SME-032. Both wrappers use the existing outlined/shaded card class. Native controls, ranges, units and help behavior are retained; FiO2 now has an explicit accessible name and inline-value description. No settings/engine behavior changes.
