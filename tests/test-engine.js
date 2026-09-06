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
import {
    Ventilator,
    MODE_VC_CMV,
    MODE_PC_CMV,
    MODE_PC_CSV,
    SUPPORTED_MODES,
} from '../js/ventilator.js';
import { SimulationEngine, RingBuffer } from '../js/simulation.js';
import AlarmEngine from '../alarms.js';
import { alarmSignature, shouldPlayAlarmSound } from '../alarm-audio.js';

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

function assertBetween(label, actual, min, max) {
    const ok = Number.isFinite(actual) && actual >= min && actual <= max;
    if (ok) {
        console.log(`  âœ“ ${label}: ${actual.toFixed(3)} within [${min}, ${max}]`);
        passed++;
    } else {
        console.log(`  âœ— ${label}: got ${actual}, expected within [${min}, ${max}]`);
        failed++;
    }
}

function assertTrue(label, condition) {
    if (condition) {
        console.log(`  âœ“ ${label}`);
        passed++;
    } else {
        console.log(`  âœ— ${label}`);
        failed++;
    }
}

function assertFinite(label, value) {
    assertTrue(label, typeof value === 'number' && Number.isFinite(value));
}

function assertDefined(label, value) {
    assertTrue(label, value !== undefined && value !== null);
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
section('Banner: Ventilator — Normal (R=10, C=0.05), VT=500, RR=14, I:E=1:2 — full TEST 4 follows TEST 3A');

section('TEST 3A: Expiratory Completion - Analytical Time Constant Invariants');

const tauAnalyticalTest = 1.0;

assert('Completion at 1tau (%)',
    expectedExpCompletionPercent(1 * tauAnalyticalTest, tauAnalyticalTest), 63.2, 0.01);

assert('Completion at 2tau (%)',
    expectedExpCompletionPercent(2 * tauAnalyticalTest, tauAnalyticalTest), 86.5, 0.01);

assert('Completion at 3tau (%)',
    expectedExpCompletionPercent(3 * tauAnalyticalTest, tauAnalyticalTest), 95.0, 0.01);

assert('Completion at 5tau (%)',
    expectedExpCompletionPercent(5 * tauAnalyticalTest, tauAnalyticalTest), 99.3, 0.01);


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
assert('Normal expiratory completion', ventNormal.expiratoryCompletion, 1 - Math.exp(-ventNormal.teOverTau), 0.001);
assert('Normal expiratory completion (%)', ventNormal.expiratoryCompletionPercent, 99.7, 0.01);
assert('Normal expiratory completion status', ventNormal.expiratoryCompletionStatus === 'complete' ? 1 : 0, 1, 0);
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
assert('COPD expiratory completion (%)', ventCOPD.expiratoryCompletionPercent, 85.1, 0.02);
assert('COPD expiratory completion status', ventCOPD.expiratoryCompletionStatus === 'incomplete' ? 1 : 0, 1, 0);
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
assert('Summary includes trigger type',
    summary.settings.triggerType === ventNormal.triggerType ? 1 : 0, 1, 0);
assert('Summary includes flow trigger threshold',
    summary.settings.flowTriggerLpm, ventNormal.flowTriggerLpm, 0);
assert('Summary includes pressure trigger threshold',
    summary.settings.pressureTriggerCmH2O, ventNormal.pressureTriggerCmH2O, 0);
assert('Summary includes expiratory completion', summary.safety.expiratoryCompletion, ventNormal.expiratoryCompletion, 0.001);
assert('Summary includes expiratory completion %', summary.safety.expiratoryCompletionPercent, ventNormal.expiratoryCompletionPercent, 0.001);
assert('Summary includes expiratory completion status', summary.safety.expiratoryCompletionStatus === ventNormal.expiratoryCompletionStatus ? 1 : 0, 1, 0);


// =============================================================================
// TEST 9: Patient Presets
// =============================================================================
section('TEST 8A: Expiratory Metrics - Summary Data Contract');

const simNormalContract = new SimulationEngine(ventNormal, {
    sampleRate: 100,
    displaySeconds: 10,
});
runSimForSeconds(simNormalContract, 4 * ventNormal.totalCycleTime);

const metricsNormalContract = extractSafetyMetrics(ventNormal, simNormalContract);

assertDefined('expiratoryCompletionPercent exists', metricsNormalContract.expiratoryCompletionPercent);
assertFinite('expiratoryCompletionPercent is finite', metricsNormalContract.expiratoryCompletionPercent);

assertDefined('flowBaselineReached exists', metricsNormalContract.flowBaselineReached);
assertTrue('flowBaselineReached is boolean',
    typeof metricsNormalContract.flowBaselineReached === 'boolean');

assertDefined('expiratoryCompletionStatus exists', metricsNormalContract.expiratoryCompletionStatus);
assertTrue('expiratoryCompletionStatus is string',
    typeof metricsNormalContract.expiratoryCompletionStatus === 'string');


// =============================================================================
// TEST 8B: Flow Baseline + Exp Completion - Normal Lung
// =============================================================================
section('TEST 8B: Flow Baseline + Exp Completion - Normal VC-CMV');

const normalExpectedCompletionTargeted =
    expectedExpCompletionPercent(ventNormal.effectiveExpiratoryTime, normalLung.timeConstant);

const normalExpectedEndFlowTargeted =
    expectedEndExpFlowLpm(
        ventNormal.tidalVolume,
        normalLung.resistance,
        normalLung.compliance,
        ventNormal.effectiveExpiratoryTime
    );

const simNormalTargeted = new SimulationEngine(ventNormal, {
    sampleRate: 100,
    displaySeconds: 10,
});
runSimForSeconds(simNormalTargeted, 5 * ventNormal.totalCycleTime);

console.log(`  Expected completion: ${normalExpectedCompletionTargeted.toFixed(1)}%`);
console.log(`  Expected end-exp flow: ${normalExpectedEndFlowTargeted.toFixed(2)} L/min`);

assertBetween('Normal exp completion is near complete',
    normalExpectedCompletionTargeted, 99.0, 100.0);

assertTrue('Normal expected flow baseline reached',
    expectedFlowBaselineReached(
        ventNormal.tidalVolume,
        normalLung.resistance,
        normalLung.compliance,
        ventNormal.effectiveExpiratoryTime
    ));

const normalTargetedMetrics = extractSafetyMetrics(ventNormal, simNormalTargeted);

assertBetween('Simulator exp completion normal (%)',
    normalTargetedMetrics.expiratoryCompletionPercent, 99.0, 100.0);

assertTrue('Simulator flow baseline reached normal',
    normalTargetedMetrics.flowBaselineReached === true);


// =============================================================================
// TEST 8C: Flow Baseline + Exp Completion - COPD Short Te
// =============================================================================
section('TEST 8C: Flow Baseline + Exp Completion - COPD Short Te');

const lungCOPDShortTeTargeted = new LungModel({ resistance: 25, compliance: 0.06 });

const ventCOPDShortTeTargeted = new Ventilator(lungCOPDShortTeTargeted, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 30,
    ieRatio: [1, 1],
    peep: 5,
});

const copdShortExpectedCompletionTargeted =
    expectedExpCompletionPercent(
        ventCOPDShortTeTargeted.effectiveExpiratoryTime,
        lungCOPDShortTeTargeted.timeConstant
    );

const copdShortExpectedEndFlowTargeted =
    expectedEndExpFlowLpm(
        ventCOPDShortTeTargeted.tidalVolume,
        lungCOPDShortTeTargeted.resistance,
        lungCOPDShortTeTargeted.compliance,
        ventCOPDShortTeTargeted.effectiveExpiratoryTime
    );

const simCOPDShortTeTargeted = new SimulationEngine(ventCOPDShortTeTargeted, {
    sampleRate: 100,
    displaySeconds: 10,
});
runSimForSeconds(simCOPDShortTeTargeted, 8 * ventCOPDShortTeTargeted.totalCycleTime);

console.log(`  Te=${ventCOPDShortTeTargeted.effectiveExpiratoryTime.toFixed(2)}s`);
console.log(`  tau=${lungCOPDShortTeTargeted.timeConstant.toFixed(2)}s`);
console.log(`  Te/tau=${ventCOPDShortTeTargeted.teOverTau.toFixed(2)}`);
console.log(`  Expected completion=${copdShortExpectedCompletionTargeted.toFixed(1)}%`);
console.log(`  Expected end-exp flow=${copdShortExpectedEndFlowTargeted.toFixed(1)} L/min`);

assertTrue('COPD short Te has Te/tau < 3',
    ventCOPDShortTeTargeted.teOverTau < 3);

assertBetween('COPD short Te exp completion reduced (%)',
    copdShortExpectedCompletionTargeted, 40, 90);

assertTrue('COPD short Te expected flow baseline NOT reached',
    expectedFlowBaselineReached(
        ventCOPDShortTeTargeted.tidalVolume,
        lungCOPDShortTeTargeted.resistance,
        lungCOPDShortTeTargeted.compliance,
        ventCOPDShortTeTargeted.effectiveExpiratoryTime
    ) === false);

const copdShortTargetedMetrics = extractSafetyMetrics(ventCOPDShortTeTargeted, simCOPDShortTeTargeted);

assertBetween('Simulator COPD short Te exp completion (%)',
    copdShortTargetedMetrics.expiratoryCompletionPercent, 40, 90);

assertTrue('Simulator COPD short Te flow baseline NOT reached',
    copdShortTargetedMetrics.flowBaselineReached === false);


// =============================================================================
// TEST 8D: Flow Baseline + Exp Completion - COPD Long Te Recovery
// =============================================================================
section('TEST 8D: Flow Baseline + Exp Completion - COPD Long Te Recovery');

const lungCOPDLongTeTargeted = new LungModel({ resistance: 25, compliance: 0.06 });

const ventCOPDLongTeTargeted = new Ventilator(lungCOPDLongTeTargeted, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 8,
    ieRatio: [1, 4],
    peep: 5,
});

const copdLongExpectedCompletionTargeted =
    expectedExpCompletionPercent(
        ventCOPDLongTeTargeted.effectiveExpiratoryTime,
        lungCOPDLongTeTargeted.timeConstant
    );

const copdLongExpectedEndFlowTargeted =
    expectedEndExpFlowLpm(
        ventCOPDLongTeTargeted.tidalVolume,
        lungCOPDLongTeTargeted.resistance,
        lungCOPDLongTeTargeted.compliance,
        ventCOPDLongTeTargeted.effectiveExpiratoryTime
    );

const simCOPDLongTeTargeted = new SimulationEngine(ventCOPDLongTeTargeted, {
    sampleRate: 100,
    displaySeconds: 10,
});
runSimForSeconds(simCOPDLongTeTargeted, 8 * ventCOPDLongTeTargeted.totalCycleTime);

console.log(`  Te=${ventCOPDLongTeTargeted.effectiveExpiratoryTime.toFixed(2)}s`);
console.log(`  tau=${lungCOPDLongTeTargeted.timeConstant.toFixed(2)}s`);
console.log(`  Te/tau=${ventCOPDLongTeTargeted.teOverTau.toFixed(2)}`);
console.log(`  Expected completion=${copdLongExpectedCompletionTargeted.toFixed(1)}%`);
console.log(`  Expected end-exp flow=${copdLongExpectedEndFlowTargeted.toFixed(2)} L/min`);

assertTrue('COPD long Te has Te/tau >= 3',
    ventCOPDLongTeTargeted.teOverTau >= 3);

assertBetween('COPD long Te exp completion near complete (%)',
    copdLongExpectedCompletionTargeted, 95, 100);

assertTrue('COPD long Te expected flow baseline reached',
    expectedFlowBaselineReached(
        ventCOPDLongTeTargeted.tidalVolume,
        lungCOPDLongTeTargeted.resistance,
        lungCOPDLongTeTargeted.compliance,
        ventCOPDLongTeTargeted.effectiveExpiratoryTime
    ));

const copdLongTargetedMetrics = extractSafetyMetrics(ventCOPDLongTeTargeted, simCOPDLongTeTargeted);

assertBetween('Simulator COPD long Te exp completion (%)',
    copdLongTargetedMetrics.expiratoryCompletionPercent, 95, 100);

assertTrue('Simulator COPD long Te flow baseline reached',
    copdLongTargetedMetrics.flowBaselineReached === true);


// =============================================================================
// TEST 8E: Cross-Mode Consistency - VC-CMV vs PC-CMV Exp Completion
// =============================================================================
section('TEST 8E: Cross-Mode Consistency - VC-CMV vs PC-CMV Exp Completion');

const lungCrossModeTargeted = new LungModel({ resistance: 10, compliance: 0.05 });

const ventVCCrossMode = new Ventilator(lungCrossModeTargeted, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

const ventPCCrossMode = new Ventilator(lungCrossModeTargeted, {
    mode: 'pc-cmv',
    inspiratoryPressure: 15,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

const simVCCrossMode = new SimulationEngine(ventVCCrossMode, {
    sampleRate: 100,
    displaySeconds: 10,
});
const simPCCrossMode = new SimulationEngine(ventPCCrossMode, {
    sampleRate: 100,
    displaySeconds: 10,
});
runSimForSeconds(simVCCrossMode, 5 * ventVCCrossMode.totalCycleTime);
runSimForSeconds(simPCCrossMode, 5 * ventPCCrossMode.totalCycleTime);

const vcCrossModeMetrics = extractSafetyMetrics(ventVCCrossMode, simVCCrossMode);
const pcCrossModeMetrics = extractSafetyMetrics(ventPCCrossMode, simPCCrossMode);

assert('VC and PC Te/tau match',
    ventVCCrossMode.teOverTau, ventPCCrossMode.teOverTau, 0.001);

assert('VC and PC exp completion percent match',
    vcCrossModeMetrics.expiratoryCompletionPercent,
    pcCrossModeMetrics.expiratoryCompletionPercent,
    0.01);

assertTrue('VC flow baseline reached',
    vcCrossModeMetrics.flowBaselineReached === true);

assertTrue('PC flow baseline reached',
    pcCrossModeMetrics.flowBaselineReached === true);


// =============================================================================
// TEST 8F: Measured RR - Real-Time Engine Accuracy
// =============================================================================
section('TEST 8F: Measured RR - Real-Time Engine Accuracy');

const lungRRTargeted = new LungModel({ resistance: 10, compliance: 0.05 });

const ventRRTargeted = new Ventilator(lungRRTargeted, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    peep: 5,
});

const simRRTargeted = new SimulationEngine(ventRRTargeted, {
    sampleRate: 100,
    displaySeconds: 10,
});

runSimForSeconds(simRRTargeted, 25);

const rrTargetedMetrics = extractSafetyMetrics(ventRRTargeted, simRRTargeted);

assertDefined('measuredRR exists', rrTargetedMetrics.measuredRR);
assertFinite('measuredRR is finite', rrTargetedMetrics.measuredRR);

console.log(`  Measured RR=${rrTargetedMetrics.measuredRR.toFixed(1)}; Set RR=14`);

assertBetween('Measured RR approximates set RR',
    rrTargetedMetrics.measuredRR, 13.5, 14.5);


// =============================================================================
// TEST 8G: VSM-CLIN-003 — PC-CSV completed-breath classification
// =============================================================================
section('TEST 8G: VSM-CLIN-003 — PC-CSV Cycle Agent and Breath Type');

function capturePcCsvCompletion({
    resistance,
    compliance,
    respiratoryRate,
    ieRatio,
    cyclePercent,
    holdTime = 0,
}) {
    const lung = new LungModel({ resistance, compliance });
    const vent = new Ventilator(lung, {
        mode: MODE_PC_CSV,
        inspiratoryPressure: 17,
        psPressure: 10,
        respiratoryRate,
        ieRatio,
        cyclePercent,
        peep: 5,
        holdTime,
        pMusMax: 8,
        neuralTi: 1.0,
        flowTriggerLpm: 2,
    });
    const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
    sim.patientRR = 18;

    let currentBreathAtInspiration = null;
    let sawHold = false;
    for (let tick = 0; tick < 5000; tick++) {
        const phaseBefore = sim.phase;
        sim.tick();
        sawHold ||= sim.phase === 'HOLD';

        if (phaseBefore === 'EXPIRATION' && sim.phase === 'INSPIRATION') {
            currentBreathAtInspiration = { ...sim.currentBreath };
        }
        if (phaseBefore === 'INSPIRATION' && sim.phase === 'EXPIRATION') {
            return {
                vent,
                sim,
                record: sim.lastCompletedBreath,
                currentBreathAtInspiration,
                sawHold,
                boundaryTime_s: sim.buffers.time.toArray().at(-1),
                boundaryPressure_cmH2O: sim.buffers.pressure.toArray().at(-1),
                waveformBoundaryVT_mL: sim.buffers.volume.toArray().at(-1),
                waveformBoundaryFlow_Lpm: sim.buffers.flow.toArray().at(-1),
                loopBoundaryVT_mL: sim.loopCurrent.volume.at(-1),
                loopBoundaryFlow_Lpm: sim.loopCurrent.flow.at(-1),
                boundarySampleIndex: sim._sampleCount - 1,
            };
        }
    }

    throw new Error('PC-CSV trace did not complete an inspiration within 50 seconds');
}

const flowCycleTrace = capturePcCsvCompletion({
    resistance: 10,
    compliance: 0.05,
    respiratoryRate: 14,
    ieRatio: [1, 2],
    cyclePercent: 25,
    holdTime: 0.75,
});
const maxTiTrace = capturePcCsvCompletion({
    resistance: 25,
    compliance: 0.06,
    respiratoryRate: 35,
    ieRatio: [1, 1],
    cyclePercent: 10,
});

console.log(
    `  Flow-cycle: Ti=${flowCycleTrace.record.inspiratoryTime_s.toFixed(2)}s`
    + ` flow=${flowCycleTrace.record.flowAtTermination_Lpm.toFixed(2)} L/min`
    + ` threshold=${flowCycleTrace.record.flowCycleThreshold_Lpm.toFixed(2)} L/min`
);
console.log(
    `  Maximum-Ti: Ti=${maxTiTrace.record.inspiratoryTime_s.toFixed(2)}s`
    + ` flow=${maxTiTrace.record.flowAtTermination_Lpm.toFixed(2)} L/min`
    + ` threshold=${maxTiTrace.record.flowCycleThreshold_Lpm.toFixed(2)} L/min`
);

assertTrue('VSM-CLIN-003 supported inventory is exact, case-sensitive, and excludes VC-CSV',
    JSON.stringify(SUPPORTED_MODES) === JSON.stringify([
        MODE_VC_CMV, MODE_PC_CMV, 'PC-CSV',
    ])
    && MODE_PC_CSV === 'PC-CSV'
    && !SUPPORTED_MODES.includes('VC-CSV'));

assertTrue('VSM-CLIN-003 PC-CSV pressure support targets psPressure above PEEP',
    flowCycleTrace.vent.pressureControlLevel === 10
    && Math.abs(flowCycleTrace.boundaryPressure_cmH2O - 15) < 1e-9);

assertTrue('VSM-CLIN-003 configured inspiratory hold is inapplicable in PC-CSV',
    flowCycleTrace.vent.holdTime === 0.75
    && flowCycleTrace.vent.effectiveHoldTime === 0
    && !flowCycleTrace.vent.holdActive
    && !flowCycleTrace.sawHold);

const passiveCsv = new SimulationEngine(new Ventilator(
    new LungModel({ resistance: 10, compliance: 0.05 }),
    { mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25, peep: 5 }
));
// VSM-CLIN-004 strengthens the existing composite without removing its
// no-breath/classification predicates or changing the commissioned tally.
const passiveCsvInitialized = passiveCsv.lastCompletedBreath === null
    && passiveCsv.breathSummary.pipLatched === 0
    && passiveCsv.breathSummary.pplat === null
    && passiveCsv.volumeAtBreathStart === 0;
runSimForSeconds(passiveCsv, 15);
assertTrue('VSM-CLIN-003 passive PC-CSV completes no breath and measured RR stays zero',
    passiveCsv.breathCount === 0
    && passiveCsv.measuredRR === 0
    && passiveCsv.lastCompletedBreath === null
    && passiveCsvInitialized
    && passiveCsv.breathSummary.pipLatched === 0
    && passiveCsv.breathSummary.pplat === null
    && passiveCsv.volumeAtBreathStart === 0
    && passiveCsv.vent.summary().pressures.map_cmH2O > 0);

const firstCsvWarmup = flowCycleTrace.sim.measuredRR === 0;
const firstCsvBreathCount = flowCycleTrace.sim.breathCount;
for (let tick = 0; tick < 1000 && flowCycleTrace.sim.breathCount === firstCsvBreathCount; tick++) {
    flowCycleTrace.sim.tick();
}
const finalizedVtSurvivesNextStart = flowCycleTrace.sim.lastCompletedBreath === flowCycleTrace.record
    && flowCycleTrace.sim.lastCompletedBreath.measuredVT_mL === flowCycleTrace.record.measuredVT_mL
    && flowCycleTrace.sim.measuredVT_mL === 0
    && flowCycleTrace.sim.breathCount === firstCsvBreathCount + 1;

runSimForSeconds(flowCycleTrace.sim, 25);
assertTrue('VSM-CLIN-003 current PC-CSV breaths are patient-triggered and measured RR follows effort',
    flowCycleTrace.currentBreathAtInspiration.configuredMode === 'PC-CSV'
    && flowCycleTrace.currentBreathAtInspiration.triggerAgent === 'patient'
    && flowCycleTrace.sim.measuredRR >= 16
    && flowCycleTrace.sim.measuredRR <= 20
    && flowCycleTrace.sim.lastCompletedBreath !== flowCycleTrace.record
    && flowCycleTrace.sim.lastCompletedBreath.completedAt_s
        > flowCycleTrace.record.completedAt_s);

assertTrue('VSM-CLIN-003 flow-cycle record is PC-CSV, patient/patient, flowCycle, spontaneous',
    flowCycleTrace.record.configuredMode === 'PC-CSV'
    && flowCycleTrace.record.triggerAgent === 'patient'
    && flowCycleTrace.record.cycleAgent === 'patient'
    && flowCycleTrace.record.terminationReason === 'flowCycle'
    && flowCycleTrace.record.breathType === 'spontaneous'
    && flowCycleTrace.record.flowAtTermination_Lpm
        <= flowCycleTrace.record.flowCycleThreshold_Lpm);

assertTrue('VSM-CLIN-003 maximum-Ti record is PC-CSV, patient/machine, maxTiReached, mandatory',
    maxTiTrace.record.configuredMode === 'PC-CSV'
    && maxTiTrace.record.triggerAgent === 'patient'
    && maxTiTrace.record.cycleAgent === 'machine'
    && maxTiTrace.record.terminationReason === 'maxTiReached'
    && maxTiTrace.record.breathType === 'mandatory'
    && maxTiTrace.record.inspiratoryTime_s >= 0.85
    && maxTiTrace.record.inspiratoryTime_s <= 0.88
    && maxTiTrace.record.flowAtTermination_Lpm
        > maxTiTrace.record.flowCycleThreshold_Lpm);

assertTrue('VSM-CLIN-003 finalized records agree with their waveform and loop boundary sample',
    firstCsvWarmup && finalizedVtSurvivesNextStart
    && [flowCycleTrace, maxTiTrace].every(trace =>
        trace.record.boundarySampleIndex === trace.boundarySampleIndex
        && Math.abs(trace.record.completedAt_s - trace.boundaryTime_s) < 1e-12
        && Math.abs(trace.record.measuredVT_mL - trace.waveformBoundaryVT_mL) < 1e-9
        && Math.abs(trace.record.measuredVT_mL - trace.loopBoundaryVT_mL) < 1e-9
        && Math.abs(trace.record.flowAtTermination_Lpm
            - trace.waveformBoundaryFlow_Lpm) < 1e-9
        && Math.abs(trace.record.flowAtTermination_Lpm
            - trace.loopBoundaryFlow_Lpm) < 1e-9
        && trace.sim.getTriggerEvents().some(event =>
            event.type === trace.record.triggerAgent
            && Math.abs(event.time - trace.record.startedAt_s) < 1e-12)));

maxTiTrace.vent.cyclePercent = 100;
runSimForSeconds(maxTiTrace.sim, 10);
const postMaxTiRecord = maxTiTrace.sim.lastCompletedBreath;
flowCycleTrace.sim.reset();
assertTrue('VSM-CLIN-003 consecutive breaths replace classification and reset clears metadata',
    postMaxTiRecord !== maxTiTrace.record
    && postMaxTiRecord.completedAt_s > maxTiTrace.record.completedAt_s
    && postMaxTiRecord.configuredMode === 'PC-CSV'
    && postMaxTiRecord.terminationReason === 'flowCycle'
    && postMaxTiRecord.cycleAgent === 'patient'
    && postMaxTiRecord.breathType === 'spontaneous'
    && flowCycleTrace.sim.currentBreath === null
    && flowCycleTrace.sim.lastCompletedBreath === null
    && flowCycleTrace.sim.breathSummary.pipLatched === 0
    && flowCycleTrace.sim.breathSummary.pplat === null
    && flowCycleTrace.sim.measuredRR === 0
    && flowCycleTrace.sim.volumeAtBreathStart === 0);

maxTiTrace.vent.mode = MODE_PC_CMV;
maxTiTrace.sim.reset();
const modeResetUnavailable = maxTiTrace.sim.lastCompletedBreath === null
    && maxTiTrace.sim.breathSummary.pipLatched === 0
    && maxTiTrace.sim.breathSummary.pplat === null
    && maxTiTrace.sim.measuredRR === 0
    && maxTiTrace.sim.volumeAtBreathStart === 0;
for (let tick = 0; tick < 1000 && !maxTiTrace.sim.lastCompletedBreath; tick++) {
    maxTiTrace.sim.tick();
}
assertTrue('VSM-CLIN-003 mode transition cannot retain prior PC-CSV cycle metadata',
    maxTiTrace.sim.lastCompletedBreath.configuredMode === MODE_PC_CMV
    && maxTiTrace.sim.lastCompletedBreath.cycleAgent === 'machine'
    && maxTiTrace.sim.lastCompletedBreath.terminationReason === null
    && maxTiTrace.sim.lastCompletedBreath.breathType === 'mandatory'
    && modeResetUnavailable);


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
section('TEST 9A: PC-CMV — Normal Lung (R=10, C=0.05)');

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
section('TEST 9B: PC-CMV — ARDS (R=10, C=0.035)');

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
section('TEST 9C: PC-CMV — COPD with Gas Trapping (R=25, C=0.06)');

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
// TEST 26: SimEngine — Passive VC-CMV Numerical Characterization
// =============================================================================
section('TEST 26: SimEngine — Passive VC-CMV Numerical Characterization');

// VSM-CLIN-002 characterizes the commissioned live implementation; it does not
// require live VT to equal set VT. "Stable post-startup" here is the third
// completed mandatory breath. The second and third completed breaths must
// repeat after the startup-specific phase alignment has passed.
const vcCharacterizationTolerance_mL = 1e-9;
const vcStepTolerance_L = 1e-12;
const vcCharacterizationMatrix = [
    { flowPattern: 'square', tidalVolume: 0.300, respiratoryRate: 20, ti: 1.0,   startupVT_mL: 303.000, stableVT_mL: 300.000 },
    { flowPattern: 'ramp',   tidalVolume: 0.300, respiratoryRate: 20, ti: 1.0,   startupVT_mL: 303.000, stableVT_mL: 297.000 },
    { flowPattern: 'square', tidalVolume: 0.300, respiratoryRate: 12, ti: 5 / 3, startupVT_mL: 302.400, stableVT_mL: 300.600 },
    { flowPattern: 'ramp',   tidalVolume: 0.300, respiratoryRate: 12, ti: 5 / 3, startupVT_mL: 301.8024, stableVT_mL: 298.2024 },
    { flowPattern: 'square', tidalVolume: 0.500, respiratoryRate: 20, ti: 1.0,   startupVT_mL: 505.000, stableVT_mL: 500.000 },
    { flowPattern: 'ramp',   tidalVolume: 0.500, respiratoryRate: 20, ti: 1.0,   startupVT_mL: 505.000, stableVT_mL: 495.000 },
    { flowPattern: 'square', tidalVolume: 0.500, respiratoryRate: 12, ti: 5 / 3, startupVT_mL: 504.000, stableVT_mL: 501.000 },
    { flowPattern: 'ramp',   tidalVolume: 0.500, respiratoryRate: 12, ti: 5 / 3, startupVT_mL: 503.004, stableVT_mL: 497.004 },
];

function characterizeVcBoundary(testCase) {
    const lung = new LungModel({ resistance: 10, compliance: 0.05 });
    const vent = new Ventilator(lung, {
        mode: 'vc-cmv',
        flowPattern: testCase.flowPattern,
        tidalVolume: testCase.tidalVolume,
        respiratoryRate: testCase.respiratoryRate,
        ieRatio: [1, 2],
        peep: 5,
    });
    const sim = new SimulationEngine(vent);
    const analyticalWaveform = vent.generateBreathWaveforms(1);
    const completed = [];

    for (let ticks = 0; completed.length < 3 && ticks < 2000; ticks++) {
        const phaseBefore = sim.phase;
        sim.tick();
        if (phaseBefore === 'INSPIRATION' && sim.phase === 'EXPIRATION') {
            completed.push({
                measuredVT_mL: sim.measuredVT_mL,
                waveformBoundaryVT_mL: sim.buffers.volume.toArray().at(-1),
                loopBoundaryVT_mL: sim.loopCurrent.volume.at(-1),
            });
        }
    }

    return {
        ...testCase,
        sampleRate: sim.sampleRate,
        dt: sim.dt,
        actualTi: vent.inspiratoryTime,
        analyticalVT_mL: Math.max(...analyticalWaveform.volume),
        completed,
    };
}

const vcDefaultProbe = characterizeVcBoundary(vcCharacterizationMatrix[0]);
assertTrue('VSM-CLIN-002 commissioned live timestep is dt=0.01 s at 100 Hz',
    vcDefaultProbe.sampleRate === 100
    && Math.abs(vcDefaultProbe.dt - 0.01) < 1e-15);

// Probe a nonzero ramp time so a trapezoidal or other integration update does
// not coincide with Euler merely because square flow is constant.
const vcEulerLung = new LungModel({ resistance: 10, compliance: 0.05 });
const vcEulerVent = new Ventilator(vcEulerLung, {
    mode: 'vc-cmv', flowPattern: 'ramp', tidalVolume: 0.500,
    respiratoryRate: 20, ieRatio: [1, 2], peep: 5,
});
const vcEulerSim = new SimulationEngine(vcEulerVent);
vcEulerSim.tick();
const vcVolumeBefore_L = vcEulerSim.volumeAboveEq;
const vcPhaseTimeBefore_s = vcEulerSim.phaseTime;
const vcEulerFlow_Lps = (2 * vcEulerVent.tidalVolume / vcEulerVent.inspiratoryTime)
    * (1 - vcPhaseTimeBefore_s / vcEulerVent.inspiratoryTime);
vcEulerSim.tick();
assertTrue('VSM-CLIN-002 live VC update is explicit Euler: Vnext = Vcurrent + flow(t) * dt',
    Math.abs(
        vcEulerSim.volumeAboveEq
        - (vcVolumeBefore_L + vcEulerFlow_Lps * vcEulerSim.dt)
    ) < vcStepTolerance_L);

const vcCharacterization = vcCharacterizationMatrix.map(characterizeVcBoundary);
for (const result of vcCharacterization) {
    console.log(
        `    ${result.flowPattern.padEnd(6)} VT=${result.tidalVolume * 1000} mL`
        + ` Ti=${result.actualTi.toFixed(6)} s:`
        + ` analytical=${result.analyticalVT_mL.toFixed(4)}`
        + ` startup=${result.completed[0]?.measuredVT_mL.toFixed(4)}`
        + ` stable=${result.completed[2]?.measuredVT_mL.toFixed(4)} mL`
    );
}

assertTrue('VSM-CLIN-002 matrix analytical VC VT remains equal to set VT',
    vcCharacterization.every(result =>
        Math.abs(result.actualTi - result.ti) < 1e-12
        && Math.abs(result.analyticalVT_mL - result.tidalVolume * 1000)
            < vcCharacterizationTolerance_mL));

assertTrue('VSM-CLIN-002 matrix pins startup and repeated post-startup VC boundaries',
    vcCharacterization.every(result => {
        const [startup, second, stable] = result.completed;
        return result.completed.length === 3
            && Math.abs(startup.measuredVT_mL - result.startupVT_mL)
                < vcCharacterizationTolerance_mL
            && Math.abs(stable.measuredVT_mL - result.stableVT_mL)
                < vcCharacterizationTolerance_mL
            && Math.abs(second.measuredVT_mL - stable.measuredVT_mL)
                < vcCharacterizationTolerance_mL
            && Math.abs(startup.measuredVT_mL - stable.measuredVT_mL)
                > vcCharacterizationTolerance_mL;
    }));

assertTrue('VSM-CLIN-002 completed-breath waveform and loop boundaries equal finalized measuredVT_mL',
    vcCharacterization.every(result => result.completed.every(breath =>
        Math.abs(breath.waveformBoundaryVT_mL - breath.measuredVT_mL)
            < vcCharacterizationTolerance_mL
        && Math.abs(breath.loopBoundaryVT_mL - breath.measuredVT_mL)
            < vcCharacterizationTolerance_mL)));

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
assertTrue('Passive VC operational signals remain machine-triggered with complete expiration tracking',
    bs1.triggerType === 'machine'
    && sim1.getTriggerEvents(sim1.globalTime - sim1.displaySeconds, sim1.globalTime)
        .some(event => event.type === 'machine')
    && sim1.flowBaselineReached
    && sim1.expFlowReturnPercent === 100
    && sim1.expTailWindow
    && sim1.expTailWindow.end > sim1.expTailWindow.start);


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
    triggerType: 'flow',
    flowTriggerLpm: 2.0,
    pressureTriggerCmH2O: 1.0,
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
assert('Patient breath counter increments',
    bsTrig.patientBreathCount > 0 ? 1 : 0, 1, 0);
assert('Trigger markers include patient breaths',
    trigEvents.some(event => event.type === 'patient') ? 1 : 0, 1, 0);

const trigTimes = simTrig.buffers.time.toArray();
const trigPressures = simTrig.buffers.pressure.toArray();
const firstPatientEvent = trigEvents.find(event => event.type === 'patient');
const firstPatientIdx = trigTimes.findIndex(t => t >= firstPatientEvent.time);
if (firstPatientIdx > 0) {
    const preTriggerWindow = trigPressures.slice(Math.max(0, firstPatientIdx - 8), firstPatientIdx);
    const preTriggerNadir = Math.min(...preTriggerWindow);
    console.log(`    Pre-trigger nadir: ${preTriggerNadir.toFixed(2)} cmH2O (PEEP=${ventTrig.peep})`);
    assert('Patient-triggered breath has pre-trigger Paw dip',
        preTriggerNadir < (ventTrig.peep - 0.5) ? 1 : 0, 1, 0);
}

console.log('\n  ⚕️ Teaching point: When patient RR > vent RR, the patient triggers');
console.log('     additional breaths. The effective RR follows the patient.');
console.log('     This is normal Assist/Control behavior.');


// =============================================================================
// TEST 28D: Trigger Sensitivity — Weak Effort Easy Flow Trigger
// =============================================================================
section('TEST 28D: Trigger Sensitivity — Weak Effort Easy Flow Trigger');

const lungEasyFlow = new LungModel({ resistance: 10, compliance: 0.05 });
const ventEasyFlow = new Ventilator(lungEasyFlow, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 6,
    ieRatio: [1, 2],
    peep: 5,
    pMusMax: 2,
    neuralTi: 1.0,
    triggerType: 'flow',
    flowTriggerLpm: 0.5,
});

const simEasyFlow = new SimulationEngine(ventEasyFlow, { sampleRate: 100, displaySeconds: 10 });
simEasyFlow.patientRR = 20;

for (let i = 0; i < 1500; i++) simEasyFlow.tick();

assert('Easy flow trigger detects patient breaths',
    simEasyFlow.breathSummary.patientBreathCount > 0 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 28E: Trigger Sensitivity — Weak Effort Hard Flow Trigger
// =============================================================================
section('TEST 28E: Trigger Sensitivity — Weak Effort Hard Flow Trigger');

const lungHardFlow = new LungModel({ resistance: 10, compliance: 0.05 });
const ventHardFlow = new Ventilator(lungHardFlow, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 6,
    ieRatio: [1, 2],
    peep: 5,
    pMusMax: 0.5,
    neuralTi: 1.0,
    triggerType: 'flow',
    flowTriggerLpm: 5.0,
});

const simHardFlow = new SimulationEngine(ventHardFlow, { sampleRate: 100, displaySeconds: 10 });
simHardFlow.patientRR = 20;

for (let i = 0; i < 1500; i++) simHardFlow.tick();

assert('Hard flow trigger blocks weak patient efforts',
    simHardFlow.breathSummary.patientBreathCount === 0 ? 1 : 0, 1, 0);
assert('Hard flow trigger still allows machine backup breaths',
    simHardFlow.breathSummary.machineBreathCount > 0 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 28F: Trigger Sensitivity — Easy Pressure Trigger
// =============================================================================
section('TEST 28F: Trigger Sensitivity — Easy Pressure Trigger');

const lungEasyPressure = new LungModel({ resistance: 10, compliance: 0.05 });
const ventEasyPressure = new Ventilator(lungEasyPressure, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 6,
    ieRatio: [1, 2],
    peep: 5,
    pMusMax: 2,
    neuralTi: 1.0,
    triggerType: 'pressure',
    pressureTriggerCmH2O: 0.5,
});

const simEasyPressure = new SimulationEngine(ventEasyPressure, { sampleRate: 100, displaySeconds: 10 });
simEasyPressure.patientRR = 20;

for (let i = 0; i < 1500; i++) simEasyPressure.tick();

assert('Easy pressure trigger detects patient breaths',
    simEasyPressure.breathSummary.patientBreathCount > 0 ? 1 : 0, 1, 0);


// =============================================================================
// TEST 28G: Trigger Sensitivity — Hard Pressure Trigger
// =============================================================================
section('TEST 28G: Trigger Sensitivity — Hard Pressure Trigger');

const lungHardPressure = new LungModel({ resistance: 10, compliance: 0.05 });
const ventHardPressure = new Ventilator(lungHardPressure, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 6,
    ieRatio: [1, 2],
    peep: 5,
    pMusMax: 0.5,
    neuralTi: 1.0,
    triggerType: 'pressure',
    pressureTriggerCmH2O: 2.0,
});

const simHardPressure = new SimulationEngine(ventHardPressure, { sampleRate: 100, displaySeconds: 10 });
simHardPressure.patientRR = 20;

for (let i = 0; i < 1500; i++) simHardPressure.tick();

assert('Hard pressure trigger blocks weak patient efforts',
    simHardPressure.breathSummary.patientBreathCount === 0 ? 1 : 0, 1, 0);
assert('Hard pressure trigger still allows machine backup breaths',
    simHardPressure.breathSummary.machineBreathCount > 0 ? 1 : 0, 1, 0);


function expectedExpCompletionFraction(te, tau) {
    return 1 - Math.exp(-te / tau);
}

function expectedExpCompletionPercent(te, tau) {
    return expectedExpCompletionFraction(te, tau) * 100;
}

function expectedEndExpFlowLpm(vtL, resistance, compliance, te) {
    const tau = resistance * compliance;
    const initialExpFlowLps = vtL / compliance / resistance;
    return -initialExpFlowLps * Math.exp(-te / tau) * 60;
}

function expectedFlowBaselineReached(vtL, resistance, compliance, te, thresholdLpm = 1.0) {
    return Math.abs(expectedEndExpFlowLpm(vtL, resistance, compliance, te)) <= thresholdLpm;
}

function runSimForSeconds(sim, seconds) {
    const steps = Math.round(seconds * sim.sampleRate);
    for (let i = 0; i < steps; i++) {
        sim.tick();
    }
}

function extractSafetyMetrics(vent, sim = null) {
    const summary = typeof vent.summary === 'function' ? vent.summary() : {};
    const safety = summary.safety ?? {};

    return {
        expiratoryCompletionPercent:
            safety.expiratoryCompletionPercent ??
            safety.expCompletionPercent ??
            summary.expiratoryCompletionPercent ??
            summary.expCompletionPercent ??
            sim?.expiratoryCompletionPercent ??
            sim?.expCompletionPercent,

        expiratoryCompletion:
            safety.expiratoryCompletion ??
            summary.expiratoryCompletion ??
            sim?.expiratoryCompletion,

        expiratoryCompletionStatus:
            safety.expiratoryCompletionStatus ??
            summary.expiratoryCompletionStatus ??
            sim?.expiratoryCompletionStatus,

        flowBaselineReached:
            safety.flowBaselineReached ??
            summary.flowBaselineReached ??
            sim?.flowBaselineReached,

        measuredRR:
            summary.measuredRR ??
            safety.measuredRR ??
            sim?.measuredRR
    };
}

// =============================================================================
// TEST 28B: SimEngine — Lockout Effort Triggers After 100 ms
// =============================================================================
section('TEST 28B: SimEngine — Lockout Effort Triggers After 100 ms');

const lungLockout = new LungModel({ resistance: 10, compliance: 0.05 });
const ventLockout = new Ventilator(lungLockout, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 12, ieRatio: [1, 2], peep: 5,
    pMusMax: 8, neuralTi: 1.0,
});

const simLockout = new SimulationEngine(ventLockout, { sampleRate: 100, displaySeconds: 10 });
simLockout.patientRR = 35;  // First neural effort lands <100 ms into expiration

for (let i = 0; i < 250; i++) {
    simLockout.tick();
}

const lockoutEvents = simLockout.getTriggerEvents(0, simLockout.globalTime);
const lockoutPatient = lockoutEvents.filter(event => event.type === 'patient');
const lockoutFailed = lockoutEvents.filter(event => event.type === 'failed');
console.log(`    Breath count after 2.5 s: ${simLockout.breathCount}`);
console.log(`    Patient trigger markers: ${lockoutPatient.length}`);
console.log(`    Failed trigger markers: ${lockoutFailed.length}`);

assert('Lockout-onset effort later triggers', lockoutPatient.length > 0 ? 1 : 0, 1, 0);
assert('Persistent effort delivers a second breath', simLockout.breathCount, 2, 0);
assert('Persistent effort is not marked failed', lockoutFailed.length, 0, 0);


// =============================================================================
// TEST 28C: SimEngine — Patient Trigger Wins Timer Ties
// =============================================================================
section('TEST 28C: SimEngine — Patient Trigger Wins Timer Ties');

const lungTie = new LungModel({ resistance: 10, compliance: 0.05 });
const ventTie = new Ventilator(lungTie, {
    mode: 'vc-cmv', flowPattern: 'square',
    tidalVolume: 0.500, respiratoryRate: 12, ieRatio: [1, 2], peep: 5,
    pMusMax: 8, neuralTi: 1.0,
});

const simTie = new SimulationEngine(ventTie, { sampleRate: 100, displaySeconds: 10 });
simTie.patientRR = 12;  // Neural onset aligns with the machine timer

for (let i = 0; i < 700; i++) {
    simTie.tick();
}

const tieEvents = simTie.getTriggerEvents(0, simTie.globalTime);
const tieSecondEvent = tieEvents[1];
console.log(`    Breath count after 7.0 s: ${simTie.breathCount}`);
console.log(`    Second trigger: ${tieSecondEvent?.type ?? 'none'} at ${tieSecondEvent?.time?.toFixed(2) ?? 'n/a'} s`);

assert('Tie produces a second breath', simTie.breathCount, 2, 0);
assert('Patient trigger wins timer tie',
    tieSecondEvent && tieSecondEvent.type === 'patient' ? 1 : 0, 1, 0);


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
const holdRamp = simRamp.lastCompletedBreath.holdMechanics;
console.log(`    Ramp PIP=${bsRamp.pip}  VT=${bsRamp.vt_mL} mL`);
console.log(`    Pplat=${bsRamp.pplat ?? 'N/A'} (hold active → should measure)`);

const lungHoldContract = new LungModel({ resistance: 10, compliance: 0.05 });
const ventHoldContract = new Ventilator(lungHoldContract, {
    mode: 'vc-cmv', flowPattern: 'square', tidalVolume: 0.500,
    respiratoryRate: 20, ieRatio: [1, 2], peep: 5, holdTime: 0.5,
});
const simHoldContract = new SimulationEngine(ventHoldContract, { sampleRate: 100, displaySeconds: 10 });
for (let i = 0; i < 1000 && simHoldContract.lastCompletedBreath === null; i++) simHoldContract.tick();
const completedHoldContract = simHoldContract.lastCompletedBreath;
const holdContract = completedHoldContract.holdMechanics;
const expectedHoldDp = holdContract.pplat.value - holdContract.baseline.value_cmH2O;
const holdContractValid = holdContract.status === 'valid'
    && holdContract.sampleCount === 50 && holdContract.actualDuration_s === 0.5
    && holdContract.window.sampleCount === 20
    && holdContract.firstPhysicsSampleIndex === holdContract.entryBoundarySampleIndex + 1
    && holdContract.completionBoundarySampleIndex === completedHoldContract.boundarySampleIndex
    && holdContract.pplat.value !== ventHoldContract.pplat
    && holdContract.baseline.provenance === 'live-modeled-total-peep-at-breath-start'
    && holdContract.identity.breathId === completedHoldContract.breathId
    && holdContract.baseline.identity.breathId === completedHoldContract.breathId
    && holdContract.sources.identity.breathId === completedHoldContract.breathId
    && Math.abs(holdContract.drivingPressure.value - expectedHoldDp) < 1e-12
    && Math.abs(holdContract.compliance.value - completedHoldContract.measuredVT_mL / expectedHoldDp) < 1e-12
    && Math.abs(holdContract.resistance.value - 10) < 1e-9
    && holdContract.sources.endInspiratoryFlow_Lps > 0 && completedHoldContract.flowAtTermination_Lpm === 0
    && Object.isFrozen(completedHoldContract) && Object.isFrozen(holdContract.pplat.reasons)
    && holdRamp.pplat.status === 'valid' && holdRamp.compliance.status === 'valid'
    && holdRamp.resistance.status === 'inapplicable'
    && holdRamp.resistance.reasons.includes('RESISTANCE_RAMP_VC');

const lungShortHold = new LungModel({ resistance: 10, compliance: 0.05 });
const ventShortHold = new Ventilator(lungShortHold, {
    mode: 'vc-cmv', flowPattern: 'square', tidalVolume: 0.500,
    respiratoryRate: 20, ieRatio: [1, 2], peep: 5, holdTime: 0.4,
});
const simShortHold = new SimulationEngine(ventShortHold, { sampleRate: 100, displaySeconds: 10 });
for (let i = 0; i < 1000 && simShortHold.lastCompletedBreath === null; i++) simShortHold.tick();
const shortHoldRejected = simShortHold.lastCompletedBreath.holdMechanics.pplat.value === null
    && simShortHold.lastCompletedBreath.holdMechanics.reasons.includes('HOLD_TOO_SHORT')
    && simShortHold.lastCompletedBreath.holdMechanics.reasons.includes('INSUFFICIENT_SAMPLES');

simHoldContract.lastCompletedBreath = {
    ...completedHoldContract,
    holdMechanics: {
        ...holdContract,
        sources: { ...holdContract.sources, identity: { ...holdContract.sources.identity, breathId: 999 } },
    },
};
const sourceMismatchRejected = simHoldContract.holdMechanics.pplat.status === 'valid'
    && simHoldContract.holdMechanics.drivingPressure.status === 'valid'
    && simHoldContract.holdMechanics.compliance.reasons.includes('SOURCE_MISMATCH')
    && simHoldContract.holdMechanics.resistance.reasons.includes('SOURCE_MISMATCH');
simHoldContract.lastCompletedBreath = completedHoldContract;

ventHoldContract.peep = 6;
simHoldContract.notifyMeasurementSettingsChanged();
const staleAfterChange = simHoldContract.holdMechanics.reasons.includes('SETTINGS_CHANGED');
ventHoldContract.peep = 5;
simHoldContract.notifyMeasurementSettingsChanged();
const staleAfterRevert = simHoldContract.holdMechanics.reasons.includes('SETTINGS_CHANGED');

assert('Ramp sim VT ≈ 500', bsRamp.vt_mL, 500, 10);
assert('VSM-CLIN-005 completed-hold measurement contract',
    holdContractValid && shortHoldRejected && sourceMismatchRejected && staleAfterChange && staleAfterRevert ? 1 : 0, 1, 0);


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
assert('COPD flow baseline not reached', simCOPD.flowBaselineReached ? 1 : 0, 0, 0);
assert('COPD expiratory flow return percent < 100',
    simCOPD.expFlowReturnPercent < 100 ? 1 : 0, 1, 0);

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
// TEST 38: Measured RR — CMV Matches Completed Breath Timing
// =============================================================================
section('TEST 38: Measured RR — CMV Completed Breaths');

const lungMeasuredRR = new LungModel({ resistance: 10, compliance: 0.05 });
const ventMeasuredRR = new Ventilator(lungMeasuredRR, {
    mode: 'vc-cmv',
    flowPattern: 'square',
    tidalVolume: 0.500,
    respiratoryRate: 12,
    ieRatio: [1, 2],
    peep: 5,
});
const simMeasuredRR = new SimulationEngine(ventMeasuredRR, { sampleRate: 100, displaySeconds: 10 });

const ticksMeasuredRR = Math.round(8 * ventMeasuredRR.totalCycleTime * 100);
for (let i = 0; i < ticksMeasuredRR; i++) {
    simMeasuredRR.tick();
}

console.log(`    Set RR=${ventMeasuredRR.respiratoryRate}  Measured RR=${simMeasuredRR.measuredRR.toFixed(1)}`);
assert('Measured RR ≈ set RR in CMV', simMeasuredRR.measuredRR, ventMeasuredRR.respiratoryRate, 0.05);


// =============================================================================
// TEST 41: Alarm Engine — No Alerts Normal
// =============================================================================
section('TEST 41: Alarm Engine — No Alerts Normal');

let alarms = AlarmEngine.evaluateAlarms({
    nowSec: 30,
    elapsedSec: 30,
    lastBreathStartSec: 28,
    pipCmH2O: 18,
    pawCmH2O: 12,
    measuredRR: 14,
    minuteVentilationLpm: 7,
});

assert('No alarms in normal state', alarms.length, 0, 0);


// =============================================================================
// TEST 42: Alarm Engine — High Pressure
// =============================================================================
section('TEST 42: Alarm Engine — High Pressure');

alarms = AlarmEngine.evaluateAlarms({
    nowSec: 30,
    elapsedSec: 30,
    lastBreathStartSec: 28,
    pipCmH2O: 45,
    pawCmH2O: 45,
    measuredRR: 14,
    minuteVentilationLpm: 7,
});

assert('High pressure alarm active',
    alarms.some(alarm => alarm.id === 'HIGH_PRESSURE') ? 1 : 0, 1, 0);


// =============================================================================
// TEST 43: Alarm Engine — High RR
// =============================================================================
section('TEST 43: Alarm Engine — High RR');

alarms = AlarmEngine.evaluateAlarms({
    nowSec: 30,
    elapsedSec: 30,
    lastBreathStartSec: 29,
    pipCmH2O: 18,
    pawCmH2O: 12,
    measuredRR: 40,
    minuteVentilationLpm: 10,
});

assert('High RR alarm active',
    alarms.some(alarm => alarm.id === 'HIGH_RR') ? 1 : 0, 1, 0);


// =============================================================================
// TEST 44: Alarm Engine — Apnea
// =============================================================================
section('TEST 44: Alarm Engine — Apnea');

alarms = AlarmEngine.evaluateAlarms({
    nowSec: 45,
    elapsedSec: 45,
    lastBreathStartSec: 20,
    pipCmH2O: 5,
    pawCmH2O: 5,
    measuredRR: 0,
    minuteVentilationLpm: 0,
});

assert('Apnea alarm active',
    alarms.some(alarm => alarm.id === 'APNEA') ? 1 : 0, 1, 0);


// =============================================================================
// TEST 45: Alarm Engine — Low Minute Ventilation
// =============================================================================
section('TEST 45: Alarm Engine — Low Minute Ventilation');

alarms = AlarmEngine.evaluateAlarms({
    nowSec: 30,
    elapsedSec: 30,
    lastBreathStartSec: 28,
    pipCmH2O: 18,
    pawCmH2O: 12,
    measuredRR: 8,
    minuteVentilationLpm: 2,
});

assert('Low VE alarm active',
    alarms.some(alarm => alarm.id === 'LOW_VE') ? 1 : 0, 1, 0);


// =============================================================================
// TEST 46: Alarm Engine — High Minute Ventilation
// =============================================================================
section('TEST 46: Alarm Engine — High Minute Ventilation');

alarms = AlarmEngine.evaluateAlarms({
    nowSec: 30,
    elapsedSec: 30,
    lastBreathStartSec: 29,
    pipCmH2O: 18,
    pawCmH2O: 12,
    measuredRR: 35,
    minuteVentilationLpm: 22,
});

assert('High VE alarm active',
    alarms.some(alarm => alarm.id === 'HIGH_VE') ? 1 : 0, 1, 0);


// =============================================================================
// TEST 47: Alarm Engine — Auto Reset
// =============================================================================
section('TEST 47: Alarm Engine — Auto Reset');

const alarmed = AlarmEngine.evaluateAlarms({
    nowSec: 30,
    elapsedSec: 30,
    lastBreathStartSec: 29,
    pipCmH2O: 45,
    pawCmH2O: 45,
    measuredRR: 14,
    minuteVentilationLpm: 7,
});

const reset = AlarmEngine.evaluateAlarms({
    nowSec: 31,
    elapsedSec: 31,
    lastBreathStartSec: 30,
    pipCmH2O: 18,
    pawCmH2O: 12,
    measuredRR: 14,
    minuteVentilationLpm: 7,
});

assert('Alarm activates initially',
    alarmed.length > 0 ? 1 : 0, 1, 0);

assert('Alarm auto-resets when condition resolves',
    reset.length, 0, 0);


// =============================================================================
// TEST 48: Alarm Audio Policy - No Alarm No Sound
// =============================================================================
section('TEST 48: Alarm Audio Policy - No Alarm No Sound');

assert(
    'No alarms produce no sound',
    shouldPlayAlarmSound({
        activeAlarms: [],
        nowSec: 10,
        audioEnabled: true,
    }) ? 1 : 0,
    0,
    0
);


// =============================================================================
// TEST 49: Alarm Audio Policy - New Alarm Plays
// =============================================================================
section('TEST 49: Alarm Audio Policy - New Alarm Plays');

const highPressureAlarm = [{
    id: 'HIGH_PRESSURE',
    label: 'High pressure',
    priority: 'high',
    value: 45,
    limit: 40,
}];

assert(
    'New alarm signature plays sound',
    shouldPlayAlarmSound({
        activeAlarms: highPressureAlarm,
        nowSec: 10,
        audioEnabled: true,
        silencedUntilSec: 0,
        lastSoundAtSec: -Infinity,
        lastAlarmSignature: '',
    }) ? 1 : 0,
    1,
    0
);


// =============================================================================
// TEST 50: Alarm Audio Policy - Silence Suppresses Sound
// =============================================================================
section('TEST 50: Alarm Audio Policy - Silence Suppresses Sound');

assert(
    'Silenced alarm does not play',
    shouldPlayAlarmSound({
        activeAlarms: highPressureAlarm,
        nowSec: 20,
        audioEnabled: true,
        silencedUntilSec: 100,
        lastSoundAtSec: 0,
        lastAlarmSignature: '',
    }) ? 1 : 0,
    0,
    0
);


// =============================================================================
// TEST 51: Alarm Audio Policy - Mute Suppresses Sound
// =============================================================================
section('TEST 51: Alarm Audio Policy - Mute Suppresses Sound');

assert(
    'Muted alarm does not play',
    shouldPlayAlarmSound({
        activeAlarms: highPressureAlarm,
        nowSec: 20,
        audioEnabled: false,
        silencedUntilSec: 0,
        lastSoundAtSec: 0,
        lastAlarmSignature: '',
    }) ? 1 : 0,
    0,
    0
);


// =============================================================================
// TEST 52: Alarm Audio Policy - Repeat Interval Limits Annoyance
// =============================================================================
section('TEST 52: Alarm Audio Policy - Repeat Interval Limits Annoyance');

const sig = alarmSignature(highPressureAlarm);

assert(
    'Persistent alarm does not repeat too soon',
    shouldPlayAlarmSound({
        activeAlarms: highPressureAlarm,
        nowSec: 15,
        audioEnabled: true,
        silencedUntilSec: 0,
        lastSoundAtSec: 10,
        lastAlarmSignature: sig,
    }) ? 1 : 0,
    0,
    0
);

assert(
    'Persistent high alarm repeats after interval',
    shouldPlayAlarmSound({
        activeAlarms: highPressureAlarm,
        nowSec: 23,
        audioEnabled: true,
        silencedUntilSec: 0,
        lastSoundAtSec: 10,
        lastAlarmSignature: sig,
    }) ? 1 : 0,
    1,
    0
);


// =============================================================================
// NT1–NT6 — Trigger-eligibility CONTRACT TESTS (PR2)
// =============================================================================
// These encode the behavior specified in docs/trigger-fix-design.md §5. Several
// are EXPECTED to fail against today's engine (marked [RED until fix]); that is
// the point — they pass once the eligibility fix + failed-event emission lands.
// Tests fail by ASSERTION only: quantities the engine does not expose (neural
// onsets, machine phase at onset) are DERIVED by stepping sim.tick() and reading
// existing public state across ticks (mirrors scratch/trigger-sweep.mjs).
// The enriched failed-event fields (gateFailed) are referenced only as filters
// on event objects, so their being undefined today is a clean assertion failure,
// never a crash.

// Build a sim the way main.js / the existing trigger tests do. Patient effort is
// strong (pMusMax 8) so drops are due to eligibility, not a weak-effort miss.
function ntBuildSim(ventOverrides, patientRR, preset = 'normal') {
    const lung = LungModel.fromPreset(preset);
    const vent = new Ventilator(lung, Object.assign({
        mode: 'vc-cmv', flowPattern: 'square', holdTime: 0,
        pMusMax: 8, neuralTi: 1.0, tidalVolume: 0.500,
        inspiratoryPressure: 15, psPressure: 10, cyclePercent: 25,
        respiratoryRate: 14, ieRatio: [1, 2], peep: 5, fio2: 0.40,
        triggerType: 'flow', flowTriggerLpm: 2.0, pressureTriggerCmH2O: 1.0,
    }, ventOverrides));
    const sim = new SimulationEngine(vent, { sampleRate: 100, displaySeconds: 10 });
    sim.patientRR = patientRR;
    return sim;
}

// Step the sim and count neural-inspiration onsets, classified by the machine
// phase the line-352 gate sees (the phase BEFORE the tick, which _advanceNeural
// reads first). Uses only existing public fields: sim.dt, sim.phase,
// sim.neuralInspActive. With neuralTi 1.0 s and these rates the neural period
// always exceeds neuralTi, so the false->true onset edge is detected cleanly.
function ntInstrument(sim, seconds) {
    const steps = Math.round(seconds / sim.dt);
    let onsetExp = 0;
    let onsetInspHold = 0;
    for (let i = 0; i < steps; i++) {
        const phaseBefore = sim.phase;
        const neuralBefore = sim.neuralInspActive;
        sim.tick();
        if (!neuralBefore && sim.neuralInspActive) {
            if (phaseBefore === 'EXPIRATION') onsetExp++;
            else onsetInspHold++;            // INSPIRATION or HOLD
        }
    }
    return { onsetExp, onsetInspHold, onsetTotal: onsetExp + onsetInspHold };
}

// Count failed-trigger events, optionally filtered by gateFailed reason. Reading
// e.gateFailed on today's {type,time} events yields undefined (no crash); a
// gate-filtered count is therefore 0 today, which is the intended RED.
function ntFailedCount(sim, gate) {
    const evs = sim.getTriggerEvents(0, sim.globalTime);
    return evs.filter(e => e.type === 'failed' && (gate === undefined || e.gateFailed === gate)).length;
}

section('NT1 [FIXED to §2] — No silent drops; synchrony where physiology allows');
{
    // §2 guarantee: every neural effort resolves to a delivered breath, a VISIBLE
    // failed event, or is still in progress at the run boundary — never a SILENT
    // drop. An effort beginning in expiration may legitimately FAIL: on gate (c)
    // threshold (early-expiration recoil volumeAboveEq/C exceeds pMus) or on
    // gate (a) ventilator-availability (machine backup preempts it). So we assert
    // the accounting identity, NOT forced delivery of every expiration onset.
    // The strict per-onset decomposition by onset-phase is NOT reconstructable
    // (a VU event from a preempted expiration onset records phase=INSPIRATION),
    // so the correct strict invariant is the GLOBAL identity over all onsets.
    const conds = [
        { name: 'I:E 1:2',   ov: {} },
        { name: 'I:E 1:1',   ov: { ieRatio: [1, 1] } },
        { name: 'hold 0.5s', ov: { holdTime: 0.5 } },
    ];
    for (const c of conds) {
        for (const rr of [22, 24, 26, 28, 30]) {
            const sim = ntBuildSim(c.ov, rr);
            const ins = ntInstrument(sim, 60);
            const delivered = sim.patientBreathCount;
            const failed = ntFailedCount(sim);  // all 'failed' events (VU + threshold)
            const inProgress = (sim.neuralInspActive && !sim.neuralCycleResolved) ? 1 : 0;
            // (1) No SILENT drop: delivered + failed + in-progress accounts for every onset.
            assert(`NT1 ${c.name} patRR ${rr}: no silent drop (delivered+failed+inProgress == onsets)`,
                delivered + failed + inProgress, ins.onsetTotal, 0);
            // (2) Synchrony guard: in the known-clean cells (I:E 1:2, patRR <= 28)
            //     physiology allows every in-expiration effort to deliver — prove it.
            if (c.name === 'I:E 1:2' && rr <= 28) {
                assert(`NT1 ${c.name} patRR ${rr}: synchrony — delivered == in-expiration onsets`,
                    delivered, ins.onsetExp, 0);
            }
        }
    }
}

section('NT2 [FIXED to §2] — Effort during machine INSPIRATION fails visibly');
{
    // I:E 1:1 at patRR 30 forces many neural onsets into machine INSPIRATION.
    const sim = ntBuildSim({ ieRatio: [1, 1] }, 30);
    const ins = ntInstrument(sim, 60);
    const failedVU = ntFailedCount(sim, 'ventilator_unavailable');
    // sanity: scenario really does land onsets in inspiration (verified)
    assertTrue('NT2 scenario produces inspiration-phase onsets (onsetInspHold > 0)',
        ins.onsetInspHold > 0);
    // (a) those onsets deliver no breath — all deliveries come from expiration onsets (green)
    assertTrue('NT2(a) inspiration-phase onsets deliver no breath',
        sim.patientBreathCount <= ins.onsetExp);
    // (b) each emits a failed(ventilator_unavailable) event (now fixed: field present and emitted)
    assert('NT2(b) failed(ventilator_unavailable) count == inspiration-phase onsets',
        failedVU, ins.onsetInspHold, 0);
}

section('NT3 [FIXED to §2] — Sub-threshold effort fails visibly (mirror 28E/28G + PC-CSV)');
{
    // NT3a: VC flow, weak effort vs hard flow trigger (mirrors TEST 28E params)
    const simA = ntBuildSim({ respiratoryRate: 6, pMusMax: 0.5, flowTriggerLpm: 5.0 }, 20);
    ntInstrument(simA, 60);
    assert('NT3a VC flow sub-threshold: patient breaths == 0', simA.patientBreathCount, 0, 0);
    assertTrue('NT3a VC flow sub-threshold: emits failed(threshold) event',
        ntFailedCount(simA, 'threshold') > 0);

    // NT3b: VC pressure, weak effort vs hard pressure trigger (mirrors TEST 28G params)
    const simB = ntBuildSim({ respiratoryRate: 6, pMusMax: 0.5, triggerType: 'pressure', pressureTriggerCmH2O: 2.0 }, 20);
    ntInstrument(simB, 60);
    assert('NT3b VC pressure sub-threshold: patient breaths == 0', simB.patientBreathCount, 0, 0);
    assertTrue('NT3b VC pressure sub-threshold: emits failed(threshold) event',
        ntFailedCount(simB, 'threshold') > 0);

    // NT3c: PC-CSV, strong effort but stiff pressure trigger (SME-005 profile: set 35 -> collapse)
    const simC = ntBuildSim({ mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25, triggerType: 'pressure', pressureTriggerCmH2O: 5.0 }, 35);
    ntInstrument(simC, 60);
    assertTrue('NT3c PC-CSV stiff trigger: delivered rate collapses (measuredRR < set 35)',
        simC.measuredRR < 35);
    assertTrue('NT3c PC-CSV stiff trigger: emits failed(threshold) event',
        ntFailedCount(simC, 'threshold') > 0);
}

section('NT4 [FIXED to §2] — Full accounting identity + measured-RR honesty (high rate)');
{
    // VC I:E 1:2 at patRR 42 (well above cliff). Every neural onset must resolve
    // to a delivered patient breath, a failed event, OR an effort still in its
    // neural inspiration at the run boundary — no silent loss.
    const sim = ntBuildSim({}, 42);
    const ins = ntInstrument(sim, 60);
    const failedAll = ntFailedCount(sim);
    const inProgress = (sim.neuralInspActive && !sim.neuralCycleResolved) ? 1 : 0;
    assert('NT4 full identity: onsets == delivered + failed + inProgress',
        sim.patientBreathCount + failedAll + inProgress, ins.onsetTotal, 0);
    // measured RR reflects DELIVERED breaths (self-consistency; green today and post-fix)
    const deliveredRatePerMin = sim.breathCount / (sim.globalTime / 60);
    assertBetween('NT4 measuredRR tracks delivered-breath rate',
        sim.measuredRR, deliveredRatePerMin * 0.6, deliveredRatePerMin * 1.4);
}

section('NT5 [GREEN guard] — PC-CSV unchanged for adequate effort');
{
    // Strong effort + default flow trigger: PC-CSV already tracks set rate today
    // and must keep doing so after the fix. Regression guard (mirrors the
    // focused VSM-CLIN-003 trace + sweep grid E).
    for (const rr of [18, 35]) {
        const sim = ntBuildSim({ mode: MODE_PC_CSV, psPressure: 10, cyclePercent: 25 }, rr);
        ntInstrument(sim, 60);
        assertTrue(`NT5 PC-CSV patRR ${rr}: measuredRR ~= set and failed events ~= 0`,
            sim.measuredRR >= rr * 0.85
            && sim.measuredRR <= rr * 1.15
            && ntFailedCount(sim) <= 1);
    }
}

section('NT6 [FIXED to §2] — Passive (no effort) emits nothing');
{
    // Oscillator commanded (patientRR 20) but pMusMax 0: no Pmus -> no breaths,
    // and per design-spec §2 ("no effort -> nothing") no failed events either.
    // Both assertions now pass: effortPresent gate (spec §2) properly prevents
    // spurious 'failed' markers for zero-effort oscillators. No latching artifact.
    const sim = ntBuildSim({ pMusMax: 0 }, 20);
    ntInstrument(sim, 60);
    assert('NT6 passive: patient breaths == 0', sim.patientBreathCount, 0, 0);
    assertTrue('NT6 passive: failed events == 0 (no Pmus -> no ineffective effort)',
        ntFailedCount(sim) === 0);
}

section('SME-018 — cancelling a silence must actually restore sound');
{
    // The bug this pins: clearing silencedUntilSec alone is NOT enough.
    // shouldPlayAlarmSound still gates on `nowSec - lastSoundAtSec >= repeatSec`,
    // and updateAlarmAudio keeps lastAlarmSignature current all through the
    // silence — so the new-alarm fast path is already spent, and the alarm stays
    // mute for up to a full repeat interval (12 s high / 30 s medium) after the
    // user explicitly cancelled. The handler therefore also resets lastSoundAtSec.
    const alarm = highPressureAlarm;
    const sig = alarmSignature(alarm);

    // Silence pressed at t=10 (sound had just played), cancelled at t=12.
    assert(
        'BROKEN state — silence cleared but lastSoundAtSec stale: still mute',
        shouldPlayAlarmSound({
            activeAlarms: alarm, nowSec: 12, audioEnabled: true,
            silencedUntilSec: 0, lastSoundAtSec: 10, lastAlarmSignature: sig,
        }) ? 1 : 0,
        0, 0
    );

    // What the fixed handler leaves behind: lastSoundAtSec reset.
    assert(
        'FIXED state — cancel resets lastSoundAtSec: sounds on the next frame',
        shouldPlayAlarmSound({
            activeAlarms: alarm, nowSec: 12, audioEnabled: true,
            silencedUntilSec: 0, lastSoundAtSec: -Infinity, lastAlarmSignature: sig,
        }) ? 1 : 0,
        1, 0
    );

    // The reset must not defeat the silence itself — re-silencing still mutes.
    assert(
        'a fresh silence still suppresses sound after a previous cancel',
        shouldPlayAlarmSound({
            activeAlarms: alarm, nowSec: 12, audioEnabled: true,
            silencedUntilSec: 132, lastSoundAtSec: -Infinity, lastAlarmSignature: sig,
        }) ? 1 : 0,
        0, 0
    );
}

section('SME-014 — latched per-breath PIP (display) vs live PIP (alarms)');
{
    // The monitor shows `pipLatched`, the peak of the last COMPLETED breath, so
    // the biggest number on the screen updates once per breath instead of
    // tracking the inspiratory ramp. `pip` must stay LIVE, because the
    // high-pressure alarm reads it and has to fire the instant pressure rises,
    // not a breath later. These two properties are the whole contract.
    const lungP = new LungModel({ resistance: 10, compliance: 0.05 });
    const ventP = new Ventilator(lungP, {
        mode: 'vc-cmv', flowPattern: 'square',
        tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 2], peep: 5,
    });
    const simP = new SimulationEngine(ventP, { sampleRate: 100, displaySeconds: 10 });

    assert('pipLatched starts at 0 (nothing completed yet)', simP.breathSummary.pipLatched, 0, 0);

    // Settle for several breaths.
    const ticksPerBreath = Math.round(ventP.totalCycleTime * 100);
    for (let i = 0; i < ticksPerBreath * 4; i++) simP.tick();

    const after = simP.breathSummary;
    assertTrue('pipLatched is populated once a breath completes', after.pipLatched > 0);
    // NOTE: assert()'s tolerance is RELATIVE (diff <= tol * |expected|), so
    // `0.5` here would mean ±50% and would wave through a 30% error. Absolute
    // bound instead.
    assertBetween('pipLatched is within 0.5 cmH2O of the analytical PIP',
        after.pipLatched, ventP.pip - 0.5, ventP.pip + 0.5);

    // Vary compliance BETWEEN breaths so consecutive peaks actually differ. In
    // steady state every breath peaks identically, which makes "the latched
    // value is stable" true no matter WHEN the latch fires — that blind spot is
    // exactly how a one-breath-late latch shipped. Only a changing peak pins the
    // latch point. Requirement: for the WHOLE expiratory phase, pipLatched is
    // the peak of the breath that just ended, not the one before it.
    const cycleC = [0.050, 0.022, 0.035];
    let ci = 0, breathPeak = 0, lastCompleted = null, checks = 0, stale = 0;
    const liveSeen = new Set();
    for (let i = 0; i < ticksPerBreath * 8; i++) {
        const before = simP.phase;
        simP.tick();
        liveSeen.add(simP.breathSummary.pip);
        if (before === 'INSPIRATION') breathPeak = Math.max(breathPeak, simP.measuredPIP);
        if (before !== 'EXPIRATION' && simP.phase === 'EXPIRATION') {
            lastCompleted = Math.round(breathPeak * 10) / 10;
            breathPeak = 0;
        }
        if (before === 'EXPIRATION' && simP.phase === 'INSPIRATION') {
            lungP.compliance = cycleC[ci++ % cycleC.length];   // change only at breath start
        }
        if (simP.phase === 'EXPIRATION' && lastCompleted !== null) {
            checks++;
            if (Math.abs(simP.breathSummary.pipLatched - lastCompleted) > 0.06) stale++;
        }
    }
    assertTrue('pipLatched equals the peak of the breath that just ended, for the whole expiratory phase',
        checks > 200 && stale === 0);
    assertTrue('live pip still moves within the breath (alarm path intact)',
        liveSeen.size > 5);

    // A pressure excursion must be visible to the LIVE value immediately —
    // this is what the high-pressure alarm consumes.
    const preLatched = simP.breathSummary.pipLatched;
    lungP.compliance = 0.015;                     // sudden stiffening mid-run
    let livePeak = 0;
    for (let i = 0; i < Math.round(ticksPerBreath * 0.5); i++) {
        simP.tick();
        livePeak = Math.max(livePeak, simP.breathSummary.pip);
    }
    assertTrue('live pip reflects a mid-breath pressure rise before the breath ends',
        livePeak > preLatched);

    // reset() must clear the latch, or a mode switch would show a stale peak.
    simP.reset();
    assert('reset() clears pipLatched', simP.breathSummary.pipLatched, 0, 0);
}

section('Ineffective-effort counter — window semantics');
{
    // The Teaching-Mode counter is getTriggerEvents(now-60, now) filtered to
    // 'failed'. Two things have to hold for that number to mean anything:
    // failed events must be retained for the full window, and both failure
    // modes must be counted (only the 'threshold' ones draw a flow highlight,
    // so the phase-gate ones exist ONLY in this counter).
    const lungC = new LungModel({ resistance: 10, compliance: 0.05 });
    const ventC = new Ventilator(lungC, {
        mode: 'vc-cmv', flowPattern: 'square',
        tidalVolume: 0.500, respiratoryRate: 14, ieRatio: [1, 1], peep: 5,
        pMusMax: 6, neuralTi: 1.0,
    });
    const simC = new SimulationEngine(ventC, { sampleRate: 100, displaySeconds: 10 });
    simC.patientRR = 34;                          // overbreathe well past the cliff

    // Run PAST the 60 s window (90 s), capturing ground truth as events appear,
    // so retention and the tMin bound are both actually exercised. A 45 s run
    // against a 60 s window can never leave the window, and would stay green
    // even if retention were cut to 8 s.
    const truth = new Set();
    for (let i = 0; i < 100 * 90; i++) {
        simC.tick();
        for (const e of simC.getTriggerEvents(-Infinity, Infinity)) {
            if (e.type === 'failed') truth.add(e.time);
        }
    }

    const nowC = simC.globalTime;
    const windowed = simC.getTriggerEvents(nowC - 60, nowC).filter(e => e.type === 'failed');
    const truthIn  = [...truth].filter(t => t >= nowC - 60 && t <= nowC);
    const truthOld = [...truth].filter(t => t <  nowC - 60);

    assertTrue('overbreathing at RR 34 produces failed efforts to count',
        windowed.length > 0);
    assertTrue('the run outlives the window (failed efforts exist outside it)',
        truthOld.length > 0);
    assert('the 60 s window returns every failed effort produced inside it (retention covers the window)',
        windowed.length, truthIn.length, 0);

    const vu = windowed.filter(e => e.gateFailed === 'ventilator_unavailable').length;
    assertTrue('phase-gate failures are present (these have NO waveform highlight)',
        vu > 0);

    // Every counted event carries the fields the tooltip and counter rely on.
    assertTrue('every failed event has a gateFailed reason',
        windowed.every(e => typeof e.gateFailed === 'string'));
    assertTrue('every failed event has a phase',
        windowed.every(e => typeof e.phase === 'string'));

    // Cross-check tMin against a NARROWER read rather than re-checking the
    // predicate that produced `windowed` — asserting `windowed.every(e => e.time
    // >= now - 60)` is tautological, and stays green even if the tMin bound is
    // deleted from getTriggerEvents entirely.
    const narrow = simC.getTriggerEvents(nowC - 10, nowC).filter(e => e.type === 'failed');
    assertTrue('tMin is honoured: a 10 s read is a strict subset of the 60 s read',
        narrow.length > 0 && narrow.length < windowed.length
        && narrow.every(e => e.time >= nowC - 10));

    // The counter shares triggerEvents with the waveform layer, so a read must
    // never prune in place. (Reading twice and comparing answers only asserts
    // that Array.filter is deterministic.)
    const lenBefore = simC.triggerEvents.length;
    simC.getTriggerEvents(nowC - 60, nowC);
    simC.getTriggerEvents(nowC - 5, nowC);
    assert('reading the counter does not mutate the event store',
        simC.triggerEvents.length, lenBefore, 0);

    // reset() (mode switch, flow-pattern change) must zero the counter. It does
    // NOT empty triggerEvents outright: _prefill() immediately starts the first
    // mandatory breath, which legitimately records one 'machine' event. The
    // counter only ever reads 'failed', so that is what has to be clear.
    simC.reset();
    const afterReset = simC.getTriggerEvents(-Infinity, Infinity);
    assertTrue('reset() zeroes the ineffective-effort counter',
        afterReset.filter(e => e.type === 'failed').length === 0);
    assertTrue('reset() leaves only the freshly-started mandatory breath',
        afterReset.every(e => e.type === 'machine'));
}


// =============================================================================
// RESULTS
// =============================================================================
section('RESULTS');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  ${failed === 0 ? '🫁 All systems nominal. Engine is breathing.' : '⚠️  Some tests failed — review above.'}`);
console.log();

// Fail the process, and therefore CI, when any assertion failed.
//
// Until 2026-08-05 this file had no exit code at all: it printed the tally and
// exited 0 either way, so the GitHub Actions smoke test stayed green through
// any number of failures. Verified at the time by mutation — multiplying
// LungModel.timeConstant by 1.5 produced 29 failures and exit code 0.
// The whole "300 assertions make unattended work safe" premise depended on
// this line, which did not exist.
process.exitCode = failed === 0 ? 0 : 1;
