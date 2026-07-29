// READ-ONLY diagnostic harness for SME-009 (PC-CSV inspiratory hold "will not release").
// Does NOT modify any engine source. Run: node scratch/sme009-hold-trace.mjs
//
// Drives the REAL engine (Ventilator + SimulationEngine) at the user's EXACT
// reported settings, plus a faithful re-implementation of the UI hold-toggle
// branch logic from js/main.js bindHoldToggle() (lines 387-405) — the toggle is
// pure JS that reads vent.holdActive, so we can exercise it without a DOM.
//
// Goals:
//   A) Show the engine NEVER enters Phase.HOLD in PC-CSV (effectiveHoldTime==0),
//      so the *breath/waveform* is not stuck — it cycles INSP->EXP normally.
//   B) Show the UI toggle latches: in PC-CSV "Release" can never turn the hold
//      off, because it keys off vent.holdActive which is forced false.
//   C) Contrast with PC-CMV, where holdActive flips true, the breath DOES enter
//      HOLD and releases after holdTime, and the toggle releases correctly.

import { LungModel } from '../js/lung-model.js';
import { Ventilator } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';

const dt = 0.01; // sampleRate 100

// User's exact reported PC-CSV settings.
function buildPcCsv() {
  const lung = LungModel.fromPreset('normal');
  const vent = new Ventilator(lung, {
    mode: 'PC-CSV',
    psPressure: 10,        // Pressure Support 10 cmH2O
    cyclePercent: 25,      // cycle 25%
    ieRatio: [1, 2],       // I:E 1:2 (sets max-Ti backstop)
    peep: 5,
    fio2: 0.40,
    triggerType: 'flow',
    flowTriggerLpm: 2.0,   // flow trigger 2.0 L/min
    holdTime: 0.5,         // Inspiratory Hold 0.5 s  <-- the maneuver under test
    pMusMax: 2,            // pMus 2 cmH2O
    neuralTi: 1.0,
  });
  const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
  sim.patientRR = 16;      // patient RR 16
  return { lung, vent, sim };
}

function buildPcCmv() {
  const lung = LungModel.fromPreset('normal');
  const vent = new Ventilator(lung, {
    mode: 'pc-cmv',
    inspiratoryPressure: 10,
    respiratoryRate: 16,
    ieRatio: [1, 2],
    peep: 5,
    fio2: 0.40,
    triggerType: 'flow',
    flowTriggerLpm: 2.0,
    holdTime: 0.5,
    pMusMax: 0,
    neuralTi: 1.0,
  });
  const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
  return { lung, vent, sim };
}

// Faithful copy of the BRANCH SELECTION in js/main.js bindHoldToggle (387-405).
// The only state that decides "am I currently on?" is vent.holdActive.
function uiHoldToggleClick(vent, sliderDur = 0.5) {
  if (vent.holdActive) {
    vent.holdTime = 0;          // -> button label "Activate", panel hidden
    return 'Activate';
  } else {
    vent.holdTime = sliderDur;  // -> button label "Release", panel shown
    return 'Release';
  }
}

function runHoldEngineTrace(label, build) {
  const { vent, sim } = build();
  console.log(`\n=== ${label}: engine phase trace (holdTime set to ${vent.holdTime}s) ===`);
  console.log(`  effectiveHoldTime=${vent.effectiveHoldTime}   holdActive=${vent.holdActive}   isSpontaneous=${vent.isSpontaneousMode()}`);

  const phaseCounts = {};
  let firstHoldFrame = null;
  let holdReleaseFrame = null;
  let inHold = false;
  const totalTicks = Math.round(20 / dt); // 20 s

  for (let i = 0; i < totalTicks; i++) {
    sim.tick();
    const ph = sim.phase;
    phaseCounts[ph] = (phaseCounts[ph] ?? 0) + 1;
    if (ph === 'HOLD' && !inHold) { inHold = true; if (firstHoldFrame === null) firstHoldFrame = i; }
    if (ph !== 'HOLD' && inHold) { inHold = false; if (holdReleaseFrame === null) holdReleaseFrame = i; }
  }

  console.log(`  phase tick counts over 20s: ${JSON.stringify(phaseCounts)}`);
  console.log(`  breaths=${sim.breathCount}  (machine=${sim.machineBreathCount} patient=${sim.patientBreathCount})`);
  if (firstHoldFrame === null) {
    console.log(`  --> HOLD phase NEVER entered. Hold maneuver had no effect on the breath.`);
  } else {
    const dur = (holdReleaseFrame - firstHoldFrame) * dt;
    console.log(`  --> HOLD entered at frame ${firstHoldFrame}, released at frame ${holdReleaseFrame} (~${dur.toFixed(2)}s in hold). Releases normally.`);
  }
}

// Micro-trace: show a single inspiration->? boundary frame-by-frame so we can see
// whether the phase ever becomes HOLD at end-inspiration in each mode.
function microTrace(label, build) {
  const { vent, sim } = build();
  console.log(`\n--- ${label}: frame-by-frame around end of an inspiration ---`);
  let printed = 0, sawInsp = false;
  for (let i = 0; i < Math.round(20 / dt) && printed < 14; i++) {
    sim.tick();
    if (sim.phase === 'INSPIRATION') sawInsp = true;
    // Start printing once we've seen an inspiration and are near its end.
    if (sawInsp && (sim.phase === 'INSPIRATION' || sim.phase === 'HOLD' || printed > 0)) {
      if (sim.phase === 'INSPIRATION' && sim.phaseTime < 0.30) continue; // skip early insp
      console.log(`   t=${sim.globalTime.toFixed(2)} phase=${sim.phase.padEnd(11)} phaseTime=${sim.phaseTime.toFixed(2)} flow=${(sim.currentFlow*60).toFixed(1)}Lpm peakInsp=${(sim.peakInspiratoryFlow*60).toFixed(1)}`);
      printed++;
      if (sim.phase === 'EXPIRATION' && printed > 4) break;
    }
  }
}

function runUiToggleTrace(label, build) {
  const { vent } = build();
  vent.holdTime = 0; // start with hold OFF (as app boots)
  console.log(`\n=== ${label}: UI hold-toggle latch test (mirrors main.js bindHoldToggle) ===`);
  console.log(`  start: holdTime=${vent.holdTime} holdActive=${vent.holdActive}`);
  for (let click = 1; click <= 4; click++) {
    const label = uiHoldToggleClick(vent, 0.5);
    console.log(`  click ${click}: button now shows "${label}"  -> holdTime=${vent.holdTime}  holdActive=${vent.holdActive}`);
  }
  console.log(`  (Click 1 = Activate, Click 2 should = Release/OFF. If button never returns to "Activate", it is latched.)`);
}

console.log('################ SME-009: PC-CSV inspiratory hold "will not release" ################');

runHoldEngineTrace('PC-CSV (user settings)', buildPcCsv);
runHoldEngineTrace('PC-CMV (contrast)', buildPcCmv);

microTrace('PC-CSV (user settings)', buildPcCsv);
microTrace('PC-CMV (contrast)', buildPcCmv);

runUiToggleTrace('PC-CSV (user settings)', buildPcCsv);
runUiToggleTrace('PC-CMV (contrast)', buildPcCmv);
