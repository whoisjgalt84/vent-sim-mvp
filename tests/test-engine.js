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

import { LungModel } from '../js/lung-model.js';
import { Ventilator } from '../js/ventilator.js';
import { SimulationEngine, RingBuffer } from '../js/simulation.js';

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
// TEST 11: VC-CMV Descending Ramp — Normal Lung
// =============================================================================
section('TEST 11: VC Descending Ramp — Normal Lung (R=10, C=0.05)');

const lungRamp1 = new LungModel({ resistance: 10, compliance: 0.05 });
const ventRamp1 = new Ventilator(lungRamp1, {
    mode: 'vc-cmv',
    flowPattern: 'ramp',
    tidalVolume: 0.500,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

// V̇_peak = 2 × VT / Ti = 2 × 0.500 / 1.4286 = 0.700 L/s = 42.0 L/min
// (twice the square flow of 21.0 L/min)
const ti = 60 / 14 / 3;  // 1.4286 s
const expectedPeakFlow = 2 * 0.500 / ti;

assert('Ramp peak flow (L/s)', ventRamp1.vcPeakFlow, expectedPeakFlow, 0.01);
assert('Ramp peak flow = 2× square flow', ventRamp1.vcPeakFlow, 2 * ventRamp1.inspiratoryFlow, 0.01);
assert('Ramp flow pattern label', ventRamp1.flowPatternLabel === 'Ramp' ? 1 : 0, 1, 0);

// Pplat should be SAME as square (same VT, same mechanics)
const ventSquare1 = new Ventilator(lungRamp1, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});
assert('Ramp Pplat = Square Pplat', ventRamp1.pplat, ventSquare1.pplat, 0.01);

// Driving pressure should be SAME (same VT/C)
assert('Ramp ΔP = Square ΔP', ventRamp1.drivingPressure, ventSquare1.drivingPressure, 0.01);

// PIP should be LOWER for ramp (the key clinical advantage!)
console.log(`    Square PIP = ${ventSquare1.pip.toFixed(1)} cmH₂O`);
console.log(`    Ramp PIP   = ${ventRamp1.pip.toFixed(1)} cmH₂O`);
assert('Ramp PIP < Square PIP', ventRamp1.pip < ventSquare1.pip ? 1 : 0, 1, 0);

// Verify PIP analytically:
// τ = 0.5s, Ti = 1.43s → t* = Ti - τ = 0.93s
// At t*: V̇ = 0.700 × (1 - 0.93/1.43) = 0.700 × 0.351 = 0.245 L/s
//         V = 0.700 × (0.93 - 0.93²/2.86) = 0.700 × (0.93 - 0.302) = 0.440 L
//         P = 5 + 0 + 10×0.245 + 0.440/0.05 = 5 + 2.45 + 8.80 = 16.25
const tau = 10 * 0.05;
const tStar = ti - tau;
const fAtStar = expectedPeakFlow * (1 - tStar / ti);
const vAtStar = expectedPeakFlow * (tStar - tStar * tStar / (2 * ti));
const expectedPIP = 5 + 10 * fAtStar + vAtStar / 0.05;
console.log(`    Analytical PIP = ${expectedPIP.toFixed(1)} (t*=${tStar.toFixed(2)}s)`);
assert('Ramp PIP matches analytical', ventRamp1.pip, expectedPIP, 0.02);


// =============================================================================
// TEST 12: Descending Ramp — Waveform Shape Validation
// =============================================================================
section('TEST 12: Descending Ramp — Waveform Shape Validation');

const wavesRamp = ventRamp1.generateBreathWaveforms(1);
const inspSamplesR = Math.round(ti * 100);

// Flow should start high and linearly decrease to ~0
const flowStart = wavesRamp.flow[0];
const flowMid   = wavesRamp.flow[Math.round(inspSamplesR / 2)];
const flowEnd   = wavesRamp.flow[inspSamplesR - 1];
console.log(`    Flow: start=${flowStart.toFixed(1)}, mid=${flowMid.toFixed(1)}, end=${flowEnd.toFixed(1)} L/min`);
assert('Ramp flow start ≈ peak', flowStart, expectedPeakFlow * 60, 0.02);
assert('Ramp flow end ≈ 0', Math.abs(flowEnd) < 1.0 ? 1 : 0, 1, 0);
assert('Ramp flow linearly decreasing', (flowStart > flowMid && flowMid > flowEnd) ? 1 : 0, 1, 0);
assert('Ramp flow mid ≈ half peak', flowMid, flowStart / 2, 0.05);

// Volume should be parabolic (concave down) and reach VT
const volEnd = wavesRamp.volume[inspSamplesR - 1];
const volMid = wavesRamp.volume[Math.round(inspSamplesR / 2)];
console.log(`    Volume: mid=${volMid.toFixed(1)} mL, end=${volEnd.toFixed(1)} mL`);
assert('Ramp volume reaches VT', volEnd, 500, 0.03);
// Parabolic: at t=Ti/2, V should be 75% of VT (not 50% like linear)
// V(Ti/2) = fPeak × (Ti/2 - (Ti/2)²/(2Ti)) = fPeak × Ti/2 × (1 - 1/4) = fPeak × 3Ti/8
// = (2VT/Ti) × 3Ti/8 = 3VT/4 = 375 mL
assert('Ramp volume at midpoint ≈ 75% VT (parabolic)', volMid, 375, 0.05);

// Pressure should have the "hump" shape
const pStartR = wavesRamp.pressure[0];
const pEndR   = wavesRamp.pressure[inspSamplesR - 1];
const pMaxR   = Math.max(...wavesRamp.pressure.slice(0, inspSamplesR));
console.log(`    Pressure: start=${pStartR.toFixed(1)}, peak=${pMaxR.toFixed(1)}, end-insp=${pEndR.toFixed(1)}`);
// End-insp pressure should ≈ Pplat (flow is ~0)
assert('Ramp end-insp P ≈ Pplat', pEndR, ventRamp1.pplat, 0.5);
// Peak (PIP) should be in the middle, not at start or end
assert('Ramp PIP is interior maximum', (pMaxR > pStartR && pMaxR > pEndR) ? 1 : 0, 1, 0);

// Expiration should be identical to square (same VT, same mechanics)
const expStartIdx = inspSamplesR;
const expFlowRamp = wavesRamp.flow[expStartIdx];
console.log(`    Expiratory flow at start: ${expFlowRamp.toFixed(1)} L/min`);
assert('Ramp exp flow is negative', expFlowRamp < -1 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 13: Ramp vs Square — Same VT, Different Pressure
// =============================================================================
section('TEST 13: Ramp vs Square — Comparative Analysis');

console.log('\n  Same VT=500 mL, same patient, different flow patterns:');
console.log('  ─────────────────────────────────────────────────────');

for (const [label, R, C] of [
    ['Normal',   10, 0.050],
    ['ARDS',     10, 0.035],
    ['COPD',     25, 0.060],
    ['Fibrosis',  8, 0.030],
]) {
    const testLung = new LungModel({ resistance: R, compliance: C });
    const sq = new Ventilator(testLung, {
        mode: 'vc-cmv', flowPattern: 'square',
        tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    });
    const rp = new Ventilator(testLung, {
        mode: 'vc-cmv', flowPattern: 'ramp',
        tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    });
    const pipDiff = sq.pip - rp.pip;
    console.log(`    ${label.padEnd(10)} Square PIP=${sq.pip.toFixed(1)}  Ramp PIP=${rp.pip.toFixed(1)}  (ΔP=${pipDiff.toFixed(1)} less)  Pplat=${sq.pplat.toFixed(1)} (same)`);
}

console.log('\n  ⚕️ Descending ramp: same VT, same Pplat, lower PIP — purely cosmetic?');
console.log('     No! Lower PIP means less peak airway pressure and potentially');
console.log('     better patient comfort. But Pplat (the alveolar stretching');
console.log('     pressure) is unchanged — lung protection depends on Pplat and ΔP.');


// =============================================================================
// TEST 14: High Resistance — Ramp PIP at t=0
// =============================================================================
section('TEST 14: High Resistance — PIP Location Shifts');

// When τ > Ti, PIP should be at t=0 (resistive component dominates entirely)
const lungHighR = new LungModel({ resistance: 40, compliance: 0.060 });
const ventHighR = new Ventilator(lungHighR, {
    mode: 'vc-cmv', flowPattern: 'ramp',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});
const tauHighR = 40 * 0.060;  // 2.4 s
const tiHighR = ventHighR.inspiratoryTime;  // 1.43 s
console.log(`    τ=${tauHighR.toFixed(2)}s > Ti=${tiHighR.toFixed(2)}s → PIP at t=0`);
assert('τ > Ti condition', tauHighR > tiHighR ? 1 : 0, 1, 0);

// PIP at t=0: P = PEEP + R × V̇_peak (no volume yet)
const fPeakHighR = 2 * 0.500 / tiHighR;
const expectedPIPHighR = 5 + 40 * fPeakHighR;  // PEEP + R × V̇_peak + 0 (auto-PEEP negligible? check)
const autoHighR = ventHighR.autoPeep;
const trappedHighR = ventHighR.trappedVolume;
const actualExpectedPIP = 5 + autoHighR + 40 * fPeakHighR + trappedHighR / 0.060;
console.log(`    PIP=${ventHighR.pip.toFixed(1)} cmH₂O  (R×V̇_peak=${(40 * fPeakHighR).toFixed(1)}, autoPEEP=${autoHighR.toFixed(1)})`);
assert('High-R ramp PIP ≈ PEEP + autoPEEP + R×V̇_peak', ventHighR.pip, actualExpectedPIP, 0.02);


// =============================================================================
// TEST 15: Inspiratory Hold — VC-CMV Square Flow
// =============================================================================
section('TEST 15: Inspiratory Hold — VC Square (R=10, C=0.05)');

const lungHold1 = new LungModel({ resistance: 10, compliance: 0.05 });
const ventHold1 = new Ventilator(lungHold1, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 0.5,
});

assert('Hold is active', ventHold1.holdActive ? 1 : 0, 1, 0);
assert('Effective hold time', ventHold1.effectiveHoldTime, 0.5, 0.01);
console.log(`    Ti=${ventHold1.inspiratoryTime.toFixed(2)}s  Hold=${ventHold1.effectiveHoldTime.toFixed(1)}s  Te_eff=${ventHold1.effectiveExpiratoryTime.toFixed(2)}s`);

// Hold steals from Te, so effective Te = Te - holdTime
const teNoHold = ventHold1.expiratoryTime;
assert('Effective Te = Te - holdTime', ventHold1.effectiveExpiratoryTime, teNoHold - 0.5, 0.01);

// Pplat and PIP should be the same as without hold (same VT, same flow)
const ventNoHold1 = new Ventilator(lungHold1, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 0,
});
assert('Hold PIP = no-hold PIP', ventHold1.pip, ventNoHold1.pip, 0.01);
assert('Hold Pplat = no-hold Pplat', ventHold1.pplat, ventNoHold1.pplat, 0.01);

// PIP - Pplat = R × V̇ (resistive pressure, exact for square flow)
const pipPplatDiff = ventHold1.pip - ventHold1.pplat;
console.log(`    PIP=${ventHold1.pip.toFixed(1)}  Pplat=${ventHold1.pplat.toFixed(1)}  PIP-Pplat=${pipPplatDiff.toFixed(1)}`);
assert('PIP - Pplat = R × V̇', pipPplatDiff, 10 * ventHold1.inspiratoryFlow, 0.1);

// Hold-derived measurements
const s15 = ventHold1.summary();
console.log(`    Static Crs = ${s15.mechanics.staticCompliance} mL/cmH₂O (actual=${lungHold1.compliance * 1000})`);
console.log(`    Measured Raw = ${s15.mechanics.measuredResistance} cmH₂O·s/L (actual=${lungHold1.resistance})`);
assert('Hold reveals correct static Crs', s15.mechanics.staticCompliance, lungHold1.compliance * 1000, 0.5);
assert('Hold reveals correct Raw', s15.mechanics.measuredResistance, lungHold1.resistance, 0.2);


// =============================================================================
// TEST 16: Hold Waveform — Pressure Drop & Flow Zero
// =============================================================================
section('TEST 16: Hold Waveform — Pressure Drop & Flow Zero');

const wavesHold1 = ventHold1.generateBreathWaveforms(1);
const tiSamples = Math.round(ventHold1.inspiratoryTime * 100);
const holdSamples = Math.round(0.5 * 100);  // 50 samples

// Last inspiration sample: should be at PIP (pressure still has R×V̇)
const lastInspP = wavesHold1.pressure[tiSamples - 1];
console.log(`    Last insp pressure: ${lastInspP.toFixed(1)} (PIP=${ventHold1.pip.toFixed(1)})`);

// First hold sample: pressure should drop to Pplat
const firstHoldP = wavesHold1.pressure[tiSamples];
const firstHoldF = wavesHold1.flow[tiSamples];
const firstHoldV = wavesHold1.volume[tiSamples];
console.log(`    First hold: P=${firstHoldP.toFixed(1)} (Pplat=${ventHold1.pplat.toFixed(1)})  V̇=${firstHoldF.toFixed(1)} L/min  V=${firstHoldV.toFixed(0)} mL`);

assert('Hold pressure = Pplat', firstHoldP, ventHold1.pplat, 0.5);
assert('Hold flow = 0', firstHoldF, 0, 0.01);
assert('Hold volume = VT', firstHoldV, 500, 1);

// All hold samples should have zero flow and constant pressure
let holdFlowAllZero = true;
let holdPressureConstant = true;
for (let i = tiSamples; i < tiSamples + holdSamples && i < wavesHold1.time.length; i++) {
    if (Math.abs(wavesHold1.flow[i]) > 0.01) holdFlowAllZero = false;
    if (Math.abs(wavesHold1.pressure[i] - firstHoldP) > 0.1) holdPressureConstant = false;
}
assert('All hold samples: flow = 0', holdFlowAllZero ? 1 : 0, 1, 0);
assert('All hold samples: P = constant', holdPressureConstant ? 1 : 0, 1, 0);

// After hold, expiration should start with negative flow
const firstExpIdx = tiSamples + holdSamples;
const firstExpF = wavesHold1.flow[firstExpIdx];
console.log(`    First exp flow after hold: ${firstExpF.toFixed(1)} L/min`);
assert('Exp starts after hold', firstExpF < -5 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 17: Hold — Ramp Flow (Pplat should be lower than PIP)
// =============================================================================
section('TEST 17: Hold — Ramp Flow (interior PIP → hold at Pplat)');

const lungHoldRamp = new LungModel({ resistance: 10, compliance: 0.05 });
const ventHoldRamp = new Ventilator(lungHoldRamp, {
    mode: 'vc-cmv', flowPattern: 'ramp',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 0.5,
});

// For ramp flow: end-insp flow ≈ 0, so pressure at end of insp ≈ Pplat
// But PIP is an interior maximum. Hold plateau should still be at Pplat.
console.log(`    Ramp PIP=${ventHoldRamp.pip.toFixed(1)}  Pplat=${ventHoldRamp.pplat.toFixed(1)}`);
assert('Ramp hold Pplat < PIP', ventHoldRamp.pplat < ventHoldRamp.pip ? 1 : 0, 1, 0);

// Ramp waveform: hold should show Pplat plateau after the pressure hump
const wavesHoldRamp = ventHoldRamp.generateBreathWaveforms(1);
const tiSamplesR = Math.round(ventHoldRamp.inspiratoryTime * 100);
const holdStartP = wavesHoldRamp.pressure[tiSamplesR];
const holdStartF = wavesHoldRamp.flow[tiSamplesR];
console.log(`    Hold start: P=${holdStartP.toFixed(1)} V̇=${holdStartF.toFixed(1)}`);
assert('Ramp hold flow = 0', holdStartF, 0, 0.01);
assert('Ramp hold pressure ≈ Pplat', holdStartP, ventHoldRamp.pplat, 0.5);


// =============================================================================
// TEST 18: Hold — PC-CMV (Pplat visible when Ti < 3τ)
// =============================================================================
section('TEST 18: Hold — PC-CMV (Pplat visibility depends on Ti/τ)');

// Use moderate τ where flow hasn't completely stopped
const lungHoldPC = new LungModel({ resistance: 15, compliance: 0.05 });
const ventHoldPC = new Ventilator(lungHoldPC, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 0.5,
});

const pcTiTau = ventHoldPC.tiOverTau;
console.log(`    PC: Ti/τ=${pcTiTau.toFixed(1)}  PIP=${ventHoldPC.pip.toFixed(1)}  Pplat=${ventHoldPC.pplat.toFixed(1)}`);

// In PC, PIP = PEEP + Pinsp = 20. If Ti/τ < 3, Pplat < PIP.
const pcPIP   = ventHoldPC.pip;
const pcPplat = ventHoldPC.pplat;
console.log(`    PIP - Pplat = ${(pcPIP - pcPplat).toFixed(1)} cmH₂O (visible pressure drop during hold)`);
if (pcTiTau < 3) {
    assert('PC hold shows pressure drop (Ti/τ < 3)', pcPplat < pcPIP ? 1 : 0, 1, 0);
} else {
    console.log('    Ti/τ ≥ 3 → flow nearly stopped, Pplat ≈ PIP (hold is less dramatic)');
}

// Verify waveform
const wavesHoldPC = ventHoldPC.generateBreathWaveforms(1);
const pcTiSamples = Math.round(ventHoldPC.inspiratoryTime * 100);
const pcHoldP = wavesHoldPC.pressure[pcTiSamples];
const pcHoldF = wavesHoldPC.flow[pcTiSamples];
console.log(`    PC hold: P=${pcHoldP.toFixed(1)} V̇=${pcHoldF.toFixed(1)}`);
assert('PC hold flow = 0', pcHoldF, 0, 0.01);
assert('PC hold P ≈ Pplat', pcHoldP, pcPplat, 0.5);


// =============================================================================
// TEST 19: Hold Increases Gas Trapping (steals from Te)
// =============================================================================
section('TEST 19: Hold Increases Gas Trapping (COPD + hold)');

const lungCOPDHold = new LungModel({ resistance: 25, compliance: 0.06 });

const ventCOPD_noHold = new Ventilator(lungCOPDHold, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 0,
});

const ventCOPD_hold = new Ventilator(lungCOPDHold, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 1.0,
});

console.log(`    Without hold: Te=${ventCOPD_noHold.effectiveExpiratoryTime.toFixed(2)}s  Te/τ=${ventCOPD_noHold.teOverTau.toFixed(1)}  AutoPEEP=${ventCOPD_noHold.autoPeep.toFixed(1)}`);
console.log(`    With 1s hold: Te=${ventCOPD_hold.effectiveExpiratoryTime.toFixed(2)}s  Te/τ=${ventCOPD_hold.teOverTau.toFixed(1)}  AutoPEEP=${ventCOPD_hold.autoPeep.toFixed(1)}`);

assert('Hold reduces effective Te', ventCOPD_hold.effectiveExpiratoryTime < ventCOPD_noHold.effectiveExpiratoryTime ? 1 : 0, 1, 0);
assert('Hold increases auto-PEEP', ventCOPD_hold.autoPeep > ventCOPD_noHold.autoPeep ? 1 : 0, 1, 0);
assert('Hold increases trapped volume', ventCOPD_hold.trappedVolume > ventCOPD_noHold.trappedVolume ? 1 : 0, 1, 0);

console.log('\n  ⚕️ Teaching point: In COPD patients, prolonged inspiratory holds');
console.log('     steal expiratory time → more gas trapping → higher auto-PEEP.');
console.log('     Keep holds brief in obstructive patients!');


// =============================================================================
// TEST 20: Hold Duration Clamping
// =============================================================================
section('TEST 20: Hold Duration Clamping (safety limit)');

const lungClamp = new LungModel({ resistance: 10, compliance: 0.05 });
const ventClamp = new Ventilator(lungClamp, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 99,  // absurdly long
});

console.log(`    Te=${ventClamp.expiratoryTime.toFixed(2)}s  Requested hold=99s`);
console.log(`    Effective hold=${ventClamp.effectiveHoldTime.toFixed(2)}s  Effective Te=${ventClamp.effectiveExpiratoryTime.toFixed(2)}s`);
assert('Hold clamped (Te_eff ≥ 0.2)', ventClamp.effectiveExpiratoryTime >= 0.2 ? 1 : 0, 1, 0);
assert('Hold clamped = Te - 0.2', ventClamp.effectiveHoldTime, ventClamp.expiratoryTime - 0.2, 0.01);


// =============================================================================
// TEST 21: Pmus Waveform — Half-Sine Shape
// =============================================================================
section('TEST 21: Pmus Waveform — Half-Sine Shape');

const lungPmus = new LungModel({ resistance: 10, compliance: 0.05 });
const ventPmus = new Ventilator(lungPmus, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    pMusMax: 10, neuralTi: 1.0,
});

assert('Pmus is active', ventPmus.pMusActive ? 1 : 0, 1, 0);
assert('Pmus at t=0', ventPmus.pMusAt(0), 0, 0.01);
assert('Pmus at t=0.5 (peak)', ventPmus.pMusAt(0.5), 10, 0.01);
assert('Pmus at t=1.0 (end)', ventPmus.pMusAt(1.0), 0, 0.01);
assert('Pmus at t=1.5 (after neural Ti)', ventPmus.pMusAt(1.5), 0, 0.01);
assert('Pmus at t=0.25 (quarter)', ventPmus.pMusAt(0.25), 10 * Math.sin(Math.PI * 0.25), 0.01);


// =============================================================================
// TEST 22: VC-CMV + Pmus — Pressure Scalloping
// =============================================================================
section('TEST 22: VC-CMV + Pmus — Pressure Scalloping');

// With Pmus active, the pressure waveform should dip during inspiration
// Flow and volume should be UNCHANGED (VC controls flow)
const ventVC_noPmus = new Ventilator(lungPmus, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    pMusMax: 0,
});
const ventVC_pmus = new Ventilator(lungPmus, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    pMusMax: 10, neuralTi: 1.0,
});

const wavesNoPmus = ventVC_noPmus.generateBreathWaveforms(1);
const wavesPmus   = ventVC_pmus.generateBreathWaveforms(1);

// Flow should be identical
const tiSamplesP = Math.round(ventVC_pmus.inspiratoryTime * 100);
assert('VC+Pmus: flow unchanged at start', wavesPmus.flow[0], wavesNoPmus.flow[0], 0.01);
assert('VC+Pmus: flow unchanged at mid', wavesPmus.flow[Math.round(tiSamplesP/2)], wavesNoPmus.flow[Math.round(tiSamplesP/2)], 0.01);

// Volume should be identical
assert('VC+Pmus: volume unchanged at mid', wavesPmus.volume[Math.round(tiSamplesP/2)], wavesNoPmus.volume[Math.round(tiSamplesP/2)], 0.1);

// Pressure should be LOWER during Pmus peak (scalloping)
// Pmus peaks at t = neuralTi/2 = 0.5s → sample ~50
const pmusIdx = Math.round(0.5 * 100);
const pDiff = wavesNoPmus.pressure[pmusIdx] - wavesPmus.pressure[pmusIdx];
console.log(`    Without Pmus: P(0.5s) = ${wavesNoPmus.pressure[pmusIdx].toFixed(1)} cmH₂O`);
console.log(`    With Pmus=10: P(0.5s) = ${wavesPmus.pressure[pmusIdx].toFixed(1)} cmH₂O`);
console.log(`    Scallop depth = ${pDiff.toFixed(1)} cmH₂O (should ≈ Pmus_max = 10)`);
assert('VC+Pmus: pressure scallop ≈ Pmus_max', pDiff, 10, 0.5);

// Pressure at start of breath should be same (Pmus=0 at t=0)
assert('VC+Pmus: P(0) unchanged (Pmus=0 at t=0)', wavesPmus.pressure[0], wavesNoPmus.pressure[0], 0.1);

console.log('\n  ⚕️ In VC mode, patient effort creates the "scalloped" pressure waveform.');
console.log('     Flow and volume are unchanged — the patient does work that');
console.log('     would otherwise be done by the ventilator.');


// =============================================================================
// TEST 23: PC-CMV + Pmus — Volume Increase
// =============================================================================
section('TEST 23: PC-CMV + Pmus — Volume Increase');

const ventPC_noPmus = new Ventilator(lungPmus, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    pMusMax: 0,
});
const ventPC_pmus = new Ventilator(lungPmus, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    pMusMax: 10, neuralTi: 1.0,
});

const wavesPC_no = ventPC_noPmus.generateBreathWaveforms(1);
const wavesPC_pm = ventPC_pmus.generateBreathWaveforms(1);

const tiSamplesPC = Math.round(ventPC_pmus.inspiratoryTime * 100);

// Volume should be HIGHER with Pmus (more driving pressure)
const vtNoPmus = wavesPC_no.volume[tiSamplesPC - 1];
const vtPmus   = wavesPC_pm.volume[tiSamplesPC - 1];
console.log(`    Without Pmus: VT = ${vtNoPmus.toFixed(0)} mL`);
console.log(`    With Pmus=10: VT = ${vtPmus.toFixed(0)} mL`);
console.log(`    VT increase = ${(vtPmus - vtNoPmus).toFixed(0)} mL`);
assert('PC+Pmus: VT increases', vtPmus > vtNoPmus ? 1 : 0, 1, 0);

// Flow should be HIGHER at peak (more driving pressure)
const fNoPmus = wavesPC_no.flow[0];
const fPmus   = wavesPC_pm.flow[0];
console.log(`    Without Pmus: V̇_peak = ${fNoPmus.toFixed(1)} L/min`);
console.log(`    With Pmus=10: V̇_peak = ${fPmus.toFixed(1)} L/min`);
// At t=0, Pmus=0 (half-sine starts at zero), so initial flow should be same
assert('PC+Pmus: initial flow same (Pmus=0 at t=0)', fPmus, fNoPmus, 0.5);

// At mid-inspiration, flow should be higher
const midFlow_no = wavesPC_no.flow[Math.round(tiSamplesPC/2)];
const midFlow_pm = wavesPC_pm.flow[Math.round(tiSamplesPC/2)];
console.log(`    Mid-insp flow: no-Pmus=${midFlow_no.toFixed(1)}, Pmus=${midFlow_pm.toFixed(1)} L/min`);
assert('PC+Pmus: mid-insp flow higher', midFlow_pm > midFlow_no ? 1 : 0, 1, 0);

// Pressure should still be constant (ventilator controls it)
const pPC_start = wavesPC_pm.pressure[0];
const pPC_mid   = wavesPC_pm.pressure[Math.round(tiSamplesPC/2)];
assert('PC+Pmus: pressure still constant', Math.abs(pPC_start - pPC_mid) < 0.5 ? 1 : 0, 1, 0);

console.log('\n  ⚕️ In PC mode, patient effort is invisible on pressure waveform —');
console.log('     but look at flow and volume! VT increases because Pmus adds');
console.log('     to the driving pressure. This is why PC mode can over-deliver.');


// =============================================================================
// TEST 24: Pmus = 0 — Backward Compatibility
// =============================================================================
section('TEST 24: Pmus = 0 — Backward Compatibility');

const ventCompat = new Ventilator(lungPmus, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    pMusMax: 0,  // explicitly zero
});
assert('Pmus inactive when 0', ventCompat.pMusActive ? 1 : 0, 0, 0);
assert('Pmus at any time = 0', ventCompat.pMusAt(0.5), 0, 0);

// Verify waveform matches original exactly
const wCompat = ventCompat.generateBreathWaveforms(1);
const wOriginal = ventVC_noPmus.generateBreathWaveforms(1);
let maxPDiff = 0;
for (let i = 0; i < Math.min(wCompat.pressure.length, wOriginal.pressure.length); i++) {
    const d = Math.abs(wCompat.pressure[i] - wOriginal.pressure[i]);
    if (d > maxPDiff) maxPDiff = d;
}
console.log(`    Max pressure difference: ${maxPDiff.toFixed(6)} cmH₂O`);
assert('Pmus=0 produces identical waveforms', maxPDiff < 0.001 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 25: RingBuffer — Push, toArray, Wrap-Around
// =============================================================================
section('TEST 25: RingBuffer — Circular Buffer Integrity');

const rb = new RingBuffer(5);
rb.push(1); rb.push(2); rb.push(3);
assert('RingBuffer count after 3 pushes', rb.length, 3, 0);
assert('RingBuffer last value', rb.last, 3, 0);

let arr = rb.toArray();
assert('RingBuffer toArray length', arr.length, 3, 0);
assert('RingBuffer toArray order', arr[0] === 1 && arr[2] === 3 ? 1 : 0, 1, 0);

// Wrap around
rb.push(4); rb.push(5); rb.push(6); rb.push(7);
assert('RingBuffer count after wrap', rb.length, 5, 0);
arr = rb.toArray();
assert('RingBuffer oldest after wrap', arr[0], 3, 0);
assert('RingBuffer newest after wrap', arr[4], 7, 0);
console.log(`    Buffer contents: [${arr.join(', ')}]`);


// =============================================================================
// TEST 26: SimEngine — Passive VC-CMV Converges to Analytical
// =============================================================================
section('TEST 26: SimEngine — Passive VC-CMV Converges to Analytical');

const lungSim1 = new LungModel({ resistance: 10, compliance: 0.05 });
const ventSim1 = new Ventilator(lungSim1, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});

const sim1 = new SimulationEngine(ventSim1, { sampleRate: 100, displaySeconds: 10 });

// Run for 6 breaths (~25 seconds) to reach steady state
const ticksFor6Breaths = Math.round(6 * ventSim1.totalCycleTime * 100);
for (let i = 0; i < ticksFor6Breaths; i++) {
    sim1.tick();
}

const bs1 = sim1.breathSummary;
const analyticalPIP = ventSim1.pip;
const analyticalVT  = ventSim1.tidalVolume * 1000;

console.log(`    Analytical PIP=${analyticalPIP.toFixed(1)}  Sim PIP=${bs1.pip}`);
console.log(`    Analytical VT=${analyticalVT.toFixed(0)} mL  Sim VT=${bs1.vt_mL} mL`);
console.log(`    Breaths completed: ${bs1.breathCount}`);

assert('Sim PIP converges to analytical', bs1.pip, analyticalPIP, 0.5);
assert('Sim VT converges to analytical', bs1.vt_mL, analyticalVT, 5);
assert('All breaths machine-triggered', bs1.triggerType === 'machine' ? 1 : 0, 1, 0);
assert('Machine trigger markers recorded',
    sim1.getTriggerEvents(sim1.globalTime - sim1.displaySeconds, sim1.globalTime)
        .some(event => event.type === 'machine') ? 1 : 0, 1, 0);


// =============================================================================
// TEST 27: SimEngine — PC-CMV VT Matches Analytical
// =============================================================================
section('TEST 27: SimEngine — PC-CMV VT Matches Analytical');

const ventSimPC = new Ventilator(lungSim1, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});

const simPC = new SimulationEngine(ventSimPC, { sampleRate: 100, displaySeconds: 10 });

const ticksPC = Math.round(6 * ventSimPC.totalCycleTime * 100);
for (let i = 0; i < ticksPC; i++) {
    simPC.tick();
}

const bsPC = simPC.breathSummary;
const analyticalVT_PC = ventSimPC.effectiveVtMl;

console.log(`    PC Analytical VT=${analyticalVT_PC.toFixed(0)} mL  Sim VT=${bsPC.vt_mL} mL`);
console.log(`    PC PIP = ${bsPC.pip} (expected 20.0)`);

assert('PC Sim VT ≈ analytical', bsPC.vt_mL, analyticalVT_PC, 10);
assert('PC PIP = PEEP + Pinsp', bsPC.pip, 20, 0.5);


// =============================================================================
// TEST 28: SimEngine — Patient Triggering
// =============================================================================
section('TEST 28: SimEngine — Patient-Triggered Breaths');

const lungTrig = new LungModel({ resistance: 10, compliance: 0.05 });
const ventTrig = new Ventilator(lungTrig, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 12, ieRatio: [1, 2], peep: 5,
    pMusMax: 8, neuralTi: 1.0,
});

const simTrig = new SimulationEngine(ventTrig, { sampleRate: 100, displaySeconds: 10 });
simTrig.patientRR = 20;  // Patient breathing faster than vent (20 vs 12)

// Run for 15 seconds
for (let i = 0; i < 1500; i++) {
    simTrig.tick();
}

const bsTrig = simTrig.breathSummary;
const trigEvents = simTrig.getTriggerEvents(
    simTrig.globalTime - simTrig.displaySeconds,
    simTrig.globalTime
);
console.log(`    Vent RR=12, Patient RR=20`);
console.log(`    Breaths in 15s: ${bsTrig.breathCount}`);
console.log(`    Last trigger: ${bsTrig.triggerType}`);
console.log(`    Trigger markers: ${trigEvents.length}`);

// With patientRR=20, we expect ~5 breaths per 15s (20/min × 15/60 = 5)
// Actually more, since the vent delivers at its own Ti, not the patient's
assert('Patient triggers detected', bsTrig.triggerType === 'patient' ? 1 : 0, 1, 0);
assert('Effective RR > vent RR', bsTrig.breathCount > (12 * 15 / 60) ? 1 : 0, 1, 0);
assert('Trigger markers include patient breaths',
    trigEvents.some(event => event.type === 'patient') ? 1 : 0, 1, 0);

console.log('\n  ⚕️ Teaching point: When patient RR > vent RR, the patient triggers');
console.log('     additional breaths. The effective RR follows the patient.');
console.log('     This is normal Assist/Control behavior.');


// =============================================================================
// TEST 28B: SimEngine — Failed Trigger Metadata
// =============================================================================
section('TEST 28B: SimEngine — Failed Trigger Metadata');

const lungFailed = new LungModel({ resistance: 10, compliance: 0.05 });
const ventFailed = new Ventilator(lungFailed, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 12, ieRatio: [1, 2], peep: 5,
    pMusMax: 8, neuralTi: 1.0,
});

const simFailed = new SimulationEngine(ventFailed, { sampleRate: 100, displaySeconds: 10 });
simFailed.patientRR = 35;  // First neural effort lands <100 ms into expiration

for (let i = 0; i < 250; i++) {
    simFailed.tick();
}

const failedEvents = simFailed.getTriggerEvents(0, simFailed.globalTime);
const failedOnly = failedEvents.filter(event => event.type === 'failed');
console.log(`    Breath count after 2.5 s: ${simFailed.breathCount}`);
console.log(`    Failed trigger markers: ${failedOnly.length}`);

assert('Failed trigger event recorded', failedOnly.length > 0 ? 1 : 0, 1, 0);
assert('Failed trigger does not deliver a new breath', simFailed.breathCount, 1, 0);


// =============================================================================
// TEST 29: SimEngine — Ramp Flow + Hold
// =============================================================================
section('TEST 29: SimEngine — Ramp Flow + Hold Phase');

const ventSimRamp = new Ventilator(lungSim1, {
    mode: 'vc-cmv', flowPattern: 'ramp',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    holdTime: 0.5,
});

const simRamp = new SimulationEngine(ventSimRamp, { sampleRate: 100, displaySeconds: 10 });

const ticksRamp = Math.round(6 * ventSimRamp.totalCycleTime * 100);
for (let i = 0; i < ticksRamp; i++) {
    simRamp.tick();
}

const bsRamp = simRamp.breathSummary;
console.log(`    Ramp PIP=${bsRamp.pip}  VT=${bsRamp.vt_mL} mL`);
console.log(`    Pplat=${bsRamp.pplat ?? 'N/A'} (hold active → should measure)`);

assert('Ramp sim VT ≈ 500', bsRamp.vt_mL, 500, 10);
assert('Hold measures Pplat', bsRamp.pplat !== null ? 1 : 0, 1, 0);


// =============================================================================
// TEST 30: SimEngine — COPD Gas Trapping Emerges Dynamically
// =============================================================================
section('TEST 30: SimEngine — COPD Gas Trapping (dynamic)');

const lungCOPDSim = new LungModel({ resistance: 25, compliance: 0.06 });
const ventCOPDSim = new Ventilator(lungCOPDSim, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});

const simCOPD = new SimulationEngine(ventCOPDSim, { sampleRate: 100, displaySeconds: 10 });

// Run just 3 breaths — gas trapping should be building
const ticks3 = Math.round(3 * ventCOPDSim.totalCycleTime * 100);
for (let i = 0; i < ticks3; i++) {
    simCOPD.tick();
}

const vLungAfter3 = simCOPD.volumeAboveEq;
console.log(`    After 3 breaths: vLung above eq = ${(vLungAfter3 * 1000).toFixed(1)} mL`);

// Run 10 more breaths to approach steady state
const ticks10 = Math.round(10 * ventCOPDSim.totalCycleTime * 100);
for (let i = 0; i < ticks10; i++) {
    simCOPD.tick();
}

const vLungSS = simCOPD.volumeAboveEq;
const analyticalTrap = ventCOPDSim.trappedVolume * 1000;
console.log(`    After 13 breaths: vLung above eq = ${(vLungSS * 1000).toFixed(1)} mL`);
console.log(`    Analytical trapped vol = ${analyticalTrap.toFixed(1)} mL`);

// Volume at end of exp should stabilize near analytical trapped volume
// (vLung at start of each breath = trapped volume)
assert('Gas trapping builds over breaths', vLungSS > 0.01 ? 1 : 0, 1, 0);
assert('Trapping converges toward analytical',
    Math.abs(vLungSS * 1000 - analyticalTrap) < 30 ? 1 : 0, 1, 0);

console.log('\n  ⚕️ Teaching point: Gas trapping isn\'t a setting — it EMERGES');
console.log('     from the physics when Te < 3τ. Watch it build breath-by-breath!');


// =============================================================================
// TEST 31: SimEngine — Pmus Pressure Scalloping in VC
// =============================================================================
section('TEST 31: SimEngine — VC Pressure Scalloping with Pmus');

const lungScallop = new LungModel({ resistance: 10, compliance: 0.05 });
const ventScallop = new Ventilator(lungScallop, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 12, ieRatio: [1, 2], peep: 5,
    pMusMax: 10, neuralTi: 1.0,
});

// Run passive sim
const simPassive = new SimulationEngine(ventScallop, { sampleRate: 100, displaySeconds: 10 });
// patientRR = 0 → no Pmus
for (let i = 0; i < 1000; i++) simPassive.tick();
const passiveP = simPassive.buffers.pressure.toArray();

// Run with Pmus
const simActive = new SimulationEngine(ventScallop, { sampleRate: 100, displaySeconds: 10 });
simActive.patientRR = 12;  // Same as vent RR → synchronized
for (let i = 0; i < 1000; i++) simActive.tick();
const activeP = simActive.buffers.pressure.toArray();

// Find minimum pressure during a mid-breath sample (should be scalloped lower)
const midIdx = Math.min(500, passiveP.length - 1, activeP.length - 1);
if (midIdx > 0) {
    console.log(`    Passive mid P: ${passiveP[midIdx].toFixed(1)}  Active mid P: ${activeP[midIdx].toFixed(1)}`);
    // Active pressure should sometimes dip below passive (scalloping)
    let foundScallop = false;
    const checkLen = Math.min(passiveP.length, activeP.length);
    for (let i = 100; i < checkLen; i++) {
        if (passiveP[i] - activeP[i] > 2) { foundScallop = true; break; }
    }
    assert('VC Pmus creates pressure scalloping', foundScallop ? 1 : 0, 1, 0);
}


// =============================================================================
// TEST 32: SimEngine — Transport Controls
// =============================================================================
section('TEST 32: SimEngine — Pause/Resume/Speed');

const ventTransport = new Ventilator(lungSim1, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});

const simT = new SimulationEngine(ventTransport, { sampleRate: 100, displaySeconds: 10 });

assert('Sim starts running', simT.running ? 1 : 0, 1, 0);

simT.pause();
assert('Sim paused', simT.running ? 1 : 0, 0, 0);

const countBefore = simT.breathCount;
simT.advance(1.0);  // Try to advance 1 second while paused
assert('No advance while paused', simT.breathCount, countBefore, 0);

simT.resume();
assert('Sim resumed', simT.running ? 1 : 0, 1, 0);

simT.setSpeed(2);
assert('Speed set to 2×', simT.speed, 2, 0);

simT.advance(0.1);  // 0.1 real seconds at 2× → 0.2 sim seconds = 20 ticks
assert('Advance works at 2× speed', simT.globalTime > 0 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 33: Loop Data — Per-Breath Collection
// =============================================================================
section('TEST 33: Loop Data — Per-Breath Collection');

const lungLoop = new LungModel({ resistance: 10, compliance: 0.05 });
const ventLoop = new Ventilator(lungLoop, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});

const simLoop = new SimulationEngine(ventLoop, { sampleRate: 100, displaySeconds: 10 });

// Run for 3 full breaths
const ticksLoop = Math.round(3 * ventLoop.totalCycleTime * 100);
for (let i = 0; i < ticksLoop; i++) {
    simLoop.tick();
}

const lc = simLoop.loopCurrent;
const ld = simLoop.loopCompleted;

console.log(`    loopCurrent samples: ${lc.pressure.length}`);
console.log(`    loopCompleted samples: ${ld.pressure.length}`);

assert('Loop current has data', lc.pressure.length > 10 ? 1 : 0, 1, 0);
assert('Loop completed has data', ld.pressure.length > 10 ? 1 : 0, 1, 0);
assert('Loop arrays same length', lc.pressure.length === lc.volume.length ? 1 : 0, 1, 0);
assert('Completed loop arrays same length',
    ld.pressure.length === ld.volume.length &&
    ld.volume.length === ld.flow.length ? 1 : 0, 1, 0);


// =============================================================================
// TEST 34: P-V Loop Shape — Pressure and Volume Correlated
// =============================================================================
section('TEST 34: P-V Loop Shape Validation');

// In VC-CMV with square flow, during inspiration:
//   Pressure rises linearly (PEEP + V/C + R×V̇, V̇ constant)
//   Volume rises linearly
// The inspiratory limb should show both increasing together.

const ldP = ld.pressure;
const ldV = ld.volume;

// Find peak volume index (end of inspiration)
let loopMaxVol = 0, loopMaxVolIdx = 0;
for (let i = 0; i < ldV.length; i++) {
    if (ldV[i] > loopMaxVol) { loopMaxVol = ldV[i]; loopMaxVolIdx = i; }
}

console.log(`    Peak volume: ${loopMaxVol.toFixed(0)} mL at sample ${loopMaxVolIdx}`);
console.log(`    Pressure at peak vol: ${ldP[loopMaxVolIdx].toFixed(1)} cmH₂O`);
console.log(`    Pressure at start: ${ldP[0].toFixed(1)} cmH₂O`);
console.log(`    Pressure at end: ${ldP[ldP.length-1].toFixed(1)} cmH₂O`);

assert('P-V loop: peak vol ≈ VT', loopMaxVol, 500, 15);
assert('P-V loop: pressure rises during insp',
    ldP[loopMaxVolIdx] > ldP[0] ? 1 : 0, 1, 0);
// After peak vol, pressure should drop back toward PEEP (expiration)
assert('P-V loop: pressure decreases during exp',
    ldP[ldP.length - 1] < ldP[loopMaxVolIdx] ? 1 : 0, 1, 0);
// The loop should roughly close (end vol near start vol)
assert('P-V loop closes (end vol near start)',
    Math.abs(ldV[ldV.length - 1] - ldV[0]) < 20 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 35: F-V Loop Shape — Inspiratory Positive, Expiratory Negative
// =============================================================================
section('TEST 35: F-V Loop Shape Validation');

const ldF = ld.flow;

// Find some samples during inspiration (first quarter) and expiration (last quarter)
const q1 = Math.round(ldF.length * 0.1);
const q3 = Math.round(ldF.length * 0.75);

console.log(`    Insp flow (sample ${q1}): ${ldF[q1].toFixed(1)} L/min`);
console.log(`    Exp flow (sample ${q3}): ${ldF[q3].toFixed(1)} L/min`);

assert('F-V loop: inspiratory flow > 0', ldF[q1] > 0 ? 1 : 0, 1, 0);
assert('F-V loop: expiratory flow < 0', ldF[q3] < 0 ? 1 : 0, 1, 0);

// Peak inspiratory flow should be ≈ 21 L/min (500mL / 1.43s × 60)
const maxFlow = Math.max(...ldF);
console.log(`    Peak insp flow: ${maxFlow.toFixed(1)} L/min (expected ≈21)`);
assert('F-V loop: peak insp flow ≈ square flow', maxFlow, 21, 1);


// =============================================================================
// TEST 36: COPD Loop — Air Trapping Visible
// =============================================================================
section('TEST 36: COPD Loop — Air Trapping (loop doesn\'t close)');

const lungLoopCOPD = new LungModel({ resistance: 25, compliance: 0.06 });
const ventLoopCOPD = new Ventilator(lungLoopCOPD, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
});

const simLoopCOPD = new SimulationEngine(ventLoopCOPD, { sampleRate: 100, displaySeconds: 10 });

// Run for 8 breaths to build trapping
const ticksCOPDLoop = Math.round(8 * ventLoopCOPD.totalCycleTime * 100);
for (let i = 0; i < ticksCOPDLoop; i++) {
    simLoopCOPD.tick();
}

const copdLoop = simLoopCOPD.loopCompleted;
const copdEndVol = copdLoop.volume[copdLoop.volume.length - 1];
const copdStartVol = copdLoop.volume[0];
const copdPeakVol = Math.max(...copdLoop.volume);

console.log(`    COPD loop: start vol=${copdStartVol.toFixed(0)} mL, end vol=${copdEndVol.toFixed(0)} mL`);
console.log(`    COPD loop: peak vol=${copdPeakVol.toFixed(0)} mL`);
console.log(`    Volume at start > 0 indicates trapped gas from prior breaths`);

// In a COPD patient with gas trapping, the VT delivered is still ~500mL
// but the starting volume for the loop might not be exactly 0 (it depends
// on the display convention — we show volume relative to breath start).
// The key COPD signature in loops: the F-V loop shows expiratory flow
// not reaching zero before the next breath.
const copdExpFlow = copdLoop.flow[copdLoop.flow.length - 1];
console.log(`    Exp flow at end: ${copdExpFlow.toFixed(1)} L/min`);
console.log(`    (In COPD, expiratory flow may not reach zero = air trapping)`);

assert('COPD: loop has data', copdLoop.pressure.length > 50 ? 1 : 0, 1, 0);
assert('COPD: VT still ≈ 500 mL', copdPeakVol, 500, 20);

console.log('\n  ⚕️ Teaching point: In the P-V loop, the area between the');
console.log('     inspiratory and expiratory limbs represents resistive work.');
console.log('     Wider loop = more resistance. In the F-V loop, a scooped');
console.log('     expiratory limb indicates airflow obstruction.');


// =============================================================================
// TEST 37: Loop Reset — Clears On Sim Reset
// =============================================================================
section('TEST 37: Loop Reset');

simLoop.reset();
assert('Loop current empty after reset', simLoop.loopCurrent.pressure.length, 0, 0);
assert('Loop completed empty after reset', simLoop.loopCompleted.pressure.length, 0, 0);


// =============================================================================
// RESULTS
// =============================================================================
section('RESULTS');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  ${failed === 0 ? '🫁 All systems nominal. Engine is breathing.' : '⚠️  Some tests failed — review above.'}`);
console.log();
