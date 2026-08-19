/**
 * ============================================================================
 * simulation.js — Real-Time Ventilator Simulation Engine
 * ============================================================================
 *
 * Replaces the static batch waveform generation with a tick-based
 * simulation that advances sample-by-sample. This enables:
 *
 *   - Patient-triggered breaths (patient RR ≠ vent RR)
 *   - Real-time parameter changes (watch transitions unfold)
 *   - Breath-to-breath gas trapping evolution
 *   - Foundation for asynchrony patterns
 *
 * Architecture:
 *   RingBuffer        — Fixed-size circular buffer for streaming data
 *   SimulationEngine  — Tick-based physics with breath state machine
 *
 * Physics per tick (Equation of Motion):
 *
 *   Paw + Pmus = PEEP + V/C + R × V̇
 *
 *   VC mode: V̇ is prescribed (square or ramp), Paw is computed
 *   PC mode: Paw is prescribed (PEEP + Pinsp), V̇ is computed via ODE
 *
 * State Machine:
 *
 *   INSPIRATION → HOLD (optional) → EXPIRATION → back to INSPIRATION
 *
 *   Transitions:
 *     INSP → HOLD/EXP:   when phaseTime ≥ Ti
 *     HOLD → EXP:         when phaseTime ≥ holdTime
 *     EXP → INSP:         machine timer fires OR patient triggers
 *
 * Neural Oscillator:
 *
 *   Independent patient clock at patientRR. When neural insp onset
 *   occurs during machine expiration, the effort may patient-trigger
 *   a breath if the selected flow/pressure threshold is crossed.
 *   Pmus follows a half-sine: Pmus(t) = pMusMax × sin(π × t / neuralTi)
 *
 * ============================================================================
 */


// =============================================================================
// RING BUFFER
// =============================================================================

export class RingBuffer {
    /**
     * @param {number} capacity - Maximum number of elements
     */
    constructor(capacity) {
        this.capacity = capacity;
        this.data = new Float64Array(capacity);
        this.head = 0;      // next write position
        this.count = 0;
    }

    /** Push a value into the buffer (overwrites oldest if full) */
    push(value) {
        this.data[this.head] = value;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) this.count++;
    }

    /** Return values in chronological order (oldest → newest) */
    toArray() {
        if (this.count === 0) return [];
        if (this.count < this.capacity) {
            return Array.from(this.data.subarray(0, this.count));
        }
        // Buffer full: head points to oldest
        const result = new Float64Array(this.capacity);
        const tail = this.head;
        result.set(this.data.subarray(tail));
        result.set(this.data.subarray(0, tail), this.capacity - tail);
        return Array.from(result);
    }

    /** Number of elements currently stored */
    get length() { return this.count; }

    /** Most recently pushed value */
    get last() {
        if (this.count === 0) return 0;
        return this.data[(this.head - 1 + this.capacity) % this.capacity];
    }

    /** Clear all data */
    clear() {
        this.head = 0;
        this.count = 0;
    }
}


// =============================================================================
// BREATH PHASES
// =============================================================================

const Phase = Object.freeze({
    INSPIRATION: 'INSPIRATION',
    HOLD:        'HOLD',
    EXPIRATION:  'EXPIRATION',
});


// =============================================================================
// SIMULATION ENGINE
// =============================================================================

export class SimulationEngine {

    /**
     * @param {import('./ventilator.js').Ventilator} ventilator
     * @param {Object} options
     * @param {number} options.sampleRate      - Hz (default 100)
     * @param {number} options.displaySeconds  - Visible time window (default 10)
     * @param {number} options.triggerEventRetentionSeconds - Trigger metadata retention (default 60)
     */
    constructor(ventilator, options = {}) {
        this.vent = ventilator;
        this.lung = ventilator.lung;

        this.sampleRate     = options.sampleRate     ?? 100;
        this.dt             = 1 / this.sampleRate;
        // Buffers are sized to the LARGEST selectable window; displaySeconds only
        // decides how much of that history is shown. Widening the window is
        // therefore instant and non-destructive — switching 10 s → 30 s reveals
        // breaths that already happened instead of blanking the screen and
        // waiting 30 s to refill.
        this.maxDisplaySeconds = options.maxDisplaySeconds ?? 30;
        this.displaySeconds = Math.min(options.displaySeconds ?? 10, this.maxDisplaySeconds);
        this.triggerEventRetentionSeconds = options.triggerEventRetentionSeconds ?? 60;
        this.triggerLockoutSeconds = 0.10;

        // --- Ring Buffers (streaming display data) ---
        const bufSize = Math.round(this.maxDisplaySeconds * this.sampleRate);
        this.buffers = {
            time:     new RingBuffer(bufSize),
            pressure: new RingBuffer(bufSize),
            volume:   new RingBuffer(bufSize),
            flow:     new RingBuffer(bufSize),
        };

        // --- Global Clock ---
        this.globalTime = 0;

        // --- Breath State Machine ---
        this.phase      = Phase.EXPIRATION;
        this.currentPhase = 'expiration';
        this.phaseTime  = 0;        // seconds within current phase
        this.machineTimer = 0;      // seconds since last breath start (machine clock)
        this.lastBreathStartSec = 0;

        // --- Physical State ---
        this.volumeAboveEq = 0;           // L above PEEP equilibrium (total lung gas)
        this.volumeAtBreathStart = 0;     // baseline for display VT
        this.currentFlow = 0;             // L/s
        this.currentPressure = 0;         // cmH2O (Paw)

        // --- Patient Neural Oscillator ---
        //   Independent breathing drive, separate from ventilator timing.
        //   patientRR = 0 means passive (no spontaneous effort).
        this.patientRR = 0;               // breaths/min (0 = passive)
        this.neuralTimer = 0;             // seconds within current neural cycle
        this.neuralInspActive = false;    // currently in neural inspiration?
        this.neuralCycleResolved = false; // one trigger outcome per neural inspiration (delivered OR failed)
        this.neuralEligibleSeen = false;  // effort reached the threshold gate this neural inspiration
        this.scheduledBreathTrigger = null;

        // --- Per-Breath Measurements ---
        //   Updated each breath for the parameter display panel.
        this.measuredPIP       = 0;       // peak inspiratory pressure (running, this breath)
        this.lastBreathPIP     = 0;       // PIP latched from the last COMPLETED breath (SME-014)
        this.measuredPplat     = null;    // plateau pressure (hold only)
        this.measuredVT_mL     = 0;       // delivered tidal volume
        this.peakInspFlow_Lpm  = 0;       // peak inspiratory flow
        this.peakInspiratoryFlow = 0;     // L/s, used for flow cycling in PC-CSV
        this.breathTimestamps = [];       // completed-breath timestamps (ms)
        this.measuredRR = 0;              // breaths/min from completed breaths
        this.measuredRespiratoryRate = 0; // backwards-compatible alias

        // --- Per-Breath Loop Data ---
        //   Collects (pressure, volume, flow) samples for the current breath.
        //   When a new breath starts, current → completed (for loop display).
        //   "completed" always holds the most recent FULL breath for rendering.
        this.loopCurrent   = { pressure: [], volume: [], flow: [] };
        this.loopCompleted = { pressure: [], volume: [], flow: [] };

        // --- Teaching Signals: Expiratory Flow Baseline Return ---
        this.flowBaselineReached = true;
        this.expFlowReturnPercent = 100;
        this.expTailWindow = null;
        this._expTailWindowSamples = null;
        this._expStartSample = null;
        this._expMinAbsFlow = Infinity;
        this._prevFlowLpm = 0;
        this._sampleCount = 0;

        // --- Breath Tracking ---
        this.breathCount     = 0;
        this.machineBreathCount = 0;
        this.patientBreathCount = 0;
        this.lastTriggerType = 'machine';  // 'machine' or 'patient'
        this.triggerEvents   = [];         // delivered + failed trigger markers
        this.currentBreath = null;          // breath-start context awaiting finalization
        this.lastCompletedBreath = null;    // canonical finalized breath record

        // --- Transport Controls ---
        this.running = true;
        this.speed   = 1;                  // 0.5×, 1×, 2×, 4×

        // --- Initialize ---
        this._prefill();
    }


    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Pre-fill buffers with PEEP baseline so the display isn't blank
     * on startup, then immediately start the first breath.
     */
    /**
     * Change the visible time window without disturbing the simulation. The
     * buffers already hold maxDisplaySeconds of history, so this only changes how
     * much of it is drawn — no data is lost when narrowing, and widening
     * immediately shows real recorded breaths rather than a blank stretch.
     *
     * @param {number} seconds - Desired window, clamped to [1, maxDisplaySeconds]
     * @returns {number} The window actually applied
     */
    setDisplaySeconds(seconds) {
        const requested = Number(seconds);
        if (!Number.isFinite(requested)) return this.displaySeconds;
        this.displaySeconds = Math.max(1, Math.min(requested, this.maxDisplaySeconds));
        return this.displaySeconds;
    }

    _prefill() {
        const peep = this.vent.peep;
        const n = this.buffers.time.capacity;
        // Stamp the baseline so the newest prefilled sample lands at t≈0: the run
        // of pre-history must match the BUFFER's span, not the visible window,
        // or the timestamps skew once the two differ.
        const bufferSpan = n * this.dt;
        for (let i = 0; i < n; i++) {
            this.buffers.time.push(-bufferSpan + i * this.dt);
            this.buffers.pressure.push(peep);
            this.buffers.volume.push(0);
            this.buffers.flow.push(0);
        }
        this._sampleCount = this.buffers.flow.length;
        this._prevFlowLpm = 0;
        this._syncExpTailWindow();
        this.currentPressure = peep;

        if (!this.vent.isSpontaneousMode()) {
            this._startNewBreath('machine', this.globalTime);
        }
    }

    _updateExpFlowTracking(flowLpm, sampleIndex) {
        const prevFlow = this._prevFlowLpm;

        if (prevFlow >= 0 && flowLpm < 0) {
            this._expStartSample = sampleIndex;
            this._expMinAbsFlow = Math.abs(flowLpm);
        } else if (this._expStartSample !== null && flowLpm <= 0) {
            this._expMinAbsFlow = Math.min(this._expMinAbsFlow, Math.abs(flowLpm));
        }

        if (this._expStartSample !== null && prevFlow <= 0 && flowLpm > 0) {
            const threshold = 0.5;  // L/min teaching threshold for "near baseline"
            const minAbsFlow = isFinite(this._expMinAbsFlow)
                ? this._expMinAbsFlow
                : Math.abs(prevFlow);
            const baselineReached = minAbsFlow <= threshold;
            const percent = Math.max(
                0,
                Math.min(100, (threshold / (minAbsFlow + 1e-6)) * 100)
            );

            this.flowBaselineReached = baselineReached;
            this.expFlowReturnPercent = baselineReached ? 100 : percent;
            this._expTailWindowSamples = {
                start: this._expStartSample,
                end: sampleIndex,
            };

            this._expStartSample = null;
            this._expMinAbsFlow = Infinity;
        }

        this._prevFlowLpm = flowLpm;
    }

    _syncExpTailWindow() {
        if (!this._expTailWindowSamples) {
            this.expTailWindow = null;
            return;
        }

        const visibleCount = this.buffers.flow.length;
        const oldestVisibleSample = this._sampleCount - visibleCount;
        const start = this._expTailWindowSamples.start - oldestVisibleSample;
        const end = this._expTailWindowSamples.end - oldestVisibleSample;

        if (end <= 0 || start >= visibleCount) {
            this.expTailWindow = null;
            return;
        }

        const clampedStart = Math.max(0, start);
        const clampedEnd = Math.min(visibleCount, end);

        this.expTailWindow = clampedEnd > clampedStart
            ? { start: clampedStart, end: clampedEnd }
            : null;
    }


    // =========================================================================
    // NEURAL OSCILLATOR
    // =========================================================================

    /**
     * Current Pmus value from the patient's neural drive.
     *
     * Pmus(t) = pMusMax × sin(π × t / neuralTi)  during neural insp
     * Pmus(t) = 0                                    during neural exp
     *
     * The neural oscillator runs independently of the ventilator.
     * This is how real respiratory drive works: the brainstem fires
     * at its own rate, regardless of what the machine is doing.
     */
    get currentPmus() {
        if (this.patientRR <= 0 || this.vent.pMusMax <= 0) return 0;
        if (!this.neuralInspActive) return 0;

        const neuralTi = this.vent.neuralTi;
        if (this.neuralTimer > neuralTi) return 0;

        return this.vent.pMusMax * Math.sin(Math.PI * this.neuralTimer / neuralTi);
    }

    /**
     * Advance the patient's neural oscillator by one time step.
     *
     * The oscillator cycles at patientRR independently of the ventilator. This
     * method advances only the neural CLOCK and the neuralInspActive state; the
     * trigger decision itself is made by _evaluatePatientTrigger() after physics
     * is computed (design spec §2). A neural inspiration that ends without
     * delivering a breath, yet was eligible to trigger, is resolved here as a
     * 'threshold' ineffective effort.
     */
    _advanceNeural() {
        if (this.patientRR <= 0) {
            // No neural drive → no per-cycle trigger state to carry.
            this.neuralCycleResolved = false;
            this.neuralEligibleSeen = false;
            return;
        }

        const neuralCycleTime = 60 / this.patientRR;
        const neuralTi = this.vent.neuralTi;

        this.neuralTimer += this.dt;

        // End neural inspiration when neuralTi elapsed.
        if (this.neuralInspActive && this.neuralTimer >= neuralTi) {
            this.neuralInspActive = false;
            this._onNeuralInspirationEnd();
        }

        // Start a new neural cycle when the full cycle time elapses. A fresh
        // neural inspiration begins undecided (no outcome, no eligibility yet).
        if (this.neuralTimer >= neuralCycleTime) {
            this.neuralTimer -= neuralCycleTime;  // carry remainder for timing accuracy
            this.neuralInspActive = true;
            this.neuralCycleResolved = false;
            this.neuralEligibleSeen = false;
        }
    }

    /**
     * Three-gate patient-trigger eligibility, evaluated EVERY tick while a neural
     * inspiration is active (design spec §2). Exactly one outcome per neural
     * inspiration — a delivered patient breath OR a failed-trigger event — never
     * a silent drop. The trigger MATH (gate c) is unchanged from before; only
     * WHEN/HOW OFTEN it is evaluated, and what is recorded on failure, changed.
     */
    _evaluatePatientTrigger() {
        // Effort must actually be present. A commanded oscillator with zero Pmus
        // is passive and produces NO event (closes the zero-effort phantom failure).
        const effortPresent =
            this.patientRR > 0 && this.vent.pMusMax > 0 && this.neuralInspActive;
        if (!effortPresent) return;

        // One outcome per neural inspiration.
        if (this.neuralCycleResolved) return;

        // Gate (a) — ventilator available? A mandatory INSPIRATION/HOLD cannot
        // honor a trigger; the effort is ineffective (HOLD treated as INSPIRATION).
        if (this.phase !== Phase.EXPIRATION) {
            this._recordFailedTrigger('ventilator_unavailable');
            this.neuralCycleResolved = true;
            return;
        }

        // Gate (b) — past the genuine post-breath refractory? Within it the effort
        // is real but too soon: hold and re-check next tick (NOT a failure).
        if (this.phaseTime <= this.triggerLockoutSeconds) return;

        // Gates (a)+(b) passed → the effort is eligible to trigger this cycle.
        this.neuralEligibleSeen = true;

        // Gate (c) — does the effort cross sensitivity? (existing math, UNCHANGED)
        const pmus = this.currentPmus;
        const elasticRecoilPressure = this.volumeAboveEq / this.lung.compliance;

        // Effective patient-generated effort available at the airway opening
        // after overcoming residual lung recoil / intrinsic PEEP load.
        const pressureDeflectionCmH2O = Math.max(0, pmus - elasticRecoilPressure);

        // Positive flow during expiration represents inspiratory flow demand.
        const inspiratoryFlowDeflectionLpm = Math.max(0, this.currentFlow * 60);

        const triggerType = this.vent.triggerType ?? 'flow';

        const triggered =
            triggerType === 'pressure'
                ? pressureDeflectionCmH2O >= this.vent.pressureTriggerCmH2O
                : inspiratoryFlowDeflectionLpm >= this.vent.flowTriggerLpm;

        if (triggered) {
            this.scheduledBreathTrigger = 'patient';
            this.neuralCycleResolved = true;
        }
        // else: eligible but sub-threshold this tick → keep evaluating until the
        // neural inspiration ends, where it resolves as a 'threshold' failure.
    }

    /**
     * Neural inspiration just ended. If the effort became eligible (passed the
     * ventilator-available and refractory gates) but never crossed the trigger
     * threshold, it is an ineffective effort — record it as a failed trigger.
     */
    _onNeuralInspirationEnd() {
        if (this.neuralEligibleSeen && !this.neuralCycleResolved) {
            this._recordFailedTrigger('threshold');
        }
    }

    /** Record an ineffective patient effort (Pmus present, no delivered breath). */
    _recordFailedTrigger(gateFailed) {
        this._recordTriggerEvent('failed', this.globalTime, {
            gateFailed,
            pmus: this.currentPmus,
            phase: this.phase,
        });
    }


    // =========================================================================
    // BREATH STATE MACHINE
    // =========================================================================

    _recordTriggerEvent(type, time = this.globalTime, extra = {}) {
        // Backward compatible: delivered ('machine'/'patient') events keep the
        // {type, time} shape; failed events add {gateFailed, pmus, phase} (§3).
        this.triggerEvents.push({ type, time, ...extra });

        const cutoff = time - this.triggerEventRetentionSeconds;
        while (this.triggerEvents.length > 0 && this.triggerEvents[0].time < cutoff) {
            this.triggerEvents.shift();
        }
    }

    _setPhase(phase) {
        this.phase = phase;
        this.currentPhase = phase === Phase.EXPIRATION ? 'expiration' : 'inspiration';
    }

    _updateMeasuredRR() {
        const times = this.breathTimestamps;

        if (times.length < 2) {
            this.measuredRR = 0;
            this.measuredRespiratoryRate = 0;
            return;
        }

        let totalInterval = 0;
        for (let i = 1; i < times.length; i++) {
            totalInterval += (times[i] - times[i - 1]);
        }

        const avgIntervalMs = totalInterval / (times.length - 1);
        const rawMeasuredRR = 60000 / avgIntervalMs;

        this.measuredRR = this.measuredRR > 0
            ? this.measuredRR * 0.7 + rawMeasuredRR * 0.3
            : rawMeasuredRR;

        if (!isFinite(this.measuredRR)) {
            this.measuredRR = 0;
        }

        this.measuredRespiratoryRate = this.measuredRR;
    }

    _startExpiration(terminationReason = null) {
        this.measuredVT_mL =
            (this.volumeAboveEq - this.volumeAtBreathStart) * 1000;
        this.breathTimestamps.push(this.globalTime * 1000);
        if (this.breathTimestamps.length > 10) {
            this.breathTimestamps.shift();
        }
        this._updateMeasuredRR();
        // Latch the peak THIS breath reached, at the moment inspiration ends —
        // NOT at the start of the next breath. measuredPIP is written only in
        // _computeInspiration, so it is already final here and cannot change
        // before the next _startNewBreath. Latching here is what makes the
        // monitor show the breath that just finished for the whole expiratory
        // phase (2/3 of the cycle at I:E 1:2) instead of the one before it —
        // latching at breath start meant a pressure excursion could raise the
        // high-pressure alarm while PIP still read the previous, normal value.
        // Every inspiration exit funnels through here: mandatory, post-HOLD,
        // and the PC-CSV flow-cycled path. measuredPIP itself is untouched —
        // the alarm must still see pressure the instant it rises (SME-014).
        if (this.measuredPIP > 0) {
            this.lastBreathPIP = this.measuredPIP;
        }

        if (this.currentBreath) {
            const cycleAgent = terminationReason === 'flowCycle'
                ? 'patient'
                : 'machine';
            const breathType =
                this.currentBreath.triggerAgent === 'patient' && cycleAgent === 'patient'
                    ? 'spontaneous'
                    : 'mandatory';
            const flowCycleThreshold_Lpm = this.vent.isSpontaneousMode()
                ? this.peakInspiratoryFlow * 60 * (this.vent.cyclePercent / 100)
                : null;

            this.lastCompletedBreath = Object.freeze({
                configuredMode: this.currentBreath.configuredMode,
                triggerAgent: this.currentBreath.triggerAgent,
                cycleAgent,
                terminationReason,
                breathType,
                startedAt_s: this.currentBreath.startedAt_s,
                completedAt_s: this.globalTime,
                inspiratoryTime_s: this.phaseTime,
                boundarySampleIndex: this._sampleCount,
                measuredVT_mL: this.measuredVT_mL,
                flowAtTermination_Lpm: this.currentFlow * 60,
                flowCycleThreshold_Lpm,
            });
            this.currentBreath = null;
        }

        this._setPhase(Phase.EXPIRATION);
        this.phaseTime = 0;
        this.peakInspiratoryFlow = 0;
    }

    /** Start a new breath (machine-triggered or patient-triggered). */
    _startNewBreath(triggerType, eventTime = this.globalTime) {
        this._setPhase(Phase.INSPIRATION);
        this.phaseTime = 0;
        this.volumeAtBreathStart = this.volumeAboveEq;
        this.breathCount++;
        if (triggerType === 'patient') {
            this.patientBreathCount++;
        } else {
            this.machineBreathCount++;
        }
        this.lastTriggerType = triggerType;
        this.currentBreath = {
            configuredMode: this.vent.mode,
            triggerAgent: triggerType,
            startedAt_s: eventTime,
        };
        this.machineTimer = 0;
        this.lastBreathStartSec = this.globalTime;
        this._recordTriggerEvent(triggerType, eventTime);

        // Swap loop data: current (now complete) → completed, then reset current
        if (this.loopCurrent.pressure.length > 10) {
            this.loopCompleted = this.loopCurrent;
        }
        this.loopCurrent = { pressure: [], volume: [], flow: [] };

        // Reset per-breath measurements
        //   (lastBreathPIP is latched in _startExpiration, where the peak is
        //   final — deliberately NOT here. One latch site only.)
        this.measuredPIP       = 0;
        this.measuredPplat     = null;
        this.measuredVT_mL     = 0;
        this.peakInspFlow_Lpm  = 0;
        this.peakInspiratoryFlow = 0;
    }

    /** Check for phase transitions based on timing. */
    _checkTransitions() {
        const ti      = this.vent.inspiratoryTime;
        const holdDur = this.vent.effectiveHoldTime;
        const ttot    = this.vent.totalCycleTime;
        const isSpontaneous = this.vent.isSpontaneousMode();

        switch (this.phase) {

            case Phase.INSPIRATION:
                if (isSpontaneous) {
                    const cycleThreshold =
                        this.peakInspiratoryFlow * (this.vent.cyclePercent / 100);
                    const cycleReady =
                        this.phaseTime > this.dt &&
                        this.peakInspiratoryFlow > 0 &&
                        this.currentFlow <= cycleThreshold;
                    const maxTiReached =
                        this.phaseTime >= Math.max(this.vent.inspiratoryTime, this.dt * 2);

                    if (cycleReady) {
                        this._startExpiration('flowCycle');
                    } else if (maxTiReached) {
                        this._startExpiration('maxTiReached');
                    }
                } else if (this.phaseTime >= ti) {
                    if (holdDur > 0) {
                        this._setPhase(Phase.HOLD);
                        this.phaseTime = 0;
                        this.measuredVT_mL =
                            (this.volumeAboveEq - this.volumeAtBreathStart) * 1000;
                    } else {
                        this._startExpiration();
                    }
                }
                break;

            case Phase.HOLD:
                if (this.phaseTime >= holdDur) {
                    this._startExpiration();
                }
                break;

            case Phase.EXPIRATION:
                // Machine backup timer: if machineTimer reaches Ttot,
                // the machine fires regardless of patient effort.
                if (!isSpontaneous &&
                    this.machineTimer >= ttot &&
                    this.scheduledBreathTrigger !== 'patient') {
                    this._startNewBreath('machine', this.globalTime);
                }
                break;
        }
    }


    // =========================================================================
    // PHYSICS
    // =========================================================================

    /** Compute flow, volume, and pressure for the current time step. */
    _computePhysics() {
        const R    = this.lung.resistance;
        const C    = this.lung.compliance;
        const peep = this.vent.peep;
        const pmus = this.currentPmus;
        const dt   = this.dt;

        switch (this.phase) {
            case Phase.INSPIRATION:
                this._computeInspiration(R, C, peep, pmus, dt);
                break;
            case Phase.HOLD:
                this._computeHold(C, peep, pmus);
                break;
            case Phase.EXPIRATION:
                this._computeExpiration(R, C, peep, pmus, dt);
                break;
        }
    }

    /**
     * Inspiration physics — mode-dependent.
     *
     * VC: Flow prescribed (square or ramp). Pressure is dependent.
     *     Paw = PEEP + V/C + R×V̇ − Pmus
     *
     * PC: Pressure prescribed. Flow computed from ODE (Euler step).
     *     V̇ = (Pinsp + Pmus − V_above_eq/C) / R
     */
    _computeInspiration(R, C, peep, pmus, dt) {
        const isPressureMode = this.vent.isPressureMode();
        const ti   = this.vent.inspiratoryTime;

        if (!isPressureMode) {
            // --- Volume Control: flow is prescribed ---
            let flow;
            if (this.vent.flowPattern === 'ramp') {
                const vPeak = 2 * this.vent.tidalVolume / ti;
                flow = vPeak * Math.max(0, 1 - this.phaseTime / ti);
            } else {
                flow = this.vent.tidalVolume / ti;
            }

            this.volumeAboveEq += flow * dt;
            this.currentFlow = flow;

            // Equation of motion: Paw = PEEP + V/C + R×V̇ − Pmus
            this.currentPressure =
                peep + this.volumeAboveEq / C + R * flow - pmus;

        } else {
            // --- Pressure Control: pressure prescribed, flow is ODE ---
            const pinsp = this.vent.pressureControlLevel;

            // V̇ = (Pinsp + Pmus − V_above_eq/C) / R
            const flow = (pinsp + pmus - this.volumeAboveEq / C) / R;

            // Clamp: flow can't reverse during PC inspiration
            // (ventilator closes insp valve if flow reverses)
            this.currentFlow = Math.max(0, flow);
            this.volumeAboveEq += this.currentFlow * dt;

            // Displayed Paw = set pressure (the vent maintains this)
            this.currentPressure = peep + pinsp;
        }

        // Track peak values for this breath
        if (this.currentPressure > this.measuredPIP) {
            this.measuredPIP = this.currentPressure;
        }
        if (this.currentFlow * 60 > this.peakInspFlow_Lpm) {
            this.peakInspFlow_Lpm = this.currentFlow * 60;
        }
        if (this.vent.isSpontaneousMode()) {
            this.peakInspiratoryFlow = Math.max(this.peakInspiratoryFlow, this.currentFlow);
        }
    }

    /**
     * Inspiratory hold — both valves closed, flow = 0.
     *
     * In a single compartment with sealed valves:
     *   Paw = PEEP + V/C − Pmus
     *
     * Pmus is visible during hold (muscles pulling on the sealed system
     * create a transient pressure dip).
     */
    _computeHold(C, peep, pmus) {
        this.currentFlow = 0;
        this.currentPressure = peep + this.volumeAboveEq / C - pmus;

        // Capture Pplat on first hold sample (before Pmus distorts it)
        if (this.measuredPplat === null) {
            this.measuredPplat = peep + this.volumeAboveEq / C;
        }
    }

    /**
     * Expiration — passive recoil ± patient effort.
     *
     *   V̇ = −(V_above_eq/C − Pmus) / R
     *
     * Normally V̇ < 0 (expiratory flow). If Pmus > V/C near end of
     * expiration, flow can reverse briefly (this is the trigger
     * pressure/flow deflection visible on the waveform).
     *
     * Paw during passive exp ≈ PEEP (maintained by valve).
     * Computed as: Paw = PEEP + V/C + R × V̇
     * Which equals PEEP when V̇ = −(V/C)/R.
     */
    _computeExpiration(R, C, peep, pmus, dt) {
        const flow = -(this.volumeAboveEq / C - pmus) / R;
        this.currentFlow = flow;

        this.volumeAboveEq += flow * dt;
        this.volumeAboveEq = Math.max(0, this.volumeAboveEq);

        // Paw = PEEP + V/C + R × V̇  (equals PEEP for passive exp)
        this.currentPressure = peep - pmus;
    }


    // =========================================================================
    // MAIN TICK
    // =========================================================================

    /**
     * Advance the simulation by one time step (dt = 1/sampleRate).
     *
     * Order matters:
     *   1. Neural oscillator (creates patient effort)
     *   2. Physics computation (turns effort into flow/pressure deflection)
     *   3. Trigger detection (checks whether effort crosses sensitivity threshold)
     *   4. Phase transitions (may change phase for next tick)
     *   5. Record sample to ring buffers
     *   6. Advance clocks
     */
    tick() {
        this._advanceNeural();
        this._computePhysics();
        this._evaluatePatientTrigger();
        this._checkTransitions();

        // Volume display: delivered this breath (starts at 0 each breath)
        const displayVol =
            (this.volumeAboveEq - this.volumeAtBreathStart) * 1000;
        const flowLpm = this.currentFlow * 60;
        const sampleIndex = this._sampleCount;

        this._updateExpFlowTracking(flowLpm, sampleIndex);

        this.buffers.time.push(this.globalTime);
        this.buffers.pressure.push(this.currentPressure);
        this.buffers.volume.push(Math.max(0, displayVol));
        this.buffers.flow.push(flowLpm);  // L/s → L/min

        // Per-breath loop data (for P-V and F-V loop displays)
        this.loopCurrent.pressure.push(this.currentPressure);
        this.loopCurrent.volume.push(Math.max(0, displayVol));
        this.loopCurrent.flow.push(flowLpm);

        this._sampleCount++;
        this._syncExpTailWindow();

        // Advance all clocks
        this.globalTime   += this.dt;
        this.phaseTime    += this.dt;
        this.machineTimer += this.dt;

        if (this.scheduledBreathTrigger) {
            const triggerType = this.scheduledBreathTrigger;
            this.scheduledBreathTrigger = null;
            this._startNewBreath(triggerType, this.globalTime);
        }
    }

    /**
     * Advance simulation by real elapsed time at current speed.
     *
     * Called by the animation loop with the real time delta.
     * Steps are capped at 300/frame to prevent spiral-of-death
     * if the browser drops frames (e.g., tab in background).
     *
     * @param {number} realDt - Real elapsed time in seconds
     */
    advance(realDt) {
        if (!this.running) return;
        const simTime = realDt * this.speed;
        const steps = Math.min(Math.round(simTime / this.dt), 300);
        for (let i = 0; i < steps; i++) {
            this.tick();
        }
    }


    // =========================================================================
    // TRANSPORT CONTROLS
    // =========================================================================

    pause()  { this.running = false; }
    resume() { this.running = true; }
    toggle() { this.running = !this.running; }

    setSpeed(multiplier) {
        this.speed = Math.max(0.5, Math.min(4, multiplier));
    }

    /** Reset simulation to initial state. */
    reset() {
        this.globalTime        = 0;
        this.phase             = Phase.EXPIRATION;
        this.currentPhase      = 'expiration';
        this.phaseTime         = 0;
        this.machineTimer      = 0;
        this.lastBreathStartSec = 0;
        this.volumeAboveEq     = 0;
        this.volumeAtBreathStart = 0;
        this.currentFlow       = 0;
        this.currentPressure   = this.vent.peep;
        this.neuralTimer       = 0;
        this.neuralInspActive  = false;
        this.neuralCycleResolved = false;
        this.neuralEligibleSeen = false;
        this.scheduledBreathTrigger = null;
        this.breathCount       = 0;
        this.machineBreathCount = 0;
        this.patientBreathCount = 0;
        this.lastTriggerType   = 'machine';
        this.triggerEvents     = [];
        this.currentBreath     = null;
        this.lastCompletedBreath = null;
        this.measuredPIP       = 0;
        this.lastBreathPIP     = 0;
        this.measuredPplat     = null;
        this.measuredVT_mL     = 0;
        this.peakInspFlow_Lpm  = 0;
        this.peakInspiratoryFlow = 0;
        this.breathTimestamps  = [];
        this.measuredRR        = 0;
        this.measuredRespiratoryRate = 0;
        this.flowBaselineReached = true;
        this.expFlowReturnPercent = 100;
        this.expTailWindow = null;
        this._expTailWindowSamples = null;
        this._expStartSample = null;
        this._expMinAbsFlow = Infinity;
        this._prevFlowLpm = 0;
        this._sampleCount = 0;

        this.loopCurrent   = { pressure: [], volume: [], flow: [] };
        this.loopCompleted = { pressure: [], volume: [], flow: [] };

        Object.values(this.buffers).forEach(b => b.clear());
        this._prefill();
    }


    // =========================================================================
    // PUBLIC GETTERS
    // =========================================================================

    /** Current breath phase as string */
    get phaseName() { return this.phase; }

    /** Is patient actively triggering breaths? */
    get isPatientTriggering() { return this.patientRR > 0; }

    /** Trigger events visible on the scrolling waveform panels. */
    getTriggerEvents(tMin = -Infinity, tMax = Infinity) {
        return this.triggerEvents.filter(event => event.time >= tMin && event.time <= tMax);
    }

    /** Display-ready summary of per-breath measurements */
    get breathSummary() {
        return {
            pip:          Math.round(this.measuredPIP * 10) / 10,
            // Latched peak of the last completed breath — what the monitor shows
            // (SME-014). `pip` above stays live for alarm evaluation.
            pipLatched:   Math.round(this.lastBreathPIP * 10) / 10,
            pplat:        this.measuredPplat !== null
                              ? Math.round(this.measuredPplat * 10) / 10
                              : null,
            vt_mL:        Math.round(this.measuredVT_mL),
            peakFlow_Lpm: Math.round(this.peakInspFlow_Lpm),
            triggerType:  this.lastTriggerType,
            breathCount:  this.breathCount,
            machineBreathCount: this.machineBreathCount,
            patientBreathCount: this.patientBreathCount,
            phase:        this.currentPhase,
        };
    }
}
