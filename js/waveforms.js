/**
 * ============================================================================
 * waveforms.js — Canvas Waveform Renderer
 * ============================================================================
 *
 * Renders pressure, volume, and flow waveforms on HTML5 Canvas elements,
 * styled to resemble a real ICU ventilator display.
 *
 * Design philosophy:
 *   - Dark background, bright traces (like Dräger, PB, Hamilton screens)
 *   - Gridlines for quick visual estimation
 *   - Y-axis auto-scales with clinical rounding (nice round numbers)
 *   - Crisp, anti-aliased traces
 *
 * ============================================================================
 */

export class WaveformRenderer {

    /**
     * @param {HTMLCanvasElement} canvas  - The canvas element to draw on
     * @param {Object} options
     * @param {string} options.label      - Y-axis label (e.g., "Paw (cmH₂O)")
     * @param {string} options.color      - Trace color (CSS color string)
     * @param {string} options.bgColor    - Background color
     * @param {string} options.gridColor  - Grid line color
     * @param {number} options.yMin       - Fixed Y minimum (null = auto)
     * @param {number} options.yMax       - Fixed Y maximum (null = auto)
     * @param {number} options.yStep      - Grid step size for Y axis (null = auto)
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');

        // Display settings
        this.label     = options.label     ?? '';
        this.kind      = options.kind      ?? null;  // 'pressure' | 'volume' | 'flow' — routes highlight segments
        this.color     = options.color     ?? '#00ff87';
        this.bgColor   = options.bgColor   ?? '#0d1117';
        this.gridColor = options.gridColor ?? 'rgba(255,255,255,0.07)';
        this.textColor = options.textColor ?? 'rgba(232,236,240,0.78)';
        this.axisColor = options.axisColor ?? 'rgba(255,255,255,0.22)';

        // Y-axis range overrides (null = auto-scale from data)
        this.yMinFixed = options.yMin  ?? null;
        this.yMaxFixed = options.yMax  ?? null;
        this.yStep     = options.yStep ?? null;

        // Layout margins (pixels) — room for axis labels
        this.margin = { top: 8, right: 12, bottom: 24, left: 56 };

        // Resize canvas to match its CSS display size (for sharp rendering)
        this._resizeCanvas();
    }

    /**
     * Match canvas internal resolution to its CSS display size.
     * This prevents blurry rendering on high-DPI screens.
     */
    _resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width  = rect.width  * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        // Store CSS dimensions for drawing calculations
        this.width  = rect.width;
        this.height = rect.height;
    }

    /**
     * The drawable area inside the margins.
     */
    get plotArea() {
        return {
            x: this.margin.left,
            y: this.margin.top,
            w: this.width  - this.margin.left - this.margin.right,
            h: this.height - this.margin.top  - this.margin.bottom,
        };
    }

    /**
     * Choose a "nice" Y-axis range and step size.
     * Rounds to clinically meaningful intervals.
     *
     * @param {number} dataMin - Minimum value in the data
     * @param {number} dataMax - Maximum value in the data
     * @returns {{ yMin: number, yMax: number, yStep: number }}
     */
    _niceYRange(dataMin, dataMax) {
        // Use fixed bounds if provided
        let yMin = this.yMinFixed ?? dataMin;
        let yMax = this.yMaxFixed ?? dataMax;

        // Add padding (10% of range, minimum 1 unit)
        if (this.yMinFixed === null || this.yMaxFixed === null) {
            const range = yMax - yMin || 1;
            const pad = Math.max(range * 0.1, 0.5);
            if (this.yMinFixed === null) yMin = yMin - pad;
            if (this.yMaxFixed === null) yMax = yMax + pad;
        }

        // Choose a nice step size
        let yStep = this.yStep;
        if (yStep === null) {
            const rawRange = yMax - yMin;
            // Target ~4-6 grid lines
            const rawStep = rawRange / 5;
            // Round to a nice number
            const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
            const normalized = rawStep / magnitude;
            if (normalized <= 1.5)      yStep = 1 * magnitude;
            else if (normalized <= 3.5) yStep = 2 * magnitude;
            else if (normalized <= 7.5) yStep = 5 * magnitude;
            else                        yStep = 10 * magnitude;
        }

        // Snap yMin/yMax to step boundaries
        yMin = Math.floor(yMin / yStep) * yStep;
        yMax = Math.ceil(yMax / yStep)  * yStep;

        return { yMin, yMax, yStep };
    }

    /**
     * Render a complete waveform with grid, axes, labels, and trace.
     *
     * @param {number[]} timeData  - X values (seconds)
     * @param {number[]} valueData - Y values (in display units)
     * @param {{ time: number, type: string }[]} triggerEvents - Overlay markers
     * @param {{ tailWindow?: { start: number, end: number }, baselineReached?: boolean } | null} overlay
     * @param {Array} highlights - Reusable highlight segments (see _drawWaveformHighlights)
     */
    render(timeData, valueData, triggerEvents = [], overlay = null, highlights = []) {
        // Resize in case the window changed
        this._resizeCanvas();

        const teachingMode = document.body.classList.contains('teaching-mode');
        const gridFont = teachingMode ? '13px monospace' : '11px monospace';
        const timeFont = teachingMode ? '12px monospace' : '10px monospace';
        const axisLabelFont = teachingMode
            ? 'bold 16px system-ui, -apple-system, sans-serif'
            : 'bold 13px system-ui, -apple-system, sans-serif';
        this.margin = teachingMode
            ? { top: 8, right: 12, bottom: 30, left: 66 }
            : { top: 8, right: 12, bottom: 24, left: 56 };

        const ctx  = this.ctx;
        const plot = this.plotArea;

        // Determine data ranges
        const tMin = timeData[0];
        const tMax = timeData[timeData.length - 1];

        let dataMin = Infinity, dataMax = -Infinity;
        for (let i = 0; i < valueData.length; i++) {
            if (valueData[i] < dataMin) dataMin = valueData[i];
            if (valueData[i] > dataMax) dataMax = valueData[i];
        }

        const { yMin, yMax, yStep } = this._niceYRange(dataMin, dataMax);

        // --- Clear background ---
        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, this.width, this.height);

        // --- Coordinate transforms ---
        const xScale = (t) => plot.x + ((t - tMin) / (tMax - tMin)) * plot.w;
        const yScale = (v) => plot.y + plot.h - ((v - yMin) / (yMax - yMin)) * plot.h;

        // --- Draw horizontal grid lines and Y-axis labels ---
        ctx.font = gridFont;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (let y = yMin; y <= yMax + yStep * 0.01; y += yStep) {
            const py = yScale(y);

            // Grid line
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(plot.x, py);
            ctx.lineTo(plot.x + plot.w, py);
            ctx.stroke();

            // Y-axis label
            ctx.fillStyle = this.textColor;
            const label = Number.isInteger(y) ? y.toString() : y.toFixed(1);
            ctx.fillText(label, plot.x - 6, py);
        }

        // --- Draw vertical grid lines (every second) with time labels ---
        const tStart = Math.ceil(tMin);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let t = tStart; t <= tMax; t += 1) {
            const px = xScale(t);
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, plot.y);
            ctx.lineTo(px, plot.y + plot.h);
            ctx.stroke();

            // Time label below plot area
            ctx.fillStyle = this.textColor;
            ctx.font = timeFont;
            // Show relative seconds (mod 60 for readability)
            const label = Math.abs(t % 60).toString();
            ctx.fillText(label, px, plot.y + plot.h + 3);
        }

        // --- Draw zero line (if zero is in range) ---
        if (yMin <= 0 && yMax >= 0) {
            const zeroY = yScale(0);
            ctx.strokeStyle = this.axisColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(plot.x, zeroY);
            ctx.lineTo(plot.x + plot.w, zeroY);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // --- Draw plot border ---
        ctx.strokeStyle = this.axisColor;
        ctx.lineWidth = 1;
        ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

        // --- Draw waveform trace ---
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        for (let i = 0; i < timeData.length; i++) {
            const px = xScale(timeData[i]);
            const py = yScale(valueData[i]);

            // Clamp to plot area
            const cyp = Math.max(plot.y, Math.min(plot.y + plot.h, py));

            if (i === 0) {
                ctx.moveTo(px, cyp);
            } else {
                ctx.lineTo(px, cyp);
            }
        }
        ctx.stroke();

        if (teachingMode && overlay?.tailWindow) {
            this._drawTailHighlight(
                ctx,
                timeData,
                valueData,
                overlay.tailWindow,
                overlay.baselineReached,
                xScale,
                yScale,
                plot
            );
        }

        // Reusable trace highlights (e.g. ineffective-effort flow deflection).
        this._drawWaveformHighlights(ctx, highlights, timeData, valueData, xScale, yScale, plot);

        this._drawTriggerMarkers(ctx, triggerEvents, xScale, plot);

        // --- Draw Y-axis label (rotated, left side) ---
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.font = axisLabelFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.translate(15, plot.y + plot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.label, 0, 0);
        ctx.restore();
    }

    _drawTailHighlight(ctx, timeData, valueData, tailWindow, baselineReached, xScale, yScale, plot) {
        const start = Math.max(0, Math.min(timeData.length - 1, tailWindow.start));
        const end = Math.max(start + 1, Math.min(timeData.length, tailWindow.end));

        if (end - start < 2) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y, plot.w, plot.h);
        ctx.clip();

        // Gas trapping (expiratory flow did NOT return to baseline) gets a louder,
        // distinct treatment: a vivid crimson overstroke + an "air trapping" label.
        // The crimson stays clearly separate from the amber-gold ineffective-effort
        // highlight. The baseline-reached case keeps its original quiet blue cue.
        const GAS_TRAPPING_COLOR = 'rgba(255, 45, 85, 0.80)';

        ctx.strokeStyle = baselineReached
            ? 'rgba(100, 200, 255, 0.25)'
            : GAS_TRAPPING_COLOR;
        ctx.lineWidth = baselineReached ? 2 : 3.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();

        let minX = Infinity, maxX = -Infinity, topY = Infinity;
        for (let i = start; i < end; i++) {
            const px = xScale(timeData[i]);
            const py = yScale(valueData[i]);
            const cyp = Math.max(plot.y, Math.min(plot.y + plot.h, py));

            if (i === start) {
                ctx.moveTo(px, cyp);
            } else {
                ctx.lineTo(px, cyp);
            }
            if (px < minX) minX = px;
            if (px > maxX) maxX = px;
            if (cyp < topY) topY = cyp;
        }

        ctx.stroke();

        // Teaching Mode label on the non-returning expiratory limb (mirrors the
        // ineffective-effort label in _drawWaveformHighlights). The whole tail
        // highlight is already teaching-gated at the call site, so this is
        // teaching-only. Gas-trapping branch only — the blue branch stays unlabeled.
        if (!baselineReached) {
            ctx.fillStyle = GAS_TRAPPING_COLOR;
            ctx.font = '10px system-ui, -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('air trapping', (minX + maxX) / 2, Math.max(plot.y + 10, topY - 4));
        }

        ctx.restore();
    }

    _drawTriggerMarkers(ctx, triggerEvents, xScale, plot) {
        if (!triggerEvents || triggerEvents.length === 0) return;

        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y, plot.w, plot.h);
        ctx.clip();

        for (const event of triggerEvents) {
            // Failed (ineffective) efforts are rendered as a highlighted amber
            // segment on the flow trace by _drawWaveformHighlights — not a marker.
            if (event.type === 'failed') continue;

            const x = xScale(event.time);

            if (event.type === 'patient') {
                this._drawPatientTriggerMarker(ctx, x, plot);
            } else {
                this._drawMachineTriggerMarker(ctx, x, plot);
            }
        }

        ctx.restore();
    }

    _drawMachineTriggerMarker(ctx, x, plot) {
        const top = plot.y + 2;

        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + 11);
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.arc(x, top + 3, 1.8, 0, Math.PI * 2);
        ctx.fill();
    }

    _drawPatientTriggerMarker(ctx, x, plot) {
        const top = plot.y + 2;

        ctx.strokeStyle = '#4fc3f7';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + 14);
        ctx.stroke();

        ctx.fillStyle = '#4fc3f7';
        ctx.beginPath();
        ctx.moveTo(x, top + 4);
        ctx.lineTo(x - 4, top + 11);
        ctx.lineTo(x + 4, top + 11);
        ctx.closePath();
        ctx.fill();
    }

    /**
     * REUSABLE HIGHLIGHT PRIMITIVE — recolors and slightly thickens the existing
     * trace polyline between tStart and tEnd. Trace-agnostic: any feature can feed
     * segments (ineffective effort now; gas trapping, successful/auto trigger,
     * etc. later). It changes NO data — it re-strokes the same sample points.
     * Each segment: { trace, tStart, tEnd, color, lineWidthDelta, label, tooltip }.
     * A segment is drawn only on the renderer whose `kind` matches `segment.trace`.
     */
    _drawWaveformHighlights(ctx, segments, timeData, valueData, xScale, yScale, plot) {
        const mine = (segments || []).filter((s) => s && s.trace === this.kind);
        this._highlightHoverRegions = [];
        if (mine.length === 0) { this._syncHighlightTooltip(); return; }

        const teachingMode = document.body.classList.contains('teaching-mode');
        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y, plot.w, plot.h);
        ctx.clip();

        for (const seg of mine) {
            // sample indices inside [tStart, tEnd] — IDENTICAL span to baseline
            let i0 = -1, i1 = -1;
            for (let i = 0; i < timeData.length; i++) {
                if (timeData[i] >= seg.tStart && i0 === -1) i0 = i;
                if (timeData[i] <= seg.tEnd) i1 = i;
            }
            if (i0 === -1 || i1 - i0 < 1) continue;

            // Collect the exact same sample points first, so the feathered
            // gradient can span the segment from its left to right edge.
            const pts = [];
            let minX = Infinity, maxX = -Infinity, topY = Infinity;
            for (let i = i0; i <= i1; i++) {
                const px = xScale(timeData[i]);
                const py = Math.max(plot.y, Math.min(plot.y + plot.h, yScale(valueData[i])));
                pts.push(px, py);
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < topY) topY = py;
            }

            // Edge-feathered stroke: full highlight through the middle, fading to
            // transparent at each end so it emerges from (not painted onto) the trace.
            ctx.strokeStyle = this._featheredStroke(ctx, seg.color, minX, maxX);
            ctx.lineWidth = 1.8 + (seg.lineWidthDelta ?? 0);   // base trace is 1.8
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            for (let k = 0; k < pts.length; k += 2) {
                if (k === 0) ctx.moveTo(pts[k], pts[k + 1]);
                else ctx.lineTo(pts[k], pts[k + 1]);
            }
            ctx.stroke();

            // Teaching Mode: small label near the segment.
            if (teachingMode && seg.label) {
                ctx.fillStyle = seg.color;
                ctx.font = '10px system-ui, -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(seg.label, (minX + maxX) / 2, Math.max(plot.y + 10, topY - 4));
            }
            if (seg.tooltip) this._highlightHoverRegions.push({ x0: minX, x1: maxX, text: seg.tooltip });
        }
        ctx.restore();
        this._ensureHighlightHover();
        this._syncHighlightTooltip();
    }

    /** One-time hover wiring: surfaces a segment's tooltip via the canvas title. */
    _ensureHighlightHover() {
        if (this._highlightHoverBound) return;
        this._highlightHoverBound = true;
        this._highlightHoverX = null;
        this.canvas.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this._highlightHoverX = e.clientX - rect.left;   // CSS px, same domain as xScale
            this._syncHighlightTooltip();
        });
        this.canvas.addEventListener('mouseleave', () => {
            this._highlightHoverX = null;
            this._syncHighlightTooltip();
        });
    }

    /** Set canvas.title to the tooltip of the highlighted segment under the cursor. */
    _syncHighlightTooltip() {
        const regions = this._highlightHoverRegions || [];
        const x = this._highlightHoverX;
        let text = '';
        if (x != null) {
            for (const r of regions) {
                if (x >= r.x0 - 3 && x <= r.x1 + 3) { text = r.text; break; }
            }
        }
        if (this.canvas.title !== text) this.canvas.title = text;
    }

    /**
     * Build a left/right edge-feathered stroke style: full color through the
     * middle, fading to transparent at each end (~9 px) so a highlight emerges
     * from the trace instead of being painted on with a hard seam.
     */
    _featheredStroke(ctx, color, minX, maxX) {
        const { r, g, b } = this._hexToRgb(color);
        const width = Math.max(1, maxX - minX);
        const f = Math.min(0.45, Math.max(0.06, 9 / width));   // ~9 px feather each end
        const grad = ctx.createLinearGradient(minX, 0, maxX, 0);
        grad.addColorStop(0,     `rgba(${r},${g},${b},0)`);
        grad.addColorStop(f,     `rgba(${r},${g},${b},1)`);
        grad.addColorStop(1 - f, `rgba(${r},${g},${b},1)`);
        grad.addColorStop(1,     `rgba(${r},${g},${b},0)`);
        return grad;
    }

    /** Parse #rgb / #rrggbb (or a trimmed CSS var value) to {r,g,b}. */
    _hexToRgb(hex) {
        let h = String(hex).trim().replace('#', '');
        if (h.length === 3) h = h.split('').map((c) => c + c).join('');
        const n = parseInt(h, 16);
        if (!Number.isFinite(n) || h.length < 6) return { r: 212, g: 162, b: 60 };  // #d4a23c
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
}


/**
 * ============================================================================
 * LoopRenderer — X-Y Loop Display (P-V and F-V Loops)
 * ============================================================================
 *
 * Renders pressure-volume and flow-volume loops on canvas.
 * Shows two traces:
 *   - Completed breath (solid, full opacity) — the reference loop
 *   - Current breath (tracing live, slightly dimmer) — builds in real-time
 *
 * Clinical significance:
 *
 *   P-V Loop (Paw vs Volume):
 *     - Slope of inspiratory limb = dynamic compliance
 *     - Upper beak/flattening = overdistension
 *     - Loop not starting at 0 on P-axis = auto-PEEP
 *     - Area between limbs = resistive work of breathing
 *     - Pmus scalloping visible as leftward dip
 *
 *   F-V Loop (Flow vs Volume):
 *     - Scooped expiratory limb = airway obstruction (COPD/asthma)
 *     - Loop not returning to Vol=0 = air trapping
 *     - Inspiratory flow shape = square vs ramp pattern
 *     - Expiratory peak flow = elastic recoil strength
 *
 * ============================================================================
 */

export class LoopRenderer {

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {Object} options
     * @param {string} options.xLabel   - X-axis label
     * @param {string} options.yLabel   - Y-axis label
     * @param {string} options.color    - Completed loop color
     * @param {string} options.traceColor - Current breath trace color
     */
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.ctx    = canvas.getContext('2d');

        this.xLabel     = options.xLabel     ?? 'X';
        this.yLabel     = options.yLabel     ?? 'Y';
        this.color      = options.color      ?? '#f0c050';
        this.traceColor = options.traceColor ?? 'rgba(255,255,255,0.35)';
        this.bgColor    = options.bgColor    ?? '#0d1117';
        this.gridColor  = options.gridColor  ?? 'rgba(255,255,255,0.07)';
        this.textColor  = options.textColor  ?? 'rgba(232,236,240,0.78)';
        this.axisColor  = options.axisColor  ?? 'rgba(255,255,255,0.22)';

        this.margin = { top: 10, right: 12, bottom: 28, left: 52 };

        this._resizeCanvas();
    }

    _resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.width  = rect.width * dpr;
        this.height = rect.height * dpr;
        this.canvas.width  = this.width;
        this.canvas.height = this.height;
        this.ctx.scale(dpr, dpr);
        this.cssWidth  = rect.width;
        this.cssHeight = rect.height;
    }

    get plotArea() {
        return {
            x: this.margin.left,
            y: this.margin.top,
            w: this.cssWidth  - this.margin.left - this.margin.right,
            h: this.cssHeight - this.margin.top  - this.margin.bottom,
        };
    }

    /**
     * Compute nice axis range (same algorithm as WaveformRenderer).
     */
    _niceRange(dataMin, dataMax, fixedMin, fixedMax) {
        let lo = fixedMin ?? dataMin;
        let hi = fixedMax ?? dataMax;

        if (fixedMin === undefined || fixedMax === undefined) {
            const range = hi - lo || 1;
            const pad = Math.max(range * 0.1, 0.5);
            if (fixedMin === undefined) lo -= pad;
            if (fixedMax === undefined) hi += pad;
        }

        const rawRange = hi - lo;
        const rawStep = rawRange / 5;
        const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 0.001))));
        const norm = rawStep / mag;
        let step;
        if (norm <= 1.5) step = 1 * mag;
        else if (norm <= 3.5) step = 2 * mag;
        else if (norm <= 7.5) step = 5 * mag;
        else step = 10 * mag;

        lo = Math.floor(lo / step) * step;
        hi = Math.ceil(hi / step) * step;

        return { lo, hi, step };
    }

    /**
     * Render a loop display.
     *
     * @param {Object} completed  - { x: number[], y: number[] } completed breath
     * @param {Object} current    - { x: number[], y: number[] } current breath (live trace)
     * @param {Object} [opts]     - Optional overrides { xMin, xMax, yMin, yMax }
     */
    render(completed, current, opts = {}) {
        this._resizeCanvas();

        const ctx  = this.ctx;
        const plot = this.plotArea;

        // --- Determine axis ranges from all data ---
        let allX = [], allY = [];
        if (completed.x.length > 0) {
            allX = allX.concat(completed.x);
            allY = allY.concat(completed.y);
        }
        if (current.x.length > 0) {
            allX = allX.concat(current.x);
            allY = allY.concat(current.y);
        }

        if (allX.length < 2) {
            // Not enough data — just draw empty background
            ctx.fillStyle = this.bgColor;
            ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
            return;
        }

        const xDataMin = Math.min(...allX);
        const xDataMax = Math.max(...allX);
        const yDataMin = Math.min(...allY);
        const yDataMax = Math.max(...allY);

        const xRange = this._niceRange(xDataMin, xDataMax, opts.xMin, opts.xMax);
        const yRange = this._niceRange(yDataMin, yDataMax, opts.yMin, opts.yMax);

        // --- Clear ---
        ctx.fillStyle = this.bgColor;
        ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);

        // --- Coordinate transforms ---
        const xScale = (v) => plot.x + ((v - xRange.lo) / (xRange.hi - xRange.lo)) * plot.w;
        const yScale = (v) => plot.y + plot.h - ((v - yRange.lo) / (yRange.hi - yRange.lo)) * plot.h;

        // --- Grid lines: horizontal (Y) ---
        ctx.font = '11px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';

        for (let y = yRange.lo; y <= yRange.hi + yRange.step * 0.01; y += yRange.step) {
            const py = yScale(y);
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(plot.x, py);
            ctx.lineTo(plot.x + plot.w, py);
            ctx.stroke();

            ctx.fillStyle = this.textColor;
            const label = Number.isInteger(y) ? y.toString() : y.toFixed(1);
            ctx.fillText(label, plot.x - 6, py);
        }

        // --- Grid lines: vertical (X) ---
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (let x = xRange.lo; x <= xRange.hi + xRange.step * 0.01; x += xRange.step) {
            const px = xScale(x);
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, plot.y);
            ctx.lineTo(px, plot.y + plot.h);
            ctx.stroke();

            ctx.fillStyle = this.textColor;
            const label = Number.isInteger(x) ? x.toString() : x.toFixed(1);
            ctx.fillText(label, px, plot.y + plot.h + 4);
        }

        // --- Zero lines (if in range) ---
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = this.axisColor;
        ctx.lineWidth = 1;
        if (xRange.lo <= 0 && xRange.hi >= 0) {
            const zx = xScale(0);
            ctx.beginPath();
            ctx.moveTo(zx, plot.y);
            ctx.lineTo(zx, plot.y + plot.h);
            ctx.stroke();
        }
        if (yRange.lo <= 0 && yRange.hi >= 0) {
            const zy = yScale(0);
            ctx.beginPath();
            ctx.moveTo(plot.x, zy);
            ctx.lineTo(plot.x + plot.w, zy);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // --- Draw completed breath loop (solid, full color) ---
        if (completed.x.length > 2) {
            this._drawTrace(ctx, completed.x, completed.y, xScale, yScale,
                this.color, 2.0, plot);
        }

        // --- Draw current breath trace (dimmer, builds live) ---
        if (current.x.length > 2) {
            this._drawTrace(ctx, current.x, current.y, xScale, yScale,
                this.traceColor, 1.5, plot);

            // Bright dot at the current position (the "pen tip")
            const lastX = xScale(current.x[current.x.length - 1]);
            const lastY = yScale(current.y[current.y.length - 1]);
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }

        // --- X-axis label (bottom center) ---
        ctx.fillStyle = this.textColor;
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(this.xLabel, plot.x + plot.w / 2, plot.y + plot.h + 14);

        // --- Y-axis label (rotated, left side) ---
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.translate(13, plot.y + plot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.yLabel, 0, 0);
        ctx.restore();
    }

    /**
     * Draw a trace path, clipped to the plot area.
     */
    _drawTrace(ctx, xData, yData, xScale, yScale, color, lineWidth, plot) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(plot.x, plot.y, plot.w, plot.h);
        ctx.clip();

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';

        let started = false;
        for (let i = 0; i < xData.length; i++) {
            const px = xScale(xData[i]);
            const py = yScale(yData[i]);
            if (!started) { ctx.moveTo(px, py); started = true; }
            else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
        ctx.restore();
    }
}


/**
 * ============================================================================
 * WaveformDisplay — Manages the three-panel ventilator waveform display
 * ============================================================================
 *
 * Creates and coordinates three WaveformRenderer instances for the
 * standard ventilator display: Pressure, Volume, Flow vs. Time.
 *
 * ============================================================================
 */

export class WaveformDisplay {

    /**
     * @param {Object} canvases
     * @param {HTMLCanvasElement} canvases.pressure - Pressure waveform canvas
     * @param {HTMLCanvasElement} canvases.volume   - Volume waveform canvas
     * @param {HTMLCanvasElement} canvases.flow     - Flow waveform canvas
     * @param {number} numBreaths - Number of breaths to display
     */
    constructor(canvases, numBreaths = 4) {
        this.numBreaths = numBreaths;

        // Pressure: Yellow/amber — the classic ventilator pressure color
        this.pressureRenderer = new WaveformRenderer(canvases.pressure, {
            label: 'Paw (cmH₂O)',
            kind:  'pressure',
            color: '#f0c050',
            yMin:  0,
        });

        // Volume: Cyan — clearly distinct from pressure
        this.volumeRenderer = new WaveformRenderer(canvases.volume, {
            label: 'Vol (mL)',
            kind:  'volume',
            color: '#4fc3f7',
            yMin: -20,
        });

        // Flow: Green — the standard flow trace color
        this.flowRenderer = new WaveformRenderer(canvases.flow, {
            label: 'Flow (L/min)',
            kind:  'flow',
            color: '#66bb6a',
        });
    }

    /**
     * Render all three waveforms from a Ventilator instance (static mode).
     *
     * @param {import('./ventilator.js').Ventilator} ventilator
     */
    render(ventilator) {
        const waveforms = ventilator.generateBreathWaveforms(this.numBreaths);

        this.pressureRenderer.render(waveforms.time, waveforms.pressure);
        this.volumeRenderer.render(waveforms.time, waveforms.volume);
        this.flowRenderer.render(waveforms.time, waveforms.flow);
    }

    /**
     * Render all three waveforms from simulation ring buffers (dynamic mode).
     *
     * @param {import('./simulation.js').SimulationEngine} sim
     */
    renderFromSim(sim) {
        const time     = sim.buffers.time.toArray();
        const pressure = sim.buffers.pressure.toArray();
        const volume   = sim.buffers.volume.toArray();
        const flow     = sim.buffers.flow.toArray();

        if (time.length < 2) return;

        const triggerEvents = sim.getTriggerEvents(time[0], time[time.length - 1]);
        const flowOverlay = sim.expTailWindow
            ? {
                tailWindow: sim.expTailWindow,
                baselineReached: sim.flowBaselineReached,
            }
            : null;

        // PR4a producer: ineffective-effort flow highlights (tagged trace:'flow',
        // so only the flow renderer draws them; the others filter them out).
        const neuralTi = sim.vent?.neuralTi ?? 1.0;
        const highlights = this._deriveFailedEffortSegments(time, flow, triggerEvents, neuralTi);

        this.pressureRenderer.render(time, pressure, triggerEvents, null, highlights);
        this.volumeRenderer.render(time, volume, triggerEvents, null, highlights);
        this.flowRenderer.render(time, flow, triggerEvents, flowOverlay, highlights);
    }

    /**
     * Handle window resize — re-render with current data.
     * Call this after the ventilator state is available.
     *
     * @param {import('./ventilator.js').Ventilator} ventilator
     */
    onResize(ventilator) {
        this.render(ventilator);
    }

    /**
     * PRODUCER (the only one wired now): turn 'failed' trigger events into flow
     * highlight segments. An ineffective effort recorded DURING EXPIRATION (a
     * gate-c 'threshold' miss) leaves a visible flow deflection — the expiratory
     * trace bends toward baseline without reaching it. VU failures during a
     * mandatory inspiration have no expiratory flow deflection (they scallop
     * pressure instead) and so are not highlighted on the flow trace.
     */
    _deriveFailedEffortSegments(time, flow, triggerEvents, neuralTi) {
        // Muted amber-gold "interpretation" finding color (NOT an alarm) — single
        // source of truth in css/style.css (--color-interpretation-highlight).
        const HIGHLIGHT_COLOR = (typeof getComputedStyle === 'function'
            ? getComputedStyle(document.documentElement)
                .getPropertyValue('--color-interpretation-highlight').trim()
            : '') || '#d4a23c';
        const win = Math.max(0.3, neuralTi || 1.0);   // the effort's own mechanical window
        const segments = [];
        for (const ev of (triggerEvents || [])) {
            if (ev.type !== 'failed') continue;
            if (ev.phase !== 'EXPIRATION') continue;  // only expiratory efforts bend the flow trace
            const span = this._deflectionSpan(time, flow, ev.time, win);
            if (!span) continue;
            segments.push({
                trace: 'flow',
                tStart: span.tStart,
                tEnd: span.tEnd,
                color: HIGHLIGHT_COLOR,
                lineWidthDelta: 1.4,                  // ~1.8 base → ~3.2 px, clearly thicker
                label: 'ineffective effort',
                tooltip: 'Ineffective effort — patient pulled but did not trigger',
            });
        }
        return segments;
    }

    /**
     * Bound the deflection span from the FLOW DATA itself (not an arbitrary ±N ms).
     * A 'threshold' failure is recorded at the effort's neural-inspiration END, so
     * search the one-neuralTi window ending there, take the least-negative flow
     * LOCAL MAX (the peak of the bend toward baseline), then expand to the flow
     * minima on each side. The result is exactly the visible deflection bump.
     */
    _deflectionSpan(time, flow, eventTime, win) {
        const n = time.length;
        if (n < 3) return null;
        let lo = 0, hi = 0, haveLo = false;
        for (let i = 0; i < n; i++) {
            if (time[i] >= eventTime - win && !haveLo) { lo = i; haveLo = true; }
            if (time[i] <= eventTime + 1e-9) hi = i;
        }
        if (!haveLo || hi - lo < 2) return null;
        let peak = lo;
        for (let i = lo; i <= hi; i++) if (flow[i] > flow[peak]) peak = i;
        let a = peak;
        while (a > lo && flow[a - 1] <= flow[a]) a--;     // walk down the left slope to the trough
        let b = peak;
        while (b < hi && flow[b + 1] <= flow[b]) b++;      // walk down the right slope to the trough
        if (b - a < 1) return null;
        return { tStart: time[a], tEnd: time[b] };
    }
}
