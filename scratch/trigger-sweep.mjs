/**
 * scratch/trigger-sweep.mjs — THROWAWAY read-only investigation harness
 * for SME-001/004 (patient-trigger drop) and SME-005/006 (spontaneous-mode
 * measured-RR misread).
 *
 * Drives the REAL engine classes exactly as the app does (no source edits).
 * Run:  node scratch/trigger-sweep.mjs
 *
 * It only calls public methods (sim.tick()) and reads public fields the app
 * itself reads (sim.phase, sim.neuralInspActive, sim.patientBreathCount,
 * sim.machineBreathCount, sim.measuredRR, sim.lastBreathStartSec,
 * sim.globalTime). Phase-at-onset is observed BETWEEN ticks in the harness;
 * the engine is never instrumented or mutated.
 */

import { LungModel } from '../js/lung-model.js';
import { Ventilator, MODE_PC_CSV } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';

// --- Constants mirrored from the real app ---
const APNEA_SECONDS = 20;   // alarms.js DEFAULT_ALARM_LIMITS.apneaSeconds
const SIM_SECONDS   = 60;   // fixed sim duration per scenario
const EFFORT_PMUS   = 8;    // strong, clearly supra-threshold effort.
                            // Chosen so drops are due to phase-gating, NOT a
                            // weak-effort threshold miss (that is a separate
                            // cause; using 8 isolates the line-352 mechanism).
const NEURAL_TI     = 1.0;  // app default (neural-ti slider 10 -> 1.0 s)

// main.js init() construction, mirrored verbatim (see js/main.js:73-96):
//   lung = LungModel.fromPreset('normal');
//   vent = new Ventilator(lung, { mode:'vc-cmv', flowPattern:'square',
//          holdTime:0, pMusMax:0, neuralTi:1.0, tidalVolume:0.500,
//          inspiratoryPressure:15, psPressure:10, cyclePercent:25,
//          respiratoryRate:14, ieRatio:[1,2], peep:5, fio2:0.40,
//          triggerType:'flow', flowTriggerLpm:2.0, pressureTriggerCmH2O:1.0 });
//   sim = new SimulationEngine(vent, { sampleRate:100, displaySeconds:10 });
// Patient effort is turned ON here via pMusMax (app: vent.pMusMax = slider),
// and patient rate via sim.patientRR (app: js/main.js:481-484 onPatientRRChange
// does `sim.patientRR = prr`).
function baseSettings(overrides = {}) {
    return {
        mode:                 'vc-cmv',
        flowPattern:          'square',
        holdTime:             0,
        pMusMax:              EFFORT_PMUS,
        neuralTi:             NEURAL_TI,
        tidalVolume:          0.500,
        inspiratoryPressure:  15,
        psPressure:           10,
        cyclePercent:         25,
        respiratoryRate:      14,
        ieRatio:              [1, 2],
        peep:                 5,
        fio2:                 0.40,
        triggerType:          'flow',
        flowTriggerLpm:       2.0,
        pressureTriggerCmH2O: 1.0,
        ...overrides,
    };
}

function runScenario({ preset = 'normal', ventOverrides = {}, patientRR }) {
    const lung = LungModel.fromPreset(preset);
    const vent = new Ventilator(lung, baseSettings(ventOverrides));
    const sim  = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
    sim.patientRR = patientRR;

    const dt    = sim.dt;
    const steps = Math.round(SIM_SECONDS / dt);

    let onsetExp      = 0;   // neural onsets while machine phase == EXPIRATION
    let onsetInspHold = 0;   // neural onsets while machine phase == INSPIRATION or HOLD
    let maxGap        = 0;   // worst (globalTime - lastBreathStartSec)
    let apneaEver     = false;

    for (let i = 0; i < steps; i++) {
        // _advanceNeural() runs FIRST inside tick() and reads this.phase before
        // any phase transition this tick, so the phase the line-352 gate sees is
        // exactly sim.phase as it stands right now (before tick()).
        const phaseBefore  = sim.phase;
        const neuralBefore = sim.neuralInspActive;

        sim.tick();

        const neuralAfter = sim.neuralInspActive;
        if (!neuralBefore && neuralAfter) {
            // A neural inspiration just began this tick.
            if (phaseBefore === 'EXPIRATION') onsetExp++;
            else onsetInspHold++;            // INSPIRATION or HOLD
        }

        // Apnea metric, mirrored from alarms.js:44-46,72:
        //   timeSinceLastBreath = nowSec - lastBreathStartSec; apnea if > 20 s.
        const gap = sim.globalTime - sim.lastBreathStartSec;
        if (gap > maxGap) maxGap = gap;
        if (gap > APNEA_SECONDS) apneaEver = true;
    }

    const initiated  = onsetExp + onsetInspHold;
    const triggered  = sim.patientBreathCount;       // patient breaths actually started
    const machine    = sim.machineBreathCount;
    const dropped    = initiated - triggered;
    const dropPct    = initiated > 0 ? (dropped / initiated) * 100 : 0;

    // Every INSP/HOLD onset is necessarily dropped: the line-352 gate never
    // latches pendingPatientTrigger unless phase == EXPIRATION, so those efforts
    // can never trigger in their neural cycle. All patient breaths therefore come
    // from EXPIRATION onsets => triggered <= onsetExp, and the INSP/HOLD onsets
    // are exactly the "phase-collision" share of the drops.
    const droppedInspHoldPct = dropped > 0 ? (onsetInspHold / dropped) * 100 : 0;

    const effectiveRate = triggered / (SIM_SECONDS / 60);  // patient breaths/min

    return {
        patientRR, initiated, triggered, machine, dropPct,
        onsetExp, onsetInspHold, droppedInspHoldPct,
        measuredRR: sim.measuredRR, effectiveRate, maxGap, apnea: apneaEver,
    };
}

function fmt(n, w, d = 1) {
    const s = (typeof n === 'number') ? n.toFixed(d) : String(n);
    return s.padStart(w);
}

function printTable(title, rows) {
    console.log(`\n=== ${title} ===`);
    console.log(
        'patRR | init | trig | mach | drop% | drop@INSP/HOLD% | onsetExp | onsetIH | measRR | effRR | maxGap | apnea?'
    );
    for (const r of rows) {
        console.log(
            [
                fmt(r.patientRR, 5, 0),
                fmt(r.initiated, 4, 0),
                fmt(r.triggered, 4, 0),
                fmt(r.machine, 4, 0),
                fmt(r.dropPct, 5, 0) + '%',
                fmt(r.droppedInspHoldPct, 14, 0) + '%',
                fmt(r.onsetExp, 8, 0),
                fmt(r.onsetInspHold, 7, 0),
                fmt(r.measuredRR, 6, 1),
                fmt(r.effectiveRate, 5, 1),
                fmt(r.maxGap, 6, 1),
                String(r.apnea).padStart(6),
            ].join(' | ')
        );
    }
}

function cliff(rows, threshold = 10) {
    const hit = rows.find((r) => r.dropPct > threshold);
    return hit ? hit.patientRR : null;
}

// --- Grids ---
const sweepA = [10, 14, 18, 20, 22, 24, 26, 28, 30, 34, 38, 42];
const sweepE = [10, 15, 20, 25, 30, 35];

const A = sweepA.map((rr) => runScenario({ patientRR: rr }));
const B = sweepA.map((rr) => runScenario({ ventOverrides: { ieRatio: [1, 1] }, patientRR: rr }));
const C = sweepA.map((rr) => runScenario({ ventOverrides: { holdTime: 0.5 }, patientRR: rr }));
const D = sweepA.map((rr) => runScenario({ ventOverrides: { mode: 'pc-cmv', inspiratoryPressure: 12 }, patientRR: rr }));
const E = sweepE.map((rr) => runScenario({ ventOverrides: { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25 }, patientRR: rr }));

console.log(`Sim: ${SIM_SECONDS}s @ dt=0.01s | effort pMusMax=${EFFORT_PMUS} cmH2O | neuralTi=${NEURAL_TI}s | preset=normal`);
console.log('Engine: real LungModel + Ventilator + SimulationEngine (no source edits).');

printTable('Grid A: VC-CMV, machine RR 14, I:E 1:2, no hold, flow trig 2.0', A);
printTable('Grid B: VC-CMV, machine RR 14, I:E 1:1, no hold', B);
printTable('Grid C: VC-CMV, machine RR 14, I:E 1:2, inspiratory hold 0.5s', C);
printTable('Grid D: PC-CMV, Pinsp 12, RR 14, I:E 1:2', D);
printTable('Grid E: PC-CSV, PS 10, cycle 25% (all breaths patient-triggered)', E);

console.log('\n=== Cliff points (lowest patientRR with drop% > 10%) ===');
console.log(`  A (I:E 1:2):        ${cliff(A) ?? 'none in sweep'}`);
console.log(`  B (I:E 1:1):        ${cliff(B) ?? 'none in sweep'}`);
console.log(`  C (hold 0.5s):      ${cliff(C) ?? 'none in sweep'}`);
console.log(`  D (PC-CMV):         ${cliff(D) ?? 'none in sweep'}`);

console.log('\n=== Grid E focus (SME-005/006): measured RR vs set patient RR ===');
for (const r of E) {
    console.log(
        `  set patientRR=${String(r.patientRR).padStart(2)} -> measuredRR=${r.measuredRR.toFixed(1)}  ` +
        `effectiveRR=${r.effectiveRate.toFixed(1)}  triggered=${r.triggered}/${r.initiated}  ` +
        `drop%=${r.dropPct.toFixed(0)}  maxGap=${r.maxGap.toFixed(1)}s  apnea=${r.apnea}`
    );
}

// --- Grid E PROBES: what reproduces SME-005's "set 35 -> displayed 6"? ---
// Default strong-effort PC-CSV above tracks 35 fine, so probe other plausible
// real-world configs the reviewer might have used.
console.log('\n=== Grid E probes @ patientRR=35 (hunting the 35->6 misread) ===');
const probes = [
    { label: 'baseline: pMus=8, neuralTi=1.0, flow trig 2.0',     ov: {} },
    { label: 'WEAK effort: pMus=2 (UI default), flow trig 2.0',   ov: { pMusMax: 2 } },
    { label: 'WEAK effort: pMus=1, flow trig 2.0',                ov: { pMusMax: 1 } },
    { label: 'neuralTi=2.0 (UI max) collides w/ 1.71s period',    ov: { neuralTi: 2.0 } },
    { label: 'pressure trigger 1.0, pMus=8',                      ov: { triggerType: 'pressure', pressureTriggerCmH2O: 1.0 } },
    { label: 'pressure trigger 1.0, WEAK pMus=2',                 ov: { triggerType: 'pressure', pressureTriggerCmH2O: 1.0, pMusMax: 2 } },
    { label: 'pressure trigger 5.0 (hard), pMus=8',               ov: { triggerType: 'pressure', pressureTriggerCmH2O: 5.0 } },
];
for (const p of probes) {
    const r = runScenario({
        ventOverrides: { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25, ...p.ov },
        patientRR: 35,
    });
    console.log(
        `  measRR=${r.measuredRR.toFixed(1).padStart(5)}  effRR=${r.effectiveRate.toFixed(1).padStart(5)}  ` +
        `trig=${String(r.triggered).padStart(3)}/${String(r.initiated).padStart(2)}  ` +
        `apnea=${String(r.apnea).padStart(5)}  maxGap=${r.maxGap.toFixed(1).padStart(5)}s  | ${p.label}`
    );
}

// If a probe sags, sweep it across patientRR to see if "displayed ~6" emerges.
console.log('\n=== Grid E probe sweep: neuralTi=2.0, pMus=8, flow trig 2.0 ===');
for (const rr of [10, 15, 20, 25, 30, 35]) {
    const r = runScenario({ ventOverrides: { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25, neuralTi: 2.0 }, patientRR: rr });
    console.log(`  set ${String(rr).padStart(2)} -> measRR=${r.measuredRR.toFixed(1).padStart(5)}  effRR=${r.effectiveRate.toFixed(1).padStart(5)}  trig=${r.triggered}/${r.initiated}  apnea=${r.apnea}`);
}

console.log('\n=== Grid E probe sweep: WEAK pMus=2, neuralTi=1.0, flow trig 2.0 ===');
for (const rr of [10, 15, 20, 25, 30, 35]) {
    const r = runScenario({ ventOverrides: { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25, pMusMax: 2 }, patientRR: rr });
    console.log(`  set ${String(rr).padStart(2)} -> measRR=${r.measuredRR.toFixed(1).padStart(5)}  effRR=${r.effectiveRate.toFixed(1).padStart(5)}  trig=${r.triggered}/${r.initiated}  apnea=${r.apnea}`);
}

// Gradient: how trigger insensitivity drives the PC-CSV measured-RR collapse
// toward the SME-005 "single-digit RR + apnea" profile (set 35).
console.log('\n=== Grid E probe: pressure-trigger threshold sweep @ patientRR=35, pMus=8 ===');
for (const pt of [1.0, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0]) {
    const r = runScenario({
        ventOverrides: { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25, triggerType: 'pressure', pressureTriggerCmH2O: pt },
        patientRR: 35,
    });
    console.log(`  Ptrig=${pt.toFixed(1)} -> measRR=${r.measuredRR.toFixed(1).padStart(5)}  trig=${String(r.triggered).padStart(3)}/${r.initiated}  apnea=${String(r.apnea).padStart(5)}  maxGap=${r.maxGap.toFixed(1).padStart(5)}s`);
}
