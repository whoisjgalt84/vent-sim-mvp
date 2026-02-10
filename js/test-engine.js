/**
 * ============================================================================
 * test-engine.js — Validation Harness for Lung Model + Ventilator Engine
 * ============================================================================
 *
 * Run with:   node test-engine.js
 *
 * This validates our engine output against hand-calculable values.
 * If you can do the math on paper and get the same numbers, the engine
 * is faithful to the equation of motion.
 *
 * ============================================================================
 */

import { LungModel } from './lung-model.js';
import { Ventilator } from './ventilator.js';

let passed = 0;
let failed = 0;

function assert(label, actual, expected, tolerance = 0.01) {
    const diff = Math.abs(actual - expected);
    const ok = diff <= tolerance * Math.abs(expected) || diff < 0.01;
    if (ok) {
        console.log(`  ✓ ${label}: ${typeof actual === 'number' ? actual.toFixed(3) : actual}`);
        passed++;
    } else {
        console.log(`  ✗ ${label}: got ${actual.toFixed(3)}, expected ${expected.toFixed(3)}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${title}`);
    console.log(`${'═'.repeat(60)}`);
}

// =============================================================================
// TEST 1: Lung Model — Normal Lung
// =============================================================================
section('TEST 1: LungModel — Normal Lung (R=10, C=0.05)');

const normalLung = new LungModel({ resistance: 10, compliance: 0.05 });

// τ = R × C = 10 × 0.05 = 0.5 s
assert('Time constant (s)', normalLung.timeConstant, 0.5);

// E = 1/C = 1/0.05 = 20 cmH2O/L
assert('Elastance (cmH2O/L)', normalLung.elastance, 20);

// Inspiratory pressure: V=0.5L, V̇=0.35 L/s, PEEP=5
// P = 5 + 10×0.35 + 0.5/0.05 = 5 + 3.5 + 10 = 18.5
assert('Insp pressure at end-insp',
    normalLung.inspiratoryPressure(0.5, 0.35, 5, 0), 18.5);

// Plateau: P = 5 + 0.5/0.05 = 5 + 10 = 15
assert('Plateau pressure',
    normalLung.plateauPressure(0.5, 5, 0), 15.0);

// Expiratory flow at t=0: V̇ = -(10/10) × e^0 = -1.0 L/s
// (with vStartExp=0.5, ΔP = 0.5/0.05 = 10)
assert('Exp flow at t=0 (L/s)',
    normalLung.expiratoryFlow(0.5, 0), -1.0);

// Expiratory flow at t=τ: V̇ = -1.0 × e^(-1) = -0.368
assert('Exp flow at t=τ (L/s)',
    normalLung.expiratoryFlow(0.5, 0.5), -1.0 * Math.exp(-1));

// Volume remaining at t=τ: V = 0.5 × e^(-1) = 0.184 L
assert('Volume remaining at t=τ (L)',
    normalLung.expiratoryVolumeRemaining(0.5, 0.5), 0.5 * Math.exp(-1));

// Auto-PEEP with Te=2.86s, VT=0.5L:
// e^(-2.86/0.5) = e^(-5.72) ≈ 0.00327
// V_trapped = 0.5 × 0.00327 / (1-0.00327) = 0.00164 L
// autoPEEP = 0.00164 / 0.05 = 0.033 cmH2O (essentially zero)
assert('Auto-PEEP normal (cmH2O)',
    normalLung.steadyStateAutoPeep(0.5, 2.86), 0.033, 0.2);


// =============================================================================
// TEST 2: Lung Model — COPD (High Resistance, Gas Trapping)
// =============================================================================
section('TEST 2: LungModel — COPD (R=25, C=0.06)');

const copdLung = new LungModel({ resistance: 25, compliance: 0.06 });

// τ = 25 × 0.06 = 1.5 s
assert('Time constant (s)', copdLung.timeConstant, 1.5);

// Auto-PEEP with Te=2.86s, VT=0.5L:
// e^(-2.86/1.5) = e^(-1.907) ≈ 0.1484
// V_trapped = 0.5 × 0.1484 / (1 - 0.1484) = 0.0742 / 0.8516 = 0.0871 L
// autoPEEP = 0.0871 / 0.06 = 1.45 cmH2O
const copdAutoP = copdLung.steadyStateAutoPeep(0.5, 2.86);
assert('Auto-PEEP COPD (cmH2O)', copdAutoP, 1.45, 0.05);

console.log(`  → Clinical note: Te/τ = ${(2.86/1.5).toFixed(1)} (< 3 → gas trapping!)`);


// =============================================================================
// TEST 3: Lung Model — ARDS (Low Compliance)
// =============================================================================
section('TEST 3: LungModel — ARDS (R=10, C=0.03)');

const ardsLung = new LungModel({ resistance: 10, compliance: 0.03 });

// τ = 10 × 0.03 = 0.3 s
assert('Time constant (s)', ardsLung.timeConstant, 0.3);

// Very short τ → Te/τ will be very large → no gas trapping
// But: VT/C = 0.5/0.03 = 16.7 cmH2O driving pressure (high!)
// Pplat = 5 + 16.7 = 21.7
assert('Driving pressure (cmH2O)', 0.5 / 0.03, 16.67, 0.01);
assert('Plateau pressure (cmH2O)',
    ardsLung.plateauPressure(0.5, 5, 0), 21.67, 0.01);

console.log('  → Clinical note: Driving pressure 16.7 cmH2O > 15 — consider ↓VT');


// =============================================================================
// TEST 4: Ventilator — Normal Patient, Standard Settings
// =============================================================================
section('TEST 4: Ventilator — Normal (R=10, C=0.05), VT=500, RR=14, I:E=1:2');

const ventNormal = new Ventilator(normalLung, {
    tidalVolume: 0.500,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
    fio2: 0.40,
});

// TCT = 60/14 = 4.286 s
assert('Total cycle time (s)', ventNormal.totalCycleTime, 4.286, 0.01);

// Ti = 4.286 × 1/3 = 1.429 s
assert('Inspiratory time (s)', ventNormal.inspiratoryTime, 1.429, 0.01);

// Te = 4.286 × 2/3 = 2.857 s
assert('Expiratory time (s)', ventNormal.expiratoryTime, 2.857, 0.01);

// V̇ = 0.5 / 1.429 = 0.350 L/s = 21.0 L/min
assert('Insp flow (L/min)', ventNormal.inspiratoryFlowLpm, 21.0, 0.02);

// PIP = 5 + ~0 + 10×0.35 + 0.5/0.05 = 5 + 3.5 + 10 = 18.5
assert('PIP (cmH2O)', ventNormal.pip, 18.5, 0.02);

// Pplat = 5 + 0 + 10 = 15.0
assert('Pplat (cmH2O)', ventNormal.pplat, 15.0, 0.02);

// Driving pressure = VT/C = 10.0
assert('Driving pressure (cmH2O)', ventNormal.drivingPressure, 10.0);

// Resistive pressure = R × V̇ = 10 × 0.35 = 3.5
assert('Resistive pressure (cmH2O)', ventNormal.resistivePressure, 3.5, 0.02);

// Te/τ = 2.857/0.5 = 5.71 → no gas trapping
assert('Te/τ', ventNormal.teOverTau, 5.71, 0.02);
assert('Gas trapping risk', ventNormal.gasTrappingRisk ? 1 : 0, 0);

// V̇E = 0.5 × 14 = 7.0 L/min
assert('Minute ventilation (L/min)', ventNormal.minuteVentilation, 7.0);


// =============================================================================
// TEST 5: Ventilator — COPD Patient (Gas Trapping Expected)
// =============================================================================
section('TEST 5: Ventilator — COPD (R=25, C=0.06), VT=500, RR=14, I:E=1:2');

const ventCOPD = new Ventilator(copdLung, {
    tidalVolume: 0.500,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

assert('Time constant (s)', copdLung.timeConstant, 1.5);
assert('Te/τ', ventCOPD.teOverTau, 1.90, 0.02);
assert('Gas trapping risk', ventCOPD.gasTrappingRisk ? 1 : 0, 1);
assert('Auto-PEEP (cmH2O)', ventCOPD.autoPeep, 1.45, 0.1);

// PIP = 5 + 1.45 + 25×0.35 + 0.5/0.06
//     = 5 + 1.45 + 8.75 + 8.33 = 23.53
assert('PIP (cmH2O)', ventCOPD.pip, 23.5, 0.02);

console.log(`  → Clinical note: Te/τ = ${ventCOPD.teOverTau.toFixed(1)} — consider ↓RR or ↑I:E`);


// =============================================================================
// TEST 6: Waveform Integrity
// =============================================================================
section('TEST 6: Waveform Data Integrity');

const waveforms = ventNormal.generateBreathWaveforms(2);

// Check array lengths are equal
const len = waveforms.time.length;
assert('All arrays same length',
    waveforms.pressure.length === len &&
    waveforms.volume.length === len &&
    waveforms.flow.length === len ? 1 : 0, 1);

console.log(`  Total samples: ${len} (${(len / ventNormal.sampleRate).toFixed(1)} seconds)`);

// Check that first breath starts near PEEP + R×V̇
// P(t=0) = PEEP + autoPEEP + R×V̇ + 0/C = 5 + ~0 + 3.5 = 8.5
assert('First pressure sample (cmH2O)', waveforms.pressure[0], 8.5, 0.02);

// First flow should be inspiratory: ~21 L/min
assert('First flow sample (L/min)', waveforms.flow[0], 21.0, 0.02);

// First volume should be ~0 mL
assert('First volume sample (mL)', waveforms.volume[0], 0, 0.1);

// Check that pressure peaks near PIP within each breath
const pip = Math.max(...waveforms.pressure);
assert('Peak pressure in waveform (cmH2O)', pip, ventNormal.pip, 0.02);

// Check that volume peaks near VT (500 mL)
const maxVol = Math.max(...waveforms.volume);
assert('Peak volume in waveform (mL)', maxVol, 500, 0.05);

// Check that expiratory flow is negative
const minFlow = Math.min(...waveforms.flow);
assert('Min flow is negative', minFlow < 0 ? 1 : 0, 1);

// Check that volume returns near 0 at end of each breath (steady state)
// Tolerance: 0.05 mL absolute — well within clinical insignificance
const lastIdx = len - 1;
assert('Volume at end of last breath (mL)',
    Math.abs(waveforms.volume[lastIdx]) < 0.05 ? 1 : 0, 1);


// =============================================================================
// TEST 7: MAP Calculation
// =============================================================================
section('TEST 7: Mean Airway Pressure');

const mapNormal = ventNormal.calculateMAP();
// MAP for VC with square flow is approximately:
//   MAP ≈ PEEP + 0.5 × (PIP - PEEP) × (Ti/TCT)   (rough approximation)
// More accurate: integrate the actual waveform (which our code does)
// Expected: between PEEP (5) and PIP (18.5), weighted toward PEEP
// because expiration occupies 2/3 of the breath.
console.log(`  MAP = ${mapNormal.toFixed(1)} cmH2O`);
assert('MAP between PEEP and PIP', (mapNormal > 5 && mapNormal < 18.5) ? 1 : 0, 1);
assert('MAP in clinical range', (mapNormal > 7 && mapNormal < 13) ? 1 : 0, 1);


// =============================================================================
// TEST 8: Full Summary Output
// =============================================================================
section('TEST 8: Full Summary — Normal Patient');

const summary = ventNormal.summary();
console.log(JSON.stringify(summary, null, 2));


// =============================================================================
// TEST 9: Patient Presets
// =============================================================================
section('TEST 9: Patient Presets');

const presets = LungModel.presets();
console.log('  Available presets:');
for (const [key, preset] of Object.entries(presets)) {
    const lung = LungModel.fromPreset(key);
    console.log(`    ${preset.label.padEnd(20)} R=${preset.resistance.toString().padStart(2)}  C=${preset.compliance.toFixed(3)}  τ=${lung.timeConstant.toFixed(2)}s  ${preset.note}`);
}


// =============================================================================
// SCENARIO: Clinical "Sanity Checks"
// =============================================================================
section('SCENARIO: Does the math pass the clinical sniff test?');

// Normal patient at VT 6 mL/kg for 70 kg patient = 420 mL
const lung70 = LungModel.fromPreset('normal');
const vent70 = new Ventilator(lung70, {
    tidalVolume: 0.420, respiratoryRate: 16, ieRatio: [1, 2], peep: 5,
});
console.log(`  70 kg normal, VT=420 mL, RR=16:`);
console.log(`    PIP=${vent70.pip.toFixed(1)}  Pplat=${vent70.pplat.toFixed(1)}  DP=${vent70.drivingPressure.toFixed(1)}  V̇E=${vent70.minuteVentilation.toFixed(1)}`);
console.log(`    → Looks like a typical post-op patient ✓`);

// ARDS patient at 6 mL/kg PBW = 420 mL, higher RR for compensatory V̇E
const lungARDS = LungModel.fromPreset('ards_moderate');
const ventARDS = new Ventilator(lungARDS, {
    tidalVolume: 0.420, respiratoryRate: 24, ieRatio: [1, 2], peep: 12,
});
console.log(`\n  ARDS moderate, VT=420 mL, RR=24, PEEP=12:`);
console.log(`    PIP=${ventARDS.pip.toFixed(1)}  Pplat=${ventARDS.pplat.toFixed(1)}  DP=${ventARDS.drivingPressure.toFixed(1)}  V̇E=${ventARDS.minuteVentilation.toFixed(1)}`);
console.log(`    Pplat ${ventARDS.pplat > 30 ? '> 30 ⚠️' : '≤ 30 ✓'}   DP ${ventARDS.drivingPressure > 15 ? '> 15 ⚠️' : '≤ 15 ✓'}`);

// COPD with settings adjusted to minimize trapping
const lungCOPD2 = LungModel.fromPreset('copd');
const ventCOPD2 = new Ventilator(lungCOPD2, {
    tidalVolume: 0.450, respiratoryRate: 10, ieRatio: [1, 4], peep: 5,
});
console.log(`\n  COPD, VT=450 mL, RR=10, I:E=1:4 (permissive strategy):`);
console.log(`    Ti=${ventCOPD2.inspiratoryTime.toFixed(2)}s  Te=${ventCOPD2.expiratoryTime.toFixed(2)}s  Te/τ=${ventCOPD2.teOverTau.toFixed(1)}`);
console.log(`    PIP=${ventCOPD2.pip.toFixed(1)}  autoPEEP=${ventCOPD2.autoPeep.toFixed(2)}  Trapping: ${ventCOPD2.gasTrappingRisk ? 'YES ⚠️' : 'Minimal ✓'}`);


// =============================================================================
// TEST 7: PC-CMV — Normal Lung
// =============================================================================
section('TEST 7: PC-CMV — Normal Lung (R=10, C=0.05)');

// Normal lung, Pinsp=15, RR=14, I:E=1:2, PEEP=5
const lungPC1 = new LungModel({ resistance: 10, compliance: 0.05 });
const ventPC1 = new Ventilator(lungPC1, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

// τ = 10 × 0.05 = 0.5 s
// Ti = (60/14) × (1/3) = 1.4286 s
// Ti/τ = 1.4286 / 0.5 = 2.857  (good fill, >95% of max)
// Te/τ = 2.857 / 0.5 = 5.71    (no gas trapping)

// With negligible auto-PEEP (Te >> 3τ):
// VT_max = Pinsp × C = 15 × 0.05 = 0.750 L
// VT = 15 × 0.05 × (1 - e^(-1.4286/0.5)) = 0.750 × (1 - e^(-2.857))
//    = 0.750 × (1 - 0.0574) = 0.750 × 0.9426 = 0.707 L

assert('PC mode label', ventPC1.modeLabel === 'PC-CMV' ? 1 : 0, 1, 0);
assert('PC Ti (s)', ventPC1.inspiratoryTime, 60/14/3, 0.01);
assert('PC Peak flow (L/s)', ventPC1.pcPeakFlow, 15 / 10, 0.02);  // 1.5 L/s
assert('PC PIP (cmH2O)', ventPC1.pip, 5 + 15, 0.01);  // 20

// VT: with minimal auto-PEEP, should be close to 707 mL
const pcVt1 = ventPC1.pcDeliveredVt;
console.log(`    Delivered VT = ${(pcVt1 * 1000).toFixed(1)} mL (expected ~707 mL)`);
assert('PC Delivered VT (L)', pcVt1, 0.707, 0.02);

// VT from steady-state should be essentially the same (no trapping)
const pcVtSS1 = ventPC1._pcSteadyStateVt();
assert('PC Steady-state VT (L)', pcVtSS1, pcVt1, 0.02);

// Minute ventilation
assert('PC V̇E (L/min)', ventPC1.minuteVentilation, pcVtSS1 * 14, 0.02);


// =============================================================================
// TEST 8: PC-CMV — ARDS (Low Compliance → Less Volume)
// =============================================================================
section('TEST 8: PC-CMV — ARDS (R=10, C=0.035)');

// Same Pinsp=15, but much stiffer lungs
// τ = 10 × 0.035 = 0.35 s
// Ti = 1.4286 s → Ti/τ = 4.08 → nearly complete fill
// VT_max = 15 × 0.035 = 0.525 L = 525 mL
// VT ≈ 525 × (1 - e^(-4.08)) ≈ 525 × 0.983 ≈ 516 mL

const lungPC2 = new LungModel({ resistance: 10, compliance: 0.035 });
const ventPC2 = new Ventilator(lungPC2, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

const pcVt2 = ventPC2.pcDeliveredVt;
console.log(`    ARDS VT = ${(pcVt2 * 1000).toFixed(1)} mL (expected ~516 mL)`);
assert('ARDS PC VT (L)', pcVt2, 0.516, 0.03);

// Key teaching point: same pressure → less volume with stiffer lungs
console.log(`    Normal VT=${(pcVt1*1000).toFixed(0)} vs ARDS VT=${(pcVt2*1000).toFixed(0)} — compliance matters!`);


// =============================================================================
// TEST 9: PC-CMV — COPD (Gas Trapping)
// =============================================================================
section('TEST 9: PC-CMV — COPD with Gas Trapping (R=25, C=0.06)');

// High resistance, normal compliance
// τ = 25 × 0.06 = 1.5 s
// With RR=14, I:E=1:2: Ti=1.43s, Te=2.86s
// Ti/τ = 0.95 → INCOMPLETE fill (only ~61% of max)
// Te/τ = 1.90 → SIGNIFICANT gas trapping

const lungPC3 = LungModel.fromPreset('copd');
const ventPC3 = new Ventilator(lungPC3, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

console.log(`    τ=${lungPC3.timeConstant.toFixed(2)}s  Ti/τ=${ventPC3.tiOverTau.toFixed(2)}  Te/τ=${ventPC3.teOverTau.toFixed(2)}`);
console.log(`    Auto-PEEP=${ventPC3.autoPeep.toFixed(2)} cmH2O  Trapped=${(ventPC3.trappedVolume*1000).toFixed(1)} mL`);

assert('COPD Ti/τ < 1 (incomplete fill)', ventPC3.tiOverTau < 1 ? 1 : 0, 1, 0);
assert('COPD gas trapping risk', ventPC3.gasTrappingRisk ? 1 : 0, 1, 0);
assert('COPD auto-PEEP > 0', ventPC3.autoPeep > 0.5 ? 1 : 0, 1, 0);

// Verify PC waveform generation works
const pcWaves = ventPC3.generateBreathWaveforms(2);
assert('PC waveform has data', pcWaves.time.length > 100 ? 1 : 0, 1, 0);
assert('PC pressure square wave (max ≈ PIP)', 
    Math.max(...pcWaves.pressure), ventPC3.pip, 0.02);
assert('PC flow peak > 0', Math.max(...pcWaves.flow) > 0 ? 1 : 0, 1, 0);
assert('PC flow decelerating (peak >> end-insp)', 
    pcWaves.flow[0] > pcWaves.flow[Math.round(ventPC3.inspiratoryTime * 100) - 1] ? 1 : 0, 1, 0);


// =============================================================================
// TEST 10: PC-CMV — Waveform Sanity Checks
// =============================================================================
section('TEST 10: PC-CMV — Waveform Shape Validation');

// Use normal lung for clean waveforms
const wavesPC = ventPC1.generateBreathWaveforms(1);

// Pressure should be constant during inspiration (square wave)
const inspSamples = Math.round(ventPC1.inspiratoryTime * 100);
const inspPressures = wavesPC.pressure.slice(0, inspSamples);
const pMin = Math.min(...inspPressures);
const pMax = Math.max(...inspPressures);
console.log(`    Insp pressure range: ${pMin.toFixed(2)} – ${pMax.toFixed(2)} (should be ~constant at ${ventPC1.pip.toFixed(1)})`);
assert('PC pressure constant during insp (spread < 0.5)', pMax - pMin, 0, 0.5);

// Flow should start high and decay
const firstFlow = wavesPC.flow[0];
const midFlow   = wavesPC.flow[Math.round(inspSamples / 2)];
const endFlow   = wavesPC.flow[inspSamples - 1];
console.log(`    Flow: start=${firstFlow.toFixed(1)}, mid=${midFlow.toFixed(1)}, end=${endFlow.toFixed(1)} L/min`);
assert('PC flow decelerating (start > mid > end)', 
    (firstFlow > midFlow && midFlow > endFlow) ? 1 : 0, 1, 0);

// Volume should rise and plateau (concave down)
const endVol = wavesPC.volume[inspSamples - 1];
const midVol = wavesPC.volume[Math.round(inspSamples / 2)];
console.log(`    Volume: mid=${midVol.toFixed(1)} mL, end=${endVol.toFixed(1)} mL`);
assert('PC volume rises (end > mid > 0)',
    (endVol > midVol && midVol > 0) ? 1 : 0, 1, 0);

// Expiration should have negative flow
const expStart = inspSamples;
const expFlow = wavesPC.flow[expStart];
console.log(`    Expiratory flow at start: ${expFlow.toFixed(1)} L/min (should be negative)`);
assert('PC exp flow is negative', expFlow < -1 ? 1 : 0, 1, 0);


// =============================================================================
// CLINICAL SCENARIO: PC-CMV Teaching Moment
// =============================================================================
section('CLINICAL SCENARIO: PC-CMV Sensitivity to Mechanics');

// Show that in PC, when compliance drops (e.g., worsening ARDS),
// VT drops automatically — this is a KEY safety concern.
console.log('\n  Pinsp=15, RR=14, I:E=1:2 across different compliance values:');
console.log('  ─────────────────────────────────────────────────────');

for (const cVal of [0.060, 0.050, 0.035, 0.025]) {
    const testLung = new LungModel({ resistance: 10, compliance: cVal });
    const testVent = new Ventilator(testLung, {
        mode: 'pc-cmv', inspiratoryPressure: 15, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    });
    const vt = testVent._pcSteadyStateVt() * 1000;
    const ve = testVent.minuteVentilation;
    console.log(`    C=${(cVal*1000).toFixed(0)} mL/cmH₂O → VT=${vt.toFixed(0)} mL, V̇E=${ve.toFixed(1)} L/min`);
}

console.log('\n  ⚕️ In PC-CMV, watch VT closely — it changes with the patient!');


// =============================================================================
// RESULTS
// =============================================================================
section('RESULTS');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  ${failed === 0 ? '🫁 All systems nominal. Engine is breathing.' : '⚠️  Some tests failed — review above.'}`);
console.log();
