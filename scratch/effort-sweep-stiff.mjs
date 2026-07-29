/**
 * scratch/effort-sweep-stiff.mjs — THROWAWAY read-only effort sweep at the user's
 * exact live settings: VC-CMV, RR14, I:E 1:1, PEEP5, VT500, R10, C=0.050 (stiff,
 * NOT the 0.060 preset), flow trig 2.0, neuralTi 1.0, patientRR 26.
 * Reads public fields only; recomputes gate-c quantities exactly as the engine
 * does (engine flow = -(volumeAboveEq/C - pmus)/R, so currentFlow*60 IS the
 * (pmus-recoil)/R*60 inspiratory flow demand it compares to the 2.0 threshold).
 */
import { LungModel } from '../js/lung-model.js';
import { Ventilator } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';

const R = 10, C = 0.050, THRESH = 2.0;

function build(pMusMax) {
    const lung = new LungModel({ resistance: R, compliance: C });   // literal stiff lung
    const vent = new Ventilator(lung, {
        mode: 'vc-cmv', flowPattern: 'square', holdTime: 0,
        tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 1], peep: 5, fio2: 0.40,
        triggerType: 'flow', flowTriggerLpm: THRESH, pressureTriggerCmH2O: 1.0,
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
    const onsets = [];
    let cur = null;

    for (let i = 0; i < steps; i++) {
        const phaseBefore = sim.phase;
        const neuralBefore = sim.neuralInspActive;
        sim.tick();

        if (!neuralBefore && sim.neuralInspActive) {
            if (phaseBefore === 'EXPIRATION') onsetExp++; else onsetIH++;
            cur = {
                t: sim.globalTime, onsetPhase: phaseBefore, phaseTimeAtOnset: sim.phaseTime,
                peakPmus: 0, minRecoil: Infinity, maxFlowDemand: 0,
                eligibleTicks: 0, firstEligNeuralT: null, lastEligNeuralT: null,
            };
            onsets.push(cur);
        }
        if (cur && sim.neuralInspActive) {
            const pmus = sim.currentPmus;
            const recoil = sim.volumeAboveEq / sim.lung.compliance;
            const flowDemand = Math.max(0, sim.currentFlow * 60);   // engine's gate-c value
            const eligible = (sim.phase === 'EXPIRATION' && sim.phaseTime > lockout);
            if (eligible) {
                cur.eligibleTicks++;
                if (cur.firstEligNeuralT === null) cur.firstEligNeuralT = sim.neuralTimer;
                cur.lastEligNeuralT = sim.neuralTimer;
                if (pmus > cur.peakPmus) cur.peakPmus = pmus;
                if (recoil < cur.minRecoil) cur.minRecoil = recoil;
                if (flowDemand > cur.maxFlowDemand) cur.maxFlowDemand = flowDemand;
            }
        }
    }

    const inProgress = (sim.neuralInspActive && !sim.neuralCycleResolved) ? 1 : 0;
    const evs = sim.getTriggerEvents(0, sim.globalTime);
    const failedVU = evs.filter(e => e.type === 'failed' && e.gateFailed === 'ventilator_unavailable').length;
    const failedTh = evs.filter(e => e.type === 'failed' && e.gateFailed === 'threshold').length;
    const outcomeEvents = evs.filter(e => e.type === 'patient' || e.type === 'failed').sort((a, b) => a.time - b.time);
    for (let k = 0; k < onsets.length; k++) {
        const o = onsets[k];
        const next = onsets[k + 1] ? onsets[k + 1].t : Infinity;
        const ev = outcomeEvents.find(e => e.time >= o.t - 0.011 && e.time < next - 0.011);
        if (!ev) { o.outcome = 'in-progress'; o.gate = '-'; }
        else if (ev.type === 'patient') { o.outcome = 'DELIVERED'; o.gate = 'c pass'; }
        else { o.outcome = 'FAILED'; o.gate = ev.gateFailed; }
        // naive "combine the extremes" demand — peak pmus vs min recoil (NOT same instant)
        o.hypotheticalDemand = o.minRecoil < Infinity ? Math.max(0, (o.peakPmus - o.minRecoil)) / R * 60 : 0;
    }
    return {
        pMusMax, onsets: onsetExp + onsetIH, onsetExp, onsetIH,
        delivered: sim.patientBreathCount, machine: sim.machineBreathCount,
        failed: failedVU + failedTh, failedVU, failedTh, inProgress,
        measuredRR: sim.measuredRR, onsetRecords: onsets,
    };
}

const levels = [1.75, 3.25, 5, 8].map(p => run(p, 60));  // NB: not .map(run) — map passes index as 2nd arg

console.log(`Stiff lung R=${R}, C=${C} (recoil at start of expiration = VT/C = ${(0.5 / C).toFixed(1)} cmH2O; tau=${(R * C).toFixed(2)}s)`);
console.log('machine I:E 1:1 RR14 -> Ttot 4.286s, Ti 2.143s, Te 2.143s; eligible expiration = Te-0.10 = 2.043s; neuralTi=1.0s\n');
console.log('=== 4-LEVEL TREND ===');
console.log('pMusMax | onsets(exp/IH) | delivered | machine | failed(VU/thr) | inProg | identity | measuredRR');
for (const r of levels) {
    const id = r.delivered + r.failed + r.inProgress;
    console.log(
        `${String(r.pMusMax).padStart(7)} | ${String(r.onsets).padStart(2)} (${r.onsetExp}/${r.onsetIH})`.padEnd(26) +
        ` | ${String(r.delivered).padStart(9)} | ${String(r.machine).padStart(7)} | ${`${r.failed} (${r.failedVU}/${r.failedTh})`.padStart(14)} | ${String(r.inProgress).padStart(6)} | ` +
        `${id === r.onsets ? `CLOSES(${id})` : `BUG(${id}!=${r.onsets})`} | ${r.measuredRR.toFixed(2)}`
    );
}

function eligTable(r) {
    console.log(`\n=== Eligible EXPIRATION-onset efforts, pMusMax ${r.pMusMax} ===`);
    console.log('  onset t | phaseT@onset | peakPmus | minRecoil(elig) | maxFlowDemand(engine) | hypo(peakP-minR)/R | thr | outcome   | gate');
    for (const o of r.onsetRecords) {
        if (o.onsetPhase !== 'EXPIRATION') continue;
        console.log(
            `  ${o.t.toFixed(2).padStart(6)}s | ${o.phaseTimeAtOnset.toFixed(2).padStart(11)}s | ${o.peakPmus.toFixed(2).padStart(8)} | ` +
            `${(o.minRecoil < Infinity ? o.minRecoil : 0).toFixed(2).padStart(15)} | ${o.maxFlowDemand.toFixed(2).padStart(21)} | ` +
            `${o.hypotheticalDemand.toFixed(2).padStart(18)} | 2.0 | ${o.outcome.padEnd(9)} | ${o.gate}`
        );
    }
}
eligTable(levels[1]); // 3.25
eligTable(levels[2]); // 5

// CRITICAL DISCRIMINATOR for pMusMax 5
const five = levels[2];
const bugs = five.onsetRecords.filter(o => o.onsetPhase === 'EXPIRATION' && o.outcome === 'FAILED' && o.maxFlowDemand >= THRESH);
const hypoButFail = five.onsetRecords.filter(o => o.onsetPhase === 'EXPIRATION' && o.outcome === 'FAILED' && o.maxFlowDemand < THRESH && o.hypotheticalDemand >= THRESH);
console.log('\n=== CRITICAL DISCRIMINATOR (pMusMax 5) ===');
console.log(`Failed expiration efforts whose ACTUAL engine flow demand reached >= ${THRESH} (would be a GATE-C BUG): ${bugs.length}`);
bugs.forEach(o => console.log(`   t=${o.t.toFixed(2)}s maxFlowDemand=${o.maxFlowDemand.toFixed(2)} >= ${THRESH} but FAILED <-- BUG`));
console.log(`Failed expiration efforts where naive (peakPmus-minRecoil) WOULD exceed ${THRESH} but actual per-tick demand never did (TIMING, not bug): ${hypoButFail.length}`);
hypoButFail.forEach(o => console.log(`   t=${o.t.toFixed(2)}s peakPmus=${o.peakPmus.toFixed(2)} minRecoil=${o.minRecoil.toFixed(2)} hypo=${o.hypotheticalDemand.toFixed(2)} but actual max=${o.maxFlowDemand.toFixed(2)} (extremes not coincident)`));

// neural-window vs expiration alignment (pMus 5)
console.log('\n=== Neural window vs eligible expiration (pMusMax 5, expiration onsets) ===');
for (const o of five.onsetRecords) {
    if (o.onsetPhase !== 'EXPIRATION') continue;
    const eligDur = o.eligibleTicks * 0.01;
    console.log(`  onset ${o.t.toFixed(2)}s: eligible window ${eligDur.toFixed(2)}s (neuralTimer ${o.firstEligNeuralT?.toFixed(2) ?? '-'}..${o.lastEligNeuralT?.toFixed(2) ?? '-'} of neuralTi 1.0) -> minRecoil ${(o.minRecoil<Infinity?o.minRecoil:0).toFixed(2)}, ${o.outcome}`);
}
