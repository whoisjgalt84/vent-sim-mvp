/**
 * scratch/verify-identity.mjs — THROWAWAY post-fix accounting verification.
 * Read-only: imports the real engine, drives it, and checks the §2 invariant
 *   neural onsets (with effort) == delivered patient breaths + failed events
 *                                  + efforts still in progress at the run boundary
 * Counts FAILED events (which scratch/trigger-sweep.mjs does not), so we can tell
 * "visible failed effort" (engine correct) from "silent drop" (bug).
 */
import { LungModel } from '../js/lung-model.js';
import { Ventilator, MODE_PC_CSV } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';

function build(ov, patientRR) {
    const lung = LungModel.fromPreset('normal');
    const vent = new Ventilator(lung, Object.assign({
        mode: 'vc-cmv', flowPattern: 'square', holdTime: 0,
        pMusMax: 8, neuralTi: 1.0, tidalVolume: 0.500,
        inspiratoryPressure: 15, psPressure: 10, cyclePercent: 25,
        respiratoryRate: 14, ieRatio: [1, 2], peep: 5, fio2: 0.40,
        triggerType: 'flow', flowTriggerLpm: 2.0, pressureTriggerCmH2O: 1.0,
    }, ov));
    const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
    sim.patientRR = patientRR;
    return sim;
}

function run(ov, rr, seconds = 60) {
    const sim = build(ov, rr);
    const steps = Math.round(seconds / sim.dt);
    let onsetExp = 0, onsetIH = 0;
    for (let i = 0; i < steps; i++) {
        const phaseBefore = sim.phase;
        const nb = sim.neuralInspActive;
        sim.tick();
        if (!nb && sim.neuralInspActive) {
            if (phaseBefore === 'EXPIRATION') onsetExp++; else onsetIH++;
        }
    }
    // an effort commanded but still mid-neural-inspiration AND not yet resolved
    // at the boundary is neither delivered nor failed yet — count it so the
    // identity is exact. (An effort that already emitted VU stays neuralInspActive
    // but is resolved, so it must NOT be counted here.)
    const inProgress = (sim.neuralInspActive && !sim.neuralCycleResolved) ? 1 : 0;
    const evs = sim.getTriggerEvents(0, sim.globalTime);
    const failed = evs.filter(e => e.type === 'failed').length;
    const failedVU = evs.filter(e => e.type === 'failed' && e.gateFailed === 'ventilator_unavailable').length;
    const failedTh = evs.filter(e => e.type === 'failed' && e.gateFailed === 'threshold').length;
    const onsets = onsetExp + onsetIH;
    const delivered = sim.patientBreathCount;
    const unaccounted = onsets - delivered - failed - inProgress; // 0 == no silent drop
    return { rr, onsets, onsetExp, onsetIH, delivered, machine: sim.machineBreathCount,
             failed, failedVU, failedTh, inProgress, unaccounted };
}

function grid(name, ov, rrs) {
    console.log(`\n=== ${name} ===`);
    console.log('patRR | onsets | onsetExp | onsetIH | delivered | failed(VU/Thr) | inProg | UNACCOUNTED(silent) | identity?');
    let allClose = true;
    for (const rr of rrs) {
        const r = run(ov, rr);
        if (r.unaccounted !== 0) allClose = false;
        console.log(
            `${String(r.rr).padStart(5)} | ${String(r.onsets).padStart(6)} | ${String(r.onsetExp).padStart(8)} | ` +
            `${String(r.onsetIH).padStart(7)} | ${String(r.delivered).padStart(9)} | ` +
            `${String(r.failed).padStart(3)} (${r.failedVU}/${r.failedTh})`.padStart(14) +
            ` | ${String(r.inProgress).padStart(6)} | ${String(r.unaccounted).padStart(19)} | ` +
            `${r.unaccounted === 0 ? 'CLOSES' : 'SILENT-DROP!'}`
        );
    }
    return allClose;
}

const rrs = [10, 14, 18, 20, 22, 24, 26, 28, 30, 34, 38, 42];
let ok = true;
ok = grid('A: VC I:E 1:2',  {},                 rrs) && ok;
ok = grid('B: VC I:E 1:1',  { ieRatio: [1, 1] }, rrs) && ok;
ok = grid('C: VC hold 0.5s', { holdTime: 0.5 },  rrs) && ok;
ok = grid('D: PC-CMV',      { mode: 'pc-cmv', inspiratoryPressure: 12 }, rrs) && ok;
ok = grid('E: PC-CSV',      { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25 }, [10,15,20,25,30,35]) && ok;

console.log(`\n>>> Accounting identity closes at EVERY cell (no silent drops): ${ok ? 'YES' : 'NO'}`);
