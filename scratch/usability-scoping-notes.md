# Usability scoping (READ-ONLY recon) — SME-010/002/011/012

Branch: main @ 0a10cc8 (current). No code changed. Quotes are file:line.

## Item 1 — Coarse trigger slider (SME-010)  → TRIVIAL (markup only)
- index.html:174-175 flow-trigger `min="0.5" max="5" step="0.5" value="2"`
- index.html:181-182 pressure-trigger `min="0.5" max="5" step="0.5" value="1"`
- main.js:716-722 onFlowTriggerChange → parseFloat → vent.flowTriggerLpm (NO snap)
- main.js:666-668 formatTriggerValue → toFixed(1) (already supports 0.1)
- Engine simulation.js:409 compares value directly. No downstream rounding.
- Fix = change step 0.5→0.1 on two inputs. Pure HTML attribute. No JS.

## Item 2 — Off-screen effort sliders (SME-002)  → SMALL (CSS only)
- Markup index.html:332-352 .pmus-controls > [toggle btn] + .pmus-sliders(rows)
- CSS:1098-1130 .pmus-controls is a horizontal flex (button steals width);
  each .pmus-slider-row inlines label(min36)+range(width80)+value(min60).
  240px rail → ~89px available for sliders → row needs ~188px → OVERFLOWS.
- Root cause: inline label+slider+value beside the toggle in a 240px rail w/
  fixed widths. Unlike standard .control (stacked header over width:100% range).
- Fix = CSS only: stack .pmus-controls column &/or restore stacked row pattern,
  drop width:80px on range. INTERACTION: .pmus-slider-label is reused by trigger
  rows (index.html:173,180) — shared class with Item 1 area.

## Item 3 — Set vs measured grouping (SME-011)  → SUBSTANTIAL (markup+CSS+JS)
- Set inputs live in LEFT rail; right rail is mostly measured BUT interleaves
  set values by physiological category: Set PEEP (index.html:439-442),
  Pinsp (413-416), VT (set in VC) (461-464).
- Right rail populated by id via setText (main.js:1004-1014) — order-agnostic,
  BUT order/classes are mutated at runtime:
  - syncMonitorLayout() main.js:1321-1356 reorders groups+rows, toggles
    teaching-only/teaching-key.
  - updateTeachingIndicators() main.js:1358+ repurposes Auto-PEEP/Exp-completion
    LABELS+VALUES in teaching mode.
  - PR4b dual-rate RR rebuilds #param-rr innerHTML each frame (main.js:936-995).
  - Teaching CSS curation: param-group--teaching / teaching-key / teaching-only
    (style.css:769-873).
- A "settings together / measured together" reorg fights the category grouping +
  the runtime reorder + teaching curation. Most likely to balloon.

## Item 4 — Loops only in standard mode (SME-012)  → SMALL (CSS-mostly)
- Gating is pure CSS: style.css:806-808 `body.teaching-mode .loop-row{display:none}`
  and style.css:797-799 `body.teaching-mode #btn-loops{display:none}`.
- JS renders loops every frame regardless of mode (main.js:197) — so loop
  canvases already draw in teaching mode; only CSS hides them. Deliberate (space).
- Fix = relax those 2 rules (honors existing loop-row--hidden toggle naturally),
  optionally shrink loop-row height in teaching, un-hide btn-loops so it stays
  toggleable. Layout cost is CENTER column only (loops vs 3 waveforms) — does NOT
  compete with right-rail dual-rate readout.

## Interactions
- 1↔2: same left-rail slider area; share .pmus-slider-label. Batch together.
- 3↔4: both edit teaching-mode block (CSS 769-873) but different selectors;
  no shared on-screen space (right rail vs center). Coordinate edits only.
- 4↔PR4b: none (center vs right rail).

## Recommended batching / sequencing
- PR A (trivial/small): Items 1+2 — left-rail slider polish (HTML attr + CSS).
- PR B (small): Item 4 — loops in teaching (CSS + tiny JS). Parallel-safe with A.
- PR C (substantial): Item 3 — its own PR, last; needs design decision
  (visual set/measured tagging vs full reorg) + reconcile syncMonitorLayout/
  updateTeachingIndicators/PR4b/teaching curation.
