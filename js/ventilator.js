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

import { LungModel } from './lung-model.js?v=12';

export const MODE_VC_CMV = 'vc-cmv';
export const MODE_PC_CMV = 'pc-cmv';
export const MODE_PC_CSV = 'PC-CSV';
export const SUPPORTED_MODES = Object.freeze([
    MODE_VC_CMV,
    MODE_PC_CMV,
    MODE_PC_CSV,
]);


export class Ventilator {

    /**
     * Create a ventilator with a lung model and initial settings.
     *
     * @param {LungModel} lungModel   - The patient's lung physics
     * @param {Object}    settings    - Operator settings
     * @param {string}    settings.mode              - 'vc-cmv', 'pc-cmv', or 'PC-CSV'
     * @param {string}    settings.flowPattern       - 'square' or 'ramp' (VC only)
     * @param {number}    settings.tidalVolume       - VT in L (VC mode, default 0.500)
     * @param {number}    settings.inspiratoryPressure - Pinsp above PEEP in cmH2O (PC mode, default 15)
     * @param {number}    settings.respiratoryRate   - RR in breaths/min (default 14)
     * @param {number[]}  settings.ieRatio           - [I, E] ratio (default [1, 2])
     * @param {number}    settings.peep              - PEEP in cmH2O (default 5)
     * @param {number}    settings.fio2              - FiO2 as fraction (default 0.40)
     * @param {string}    settings.triggerType       - 'flow' or 'pressure' (default 'flow')
     * @param {number}    settings.flowTriggerLpm    - Flow trigger threshold in L/min (default 2.0)
     * @param {number}    settings.pressureTriggerCmH2O - Pressure trigger threshold in cmH2O (default 1.0)
     */
    constructor(lungModel, settings = {}) {
        this.lung = lungModel;

        // --- Mode ---
        this.mode = settings.mode ?? MODE_VC_CMV;  // 'vc-cmv', 'pc-cmv', or 'PC-CSV'

        // --- Flow Pattern (VC only) ---
        // 'square' = constant flow throughout inspiration
        // 'ramp'   = descending ramp (linear deceleration from peak to zero)
        this.flowPattern = settings.flowPattern ?? 'square';

        // --- Inspiratory Hold ---
        // Duration of end-inspiratory pause (seconds). Both valves closed,
        // flow = 0, pressure equilibrates to Pplat. Steals time from Te.
        //
        // "The inspiratory hold (or inspiratory pause) is a maneuver where
        //  the ventilator closes both the inspiratory and expiratory valves
        //  at the end of inspiration. With no flow, the resistive pressure
        //  drop is zero, and the displayed pressure equals alveolar pressure
        //  (Pplat)."
        //   — Chatburn, Fundamentals, Ch. 4
        //
        // In a single-compartment model, the pressure drop from PIP to Pplat
        // is INSTANTANEOUS (no pendelluft between compartments). This is the
        // simplest way to measure static compliance: Crs = VT / (Pplat - PEEP).
        this.holdTime = settings.holdTime ?? 0;  // 0 = no hold

        // --- Operator Settings (shared) ---
        this.respiratoryRate = settings.respiratoryRate  ?? 14;      // breaths/min
        this.ieRatio         = settings.ieRatio          ?? [1, 2];  // [I, E]
        this.peep            = settings.peep             ?? 5;       // cmH2O
        this.fio2            = settings.fio2             ?? 0.40;    // fraction

        // --- Trigger Sensitivity ---
        // triggerType:
        //   'flow'     -> trigger when patient-generated inspiratory flow reaches threshold
        //   'pressure' -> trigger when patient-generated pressure deflection reaches threshold
        //
        // Typical clinical concepts:
        //   pressure trigger: cmH2O below baseline
        //   flow trigger: L/min inspiratory flow deflection
        this.triggerType = settings.triggerType ?? 'flow';
        this.flowTriggerLpm = settings.flowTriggerLpm ?? 2.0;
        this.pressureTriggerCmH2O = settings.pressureTriggerCmH2O ?? 1.0;

        // --- VC-specific ---
        this.tidalVolume     = settings.tidalVolume     ?? 0.500;   // L

        // --- PC-specific ---
        // Pinsp = inspiratory pressure ABOVE PEEP (not total Paw)
        // Clinical range: 5–35 cmH2O above PEEP
        this.inspiratoryPressure = settings.inspiratoryPressure ?? 15; // cmH2O above PEEP
        this.psPressure          = settings.psPressure          ?? 10; // cmH2O above PEEP
        this.cyclePercent        = settings.cyclePercent        ?? 25; // % of peak inspiratory flow
        this.triggerSensitivity  = settings.triggerSensitivity  ?? -2; // legacy pressure-trigger setting

        // --- Simulation Resolution ---
        this.sampleRate = 100; // Hz

        // --- Patient Effort (Pmus) ---
        //
        // THE EQUATION OF MOTION — NOW COMPLETE:
        //
        //   Pmus(t) + Pvent(t) = E × V(t) + R × V̇(t)
        //
        // Previously Pmus = 0 (passive patient). When active:
        //
        //   Pmus is the pressure generated by inspiratory muscles
        //   (diaphragm + accessory muscles). It is POSITIVE during
        //   inspiration (muscles generate force in the inspiratory direction).
        //
        //   Waveform: half-sine — matches EMG-based models of diaphragm
        //   activation. Rises smoothly from zero, peaks at mid-effort,
        //   returns to zero.
        //
        //     Pmus(t) = pMusMax × sin(π × t / T_neural)
        //     for 0 ≤ t ≤ T_neural, then Pmus = 0
        //
        //   pMusMax:
        //     0      = passive patient
        //     <1     = very weak inspiratory effort
        //     1-3    = mild/moderate spontaneous effort
        //     4-8    = strong effort
        //     >8     = very strong/distressed effort
        //   neuralTi:  neural inspiratory time (s), may differ from vent Ti
        //
        // EFFECT ON MODES:
        //
        //   VC-CMV: Flow and volume are CONTROLLED by the ventilator.
        //     Pmus doesn't change VT — but it changes the pressure waveform:
        //       Paw(t) = PEEP + V(t)/C + R×V̇(t) - Pmus(t)
        //     The negative Pmus creates the characteristic "scalloped"
        //     or "scooped" pressure waveform. When Pmus peaks, Paw dips.
        //     Teaching point: "The patient is doing some of the work,
        //     so the ventilator doesn't need to push as hard."
        //
        //   PC-CMV: Pressure is CONTROLLED by the ventilator.
        //     Pmus ADDS to the driving pressure, increasing flow & volume:
        //       V̇(t) = [Pinsp + Pmus(t) - V(t)×E] / R
        //     Requires numerical integration (no closed-form with Pmus).
        //     Teaching point: "In PC mode, patient effort increases VT —
        //     the vent can't prevent it since it only controls pressure."
        //
        //   — Chatburn, Fundamentals, Ch. 2 & 4
        //   — Mireles-Cabodevila et al. (2022), Equation 1
        //
        this.pMusMax  = settings.pMusMax  ?? 0;    // cmH2O (0 = passive)
        this.neuralTi = settings.neuralTi ?? 1.0;  // seconds
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

    /** Any pressure-targeted mode (PC-CMV or PC-CSV) */
    isPressureMode() {
        return this.mode === MODE_PC_CMV || this.mode === MODE_PC_CSV;
    }

    /** Spontaneous pressure-support mode */
    isSpontaneousMode() {
        return this.mode === MODE_PC_CSV;
    }

    /** Active inspiratory pressure target above PEEP (cmH2O) */
    get pressureControlLevel() {
        return this.isSpontaneousMode() ? this.psPressure : this.inspiratoryPressure;
    }

    /** Is inspiratory hold active? */
    get holdActive() {
        return this.effectiveHoldTime > 0;
    }

    /**
     * Effective hold duration (seconds), clamped so Te doesn't go below 0.2s.
     * In clinical practice, extremely long holds would compromise gas exchange.
     */
    get effectiveHoldTime() {
        if (this.isSpontaneousMode()) return 0;
        if (this.holdTime <= 0) return 0;
        const maxHold = this.expiratoryTime - 0.2;  // leave 200ms minimum Te
        return Math.max(0, Math.min(this.holdTime, maxHold));
    }

    /** Effective expiratory time after hold steals from it (seconds) */
    get effectiveExpiratoryTime() {
        return this.expiratoryTime - this.effectiveHoldTime;
    }

    /** Fraction of the breath exhaled during effective expiratory time. */
    get expiratoryCompletion() {
        return 1 - Math.exp(-this.effectiveExpiratoryTime / this.lung.timeConstant);
    }

    /** Expiratory completion expressed as a percentage. */
    get expiratoryCompletionPercent() {
        return this.expiratoryCompletion * 100;
    }

    /** Clinical interpretation of expiratory completion. */
    get expiratoryCompletionStatus() {
        const ec = this.expiratoryCompletion;

        if (ec >= 0.95) return 'complete';
        if (ec >= 0.90) return 'borderline';
        return 'incomplete';
    }


    // =========================================================================
    // PATIENT EFFORT (Pmus)
    // =========================================================================

    /** Is patient effort active? */
    get pMusActive() {
        return this.pMusMax > 0;
    }

    /**
     * Pmus at a given time within the breath (cmH2O).
     *
     * Half-sine model:
     *   Pmus(t) = pMusMax × sin(π × t / neuralTi)   for t ∈ [0, neuralTi]
     *   Pmus(t) = 0                                    for t > neuralTi
     *
     * Returns a POSITIVE value during effort (muscles assist ventilation).
     *
     * @param {number} tBreath - Time since start of breath (s)
     * @returns {number} Pmus (cmH2O), ≥ 0
     */
    pMusAt(tBreath) {
        if (this.pMusMax <= 0 || tBreath < 0 || tBreath > this.neuralTi) {
            return 0;
        }
        return this.pMusMax * Math.sin(Math.PI * tBreath / this.neuralTi);
    }

    /** I:E ratio as a readable string (e.g., "1:2.0") */
    get ieRatioString() {
        const [i, e] = this.ieRatio;
        return `1:${(e / i).toFixed(1)}`;
    }

    /** Mode display label */
    get modeLabel() {
        if (this.mode === MODE_PC_CSV) return 'PC-CSV';
        return this.mode === MODE_VC_CMV ? 'VC-CMV' : 'PC-CMV';
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
        return Math.max(0, this.pressureControlLevel - this.autoPeep);
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

    /** Steady-state auto-PEEP (cmH2O) — uses effective Te (accounts for hold) */
    get autoPeep() {
        if (this.isPressureMode()) {
            return this._pcAutoPeep();
        }
        return this.lung.steadyStateAutoPeep(this.tidalVolume, this.effectiveExpiratoryTime);
    }

    /** Total PEEP = set PEEP + auto-PEEP (cmH2O) */
    get totalPeep() {
        return this.peep + this.autoPeep;
    }

    /** Steady-state trapped gas volume (L) — uses effective Te */
    get trappedVolume() {
        if (this.isPressureMode()) {
            return this._pcTrappedVolume();
        }
        return this.lung.steadyStateTrappedVolume(this.tidalVolume, this.effectiveExpiratoryTime);
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

    /** @private PC-CMV steady-state trapped volume (L) — uses effective Te */
    _pcTrappedVolume() {
        const tau = this.lung.timeConstant;
        const C   = this.lung.compliance;
        const ti  = this.inspiratoryTime;
        const te  = this.effectiveExpiratoryTime;

        const alpha = Math.exp(-te / tau);
        const beta  = 1 - Math.exp(-ti / tau);
        const denom = 1 - Math.exp(-(ti + te) / tau);

        if (denom < 1e-10) return Infinity;  // Essentially no exhalation

        return this.pressureControlLevel * C * beta * alpha / denom;
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
        const drivePressure = Math.max(0, this.pressureControlLevel - autoPeep);
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
        if (this.isPressureMode()) {
            return this.peep + this.pressureControlLevel;
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
        if (this.isPressureMode()) {
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
        if (this.isPressureMode()) {
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
        if (this.isPressureMode()) {
            return this.pcDrivingPressure;
        }
        if (this.flowPattern === 'ramp') {
            // PIP - Pplat gives the net resistive effect at the PIP location
            return this.pip - this.pplat;
        }
        return this.lung.resistance * this.inspiratoryFlow;
    }

    /** Ratio of effective expiratory time to time constant: Te_eff / τ */
    get teOverTau() {
        return this.effectiveExpiratoryTime / this.lung.timeConstant;
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
    // VC modes use ANALYTICAL solutions (flow is controlled, pressure computed).
    // PC mode uses NUMERICAL integration when Pmus > 0 (Euler method at 100Hz).
    // PC without Pmus uses analytical exponential fill.
    //
    // The waveforms are generated in STEADY STATE — we pre-calculate the
    // auto-PEEP and trapped volume, then every breath is identical.
    //
    // When Pmus is active:
    //   VC: Paw(t) = PEEP + V(t)/C + R×V̇(t) - Pmus(t)  [analytical]
    //   PC: V̇(t) = [Pinsp + Pmus(t) - V(t)×E] / R       [numerical]
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
        if (this.isPressureMode()) {
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

        // Hold and expiration timing
        const holdDur = this.effectiveHoldTime;
        const teEff   = this.effectiveExpiratoryTime;

        // Pre-allocate arrays
        const totalSamples = Math.ceil(this.totalCycleTime * this.sampleRate) * numBreaths + 10;
        const time     = new Array(totalSamples);
        const pressure = new Array(totalSamples);
        const volume   = new Array(totalSamples);
        const flow     = new Array(totalSamples);
        let idx = 0;
        let t = 0;

        for (let breath = 0; breath < numBreaths; breath++) {
            let tBreath = 0;  // time since start of THIS breath

            // INSPIRATION — Square Flow
            const inspSteps = Math.round(ti * this.sampleRate);

            for (let i = 0; i < inspSteps; i++) {
                const tInsp = i * dt;
                const vDelivered = flowInsp * tInsp;
                const vTotal = trappedVol + vDelivered;

                // Paw = PEEP + Pelastic + Presistive - Pmus
                // Pmus SUBTRACTS from airway pressure in VC (patient does work,
                // so ventilator doesn't push as hard → "scalloped" waveform)
                const pmus = this.pMusAt(tBreath);
                const p = peep + (vTotal / C) + (R * flowInsp) - pmus;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDelivered * 1000;
                flow[idx]     = flowInsp * 60;
                idx++;
                t += dt;
                tBreath += dt;
            }

            // INSPIRATORY HOLD — Both valves closed, flow = 0
            if (holdDur > 0) {
                const holdSteps = Math.round(holdDur * this.sampleRate);
                const pPlatBase = peep + (vStartExp / C);
                for (let i = 0; i < holdSteps; i++) {
                    const pmus = this.pMusAt(tBreath);
                    const p = pPlatBase - pmus;

                    time[idx]     = t;
                    pressure[idx] = p;
                    volume[idx]   = vt * 1000;
                    flow[idx]     = 0;
                    idx++;
                    t += dt;
                    tBreath += dt;
                }
            }

            // EXPIRATION — Passive Exponential Decay
            const expSteps = Math.round(teEff * this.sampleRate);
            const deltaPExp = vStartExp / C;

            for (let i = 0; i < expSteps; i++) {
                const tExp = i * dt;
                const expDecay = Math.exp(-tExp / tau);
                const vRemaining = vStartExp * expDecay;
                const fExp = -(deltaPExp / R) * expDecay;
                const pmus = this.pMusAt(tBreath);
                const p = peep + (vRemaining / C) - pmus;
                const vExhaled  = vStartExp * (1 - expDecay);
                const vDisplayed = vt - vExhaled;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDisplayed * 1000;
                flow[idx]     = fExp * 60;
                idx++;
                t += dt;
                tBreath += dt;
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
        const vt   = this.tidalVolume;
        const peep = this.peep;
        const tau  = this.lung.timeConstant;
        const R    = this.lung.resistance;
        const C    = this.lung.compliance;

        // Steady-state values (same as square — same VT, same Te)
        const autoPeepSS = this.autoPeep;
        const trappedVol = this.trappedVolume;

        // Peak flow: V̇_peak = 2 × VT / Ti
        const fPeak = 2 * vt / ti;

        // Volume above PEEP-equilibrium at start of expiration
        const vStartExp = trappedVol + vt;

        // Hold and expiration timing
        const holdDur = this.effectiveHoldTime;
        const teEff   = this.effectiveExpiratoryTime;

        // Pre-allocate arrays
        const totalSamples = Math.ceil(this.totalCycleTime * this.sampleRate) * numBreaths + 10;
        const time     = new Array(totalSamples);
        const pressure = new Array(totalSamples);
        const volume   = new Array(totalSamples);
        const flow     = new Array(totalSamples);
        let idx = 0;
        let t = 0;

        for (let breath = 0; breath < numBreaths; breath++) {
            let tBreath = 0;

            // INSPIRATION — Descending Ramp Flow
            const inspSteps = Math.round(ti * this.sampleRate);

            for (let i = 0; i < inspSteps; i++) {
                const tInsp = i * dt;
                const fInst = fPeak * (1 - tInsp / ti);
                const vDelivered = fPeak * (tInsp - tInsp * tInsp / (2 * ti));
                const vTotal = trappedVol + vDelivered;
                const pmus = this.pMusAt(tBreath);
                const p = peep + (vTotal / C) + (R * fInst) - pmus;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDelivered * 1000;
                flow[idx]     = fInst * 60;
                idx++;
                t += dt;
                tBreath += dt;
            }

            // INSPIRATORY HOLD
            if (holdDur > 0) {
                const holdSteps = Math.round(holdDur * this.sampleRate);
                const pPlatBase = peep + (vStartExp / C);
                for (let i = 0; i < holdSteps; i++) {
                    const pmus = this.pMusAt(tBreath);
                    time[idx]     = t;
                    pressure[idx] = pPlatBase - pmus;
                    volume[idx]   = vt * 1000;
                    flow[idx]     = 0;
                    idx++;
                    t += dt;
                    tBreath += dt;
                }
            }

            // EXPIRATION — Passive Exponential Decay
            const expSteps = Math.round(teEff * this.sampleRate);
            const deltaPExp = vStartExp / C;

            for (let i = 0; i < expSteps; i++) {
                const tExp = i * dt;
                const expDecay = Math.exp(-tExp / tau);
                const vRemaining = vStartExp * expDecay;
                const fExp = -(deltaPExp / R) * expDecay;
                const pmus = this.pMusAt(tBreath);
                const p = peep + (vRemaining / C) - pmus;
                const vExhaled  = vStartExp * (1 - expDecay);
                const vDisplayed = vt - vExhaled;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDisplayed * 1000;
                flow[idx]     = fExp * 60;
                idx++;
                t += dt;
                tBreath += dt;
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
     * PC-CMV waveform generation.
     *
     * WITHOUT Pmus: Analytical exponential fill (original).
     *   V̇(t) = (ΔP_drive / R) × e^(-t/τ)
     *   V(t) = ΔP_drive × C × (1 - e^(-t/τ))
     *
     * WITH Pmus: Numerical Euler integration.
     *   V̇(t) = [Pinsp + Pmus(t) - V_above(t)×E] / R
     *   V(n+1) = V(n) + V̇(n) × dt
     *
     *   Pmus INCREASES the effective driving pressure, so:
     *     - Flow is HIGHER → more volume delivered
     *     - VT INCREASES with patient effort
     *
     *   Paw remains at PEEP + Pinsp (ventilator controls pressure).
     *   The extra work from muscles shows up as increased flow/volume,
     *   NOT as a pressure change. This is the opposite of VC mode.
     *
     *   Teaching point: "In PC, the patient's effort is invisible on
     *   the pressure waveform — you have to look at flow and volume
     *   to see if the patient is working."
     *
     * @private
     */
    _generatePC(numBreaths) {
        const dt   = 1 / this.sampleRate;
        const ti   = this.inspiratoryTime;
        const peep = this.peep;
        const tau  = this.lung.timeConstant;
        const R    = this.lung.resistance;
        const C    = this.lung.compliance;
        const E    = 1 / C;  // elastance

        // Steady-state values
        const autoPeepSS    = this.autoPeep;
        const trappedVol    = this.trappedVolume;
        const drivePressure = Math.max(0, this.pressureControlLevel - autoPeepSS);

        // Airway pressure during inspiration (constant)
        const pInsp = peep + this.pressureControlLevel;

        // Hold and expiration timing
        const holdDur = this.effectiveHoldTime;
        const teEff   = this.effectiveExpiratoryTime;

        // Choose analytical or numerical path
        const usePmus = this.pMusActive;

        // For analytical path: pre-compute VT
        const vtAnalytical = drivePressure * C * (1 - Math.exp(-ti / tau));

        // Pre-allocate arrays
        const totalSamples = Math.ceil(this.totalCycleTime * this.sampleRate) * numBreaths + 10;
        const time     = new Array(totalSamples);
        const pressure = new Array(totalSamples);
        const volume   = new Array(totalSamples);
        const flow     = new Array(totalSamples);
        let idx = 0;
        let t = 0;

        for (let breath = 0; breath < numBreaths; breath++) {
            let tBreath = 0;
            let vtDelivered;  // will be set during inspiration

            // =================================================================
            // INSPIRATION
            // =================================================================
            const inspSteps = Math.round(ti * this.sampleRate);

            if (usePmus) {
                // NUMERICAL: Euler integration with time-varying Pmus
                //
                //   V̇(t) = [Pinsp + Pmus(t) - autoPEEP - V_delivered(t)/C] / R
                //
                // The Pmus adds to Pinsp, increasing the net driving pressure.
                // As V grows, elastic backpressure increases, so flow still
                // decelerates — but peaks higher and delivers more volume.
                //
                let vDel = 0;  // volume delivered so far (L)

                for (let i = 0; i < inspSteps; i++) {
                    const pmus = this.pMusAt(tBreath);
                    const netDrive = drivePressure + pmus - (vDel / C - trappedVol / C);
                    // Actually: effective drive = Pinsp + Pmus - autoPEEP - vDelivered × E
                    // Since autoPEEP is already subtracted in drivePressure:
                    //   drive = (Pinsp - autoPEEP) + Pmus - vDel × E
                    const driveEff = drivePressure + pmus - vDel * E;
                    const fInsp = Math.max(0, driveEff / R);  // can't have negative insp flow in PC

                    time[idx]     = t;
                    pressure[idx] = pInsp;  // Paw is controlled (constant)
                    volume[idx]   = vDel * 1000;
                    flow[idx]     = fInsp * 60;
                    idx++;

                    // Euler step: V(n+1) = V(n) + V̇(n) × dt
                    vDel += fInsp * dt;

                    t += dt;
                    tBreath += dt;
                }

                vtDelivered = vDel;

            } else {
                // ANALYTICAL: exponential fill (no Pmus)
                const peakFlow = drivePressure / R;

                for (let i = 0; i < inspSteps; i++) {
                    const tInsp = i * dt;
                    const expFactor = Math.exp(-tInsp / tau);
                    const vDel  = drivePressure * C * (1 - expFactor);
                    const fInsp = peakFlow * expFactor;

                    time[idx]     = t;
                    pressure[idx] = pInsp;
                    volume[idx]   = vDel * 1000;
                    flow[idx]     = fInsp * 60;
                    idx++;
                    t += dt;
                    tBreath += dt;
                }

                vtDelivered = vtAnalytical;
            }

            // Volume above PEEP-equilibrium at start of expiration
            const vStartExp = trappedVol + vtDelivered;

            // =================================================================
            // INSPIRATORY HOLD
            // =================================================================
            if (holdDur > 0) {
                const holdSteps = Math.round(holdDur * this.sampleRate);
                const pHoldBase = peep + (vStartExp / C);
                for (let i = 0; i < holdSteps; i++) {
                    const pmus = this.pMusAt(tBreath);
                    time[idx]     = t;
                    pressure[idx] = pHoldBase - pmus;  // Pmus visible during hold
                    volume[idx]   = vtDelivered * 1000;
                    flow[idx]     = 0;
                    idx++;
                    t += dt;
                    tBreath += dt;
                }
            }

            // =================================================================
            // EXPIRATION — Passive Exponential Decay
            // =================================================================
            const expSteps = Math.round(teEff * this.sampleRate);
            const deltaPExp = vStartExp / C;

            for (let i = 0; i < expSteps; i++) {
                const tExp = i * dt;
                const expDecay = Math.exp(-tExp / tau);
                const vRemaining = vStartExp * expDecay;
                const fExp = -(deltaPExp / R) * expDecay;
                const pmus = this.pMusAt(tBreath);
                const p = peep + (vRemaining / C) - pmus;
                const vExhaled  = vStartExp * (1 - expDecay);
                const vDisplayed = vtDelivered - vExhaled;

                time[idx]     = t;
                pressure[idx] = p;
                volume[idx]   = vDisplayed * 1000;
                flow[idx]     = fExp * 60;
                idx++;
                t += dt;
                tBreath += dt;
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
        const vt = this.isPressureMode() ? this._pcSteadyStateVt() : this.tidalVolume;
        return vt * this.respiratoryRate;
    }

    /** Effective tidal volume for display (L) — set in VC, calculated in PC */
    get effectiveVt() {
        return this.isPressureMode() ? this._pcSteadyStateVt() : this.tidalVolume;
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
        const isPC = this.isPressureMode();
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
            holdActive: this.holdActive,
            pMusActive: this.pMusActive,
            pMusMax: this.pMusMax,
            neuralTi: this.neuralTi,

            // --- Operator Settings ---
            settings: {
                triggerType:           this.triggerType,
                flowTriggerLpm:        this.flowTriggerLpm,
                pressureTriggerCmH2O:  this.pressureTriggerCmH2O,
                tidalVolume_mL:      isPC ? null : this.tidalVolume * 1000,
                inspiratoryPressure: isPC ? this.pressureControlLevel : null,
                respiratoryRate:     this.respiratoryRate,
                ieRatio:             this.ieRatioString,
                peep_cmH2O:          this.peep,
                fio2:                this.fio2,
            },

            // --- Timing ---
            timing: {
                totalCycleTime_s:    round(this.totalCycleTime, 2),
                inspiratoryTime_s:   round(this.inspiratoryTime, 2),
                holdTime_s:          round(this.effectiveHoldTime, 2),
                expiratoryTime_s:    round(this.expiratoryTime, 2),
                effectiveExpTime_s:  round(this.effectiveExpiratoryTime, 2),
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
                inspiratoryPressure: isPC ? this.pressureControlLevel : null,
            },

            // --- Lung Mechanics ---
            // When hold is active, these become "measured" rather than "set":
            //   Crs_static = VT / (Pplat - totalPEEP)  ← the gold standard
            //   R_airway   = (PIP - Pplat) / V̇_insp    ← only for square flow
            mechanics: {
                resistance:          this.lung.resistance,
                compliance:          this.lung.compliance,
                elastance:           round(this.lung.elastance, 1),
                timeConstant_s:      round(this.lung.timeConstant, 2),
                // Hold-derived measurements (what clinicians actually compute)
                staticCompliance:    this.holdActive ? round(vtEffective / this.drivingPressure * 1000, 1) : null,
                measuredResistance:  (this.holdActive && !isPC && !isRamp)
                    ? round(this.resistivePressure / this.inspiratoryFlow, 1) : null,
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
                expiratoryCompletion: this.expiratoryCompletion,
                expiratoryCompletionPercent: this.expiratoryCompletionPercent,
                expiratoryCompletionStatus: this.expiratoryCompletionStatus,
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
