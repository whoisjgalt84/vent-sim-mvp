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
        this.color     = options.color     ?? '#00ff87';
        this.bgColor   = options.bgColor   ?? '#0d1117';
        this.gridColor = options.gridColor ?? 'rgba(255,255,255,0.07)';
        this.textColor = options.textColor ?? 'rgba(255,255,255,0.5)';
        this.axisColor = options.axisColor ?? 'rgba(255,255,255,0.15)';

        // Y-axis range overrides (null = auto-scale from data)
        this.yMinFixed = options.yMin  ?? null;
        this.yMaxFixed = options.yMax  ?? null;
        this.yStep     = options.yStep ?? null;

        // Layout margins (pixels) — room for axis labels
        this.margin = { top: 8, right: 12, bottom: 22, left: 52 };

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
     */
    render(timeData, valueData) {
        // Resize in case the window changed
        this._resizeCanvas();

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
        ctx.font = '10px monospace';
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
            ctx.font = '9px monospace';
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

        // --- Draw Y-axis label (rotated, left side) ---
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.translate(13, plot.y + plot.h / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(this.label, 0, 0);
        ctx.restore();
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
        this.textColor  = options.textColor  ?? 'rgba(255,255,255,0.5)';
        this.axisColor  = options.axisColor  ?? 'rgba(255,255,255,0.15)';

        this.margin = { top: 10, right: 12, bottom: 26, left: 48 };

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
        ctx.font = '10px monospace';
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
        ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(this.xLabel, plot.x + plot.w / 2, plot.y + plot.h + 14);

        // --- Y-axis label (rotated, left side) ---
        ctx.save();
        ctx.fillStyle = this.color;
        ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.translate(11, plot.y + plot.h / 2);
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
            color: '#f0c050',
            yMin:  0,
        });

        // Volume: Cyan — clearly distinct from pressure
        this.volumeRenderer = new WaveformRenderer(canvases.volume, {
            label: 'Vol (mL)',
            color: '#4fc3f7',
            yMin: -20,
        });

        // Flow: Green — the standard flow trace color
        this.flowRenderer = new WaveformRenderer(canvases.flow, {
            label: 'Flow (L/min)',
            color: '#66bb6a',
        });
    }

    /**
     * Render all three waveforms from a Ventilator instance (static mode).
     *
     * @param {import('../core/ventilator.js').Ventilator}
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
     * @param {import('../core/simulation.js').SimulationEngine}
     */
    renderFromSim(sim) {
        const time     = sim.buffers.time.toArray();
        const pressure = sim.buffers.pressure.toArray();
        const volume   = sim.buffers.volume.toArray();
        const flow     = sim.buffers.flow.toArray();

        if (time.length < 2) return;

        this.pressureRenderer.render(time, pressure);
        this.volumeRenderer.render(time, volume);
        this.flowRenderer.render(time, flow);
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
}
