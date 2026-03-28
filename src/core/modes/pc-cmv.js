/**
 * ============================================================================
 * modes/pc-cmv.js — PC-CMV Mode: Steady-State Calculations & Waveform Generation
 * ============================================================================
 *
 * Extracted from ventilator.js (Phase 3A refactor).
 * All physics are byte-for-byte identical to the original private methods;
 * only the encapsulation has changed.  `Ventilator` remains the public
 * façade — these functions are never called directly by app or test code.
 *
 * Exported functions (called via thin delegates on Ventilator):
 *   pcTrappedVolume(vent)             ← was _pcTrappedVolume()
 *   pcAutoPeep(vent)                  ← was _pcAutoPeep()
 *   pcSteadyStateVt(vent)             ← was _pcSteadyStateVt()
 *   generatePC(vent, numBreaths)      ← was _generatePC()
 *
 * Steady-state coupling (closed-form):
 *
 *   Let α = e^(-Te/τ),  β = 1 - e^(-Ti/τ)
 *
 *   V_trapped = Pinsp × C × β × α / (1 - e^(-TCT/τ))
 *   autoPEEP  = V_trapped / C
 *   VT_ss     = (Pinsp - autoPEEP) × C × β
 *
 * Every function receives the full Ventilator instance so it can access
 * any property or method without re-parameterising the call sites.
 * ============================================================================
 */


/**
 * PC-CMV steady-state trapped volume (L).
 * Uses effective Te (accounts for inspiratory hold stealing from Te).
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @returns {number} Trapped volume (L), or Infinity if no exhalation occurs
 */
export function pcTrappedVolume(vent) {
    const tau = vent.lung.timeConstant;
    const C   = vent.lung.compliance;
    const ti  = vent.inspiratoryTime;
    const te  = vent.effectiveExpiratoryTime;

    const alpha = Math.exp(-te / tau);
    const beta  = 1 - Math.exp(-ti / tau);
    const denom = 1 - Math.exp(-(ti + te) / tau);

    if (denom < 1e-10) return Infinity;  // Essentially no exhalation

    return vent.inspiratoryPressure * C * beta * alpha / denom;
}


/**
 * PC-CMV steady-state auto-PEEP (cmH2O).
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @returns {number} Auto-PEEP (cmH2O), or Infinity if complete breath stacking
 */
export function pcAutoPeep(vent) {
    const vTrapped = pcTrappedVolume(vent);
    if (!isFinite(vTrapped)) return Infinity;
    return vTrapped / vent.lung.compliance;
}


/**
 * PC-CMV steady-state delivered VT (L).
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @returns {number} Delivered VT (L)
 */
export function pcSteadyStateVt(vent) {
    const autoPeep = pcAutoPeep(vent);
    if (!isFinite(autoPeep)) return 0;
    const drivePressure = Math.max(0, vent.inspiratoryPressure - autoPeep);
    const beta = 1 - Math.exp(-vent.inspiratoryTime / vent.lung.timeConstant);
    return drivePressure * vent.lung.compliance * beta;
}


/**
 * PC-CMV waveform generation.
 *
 * WITHOUT Pmus: Analytical exponential fill.
 *   V̇(t) = (ΔP_drive / R) × e^(-t/τ)
 *   V(t) = ΔP_drive × C × (1 - e^(-t/τ))
 *
 * WITH Pmus: Numerical Euler integration.
 *   V̇(t) = [Pinsp + Pmus(t) - V_above(t)×E] / R
 *   V(n+1) = V(n) + V̇(n) × dt
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @param {number} numBreaths
 * @returns {{ time: number[], pressure: number[], volume: number[], flow: number[] }}
 */
export function generatePC(vent, numBreaths) {
    const dt   = 1 / vent.sampleRate;
    const ti   = vent.inspiratoryTime;
    const peep = vent.peep;
    const tau  = vent.lung.timeConstant;
    const R    = vent.lung.resistance;
    const C    = vent.lung.compliance;
    const E    = 1 / C;  // elastance

    // Steady-state values
    const autoPeepSS    = vent.autoPeep;
    const trappedVol    = vent.trappedVolume;
    const drivePressure = Math.max(0, vent.inspiratoryPressure - autoPeepSS);

    // Airway pressure during inspiration (constant)
    const pInsp = peep + vent.inspiratoryPressure;

    // Hold and expiration timing
    const holdDur = vent.effectiveHoldTime;
    const teEff   = vent.effectiveExpiratoryTime;

    // Choose analytical or numerical path
    const usePmus = vent.pMusActive;

    // For analytical path: pre-compute VT
    const vtAnalytical = drivePressure * C * (1 - Math.exp(-ti / tau));

    // Pre-allocate arrays
    const totalSamples = Math.ceil(vent.totalCycleTime * vent.sampleRate) * numBreaths + 10;
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
        const inspSteps = Math.round(ti * vent.sampleRate);

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
                const pmus = vent.pMusAt(tBreath);
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
            const holdSteps = Math.round(holdDur * vent.sampleRate);
            const pHoldBase = peep + (vStartExp / C);
            for (let i = 0; i < holdSteps; i++) {
                const pmus = vent.pMusAt(tBreath);
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
        const expSteps = Math.round(teEff * vent.sampleRate);
        const deltaPExp = vStartExp / C;

        for (let i = 0; i < expSteps; i++) {
            const tExp = i * dt;
            const expDecay = Math.exp(-tExp / tau);
            const vRemaining = vStartExp * expDecay;
            const fExp = -(deltaPExp / R) * expDecay;
            const pmus = vent.pMusAt(tBreath);
            const p = peep + (vRemaining / C) - pmus;
            const vExhaled   = vStartExp * (1 - expDecay);
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