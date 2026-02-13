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

        // --- Draw vertical grid lines (every second) ---
        const tStart = Math.ceil(tMin);
        for (let t = tStart; t <= tMax; t += 1) {
            const px = xScale(t);
            ctx.strokeStyle = this.gridColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(px, plot.y);
            ctx.lineTo(px, plot.y + plot.h);
            ctx.stroke();
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
