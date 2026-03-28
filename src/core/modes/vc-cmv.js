/**
 * ============================================================================
 * modes/vc-cmv.js — VC-CMV Mode: Waveform Generation & PIP Calculation
 * ============================================================================
 *
 * Extracted from ventilator.js (Phase 3A refactor).
 * All physics are byte-for-byte identical to the original private methods;
 * only the encapsulation has changed.  `Ventilator` remains the public
 * façade — these functions are never called directly by app or test code.
 *
 * Exported functions (called via thin delegates on Ventilator):
 *   generateVC(vent, numBreaths)      ← was _generateVC()
 *   generateVCRamp(vent, numBreaths)  ← was _generateVCRamp()
 *   rampPIP(vent)                     ← was _rampPIP()
 *
 * Every function receives the full Ventilator instance so it can access
 * any property or method without re-parameterising the call sites.
 * ============================================================================
 */


/**
 * Compute PIP for descending ramp flow (analytical).
 *
 * P(t) = PEEP + autoPEEP + R × V̇_peak × (1 - t/Ti)
 *       + (V_trapped + V̇_peak × (t - t²/(2Ti))) / C
 *
 * dP/dt = 0 at t* = Ti - τ   (if τ < Ti)
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @returns {number} PIP (cmH2O)
 */
export function rampPIP(vent) {
    const ti    = vent.inspiratoryTime;
    const tau   = vent.lung.timeConstant;
    const R     = vent.lung.resistance;
    const C     = vent.lung.compliance;
    const peep  = vent.peep;
    const auto  = vent.autoPeep;
    const vTrap = vent.trappedVolume;
    const fPeak = vent.vcPeakFlow;  // 2 × VT / Ti

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
 * VC-CMV waveform generation — square flow, linear pressure ramp.
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @param {number} numBreaths
 * @returns {{ time: number[], pressure: number[], volume: number[], flow: number[] }}
 */
export function generateVC(vent, numBreaths) {
    const dt   = 1 / vent.sampleRate;
    const ti   = vent.inspiratoryTime;
    const vt   = vent.tidalVolume;
    const peep = vent.peep;
    const tau  = vent.lung.timeConstant;
    const R    = vent.lung.resistance;
    const C    = vent.lung.compliance;

    // Steady-state values
    const autoPeepSS  = vent.autoPeep;
    const trappedVol  = vent.trappedVolume;
    const flowInsp    = vent.inspiratoryFlow;   // L/s, positive

    // Volume above PEEP-equilibrium at start of expiration
    const vStartExp = trappedVol + vt;

    // Hold and expiration timing
    const holdDur = vent.effectiveHoldTime;
    const teEff   = vent.effectiveExpiratoryTime;

    // Pre-allocate arrays
    const totalSamples = Math.ceil(vent.totalCycleTime * vent.sampleRate) * numBreaths + 10;
    const time     = new Array(totalSamples);
    const pressure = new Array(totalSamples);
    const volume   = new Array(totalSamples);
    const flow     = new Array(totalSamples);
    let idx = 0;
    let t = 0;

    for (let breath = 0; breath < numBreaths; breath++) {
        let tBreath = 0;  // time since start of THIS breath

        // INSPIRATION — Square Flow
        const inspSteps = Math.round(ti * vent.sampleRate);

        for (let i = 0; i < inspSteps; i++) {
            const tInsp = i * dt;
            const vDelivered = flowInsp * tInsp;
            const vTotal = trappedVol + vDelivered;

            // Paw = PEEP + Pelastic + Presistive - Pmus
            // Pmus SUBTRACTS from airway pressure in VC (patient does work,
            // so ventilator doesn't push as hard → "scalloped" waveform)
            const pmus = vent.pMusAt(tBreath);
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
            const holdSteps = Math.round(holdDur * vent.sampleRate);
            const pPlatBase = peep + (vStartExp / C);
            for (let i = 0; i < holdSteps; i++) {
                const pmus = vent.pMusAt(tBreath);
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
 * EXPIRATION: Same passive exponential decay (identical physics).
 *
 * @param {import('../ventilator.js').Ventilator} vent
 * @param {number} numBreaths
 * @returns {{ time: number[], pressure: number[], volume: number[], flow: number[] }}
 */
export function generateVCRamp(vent, numBreaths) {
    const dt   = 1 / vent.sampleRate;
    const ti   = vent.inspiratoryTime;
    const vt   = vent.tidalVolume;
    const peep = vent.peep;
    const tau  = vent.lung.timeConstant;
    const R    = vent.lung.resistance;
    const C    = vent.lung.compliance;

    // Steady-state values (same as square — same VT, same Te)
    const autoPeepSS = vent.autoPeep;
    const trappedVol = vent.trappedVolume;

    // Peak flow: V̇_peak = 2 × VT / Ti
    const fPeak = 2 * vt / ti;

    // Volume above PEEP-equilibrium at start of expiration
    const vStartExp = trappedVol + vt;

    // Hold and expiration timing
    const holdDur = vent.effectiveHoldTime;
    const teEff   = vent.effectiveExpiratoryTime;

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

        // INSPIRATION — Descending Ramp Flow
        const inspSteps = Math.round(ti * vent.sampleRate);

        for (let i = 0; i < inspSteps; i++) {
            const tInsp = i * dt;
            const fInst = fPeak * (1 - tInsp / ti);
            const vDelivered = fPeak * (tInsp - tInsp * tInsp / (2 * ti));
            const vTotal = trappedVol + vDelivered;
            const pmus = vent.pMusAt(tBreath);
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
            const holdSteps = Math.round(holdDur * vent.sampleRate);
            const pPlatBase = peep + (vStartExp / C);
            for (let i = 0; i < holdSteps; i++) {
                const pmus = vent.pMusAt(tBreath);
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