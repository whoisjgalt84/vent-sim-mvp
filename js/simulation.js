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
 *   occurs during machine expiration → patient-triggered breath.
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
        this.displaySeconds = options.displaySeconds  ?? 10;
        this.triggerEventRetentionSeconds = options.triggerEventRetentionSeconds ?? 60;
        this.triggerLockoutSeconds = 0.10;
        this.triggerPressureDropCmH2O = 1.0;

        // --- Ring Buffers (streaming display data) ---
        const bufSize = this.displaySeconds * this.sampleRate;
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
        this.phaseTime  = 0;        // seconds within current phase
        this.machineTimer = 0;      // seconds since last breath start (machine clock)

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
        this.pendingPatientTrigger = false; // effort began during expiratory lockout
        this.patientEffortStartedThisTick = false;
        this.scheduledBreathTrigger = null;

        // --- Per-Breath Measurements ---
        //   Updated each breath for the parameter display panel.
        this.measuredPIP       = 0;       // peak inspiratory pressure
        this.measuredPplat     = null;    // plateau pressure (hold only)
        this.measuredVT_mL     = 0;       // delivered tidal volume
        this.peakInspFlow_Lpm  = 0;       // peak inspiratory flow

        // --- Per-Breath Loop Data ---
        //   Collects (pressure, volume, flow) samples for the current breath.
        //   When a new breath starts, current → completed (for loop display).
        //   "completed" always holds the most recent FULL breath for rendering.
        this.loopCurrent   = { pressure: [], volume: [], flow: [] };
        this.loopCompleted = { pressure: [], volume: [], flow: [] };

        // --- Breath Tracking ---
        this.breathCount     = 0;
        this.lastTriggerType = 'machine';  // 'machine' or 'patient'
        this.triggerEvents   = [];         // delivered + failed trigger markers

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
    _prefill() {
        const peep = this.vent.peep;
        const n = this.buffers.time.capacity;
        for (let i = 0; i < n; i++) {
            this.buffers.time.push(-this.displaySeconds + i * this.dt);
            this.buffers.pressure.push(peep);
            this.buffers.volume.push(0);
            this.buffers.flow.push(0);
        }
        this._startNewBreath('machine', this.globalTime);
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
     * The oscillator cycles at patientRR independently. When a new
     * neural inspiration begins during machine expiration, the patient
     * triggers a ventilator breath.
     */
    _advanceNeural() {
        this.patientEffortStartedThisTick = false;

        if (this.patientRR <= 0) {
            this.pendingPatientTrigger = false;
            return;
        }

        const neuralCycleTime = 60 / this.patientRR;
        const neuralTi = this.vent.neuralTi;

        this.neuralTimer += this.dt;

        // End neural inspiration when neuralTi elapsed
        if (this.neuralInspActive && this.neuralTimer >= neuralTi) {
            this.neuralInspActive = false;
        }

        // Start new neural cycle when full cycle time elapsed
        if (this.neuralTimer >= neuralCycleTime) {
            this.neuralTimer -= neuralCycleTime;  // carry remainder for timing accuracy
            this.neuralInspActive = true;
            this.patientEffortStartedThisTick = true;

            // TRIGGER: patient effort during machine expiration → new breath
            //
            // Clinical equivalent: the patient's inspiratory effort creates a
            // small flow or pressure deflection that the ventilator detects.
            // We require a minimum 100ms into expiration to prevent
            // immediate double-triggering.
            if (this.phase === Phase.EXPIRATION) {
                this.pendingPatientTrigger = true;
            }
        }

        this._resolvePendingPatientTrigger();
    }


    // =========================================================================
    // BREATH STATE MACHINE
    // =========================================================================

    _resolvePendingPatientTrigger() {
        if (!this.pendingPatientTrigger) return;

        if (this.phase !== Phase.EXPIRATION) {
            this.pendingPatientTrigger = false;
            return;
        }

        if (!this.neuralInspActive) {
            this.pendingPatientTrigger = false;
            this._recordTriggerEvent('failed', this.globalTime);
        }
    }

    _recordTriggerEvent(type, time = this.globalTime) {
        this.triggerEvents.push({ type, time });

        const cutoff = time - this.triggerEventRetentionSeconds;
        while (this.triggerEvents.length > 0 && this.triggerEvents[0].time < cutoff) {
            this.triggerEvents.shift();
        }
    }

    /** Start a new breath (machine-triggered or patient-triggered). */
    _startNewBreath(triggerType, eventTime = this.globalTime) {
        this.phase = Phase.INSPIRATION;
        this.phaseTime = 0;
        this.volumeAtBreathStart = this.volumeAboveEq;
        this.breathCount++;
        this.lastTriggerType = triggerType;
        this.machineTimer = 0;
        this._recordTriggerEvent(triggerType, eventTime);

        // Swap loop data: current (now complete) → completed, then reset current
        if (this.loopCurrent.pressure.length > 10) {
            this.loopCompleted = this.loopCurrent;
        }
        this.loopCurrent = { pressure: [], volume: [], flow: [] };

        // Reset per-breath measurements
        this.measuredPIP       = 0;
        this.measuredPplat     = null;
        this.measuredVT_mL     = 0;
        this.peakInspFlow_Lpm  = 0;
    }

    /** Check for phase transitions based on timing. */
    _checkTransitions() {
        const ti      = this.vent.inspiratoryTime;
        const holdDur = this.vent.effectiveHoldTime;
        const ttot    = this.vent.totalCycleTime;

        switch (this.phase) {

            case Phase.INSPIRATION:
                if (this.phaseTime >= ti) {
                    // Capture delivered VT
                    this.measuredVT_mL =
                        (this.volumeAboveEq - this.volumeAtBreathStart) * 1000;

                    if (holdDur > 0) {
                        this.phase = Phase.HOLD;
                        this.phaseTime = 0;
                    } else {
                        this.phase = Phase.EXPIRATION;
                        this.phaseTime = 0;
                    }
                }
                break;

            case Phase.HOLD:
                if (this.phaseTime >= holdDur) {
                    this.phase = Phase.EXPIRATION;
                    this.phaseTime = 0;
                }
                break;

            case Phase.EXPIRATION:
                // Machine backup timer: if machineTimer reaches Ttot,
                // the machine fires regardless of patient effort.
                if (this.machineTimer >= ttot &&
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

    _queuePatientTriggerIfThresholdMet() {
        if (!this.pendingPatientTrigger) return;
        if (this.phase !== Phase.EXPIRATION) return;
        if (!this.neuralInspActive) return;
        if (this.phaseTime <= this.triggerLockoutSeconds) return;

        const triggerThreshold = this.vent.peep - this.triggerPressureDropCmH2O;
        const timerTie = this.patientEffortStartedThisTick &&
            (this.machineTimer + this.dt) >= this.vent.totalCycleTime;

        if (this.currentPressure <= triggerThreshold || timerTie) {
            this.pendingPatientTrigger = false;
            this.scheduledBreathTrigger = 'patient';
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
        const mode = this.vent.mode;
        const ti   = this.vent.inspiratoryTime;

        if (mode === 'vc-cmv') {
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
            const pinsp = this.vent.inspiratoryPressure;

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
     *   1. Neural oscillator (may trigger new breath)
     *   2. Physics computation (uses current phase)
     *   3. Phase transitions (may change phase for next tick)
     *   4. Record sample to ring buffers
     *   5. Advance clocks
     */
    tick() {
        this._advanceNeural();
        this._computePhysics();
        this._queuePatientTriggerIfThresholdMet();
        this._checkTransitions();

        // Volume display: delivered this breath (starts at 0 each breath)
        const displayVol =
            (this.volumeAboveEq - this.volumeAtBreathStart) * 1000;

        this.buffers.time.push(this.globalTime);
        this.buffers.pressure.push(this.currentPressure);
        this.buffers.volume.push(Math.max(0, displayVol));
        this.buffers.flow.push(this.currentFlow * 60);  // L/s → L/min

        // Per-breath loop data (for P-V and F-V loop displays)
        this.loopCurrent.pressure.push(this.currentPressure);
        this.loopCurrent.volume.push(Math.max(0, displayVol));
        this.loopCurrent.flow.push(this.currentFlow * 60);

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
        this.phaseTime         = 0;
        this.machineTimer      = 0;
        this.volumeAboveEq     = 0;
        this.volumeAtBreathStart = 0;
        this.currentFlow       = 0;
        this.currentPressure   = this.vent.peep;
        this.neuralTimer       = 0;
        this.neuralInspActive  = false;
        this.pendingPatientTrigger = false;
        this.patientEffortStartedThisTick = false;
        this.scheduledBreathTrigger = null;
        this.breathCount       = 0;
        this.lastTriggerType   = 'machine';
        this.triggerEvents     = [];
        this.measuredPIP       = 0;
        this.measuredPplat     = null;
        this.measuredVT_mL     = 0;
        this.peakInspFlow_Lpm  = 0;

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
            pplat:        this.measuredPplat !== null
                              ? Math.round(this.measuredPplat * 10) / 10
                              : null,
            vt_mL:        Math.round(this.measuredVT_mL),
            peakFlow_Lpm: Math.round(this.peakInspFlow_Lpm),
            triggerType:  this.lastTriggerType,
            breathCount:  this.breathCount,
            phase:        this.phase,
        };
    }
}
