/**
 * scratch/repro-weak.mjs — THROWAWAY read-only reproduction of the live-screen
 * weak-effort condition (VC-CMV, RR14, I:E 1:1, PEEP5, VT500, normal preset,
 * flow trig 2.0, pMusMax 1.75, neuralTi 1.0, patientRR 26). Read-only: imports
 * the real engine, tick-steps it, reads public fields only.
 */
import { LungModel } from '../js/lung-model.js';
import { Ventilator } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';

function build(pMusMax) {
    const lung = LungModel.fromPreset('normal');           // R10 / C0.060
    const vent = new Ventilator(lung, {
        mode: 'vc-cmv', flowPattern: 'square', holdTime: 0,
        tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 1], peep: 5, fio2: 0.40,
        triggerType: 'flow', flowTriggerLpm: 2.0, pressureTriggerCmH2O: 1.0,
        pMusMax, neuralTi: 1.0,
    });
    const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
    sim.patientRR = 26;
    return sim;
}

function run(pMusMax, seconds = 60) {
    const sim = build(pMusMax);
    const steps = Math.round(seconds / sim.dt);
    const lockout = sim.triggerLockoutSeconds;

    let onsetExp = 0, onsetIH = 0;
    const onsets = [];        // detailed records (we keep them all; print first 12)
    let cur = null;

    for (let i = 0; i < steps; i++) {
        const phaseBefore = sim.phase;
        const neuralBefore = sim.neuralInspActive;
        sim.tick();

        if (!neuralBefore && sim.neuralInspActive) {
            if (phaseBefore === 'EXPIRATION') onsetExp++; else onsetIH++;
            cur = {
                t: sim.globalTime, onsetPhase: phaseBefore,
                peakPmus: 0, recoilAtPeakPmus: 0, maxFlowDemandLpm: 0, eligible: false,
            };
            onsets.push(cur);
        }
        // sample the gate-c quantities while this neural inspiration is active
        if (cur && sim.neuralInspActive) {
            const pmus = sim.currentPmus;
            const recoil = sim.volumeAboveEq / sim.lung.compliance;
            const flowDemand = Math.max(0, sim.currentFlow * 60);
            if (sim.phase === 'EXPIRATION' && sim.phaseTime > lockout) cur.eligible = true;
            if (pmus > cur.peakPmus) { cur.peakPmus = pmus; cur.recoilAtPeakPmus = recoil; }
            if (sim.phase === 'EXPIRATION' && flowDemand > cur.maxFlowDemandLpm) cur.maxFlowDemandLpm = flowDemand;
        }
    }

    const inProgress = (sim.neuralInspActive && !sim.neuralCycleResolved) ? 1 : 0;
    const evs = sim.getTriggerEvents(0, sim.globalTime);          // all retained (60s run → none pruned)
    const failedVU = evs.filter(e => e.type === 'failed' && e.gateFailed === 'ventilator_unavailable').length;
    const failedTh = evs.filter(e => e.type === 'failed' && e.gateFailed === 'threshold').length;

    // attribute outcome to each onset: first 'patient'(delivered) or 'failed' event at/after onset time
    const outcomeEvents = evs.filter(e => e.type === 'patient' || e.type === 'failed')
                             .sort((a, b) => a.time - b.time);
    for (let k = 0; k < onsets.length; k++) {
        const o = onsets[k];
        const next = onsets[k + 1] ? onsets[k + 1].t : Infinity;
        // VU events are emitted mid-tick (globalTime before the end-of-tick
        // increment), so they sit ~one dt before the onset timestamp we read
        // after tick(); widen the lower bound by ~dt so they attribute correctly.
        const tol = 0.011;
        const ev = outcomeEvents.find(e => e.time >= o.t - tol && e.time < next - tol);
        if (!ev) { o.outcome = 'in-progress'; o.gate = '-'; }
        else if (ev.type === 'patient') { o.outcome = 'DELIVERED'; o.gate = 'c pass'; }
        else { o.outcome = 'FAILED'; o.gate = ev.gateFailed; o.failPmus = ev.pmus; o.failPhase = ev.phase; }
    }

    return {
        pMusMax,
        onsets: onsetExp + onsetIH, onsetExp, onsetIH,
        delivered: sim.patientBreathCount, machine: sim.machineBreathCount,
        failed: failedVU + failedTh, failedVU, failedTh, inProgress,
        measuredRR: sim.measuredRR,
        deliveredPatientRatePerMin: sim.patientBreathCount / (seconds / 60),
        totalBreathRatePerMin: sim.breathCount / (sim.globalTime / 60),
        onsetRecords: onsets,
    };
}

function summarize(label, r) {
    const identity = r.delivered + r.failed + r.inProgress;
    console.log(`\n========== ${label} (pMusMax=${r.pMusMax}) ==========`);
    console.log(`neural onsets:        ${r.onsets}  (expiration ${r.onsetExp} / insp-or-hold ${r.onsetIH})`);
    console.log(`delivered patient:    ${r.delivered}`);
    console.log(`machine breaths:      ${r.machine}`);
    console.log(`failed events:        ${r.failed}  (ventilator_unavailable ${r.failedVU} / threshold ${r.failedTh})`);
    console.log(`in-progress@boundary: ${r.inProgress}`);
    console.log(`ACCOUNTING: onsets ${r.onsets} == delivered ${r.delivered} + failed ${r.failed} + inProgress ${r.inProgress} = ${identity}  -> ${identity === r.onsets ? 'CLOSES' : 'DOES NOT CLOSE (BUG!)'}`);
    console.log(`measuredRR (engine):  ${r.measuredRR.toFixed(2)} /min`);
    console.log(`  vs machine RR 14, vs delivered-patient rate ${r.deliveredPatientRatePerMin.toFixed(2)}, vs total-breath rate ${r.totalBreathRatePerMin.toFixed(2)}, vs patientRR 26`);
}

const weak = run(1.75);
summarize('WEAK EFFORT — live screen condition', weak);

console.log('\n--- Effort-by-effort, first 12 neural onsets (weak pMusMax=1.75) ---');
console.log('  # | onset t | phase@onset | outcome   | gate                  | peakPmus | recoil@peak | maxFlowDemand | thr | eligible');
weak.onsetRecords.slice(0, 12).forEach((o, idx) => {
    console.log(
        `${String(idx + 1).padStart(3)} | ${o.t.toFixed(2).padStart(6)}s | ${o.onsetPhase.padEnd(11)} | ` +
        `${o.outcome.padEnd(9)} | ${String(o.gate).padEnd(21)} | ${o.peakPmus.toFixed(2).padStart(8)} | ` +
        `${o.recoilAtPeakPmus.toFixed(2).padStart(11)} | ${o.maxFlowDemandLpm.toFixed(2).padStart(13)} | 2.0 | ${o.eligible}`
    );
});

const strong = run(8);
summarize('STRONG EFFORT — what the NT tests used', strong);

console.log('\n>>> Identity closes (weak): ' + ((weak.delivered + weak.failed + weak.inProgress) === weak.onsets));
console.log('>>> Identity closes (strong): ' + ((strong.delivered + strong.failed + strong.inProgress) === strong.onsets));
