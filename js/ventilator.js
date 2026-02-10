/**
 * ============================================================================
 * ventilator.js — VC-CMV & PC-CMV Ventilator Simulation Engine
 * ============================================================================
 *
 * SUPPORTED MODES (Mireles-Cabodevila et al., 2022 taxonomy):
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  MODE        CONTROL VAR   OPERATOR SETS        DEPENDENT (observed)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  VC-CMVs     Flow          VT, RR, I:E, PEEP    Pressure waveform
 *  PC-CMVs     Pressure      Pinsp, RR, I:E, PEEP Flow & Volume waveforms
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * KEY DIFFERENCE:
 *
 *   "In volume control (VC), the ventilator controls flow. The pressure
 *    waveform is the dependent variable that reveals the load."
 *
 *   "In pressure control (PC), the ventilator controls pressure. The flow
 *    and volume waveforms are the dependent variables that reveal the load."
 *
 *   — Mireles-Cabodevila et al. (2022), p. 132–135
 *
 * PC-CMV INSPIRATION (exponential fill):
 *
 *   The ventilator applies a constant inspiratory pressure (Pinsp) above
 *   total PEEP. Flow and volume follow exponential charging curves:
 *
 *     ΔP_drive = Pinsp - autoPEEP
 *     V̇(t)  = (ΔP_drive / R) × e^(-t/τ)
 *     V(t)  = ΔP_drive × C × (1 - e^(-t/τ))
 *     Paw(t) = PEEP + Pinsp  (constant square wave)
 *
 *   Delivered VT depends on Pinsp, C, R (via τ), and Ti:
 *     VT = ΔP_drive × C × (1 - e^(-Ti/τ))
 *
 *   "If inspiratory time is long enough (Ti > 3τ), VT approaches ΔP × C."
 *     — Chatburn, Fundamentals of Mechanical Ventilation, Ch. 4
 *
 * REFERENCES:
 *   Chatburn RL. Fundamentals of Mechanical Ventilation. Mandu Press, 2003.
 *   Mireles-Cabodevila E, Siuba MT, Chatburn RL. Respir Care 2022;67(1):129–148.
 *
 * ============================================================================
 */

import { LungModel } from './lung-model.js';


export class Ventilator {

    /**
     * Create a ventilator with a lung model and initial settings.
     *
     * @param {LungModel} lungModel   - The patient's lung physics
     * @param {Object}    settings    - Operator settings
     * @param {string}    settings.mode              - 'vc-cmv' or 'pc-cmv'
     * @param {string}    settings.flowPattern       - 'square' or 'ramp' (VC only)
     * @param {number}    settings.tidalVolume       - VT in L (VC mode, default 0.500)
     * @param {number}    settings.inspiratoryPressure - Pinsp above PEEP in cmH2O (PC mode, default 15)
     * @param {number}    settings.respiratoryRate   - RR in breaths/min (default 14)
     * @param {number[]}  settings.ieRatio           - [I, E] ratio (default [1, 2])
     * @param {number}    settings.peep              - PEEP in cmH2O (default 5)
     * @param {number}    settings.fio2              - FiO2 as fraction (default 0.40)
     */
    constructor(lungModel, settings = {}) {
        this.lung = lungModel;

        // --- Mode ---
        this.mode = settings.mode ?? 'vc-cmv';  // 'vc-cmv' or 'pc-cmv'

        // --- Flow Pattern (VC only) ---
        // 'square' = constant flow throughout inspiration
        // 'ramp'   = descending ramp (linear deceleration from peak to zero)
        this.flowPattern = settings.flowPattern ?? 'square';

        // --- Operator Settings (shared) ---
        this.respiratoryRate = settings.respiratoryRate  ?? 14;      // breaths/min
        this.ieRatio         = settings.ieRatio          ?? [1, 2];  // [I, E]
        this.peep            = settings.peep             ?? 5;       // cmH2O
        this.fio2            = settings.fio2             ?? 0.40;    // fraction

        // --- VC-specific ---
        this.tidalVolume     = settings.tidalVolume     ?? 0.500;   // L

        // --- PC-specific ---
        // Pinsp = inspiratory pressure ABOVE PEEP (not total Paw)
        // Clinical range: 5–35 cmH2O above PEEP
        this.inspiratoryPressure = settings.inspiratoryPressure ?? 15; // cmH2O above PEEP

        // --- Simulation Resolution ---
        this.sampleRate = 100; // Hz
    }


    // =========================================================================
    // TIMING CALCULATIONS
    // =========================================================================
    //
    // From Chatburn, Table 4-1:
    //   Total cycle time (TCT) = 60 / f = Ti + Te
    //   Ti = TCT × I / (I + E)
    //   Te = TCT × E / (I + E)
    //   V̇  = VT / Ti
    //
    // Example: RR=14, I:E=1:2
    //   TCT = 60/14 = 4.29 s
    //   Ti  = 4.29 × 1/3 = 1.43 s
    //   Te  = 4.29 × 2/3 = 2.86 s
    //   V̇   = 0.500 / 1.43 = 0.350 L/s = 21.0 L/min
    //
    // =========================================================================

    /** Total cycle time in seconds: TCT = 60 / RR */
    get totalCycleTime() {
        return 60 / this.respiratoryRate;
    }

    /** Inspiratory time in seconds: Ti = TCT × I/(I+E) */
    get inspiratoryTime() {
        const [i, e] = this.ieRatio;
        return this.totalCycleTime * (i / (i + e));
    }

    /** Expiratory time in seconds: Te = TCT - Ti */
    get expiratoryTime() {
        return this.totalCycleTime - this.inspiratoryTime;
    }

    /** Inspiratory flow in L/s (internal units): V̇ = VT / Ti */
    get inspiratoryFlow() {
        return this.tidalVolume / this.inspiratoryTime;
    }

    /** Inspiratory flow in L/min (clinical display): V̇ × 60 */
    get inspiratoryFlowLpm() {
        return this.inspiratoryFlow * 60;
    }


    // =========================================================================
    // VC FLOW PATTERN PROPERTIES
    // =========================================================================
    //
    // SQUARE FLOW (default):
    //   V̇(t) = VT / Ti = constant
    //   Peak flow = mean flow = VT / Ti
    //
    // DESCENDING RAMP (triangular):
    //   V̇(t) = V̇_peak × (1 - t/Ti)
    //   V̇_peak = 2 × VT / Ti  (triangle area = ½ × base × height = VT)
    //   Mean flow = VT / Ti (same as square — same VT in same Ti)
    //   Peak flow = 2 × mean flow
    //
    //   Volume: V(t) = V̇_peak × [t - t²/(2Ti)]  (parabolic rise)
    //
    //   "The descending ramp produces lower peak airway pressures because
    //    the peak resistive load (R × V̇_peak at t=0) occurs when lung
    //    volume — and therefore elastic load — is still near zero."
    //     — Chatburn, Fundamentals, Ch. 4
    //
    // =========================================================================

    /**
     * Peak inspiratory flow for VC mode (L/s).
     *   Square: V̇_peak = VT / Ti
     *   Ramp:   V̇_peak = 2 × VT / Ti
     */
    get vcPeakFlow() {
        if (this.flowPattern === 'ramp') {
            return 2 * this.tidalVolume / this.inspiratoryTime;
        }
        return this.inspiratoryFlow;  // square: peak = mean
    }

    /** Peak inspiratory flow for VC mode (L/min) */
    get vcPeakFlowLpm() {
        return this.vcPeakFlow * 60;
    }

    /** Flow pattern display label */
    get flowPatternLabel() {
        return this.flowPattern === 'ramp' ? 'Ramp' : 'Square';
    }

    /** I:E ratio as a readable string (e.g., "1:2.0") */
    get ieRatioString() {
        const [i, e] = this.ieRatio;
        return `1:${(e / i).toFixed(1)}`;
    }

    /** Mode display label */
    get modeLabel() {
        return this.mode === 'vc-cmv' ? 'VC-CMV' : 'PC-CMV';
    }


    // =========================================================================
    // PC-CMV CALCULATED PROPERTIES
    // =========================================================================
    //
    // In PC-CMV, the ventilator applies a constant pressure (Pinsp) above
    // total PEEP. Flow decelerates exponentially as the lung fills.
    //
    // The effective driving pressure for flow is:
    //   ΔP_drive = Pinsp - autoPEEP
    //
    // When auto-PEEP > 0, some of the set Pinsp is "wasted" overcoming
    // the trapped gas pressure, reducing effective VT.
    //
    // =========================================================================

    /**
     * Effective driving pressure in PC mode (cmH2O).
     * This is the net pressure that actually drives inspiratory flow.
     *
     *   ΔP_drive = Pinsp - autoPEEP
     *
     * If auto-PEEP ≥ Pinsp, no flow occurs (complete breath stacking).
     */
    get pcDrivingPressure() {
        return Math.max(0, this.inspiratoryPressure - this.autoPeep);
    }

    /**
     * Peak inspiratory flow in PC-CMV (L/s).
     * Occurs at the very start of inspiration (t=0):
     *
     *   V̇_peak = ΔP_drive / R
     */
    get pcPeakFlow() {
        return this.pcDrivingPressure / this.lung.resistance;
    }

    /** Peak inspiratory flow in PC-CMV (L/min) */
    get pcPeakFlowLpm() {
        return this.pcPeakFlow * 60;
    }

    /**
     * Maximum achievable VT in PC-CMV (L) if Ti were infinite:
     *   VT_max = ΔP_drive × C
     */
    get pcMaxVt() {
        return this.pcDrivingPressure * this.lung.compliance;
    }

    /**
     * Actual delivered VT in PC-CMV (L) for the current Ti:
     *   VT = ΔP_drive × C × (1 - e^(-Ti/τ))
     *
     * This is the KEY equation for PC-CMV — it shows that VT depends
     * on patient mechanics (C, R) and ventilator settings (Pinsp, Ti).
     *
     * "Unlike VC, where VT is set and guaranteed, in PC the delivered
     *  VT changes if patient mechanics change."
     *   — Chatburn, Fundamentals, Ch. 4
     */
    get pcDeliveredVt() {
        const tau = this.lung.timeConstant;
        return this.pcDrivingPressure * this.lung.compliance *
               (1 - Math.exp(-this.inspiratoryTime / tau));
    }

    /** Delivered VT in PC-CMV (mL) */
    get pcDeliveredVtMl() {
        return this.pcDeliveredVt * 1000;
    }

    /** Ti/τ ratio — indicates how much of VT_max is delivered */
    get tiOverTau() {
        return this.inspiratoryTime / this.lung.timeConstant;
    }


    // =========================================================================
    // STEADY-STATE CALCULATED PRESSURES
    // =========================================================================
    //
    // These are the values you'd read from the ventilator display after
    // the system has reached steady state (typically 3–5 breaths).
    //
    // =========================================================================

    /** Steady-state auto-PEEP (cmH2O) */
    get autoPeep() {
        if (this.mode === 'pc-cmv') {
            return this._pcAutoPeep();
        }
        return this.lung.steadyStateAutoPeep(this.tidalVolume, this.expiratoryTime);
    }

    /** Total PEEP = set PEEP + auto-PEEP (cmH2O) */
    get totalPeep() {
        return this.peep + this.autoPeep;
    }

    /** Steady-state trapped gas volume (L) */
    get trappedVolume() {
        if (this.mode === 'pc-cmv') {
            return this._pcTrappedVolume();
        }
        return this.lung.steadyStateTrappedVolume(this.tidalVolume, this.expiratoryTime);
    }

    // -----------------------------------------------------------------
    // PC-CMV Steady-State (closed-form)
    //
    // In steady state for PC-CMV, VT and auto-PEEP are coupled:
    //   VT depends on auto-PEEP (via driving pressure)
    //   Auto-PEEP depends on VT (via gas trapping)
    //
    // Solving the coupled equations yields:
    //
    //   Let α = e^(-Te/τ),  β = 1 - e^(-Ti/τ)
    //
    //   V_trapped = Pinsp × C × β × α / (1 - e^(-TCT/τ))
    //   autoPEEP  = V_trapped / C
    //   VT_ss     = (Pinsp - autoPEEP) × C × β
    //
    // -----------------------------------------------------------------

    /** @private PC-CMV steady-state trapped volume (L) */
    _pcTrappedVolume() {
        const tau = this.lung.timeConstant;
        const C   = this.lung.compliance;
        const ti  = this.inspiratoryTime;
        const te  = this.expiratoryTime;
        const tct = this.totalCycleTime;

        const alpha = Math.exp(-te / tau);
        const beta  = 1 - Math.exp(-ti / tau);
        const denom = 1 - Math.exp(-tct / tau);

        if (denom < 1e-10) return Infinity;  // Essentially no exhalation

        return this.inspiratoryPressure * C * beta * alpha / denom;
    }

    /** @private PC-CMV steady-state auto-PEEP (cmH2O) */
    _pcAutoPeep() {
        const vTrapped = this._pcTrappedVolume();
        if (!isFinite(vTrapped)) return Infinity;
        return vTrapped / this.lung.compliance;
    }

    /** @private PC-CMV steady-state delivered VT (L) */
    _pcSteadyStateVt() {
        const autoPeep = this._pcAutoPeep();
        if (!isFinite(autoPeep)) return 0;
        const drivePressure = Math.max(0, this.inspiratoryPressure - autoPeep);
        const beta = 1 - Math.exp(-this.inspiratoryTime / this.lung.timeConstant);
        return drivePressure * this.lung.compliance * beta;
    }

    /**
     * Peak Inspiratory Pressure (cmH2O)
     *
     * VC-CMV Square: PIP occurs at end of inspiration (t = Ti):
     *   PIP = PEEP + autoPEEP + R × V̇ + VT / C
     *
     * VC-CMV Ramp: PIP occurs at t* = max(0, Ti - τ):
     *   The pressure waveform has competing components:
     *     - Resistive: R × V̇(t) = R × V̇_peak × (1 - t/Ti) → DECREASING
     *     - Elastic:   V(t)/C → INCREASING (parabolic)
     *   Setting dP/dt = 0 yields t* = Ti - τ.
     *   If τ ≥ Ti, resistive dominates and PIP is at t=0.
     *
     *   Key teaching point: Ramp PIP < Square PIP because the peak
     *   resistive component (at t=0) occurs when elastic load is zero.
     *
     * PC-CMV: PIP = PEEP + Pinsp (constant throughout inspiration)
     */
    get pip() {
        if (this.mode === 'pc-cmv') {
            return this.peep + this.inspiratoryPressure;
        }

        if (this.flowPattern === 'ramp') {
            return this._rampPIP();
        }

        // Square flow: PIP at end of inspiration
        return this.lung.inspiratoryPressure(
            this.tidalVolume,
            this.inspiratoryFlow,
            this.peep,
            this.autoPeep
        );
    }

    /**
     * Compute PIP for descending ramp flow (analytical).
     *
     * P(t) = PEEP + autoPEEP + R × V̇_peak × (1 - t/Ti)
     *       + (V_trapped + V̇_peak × (t - t²/(2Ti))) / C
     *
     * dP/dt = 0 at t* = Ti - τ   (if τ < Ti)
     *
     * @private
     */
    _rampPIP() {
        const ti    = this.inspiratoryTime;
        const tau   = this.lung.timeConstant;
        const R     = this.lung.resistance;
        const C     = this.lung.compliance;
        const peep  = this.peep;
        const auto  = this.autoPeep;
        const vTrap = this.trappedVolume;
        const fPeak = this.vcPeakFlow;  // 2 × VT / Ti

        // Critical time where PIP occurs
        const tStar = Math.max(0, ti - tau);

        // Flow at t*
        const flowAtStar = fPeak * (1 - tStar / ti);

        // Volume delivered at t*
        const volAtStar = fPeak * (tStar - tStar * tStar / (2 * ti));

        // Total volume above PEEP equilibrium
        const vTotal = vTrap + volAtStar;

        return peep + auto + R * flowAtStar + vTotal / C;
    }

    /**
     * Plateau Pressure (cmH2O)
     *
     * VC-CMV: Measured during inspiratory hold (flow = 0):
     *   Pplat = PEEP + autoPEEP + VT / C
     *
     * PC-CMV: Pplat = Paw at end of inspiration. If Ti > 3τ,
     *   flow has nearly stopped and Pplat ≈ PIP. If Ti is short,
     *   Pplat < PIP because some resistive component remains.
     *
     *   Actually, for set-point PC, the airway pressure IS controlled
     *   at Pinsp. During an inspiratory hold the pressure remains at
     *   PEEP + Pinsp if the valve stays closed. The alveolar pressure
     *   at end-inspiration is:
     *     Palv = PEEP + autoPEEP + VT_delivered / C
     *
     *   This should equal PEEP + Pinsp if Ti >> τ (flow has stopped).
     */
    get pplat() {
        if (this.mode === 'pc-cmv') {
            const vtDelivered = this._pcSteadyStateVt();
            return this.peep + this.autoPeep + vtDelivered / this.lung.compliance;
        }
        return this.lung.plateauPressure(
            this.tidalVolume,
            this.peep,
            this.autoPeep
        );
    }

    /**
     * Driving Pressure (cmH2O)
     *
     * VC-CMV: ΔP = Pplat - Total PEEP = VT / C
     * PC-CMV: ΔP = VT_delivered / C (the elastic pressure from delivered volume)
     */
    get drivingPressure() {
        if (this.mode === 'pc-cmv') {
            return this._pcSteadyStateVt() / this.lung.compliance;
        }
        return this.tidalVolume / this.lung.compliance;
    }

    /**
     * Resistive pressure drop (cmH2O)
     *
     * VC-CMV Square: PIP - Pplat = R × V̇ (constant)
     * VC-CMV Ramp:   Peak resistive = R × V̇_peak (at t=0, but Pplat is same)
     *                PIP - Pplat ≠ R × V̇_peak because PIP doesn't occur at t=0.
     *                Report PIP - Pplat for clinical consistency.
     * PC-CMV: Report peak value = ΔP_drive
     */
    get resistivePressure() {
        if (this.mode === 'pc-cmv') {
            return this.pcDrivingPressure;
        }
        if (this.flowPattern === 'ramp') {
            // PIP - Pplat gives the net resistive effect at the PIP location
            return this.pip - this.pplat;
        }
        return this.lung.resistance * this.inspiratoryFlow;
    }

    /** Ratio of expiratory time to time constant: Te / τ */
    get teOverTau() {
        return this.expiratoryTime / this.lung.timeConstant;
    }

    /** Is gas trapping likely? (Te < 3τ) */
    get gasTrappingRisk() {
        return this.teOverTau < 3;
    }


    // =========================================================================
    // WAVEFORM GENERATION
    // =========================================================================
    //
    // This is the heart of the simulator. We generate time-series data for
    // pressure, volume, and flow waveforms for a specified number of breaths.
    //
    // All calculations are ANALYTICAL (closed-form), not numerical integration.
    // This is possible because both VC-CMV (square flow) and PC-CMV
    // (exponential fill) with linear R,C have exact analytical solutions.
    //
    // The waveforms are generated in STEADY STATE — we pre-calculate the
    // auto-PEEP and trapped volume, then every breath is identical.
    //
    // =========================================================================

    /**
     * Generate waveform data for multiple breaths.
     * Dispatches to mode-specific generation.
     *
     * @param {number} numBreaths - Number of complete breaths to generate
     * @returns {Object} Waveform data:
     *   {number[]} time     - Time values (s)
     *   {number[]} pressure - Airway pressure (cmH2O)
     *   {number[]} volume   - Displayed volume (mL)
     *   {number[]} flow     - Flow (L/min)
     */
    generateBreathWaveforms(numBreaths = 4) {
        if (this.mode === 'pc-cmv') {
            return this._generatePC(numBreaths);
        }
        if (this.flowPattern === 'ramp') {
            return this._generateVCRamp(numBreaths);
        }
        return this._generateVC(numBreaths);
    }

    /**
     * VC-CMV waveform generation — square flow, linear pressure ramp.
     * @private
     */
    _generateVC(numBreaths) {
        const dt   = 1 / this.sampleRate;
        const ti   = this.inspiratoryTime;
        const te   = this.expiratoryTime;
        const vt   = this.tidalVolume;
        const peep = this.peep;
        const tau  = this.lung.timeConstant;
        const R    = this.lung.resistance;
        const C    = this.lung.compliance;

        // Steady-state values
        const autoPeepSS  = this.autoPeep;
        const trappedVol  = this.trappedVolume;
        const flowInsp    = this.inspiratoryFlow;   // L/s, positive

        // Volume above PEEP-equilibrium at start of expiration
        const vStartExp = trappedVol + vt;

        // Pre-allocate arrays
        const totalSamples = Math.ceil(this.totalCycleTime * this.sampleRate) * numBreaths + 1;
        const time     = new Array(totalSamples);
        const pressure = new Array(totalSamples);
        const volume   = new Array(totalSamples);
        const flow     = new Array(totalSamples);
        let idx = 0;
        let t = 0;

        for (let breath = 0; breath < numBreaths; breath++) {

            // INSPIRATION — Square Flow
            const inspSteps = Math.round(ti * this.sampleRate);

            for (let i = 0; i < inspSteps; i++) {
                const tInsp = i * dt;
                const vDelivered = flowInsp * tInsp;
                const vTotal = trappedVol + vDelivered;
                const p = peep + (vTotal / C) + (R * flowInsp);

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDelivered * 1000;
                flow[idx]     = flowInsp * 60;
                idx++;
                t += dt;
            }

            // EXPIRATION — Passive Exponential Decay
            const expSteps = Math.round(te * this.sampleRate);
            const deltaPExp = vStartExp / C;

            for (let i = 0; i < expSteps; i++) {
                const tExp = i * dt;
                const expDecay = Math.exp(-tExp / tau);
                const vRemaining = vStartExp * expDecay;
                const fExp = -(deltaPExp / R) * expDecay;
                const p = peep + (vRemaining / C);
                const vExhaled  = vStartExp * (1 - expDecay);
                const vDisplayed = vt - vExhaled;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDisplayed * 1000;
                flow[idx]     = fExp * 60;
                idx++;
                t += dt;
            }
        }

        return {
            time:     time.slice(0, idx),
            pressure: pressure.slice(0, idx),
            volume:   volume.slice(0, idx),
            flow:     flow.slice(0, idx),
        };
    }

    /**
     * VC-CMV waveform generation — descending ramp (triangular) flow.
     *
     * INSPIRATION:
     *   V̇(t) = V̇_peak × (1 - t/Ti)
     *   V̇_peak = 2 × VT / Ti
     *   V(t) = V̇_peak × [t - t²/(2Ti)]    (parabolic rise)
     *   P(t) = PEEP + autoPEEP + R × V̇(t) + V_total(t)/C
     *
     * The pressure waveform shape differs dramatically from square flow:
     *
     *   Square:  P rises linearly (constant R×V̇ + increasing V/C)
     *            PIP at end of inspiration (highest elastic + resistive)
     *
     *   Ramp:    P has an interior maximum where dP/dt = 0
     *            This occurs at t* = Ti - τ (if τ < Ti)
     *            The pressure "humps up" then comes back down
     *
     *   ┌── Square: ╱╱╱╱╲        Ramp: ╱╲╱╲
     *   │           ╱    ╲              ╱  ╲
     *   │    PEEP──╱      ╲──PEEP      ╱    ╲──PEEP
     *   └─────────────────────────────────────────
     *
     *   "The descending ramp delivers the same VT with a lower PIP,
     *    but the same Pplat and driving pressure. Only the resistive
     *    component changes — the elastic load is identical."
     *
     * EXPIRATION: Same passive exponential decay (identical physics).
     *
     * @private
     */
    _generateVCRamp(numBreaths) {
        const dt   = 1 / this.sampleRate;
        const ti   = this.inspiratoryTime;
        const te   = this.expiratoryTime;
        const vt   = this.tidalVolume;
        const peep = this.peep;
        const tau  = this.lung.timeConstant;
        const R    = this.lung.resistance;
        const C    = this.lung.compliance;

        // Steady-state values (same as square — same VT, same Te)
        const autoPeepSS = this.autoPeep;
        const trappedVol = this.trappedVolume;

        // Peak flow: V̇_peak = 2 × VT / Ti
        // Area of triangle: ½ × Ti × V̇_peak = VT  →  V̇_peak = 2VT/Ti
        const fPeak = 2 * vt / ti;

        // Volume above PEEP-equilibrium at start of expiration
        const vStartExp = trappedVol + vt;

        // Pre-allocate arrays
        const totalSamples = Math.ceil(this.totalCycleTime * this.sampleRate) * numBreaths + 1;
        const time     = new Array(totalSamples);
        const pressure = new Array(totalSamples);
        const volume   = new Array(totalSamples);
        const flow     = new Array(totalSamples);
        let idx = 0;
        let t = 0;

        for (let breath = 0; breath < numBreaths; breath++) {

            // =================================================================
            // INSPIRATION — Descending Ramp Flow
            // =================================================================
            //
            //   V̇(t) = fPeak × (1 - t/Ti)
            //
            //     At t=0:  V̇ = fPeak = 2VT/Ti  (twice the square flow)
            //     At t=Ti: V̇ = 0                (flow reaches zero)
            //
            //   V(t) = fPeak × (t - t²/(2Ti))
            //
            //     Parabolic rise — starts steep, flattens as flow decelerates.
            //     At t=Ti: V(Ti) = fPeak × (Ti - Ti/2) = fPeak×Ti/2 = VT ✓
            //
            //   P(t) = PEEP + autoPEEP + R × V̇(t) + V_total(t)/C
            //
            //     The pressure curve has a distinctive "hump":
            //     - At t=0: High R×V̇, low V/C → net moderate P
            //     - At t*:  Balanced R×V̇ and V/C → maximum P (the PIP)
            //     - At t=Ti: Zero R×V̇, max V/C → P drops to Pplat
            //
            //     This "hump and settle" shape is the visual signature
            //     of descending ramp flow on the ventilator screen.
            //
            // =================================================================

            const inspSteps = Math.round(ti * this.sampleRate);

            for (let i = 0; i < inspSteps; i++) {
                const tInsp = i * dt;

                // Instantaneous flow (linearly decreasing)
                const fInst = fPeak * (1 - tInsp / ti);

                // Volume delivered so far (parabolic)
                const vDelivered = fPeak * (tInsp - tInsp * tInsp / (2 * ti));

                // Total volume above PEEP equilibrium
                const vTotal = trappedVol + vDelivered;

                // Equation of motion: P = PEEP + V_total/C + R × V̇
                const p = peep + (vTotal / C) + (R * fInst);

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDelivered * 1000;   // L → mL
                flow[idx]     = fInst * 60;            // L/s → L/min
                idx++;
                t += dt;
            }

            // =================================================================
            // EXPIRATION — Passive Exponential Decay (same as square flow)
            // =================================================================

            const expSteps = Math.round(te * this.sampleRate);
            const deltaPExp = vStartExp / C;

            for (let i = 0; i < expSteps; i++) {
                const tExp = i * dt;
                const expDecay = Math.exp(-tExp / tau);
                const vRemaining = vStartExp * expDecay;
                const fExp = -(deltaPExp / R) * expDecay;
                const p = peep + (vRemaining / C);
                const vExhaled  = vStartExp * (1 - expDecay);
                const vDisplayed = vt - vExhaled;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDisplayed * 1000;
                flow[idx]     = fExp * 60;
                idx++;
                t += dt;
            }
        }

        return {
            time:     time.slice(0, idx),
            pressure: pressure.slice(0, idx),
            volume:   volume.slice(0, idx),
            flow:     flow.slice(0, idx),
        };
    }

    /**
     * PC-CMV waveform generation — square pressure, exponential fill.
     *
     * INSPIRATION:
     *   Paw(t) = PEEP + Pinsp                          (constant)
     *   V̇(t)  = (ΔP_drive / R) × e^(-t/τ)            (decelerating)
     *   V(t)  = ΔP_drive × C × (1 - e^(-t/τ))        (exponential rise)
     *
     *   where ΔP_drive = Pinsp - autoPEEP
     *
     * EXPIRATION:
     *   Same passive exponential decay as VC-CMV.
     *
     * @private
     */
    _generatePC(numBreaths) {
        const dt   = 1 / this.sampleRate;
        const ti   = this.inspiratoryTime;
        const te   = this.expiratoryTime;
        const peep = this.peep;
        const tau  = this.lung.timeConstant;
        const R    = this.lung.resistance;
        const C    = this.lung.compliance;

        // Steady-state values
        const autoPeepSS  = this.autoPeep;
        const trappedVol  = this.trappedVolume;
        const drivePressure = Math.max(0, this.inspiratoryPressure - autoPeepSS);

        // Delivered VT (steady state)
        const vtDelivered = drivePressure * C * (1 - Math.exp(-ti / tau));

        // Volume above PEEP-equilibrium at start of expiration
        const vStartExp = trappedVol + vtDelivered;

        // Peak inspiratory flow (at t=0)
        const peakFlow = drivePressure / R;  // L/s

        // Airway pressure during inspiration (constant square wave)
        const pInsp = peep + this.inspiratoryPressure;

        // Pre-allocate arrays
        const totalSamples = Math.ceil(this.totalCycleTime * this.sampleRate) * numBreaths + 1;
        const time     = new Array(totalSamples);
        const pressure = new Array(totalSamples);
        const volume   = new Array(totalSamples);
        const flow     = new Array(totalSamples);
        let idx = 0;
        let t = 0;

        for (let breath = 0; breath < numBreaths; breath++) {

            // =================================================================
            // INSPIRATION — Exponential Fill (Decelerating Flow)
            // =================================================================
            //
            // The ventilator maintains Paw = PEEP + Pinsp.
            //
            // As the lung fills, the pressure gradient between airway and
            // alveolus shrinks, so flow decelerates exponentially:
            //
            //   At t=0:  Palv = PEEP + autoPEEP
            //            ΔP = Paw - Palv = Pinsp - autoPEEP
            //            V̇_peak = ΔP / R
            //
            //   As lung fills: Palv rises → ΔP shrinks → V̇ falls
            //
            //   At t=Ti: V̇ → 0 if Ti >> τ (flow reaches equilibrium)
            //            VT → ΔP × C
            //
            // Anatomy of the FLOW waveform (the dependent variable in PC):
            //   ┌─── At t=0: immediate peak at V̇_peak = ΔP/R
            //   │    Peak flow is HIGHER with higher Pinsp or lower R
            //   │
            //   └──▸ Exponential decay toward zero with time constant τ
            //        Faster decay (short τ) = stiff lungs or low resistance
            //        Slower decay (long τ)  = floppy lungs or high resistance
            //
            // Anatomy of the VOLUME waveform:
            //   ┌─── Exponential rise (concave down)
            //   │    Starts steep, flattens as flow decelerates
            //   │
            //   └──▸ Approaches VT_max = ΔP × C asymptotically
            //
            // =================================================================

            const inspSteps = Math.round(ti * this.sampleRate);

            for (let i = 0; i < inspSteps; i++) {
                const tInsp = i * dt;
                const expFactor = Math.exp(-tInsp / tau);

                // Volume delivered so far this breath
                const vDelivered = drivePressure * C * (1 - expFactor);

                // Inspiratory flow (decelerating)
                const fInsp = peakFlow * expFactor;

                time[idx]     = t;
                pressure[idx] = pInsp;  // Constant square wave
                volume[idx]   = vDelivered * 1000;   // L → mL
                flow[idx]     = fInsp * 60;           // L/s → L/min
                idx++;
                t += dt;
            }

            // =================================================================
            // EXPIRATION — Passive Exponential Decay
            // =================================================================
            //
            // Identical physics to VC-CMV expiration. The ventilator opens
            // the exhalation valve, Paw drops to PEEP, and the lung empties
            // passively under elastic recoil.
            //
            // =================================================================

            const expSteps = Math.round(te * this.sampleRate);
            const deltaPExp = vStartExp / C;

            for (let i = 0; i < expSteps; i++) {
                const tExp = i * dt;
                const expDecay = Math.exp(-tExp / tau);

                const vRemaining = vStartExp * expDecay;
                const fExp = -(deltaPExp / R) * expDecay;
                const p = peep + (vRemaining / C);

                // Volume display: VT minus what's been exhaled
                const vExhaled  = vStartExp * (1 - expDecay);
                const vDisplayed = vtDelivered - vExhaled;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDisplayed * 1000;
                flow[idx]     = fExp * 60;
                idx++;
                t += dt;
            }
        }

        return {
            time:     time.slice(0, idx),
            pressure: pressure.slice(0, idx),
            volume:   volume.slice(0, idx),
            flow:     flow.slice(0, idx),
        };
    }


    // =========================================================================
    // MEAN AIRWAY PRESSURE (MAP)
    // =========================================================================
    //
    // MAP = (1/TCT) × ∫₀ᵀᶜᵀ P(t) dt
    //
    // We compute this by numerical integration of one breath's pressure
    // waveform (trapezoidal rule via simple average, since dt is uniform).
    //
    // MAP is clinically important because it correlates with oxygenation
    // and hemodynamic effects of positive pressure ventilation.
    //
    // =========================================================================

    /**
     * Calculate mean airway pressure (cmH2O) via waveform integration.
     * @returns {number} MAP (cmH2O)
     */
    calculateMAP() {
        const waveforms = this.generateBreathWaveforms(1);
        const pressures = waveforms.pressure;
        const sum = pressures.reduce((acc, p) => acc + p, 0);
        return sum / pressures.length;
    }


    // =========================================================================
    // MINUTE VENTILATION
    // =========================================================================

    /** Exhaled minute ventilation: V̇E = VT × RR (L/min) */
    get minuteVentilation() {
        const vt = this.mode === 'pc-cmv' ? this._pcSteadyStateVt() : this.tidalVolume;
        return vt * this.respiratoryRate;
    }

    /** Effective tidal volume for display (L) — set in VC, calculated in PC */
    get effectiveVt() {
        return this.mode === 'pc-cmv' ? this._pcSteadyStateVt() : this.tidalVolume;
    }

    /** Effective tidal volume in mL */
    get effectiveVtMl() {
        return this.effectiveVt * 1000;
    }


    // =========================================================================
    // COMPREHENSIVE SUMMARY
    // =========================================================================

    /**
     * Return all calculated values in one object — useful for display panels
     * and for validation against hand calculations.
     *
     * @returns {Object} Complete summary of ventilator state
     */
    summary() {
        const map = this.calculateMAP();
        const isPC = this.mode === 'pc-cmv';
        const isRamp = !isPC && this.flowPattern === 'ramp';
        const vtEffective = this.effectiveVt;

        // Display flow: peak for PC and ramp, constant for square
        let displayFlowLpm;
        if (isPC) {
            displayFlowLpm = round(this.pcPeakFlowLpm, 1);
        } else if (isRamp) {
            displayFlowLpm = round(this.vcPeakFlowLpm, 1);
        } else {
            displayFlowLpm = round(this.inspiratoryFlowLpm, 1);
        }

        return {
            // --- Mode ---
            mode: this.modeLabel,
            isPC: isPC,
            flowPattern: isPC ? null : this.flowPattern,
            isRamp: isRamp,

            // --- Operator Settings ---
            settings: {
                tidalVolume_mL:      isPC ? null : this.tidalVolume * 1000,
                inspiratoryPressure: isPC ? this.inspiratoryPressure : null,
                respiratoryRate:     this.respiratoryRate,
                ieRatio:             this.ieRatioString,
                peep_cmH2O:          this.peep,
                fio2:                this.fio2,
            },

            // --- Timing ---
            timing: {
                totalCycleTime_s:    round(this.totalCycleTime, 2),
                inspiratoryTime_s:   round(this.inspiratoryTime, 2),
                expiratoryTime_s:    round(this.expiratoryTime, 2),
                inspFlow_Lpm:        displayFlowLpm,
                tiOverTau:           isPC ? round(this.tiOverTau, 1) : null,
            },

            // --- Pressures ---
            pressures: {
                pip_cmH2O:           round(this.pip, 1),
                pplat_cmH2O:         round(this.pplat, 1),
                map_cmH2O:           round(map, 1),
                peep_cmH2O:          round(this.peep, 1),
                autoPeep_cmH2O:      round(this.autoPeep, 1),
                totalPeep_cmH2O:     round(this.totalPeep, 1),
                drivingPressure:     round(this.drivingPressure, 1),
                resistivePressure:   round(this.resistivePressure, 1),
                inspiratoryPressure: isPC ? this.inspiratoryPressure : null,
            },

            // --- Lung Mechanics ---
            mechanics: {
                resistance:          this.lung.resistance,
                compliance:          this.lung.compliance,
                elastance:           round(this.lung.elastance, 1),
                timeConstant_s:      round(this.lung.timeConstant, 2),
            },

            // --- Volumes ---
            volumes: {
                tidalVolume_mL:      round(vtEffective * 1000, 0),
                minuteVentilation:   round(this.minuteVentilation, 1),
                trappedVolume_mL:    round(this.trappedVolume * 1000, 1),
            },

            // --- Safety Assessment ---
            safety: {
                teOverTau:           round(this.teOverTau, 1),
                tiOverTau:           isPC ? round(this.tiOverTau, 1) : null,
                gasTrappingRisk:     this.gasTrappingRisk,
                pplatAbove30:        this.pplat > 30,
                drivingPressureAbove15: this.drivingPressure > 15,
                tiTooShort:          isPC && this.tiOverTau < 1,
            },
        };
    }
}


// =============================================================================
// UTILITY
// =============================================================================

/** Round a number to a specified number of decimal places. */
function round(value, decimals) {
    if (!isFinite(value)) return value;
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
}
