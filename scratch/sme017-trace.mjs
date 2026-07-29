// READ-ONLY diagnostic harness for SME-017 (false APNEA / LOW-VE on VC->PC switch).
// Does NOT modify any engine source. Run: node scratch/sme017-trace.mjs
//
// It drives the REAL engine (SimulationEngine) and the REAL AlarmEngine.
// The ONLY thing we vary is `nowSec`, to model the two getAlarmNowSec() regimes:
//   NEW (current main, post PR #13): nowSec = performance.now()/1000  -> modeled by wallSec
//   OLD (pre PR #13):                nowSec = sim.globalTime
// wallSec advances 1:1 with sim time at speed 1 (no pause) UNTIL sim.reset(),
// which zeroes sim.globalTime but NOT the wall clock -- exactly like the browser.

import { LungModel } from '../js/lung-model.js';
import { Ventilator } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';
import AlarmEngine from '../alarms.js';

const dt = 0.01; // sampleRate 100

// Mirror getCurrentAlarmMetrics(): build the metrics object the alarm engine sees.
function buildMetrics(sim, nowSec) {
  const measuredRR = sim.measuredRR ?? 0;
  const vtL = (sim.measuredVT_mL ?? 0) / 1000;
  const minuteVentilationLpm =
    Number.isFinite(measuredRR) && vtL > 0 ? Math.round(vtL * measuredRR * 10) / 10 : 0;
  return {
    nowSec,
    elapsedSec: nowSec,                       // production sets elapsedSec: nowSec
    lastBreathStartSec: sim.lastBreathStartSec,
    pawCmH2O: sim.currentPressure,
    measuredRR,
    minuteVentilationLpm,
  };
}

const fired = (sim, nowSec, id) =>
  AlarmEngine.evaluateAlarms(buildMetrics(sim, nowSec)).some(a => a.id === id);

// --- Build VC-CMV, RR 14, passive patient; run to steady state ---
const lung = new LungModel({ resistance: 10, compliance: 0.05 });
const vent = new Ventilator(lung, {
  mode: 'vc-cmv', flowPattern: 'square', tidalVolume: 0.5,
  respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});
const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });

let wallSec = 0; // models performance.now()/1000 at speed 1
const PRE_SECONDS = 60;
for (let i = 0; i < PRE_SECONDS / dt; i++) { sim.tick(); wallSec += dt; }

const m0 = buildMetrics(sim, wallSec);
console.log('=== PRE-SWITCH: steady-state VC-CMV, RR 14 (no apnea, no low-VE expected) ===');
console.log(`globalTime=${sim.globalTime.toFixed(2)}  wallSec=${wallSec.toFixed(2)}  lastBreathStartSec=${sim.lastBreathStartSec.toFixed(2)}  measuredRR=${sim.measuredRR.toFixed(1)}  VE=${m0.minuteVentilationLpm}`);
console.log(`  APNEA  new(wall)=${fired(sim, wallSec, 'APNEA')}   old(sim)=${fired(sim, sim.globalTime, 'APNEA')}`);
console.log(`  LOW_VE new(wall)=${fired(sim, wallSec, 'LOW_VE')}   old(sim)=${fired(sim, sim.globalTime, 'LOW_VE')}`);

// --- Mode switch VC -> PC, exactly as the UI does (main.js:279): set mode, then reset ---
vent.mode = 'pc-cmv';
vent.inspiratoryPressure = 15;
sim.reset();

console.log('\n=== POST-SWITCH (VC->PC + sim.reset()) — 60 frames @0.2s ===');
console.log('  frame  gTime  wallSec  lastBr  tSince(new)  measRR    VE | APNEA_new LOWVE_new | APNEA_old LOWVE_old');
for (let f = 1; f <= 60; f++) {
  for (let k = 0; k < 20; k++) { sim.tick(); wallSec += dt; } // 0.2s/frame
  const lb = sim.lastBreathStartSec;
  const tSinceNew = Math.max(0, wallSec - lb);
  const mm = buildMetrics(sim, wallSec);
  const row = [
    String(f).padStart(5),
    sim.globalTime.toFixed(2).padStart(6),
    wallSec.toFixed(2).padStart(7),
    lb.toFixed(2).padStart(6),
    tSinceNew.toFixed(2).padStart(10),
    sim.measuredRR.toFixed(1).padStart(6),
    String(mm.minuteVentilationLpm).padStart(5),
    String(fired(sim, wallSec, 'APNEA')).padStart(8),
    String(fired(sim, wallSec, 'LOW_VE')).padStart(9),
    String(fired(sim, sim.globalTime, 'APNEA')).padStart(8),
    String(fired(sim, sim.globalTime, 'LOW_VE')).padStart(9),
  ];
  console.log('  ' + row.join(' '));
}
