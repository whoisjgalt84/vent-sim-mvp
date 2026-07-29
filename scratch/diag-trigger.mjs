/**
 * READ-ONLY diagnostic harness — drives the REAL engine at the user's exact
 * settings and captures, per tick, the rendered flow (what the trace plots) vs.
 * the trigger-evaluated flow (what gate-c compares to 2.0 L/min).
 *
 * Modifies nothing. Imports the unmodified engine modules.
 */

import { LungModel } from '../js/lung-model.js';
import { Ventilator, MODE_VC_CMV } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';

// ---- EXACT user-confirmed settings ----------------------------------------
const lung = new LungModel({ resistance: 10, compliance: 0.060 });  // Normal lung
const vent = new Ventilator(lung, {
    mode:            MODE_VC_CMV,
    flowPattern:     'square',
    tidalVolume:     0.500,     // VT 500 mL
    respiratoryRate: 14,        // RR 14
    ieRatio:         [1, 2],    // I:E 1:2
    peep:            5,         // PEEP 5
    fio2:            0.40,      // FiO2 40%
    triggerType:     'flow',
    flowTriggerLpm:  2.0,       // FLOW TRIGGER 2.0 L/min
    pMusMax:         2,         // pMus 2
    neuralTi:        1.0,       // T_neural default (slider 10 / 10)
});

const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 12 });
sim.patientRR = 25;             // patient RR 25

const R = lung.resistance, C = lung.compliance;

// ---- Per-tick capture ------------------------------------------------------
// Wrap _evaluatePatientTrigger: it runs EVERY tick, AFTER _computePhysics and
// BEFORE clocks advance — i.e. exactly the state gate-c sees. We snapshot there,
// then call the original untouched. Pure observation, no behavior change.
const log = [];
const origEval = sim._evaluatePatientTrigger.bind(sim);
sim._evaluatePatientTrigger = function () {
    const pmus = this.currentPmus;
    const renderedLpm = this.currentFlow * 60;             // what the trace plots (signed)
    const triggerLpm  = Math.max(0, this.currentFlow * 60); // what gate-c tests
    const elasticRecoil = this.volumeAboveEq / C;
    const before = this.scheduledBreathTrigger;
    origEval();                                             // unmodified trigger logic
    const fired = this.scheduledBreathTrigger === 'patient' && before !== 'patient';
    log.push({
        idx: this._sampleCount,
        t: this.globalTime,
        phase: this.phase,
        phaseTime: this.phaseTime,
        neuralActive: this.neuralInspActive,
        neuralTimer: this.neuralTimer,
        pmus,
        elasticRecoil,
        pressureDeflection: Math.max(0, pmus - elasticRecoil),
        renderedLpm,                                        // currentFlow*60  (trace)
        triggerLpm,                                         // max(0,currentFlow*60) (gate-c)
        passiveLpm: renderedLpm - (pmus / R) * 60,          // flow if pMus were 0 (same V)
        effortDeltaLpm: (pmus / R) * 60,                    // lift the effort adds
        ventAvail: this.phase === 'EXPIRATION',
        pastRefractory: this.phaseTime > this.triggerLockoutSeconds,
        fired,
    });
};

// ---- Run 30 s of simulation (steady state + many neural cycles) ------------
const SECONDS = 30;
for (let i = 0; i < SECONDS * 100; i++) sim.tick();

// ---- Report 0: derived timing ---------------------------------------------
const Ttot = vent.totalCycleTime, Ti = vent.inspiratoryTime, Te = vent.expiratoryTime;
const peakExpNoEffort = -(vent.tidalVolume / C) / R * 60; // at V=VT, pMus=0
console.log('================ DERIVED TIMING / PHYSICS ================');
console.log(`Ttot=${Ttot.toFixed(3)}s  Ti=${Ti.toFixed(3)}s  Te=${Te.toFixed(3)}s  tau=RC=${(R*C).toFixed(3)}s`);
console.log(`Square insp flow = VT/Ti = ${(vent.inspiratoryFlow*60).toFixed(1)} L/min`);
console.log(`Neural cycle = 60/${sim.patientRR} = ${(60/sim.patientRR).toFixed(3)}s   neuralTi=${vent.neuralTi}s   pMusMax=${vent.pMusMax}`);
console.log(`Peak passive EXP flow at V=VT (pMus=0) = -(VT/C)/R = ${peakExpNoEffort.toFixed(1)} L/min`);
console.log(`Effort lift at peak pMus = (pMusMax/R)*60 = ${(vent.pMusMax/R*60).toFixed(1)} L/min`);
console.log(`Flow needed to cross 0 (V/C < pMus): V < pMus*C = ${(vent.pMusMax*C*1000).toFixed(0)} mL above PEEP`);

// ---- Report 1: all trigger events -----------------------------------------
console.log('\n================ TRIGGER EVENTS (30 s) ================');
for (const ev of sim.triggerEvents) {
    const extra = ev.gateFailed ? `  gateFailed=${ev.gateFailed}  phase=${ev.phase}  pmus=${ev.pmus?.toFixed(3)}` : '';
    console.log(`  t=${ev.time.toFixed(3)}s  type=${ev.type}${extra}`);
}
const failedThresh = sim.triggerEvents.filter(e => e.type === 'failed' && e.gateFailed === 'threshold' && e.phase === 'EXPIRATION');
const patientFires = sim.triggerEvents.filter(e => e.type === 'patient');
console.log(`\nineffective (threshold/EXPIRATION) efforts: ${failedThresh.length}   patient-triggered breaths: ${patientFires.length}`);

// ---- Report 2: per-tick table around ONE ineffective effort ----------------
// Pick a steady-state ineffective effort (skip the first to avoid startup).
const target = failedThresh[Math.min(2, failedThresh.length - 1)];
if (!target) { console.log('\nNo ineffective (threshold) effort captured.'); process.exit(0); }

const evT = target.time;
const neuralCyc = 60 / sim.patientRR;
// neural inspiration spanned roughly [evT - neuralTi, evT]; widen a bit each side.
const tLo = evT - vent.neuralTi - 0.10;
const tHi = evT + 0.10;
const rows = log.filter(r => r.t >= tLo && r.t <= tHi);

console.log(`\n================ PER-TICK, ONE INEFFECTIVE EFFORT (event @ t=${evT.toFixed(3)}s) ================`);
console.log('Legend: rendered = currentFlow*60 (TRACE) | trigger = max(0,currentFlow*60) (GATE-C vs 2.0)');
console.log('        passive = flow if pMus=0 (same V) | delta = effort lift = (pMus/R)*60\n');
const H = [
  't(s)'.padStart(7), 'phase'.padStart(5), 'pT(s)'.padStart(6), 'nA'.padStart(3),
  'pMus'.padStart(6), 'V/C'.padStart(6), 'rendered'.padStart(9), 'passive'.padStart(8),
  'delta'.padStart(7), 'TRIGGER'.padStart(8), '≥2.0?'.padStart(6), 'fire'.padStart(5),
];
console.log(H.join(' '));
console.log('-'.repeat(H.join(' ').length));
for (const r of rows) {
    const cells = [
      r.t.toFixed(3).padStart(7),
      (r.phase === 'EXPIRATION' ? 'EXP' : r.phase === 'INSPIRATION' ? 'INSP' : 'HOLD').padStart(5),
      r.phaseTime.toFixed(3).padStart(6),
      (r.neuralActive ? 'Y' : '.').padStart(3),
      r.pmus.toFixed(3).padStart(6),
      r.elasticRecoil.toFixed(2).padStart(6),
      r.renderedLpm.toFixed(2).padStart(9),
      r.passiveLpm.toFixed(2).padStart(8),
      r.effortDeltaLpm.toFixed(2).padStart(7),
      r.triggerLpm.toFixed(3).padStart(8),
      (r.triggerLpm >= vent.flowTriggerLpm ? 'YES' : 'no').padStart(6),
      (r.fired ? 'FIRE' : '.').padStart(5),
    ];
    console.log(cells.join(' '));
}

// ---- Report 3: rendered deflection span (the "-20 -> 0" swing) -------------
// Faithful re-implementation of WaveformDisplay._deflectionSpan / _deriveFailedEffortSegments
// (waveforms.js:889-940): find the bend the trace shows for this failed effort.
const time = sim.buffers.time.toArray();
const flow = sim.buffers.flow.toArray();
const win = Math.max(0.3, vent.neuralTi || 1.0);
function deflectionSpan(time, flow, eventTime, win) {
    const n = time.length; if (n < 3) return null;
    let lo = 0, hi = 0, haveLo = false;
    for (let i = 0; i < n; i++) {
        if (time[i] >= eventTime - win && !haveLo) { lo = i; haveLo = true; }
        if (time[i] <= eventTime + 1e-9) hi = i;
    }
    if (!haveLo || hi - lo < 2) return null;
    let peak = lo;
    for (let i = lo; i <= hi; i++) if (flow[i] > flow[peak]) peak = i;
    let a = peak; while (a > lo && flow[a - 1] <= flow[a]) a--;
    let b = peak; while (b < hi && flow[b + 1] <= flow[b]) b++;
    if (b - a < 1) return null;
    return { a, b, peak };
}
const span = deflectionSpan(time, flow, evT, win);
console.log('\n================ RENDERED DEFLECTION (what the eye reads as "-20 -> 0") ================');
if (span) {
    const troughL = flow[span.a], crest = flow[span.peak], troughR = flow[span.b];
    console.log(`highlighted span: t=[${time[span.a].toFixed(3)} .. ${time[span.b].toFixed(3)}]s`);
    console.log(`left trough  = ${troughL.toFixed(2)} L/min   (rendered/trace)`);
    console.log(`crest (least-negative) = ${crest.toFixed(2)} L/min   (rendered/trace)`);
    console.log(`right trough = ${troughR.toFixed(2)} L/min   (rendered/trace)`);
    console.log(`VISIBLE SWING (crest - left trough) = ${(crest - troughL).toFixed(2)} L/min`);
    console.log(`max trigger-flow over this span = ${Math.max(...flow.slice(span.a, span.b + 1).map(f => Math.max(0, f))).toFixed(3)} L/min  (vs threshold 2.0)`);
} else {
    console.log('no deflection span found');
}

// ---- Report 4: peak trigger-flow over the WHOLE neural inspiration ----------
const effRows = log.filter(r => r.t >= evT - vent.neuralTi - 1e-9 && r.t <= evT + 1e-9 && r.neuralActive);
const maxTrig = effRows.reduce((m, r) => Math.max(m, r.triggerLpm), 0);
const maxRendMag = effRows.reduce((m, r) => Math.max(m, Math.abs(r.renderedLpm)), 0);
const maxPmus = effRows.reduce((m, r) => Math.max(m, r.pmus), 0);
const minVC = effRows.reduce((m, r) => Math.min(m, r.elasticRecoil), Infinity);
console.log('\n================ EFFORT SUMMARY ================');
console.log(`over the neural inspiration: max pMus=${maxPmus.toFixed(3)} cmH2O  min V/C=${minVC.toFixed(2)} cmH2O`);
console.log(`max |rendered flow| = ${maxRendMag.toFixed(2)} L/min   max trigger-flow = ${maxTrig.toFixed(3)} L/min   threshold=2.0`);
console.log(`=> trigger-flow ${maxTrig >= 2.0 ? 'REACHES' : 'NEVER REACHES'} 2.0  (flow ${maxTrig > 0 ? 'crossed into inspiratory' : 'stayed expiratory/zero'})`);
