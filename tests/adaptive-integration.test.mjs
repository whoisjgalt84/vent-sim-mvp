import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import AlarmEngine from '../alarms.js';

// A copied runtime root is permitted for isolated mutation testing only.
const runtime = new URL(process.env.VSM_ADAPTIVE_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator, MODE_PC_CMVA, SUPPORTED_MODES } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const EXPECTED_GROUPS = 24;
const results = [], transitions = [], traces = {}, range = [];
function test(name, fn) {
    try { fn(); results.push({ name, passed: true }); console.log(`PASS adaptive-integration: ${name}`); }
    catch (error) { results.push({ name, passed: false, detail: error.message }); console.error(`FAIL adaptive-integration: ${name}\n${error.stack}`); }
}
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b} +/- ${tolerance}`);
const between = (a, low, high) => assert.ok(a >= low && a <= high, `${a} outside [${low}, ${high}]`);
function make({ R = 10, C = 0.05, rr = 12, ie = [1, 4], effort = 0, patientRR = 0,
    neuralTi = 1, peep = 5, target = 500, config = {}, holdTime = 0 } = {}) {
    const lung = new LungModel({ resistance: R, compliance: C });
    const vent = new Ventilator(lung, { mode: MODE_PC_CMVA, tidalVolume: target / 1000,
        inspiratoryPressure: 17, psPressure: 9, respiratoryRate: rr, ieRatio: ie,
        peep, pMusMax: effort, neuralTi, holdTime, adaptiveConfig: config });
    const sim = new SimulationEngine(vent);
    sim.patientRR = patientRR;
    // Configure prescribed drive before resetting/prefilling the demonstration.
    sim.reset();
    return { lung, vent, sim, trace: [], seen: null };
}
function step(x) {
    const { sim, vent, lung } = x;
    const physicsPhase = sim.phase;
    const oldBreath = sim.currentBreath;
    const prior = oldBreath?.adaptive;
    const count = sim.breathCount;
    const pressure = sim.adaptiveState?.applied_cmH2O;
    sim.tick();
    if (prior && physicsPhase === 'INSPIRATION') {
        assert.equal(sim.currentPressure, prior.appliedPeep_cmH2O + prior.applied_cmH2O,
            'every adaptive inspiration sample uses its own latched PEEP and command');
    }
    if (sim.adaptiveState && sim.adaptiveState.applied_cmH2O !== pressure) {
        assert.ok(sim.breathCount > count, 'pressure correction changed without a breath start');
    }
    const completed = sim.lastCompletedBreath;
    if (completed && completed !== x.seen) {
        x.seen = completed;
        const decision = sim.adaptiveState?.latestDecision ?? null;
        const row = { record: completed, decision,
            prescribedEffort_cmH2O: vent.pMusMax, patientRR: sim.patientRR, neuralTi_s: vent.neuralTi,
            diagnosticOnly_R: lung.resistance, diagnosticOnly_C: lung.compliance,
            residualAtStart_mL: oldBreath?.baseline.residualVolume_L * 1000,
            inspirationSamples: oldBreath?.inspirationSampleCount };
        x.trace.push(row);
        if (decision?.eligible) {
            const error = completed.adaptive.targetVT_mL - completed.measuredVT_mL;
            const delta = Math.abs(error) <= 10 ? 0 : Math.max(-2, Math.min(2, 0.01 * error));
            const config = sim.adaptiveState.config;
            // Normal approved-law traces only; alternative tuning is characterized separately.
            if (config.gain_cmH2O_per_mL === 0.01 && config.maxStep_cmH2O === 2 && config.deadband_mL === 10) {
                assert.equal(decision.nextPressure_cmH2O, Math.max(config.minimumPressure_cmH2O,
                    Math.min(config.maximumPressure_cmH2O, completed.adaptive.applied_cmH2O + delta)));
            }
            assert.equal(decision.vt_mL, completed.measuredVT_mL);
            assert.equal(decision.source.breathId, completed.breathId);
            assert.equal(decision.source.completedAt_s, completed.completedAt_s);
        }
    }
}
function until(x, predicate, maximum = 100000) {
    let ticks = 0;
    while (!predicate()) { assert.ok(++ticks <= maximum, 'bounded deterministic stepping did not reach event'); step(x); }
}
function completions(x, n) { const end = x.trace.length + n; until(x, () => x.trace.length >= end); return x.trace; }
function ticks(x, n) { for (let i = 0; i < n; i++) step(x); }
function edit(x, action) { action(); x.sim.notifyMeasurementSettingsChanged(); }
function prepared(phase, paused) {
    const x = make(); completions(x, 1);
    assert.ok(x.sim.adaptiveState.pending, 'old-context pending correction present');
    if (phase === 'inspiration') { until(x, () => x.sim.breathCount === 2); ticks(x, 20); }
    if (paused) x.sim.pause();
    return x;
}
const settingsCases = [
    { name: 'target', request: { targetVT_mL: 650 }, target: 650, peep: 5 },
    { name: 'peep', request: { peep_cmH2O: 12 }, target: 500, peep: 12 },
    { name: 'both', request: { targetVT_mL: 650, peep_cmH2O: 12 }, target: 650, peep: 12 },
];
function matrix(run) {
    for (const phase of ['inspiration', 'expiration']) for (const paused of [false, true]) {
        for (const setting of settingsCases) run(prepared(phase, paused), { phase, paused, ...setting });
    }
}
function retained(x, item) {
    near(x.vent.tidalVolume * 1000, item.target); assert.equal(x.vent.peep, item.peep);
    assert.equal(x.vent.inspiratoryPressure, 17); assert.equal(x.vent.psPressure, 9);
}
function clearFresh(x, item) {
    const s = x.sim.adaptiveState;
    retained(x, item); assert.equal(s.pendingSettings, null); assert.equal(s.pending, null);
    assert.equal(s.latestDecision, null); assert.equal(s.lastFeedback, null);
    assert.equal(s.applied_cmH2O, 10); assert.equal(s.commandVersion, 0);
    assert.equal(x.sim.lastCompletedBreath, null); assert.equal(x.sim.breathCount, 1);
    assert.equal(x.sim.measuredRR, 0); assert.equal(x.sim.deliveredVentilation.completedCount, 0);
    assert.equal(x.sim.running, !item.paused);
    step(x); assert.equal(x.sim.currentPressure, item.peep + 10);
}

test('explicit mode routing and initialization before prefill', () => {
    const x = make(); assert.equal(MODE_PC_CMVA, 'pc-cmva'); assert.ok(SUPPORTED_MODES.includes(MODE_PC_CMVA));
    assert.equal(x.vent.modeLabel, 'PC-CMVa'); assert.equal(x.vent.isPressureMode(), true);
    assert.equal(x.vent.isSpontaneousMode(), false); assert.equal(x.sim.breathCount, 1);
    assert.equal(x.sim.currentBreath.adaptive.applied_cmH2O, 10);
    assert.equal(x.sim.adaptiveState.lastFeedback, null); step(x); assert.equal(x.sim.currentPressure, 15);
});
test('raw canonical inspired feedback matches independent passive discrete recurrence', () => {
    const rows = [];
    for (const C of [0.015, 0.025, 0.05, 0.1]) {
        const x = make({ C }); completions(x, 1); const row = x.trace[0];
        const expected = 1000 * 10 * C * (1 - Math.pow(1 - 0.01 / (10 * C), row.inspirationSamples));
        near(row.record.measuredVT_mL, expected); assert.notEqual(row.record.measuredVT_mL, Math.round(row.record.measuredVT_mL));
        assert.equal(row.decision.vt_mL, row.record.measuredVT_mL);
        assert.equal(x.sim.phase, 'EXPIRATION'); assert.ok(x.sim.currentFlow >= 0);
        rows.push({ ...row, independentlyExpected_mL: expected });
    }
    traces.passiveOracle = rows;
});
test('normal next-boundary target/PEEP queue matrix holds old context and cancels correction', () => {
    matrix((x, item) => {
        const startId = x.sim.breathCount; const before = x.sim.adaptiveState;
        x.sim.requestAdaptiveSettings(item.request);
        assert.equal(x.vent.peep, 5); assert.equal(x.vent.tidalVolume, 0.5);
        assert.equal(x.sim.adaptiveState.appliedPeep_cmH2O, 5);
        assert.equal(x.sim.adaptiveState.requested.targetVT_mL, item.target);
        assert.equal(x.sim.adaptiveState.requested.peep_cmH2O, item.peep);
        assert.equal(x.sim.adaptiveState.pending, null); assert.equal(x.sim.adaptiveState.contextMatches, false);
        if (item.paused) {
            const clock = x.sim.globalTime; x.sim.advance(10); assert.equal(x.sim.globalTime, clock);
            assert.equal(x.sim.running, false); assert.notEqual(x.sim.adaptiveState.pendingSettings, null); x.sim.resume();
        }
        until(x, () => x.sim.breathCount > startId);
        retained(x, item); assert.equal(x.sim.adaptiveState.pendingSettings, null);
        assert.equal(x.sim.adaptiveState.applied_cmH2O, before.applied_cmH2O);
        step(x); assert.equal(x.sim.currentPressure, item.peep + before.applied_cmH2O);
        completions(x, 1); assert.equal(x.trace.at(-1).decision.eligible, true);
        assert.equal(x.trace.at(-1).record.adaptive.targetVT_mL, item.target);
        transitions.push({ event: 'next-breath', ...item, final: x.sim.adaptiveState });
    });
});
test('reset queue matrix retains both operator settings without synthetic completion or resume', () => {
    matrix((x, item) => {
        const generation = x.sim.simulationGeneration;
        x.sim.requestAdaptiveSettings(item.request); x.sim.reset(); clearFresh(x, item);
        assert.equal(x.sim.simulationGeneration, generation + 1);
        transitions.push({ event: 'reset', ...item, final: x.sim.adaptiveState });
    });
});
test('three destination modes and reentry queue matrix preserves ownership and manual pressure', () => {
    for (const destination of ['vc-cmv', 'pc-cmv', 'PC-CSV']) matrix((x, item) => {
        x.sim.requestAdaptiveSettings(item.request); x.sim.setMode(destination); retained(x, item);
        assert.equal(x.sim.adaptiveState, null); assert.equal(x.sim._pendingAdaptiveSettings, null);
        assert.equal(x.sim.lastCompletedBreath, null); assert.equal(x.vent.adaptivePressure_cmH2O, null);
        assert.equal(x.sim.running, !item.paused); step(x);
        if (destination === 'pc-cmv') assert.equal(x.sim.currentPressure, item.peep + 17);
        if (destination === 'vc-cmv') near(x.sim.currentFlow, item.target / 1000 / x.vent.inspiratoryTime);
        if (destination === 'PC-CSV') { assert.equal(x.sim.breathCount, 0); assert.equal(x.sim.currentPressure, item.peep); }
        x.vent.tidalVolume = 0.7; x.vent.peep = 8; x.sim.notifyMeasurementSettingsChanged();
        x.sim.setMode(MODE_PC_CMVA); clearFresh(x, { ...item, target: 700, peep: 8 });
        transitions.push({ event: 'exit-reentry', destination, ...item, final: x.sim.adaptiveState });
    });
});
test('multiple requests and edit/revert advance epoch without replaying pressure', () => {
    for (const phase of ['inspiration', 'expiration']) for (const paused of [false, true]) {
        const x = prepared(phase, paused); const epoch = x.sim.adaptiveState.epoch;
        x.sim.requestAdaptiveSettings({ targetVT_mL: 600 });
        x.sim.requestAdaptiveSettings({ peep_cmH2O: 10 });
        x.sim.requestAdaptiveSettings({ targetVT_mL: 500 });
        x.sim.requestAdaptiveSettings({ peep_cmH2O: 5 });
        assert.equal(x.sim.adaptiveState.epoch, epoch + 4); assert.equal(x.sim.adaptiveState.pending, null);
        assert.equal(x.sim.adaptiveState.contextMatches, false); x.sim.reset();
        clearFresh(x, { target: 500, peep: 5, paused });
    }
});
test('invalid queued requests are atomic and cannot erase an earlier valid request', () => {
    const x = prepared('expiration', true); x.sim.requestAdaptiveSettings({ targetVT_mL: 650, peep_cmH2O: 12 });
    const before = x.sim.adaptiveState;
    for (const bad of [null, [], {}, { other: 1 }, { targetVT_mL: 900, peep_cmH2O: 8 },
        { targetVT_mL: 600, peep_cmH2O: 25 }, { targetVT_mL: undefined }, { peep_cmH2O: undefined },
        { targetVT_mL: NaN }, { peep_cmH2O: Infinity }, { peep_cmH2O: null }, { targetVT_mL: '600' }]) {
        assert.throws(() => x.sim.requestAdaptiveSettings(bad)); assert.deepEqual(x.sim.adaptiveState, before);
        assert.equal(x.vent.peep, 5); assert.equal(x.vent.tidalVolume, 0.5);
    }
    x.sim.reset(); clearFresh(x, { target: 650, peep: 12, paused: true });
});
test('immediate input edits including effort invalidate a mixed inspiration and rearm next breath', () => {
    const edits = [x => { x.lung.compliance = 0.025; }, x => { x.lung.resistance = 20; },
        x => { x.vent.pMusMax = 8; }, x => { x.vent.neuralTi = 0.8; }, x => { x.sim.patientRR = 17; },
        x => { x.vent.respiratoryRate = 14; }, x => { x.vent.ieRatio = [1, 3]; },
        x => { x.vent.flowTriggerLpm = 3; }, x => { x.vent.fio2 = 0.5; }];
    for (const change of edits) {
        const x = make(); ticks(x, 30); const epoch = x.sim.adaptiveState.epoch;
        edit(x, () => change(x)); assert.ok(x.sim.adaptiveState.epoch > epoch);
        completions(x, 1); assert.equal(x.trace[0].decision.eligible, false);
        assert.equal(x.trace[0].record.adaptive.valid, false);
        assert.equal(x.sim.adaptiveState.pending, null); completions(x, 1);
        assert.equal(x.trace[1].decision.eligible, true);
    }
    // The tick fingerprint also detects direct edits; UI notifications additionally
    // detect edit/revert events that occur between ticks.
    for (const change of edits.slice(2, 5)) {
        const x = make(); ticks(x, 30); change(x); completions(x, 1);
        assert.equal(x.trace[0].decision.eligible, false);
        assert.equal(x.trace[0].record.adaptive.valid, false);
    }
});
test('ineligible real deliveries remain in raw VE history and age normally', () => {
    const x = make(); ticks(x, 30); edit(x, () => { x.lung.compliance = 0.025; }); completions(x, 1);
    const first = x.trace[0].record; assert.equal(x.trace[0].decision.eligible, false);
    assert.equal(x.sim.deliveredVentilation.completedCount, 1);
    near(x.sim.deliveredVentilation.sumVolumeL, first.measuredVT_mL / 1000);
    until(x, () => x.sim.globalTime >= 30);
    const signal = x.sim.deliveredVentilation;
    assert.equal(signal.status, 'available'); assert.ok(signal.eventIds.some(id => id.breathId === first.breathId));
    const sum = x.trace.filter(r => r.record.completedAt_s > signal.asOfSimTime_s - 30)
        .reduce((n, r) => n + r.record.measuredVT_mL / 1000, 0);
    near(signal.sumVolumeL, sum); near(signal.valueLpm, 2 * sum);
});
test('feedback remains paired with source target and never reassessed against queued target', () => {
    const x = make(); completions(x, 5); const old = x.sim.adaptiveState.lastFeedback;
    x.sim.requestAdaptiveSettings({ targetVT_mL: 650 });
    assert.equal(x.sim.adaptiveState.lastFeedback, old);
    assert.equal(old.targetVT_mL, 500); assert.equal(x.sim.adaptiveState.targetVT_mL, 500);
    assert.equal(x.sim.adaptiveState.requested.targetVT_mL, 650); assert.equal(x.sim.adaptiveState.contextMatches, false);
    completions(x, 1); assert.equal(x.sim.adaptiveState.lastFeedback.targetVT_mL, 650);
    assert.equal(x.sim.adaptiveState.contextMatches, true);
});
test('pause/resume and matched ticks at different speeds preserve controller results', () => {
    const x = make(); x.sim.pause(); x.sim.requestAdaptiveSettings({ peep_cmH2O: 9 });
    const before = x.sim.adaptiveState; x.sim.advance(10);
    assert.equal(x.sim.globalTime, 0); assert.deepEqual(x.sim.adaptiveState, before);
    const a = make(), b = make(); b.sim.setSpeed(4);
    for (let i = 0; i < 150; i++) { a.sim.advance(0.4); b.sim.advance(0.1); }
    assert.deepEqual(a.sim.lastCompletedBreath, b.sim.lastCompletedBreath);
    assert.deepEqual(a.sim.adaptiveState, b.sim.adaptiveState);
});
test('adaptive HOLD is excluded and old hold intent cannot poison initialization', () => {
    const x = make({ holdTime: 1 }); assert.equal(x.vent.effectiveHoldTime, 0);
    assert.equal(x.vent.holdTime, 0); assert.equal(x.sim.holdMechanics.status, 'inapplicable');
    completions(x, 1); assert.equal(x.trace[0].decision.eligible, true);
    x.vent.holdTime = 1; x.sim.notifyMeasurementSettingsChanged(); completions(x, 1);
    assert.equal(x.trace.at(-1).decision.eligible, false); assert.notEqual(x.sim.phase, 'HOLD');
});
test('adaptive summary and analytical APIs cannot leak fixed-pressure predictions', () => {
    const x = make(); completions(x, 3); const s = x.vent.summary();
    assert.equal(s.predictionsAvailable, false);
    for (const key of ['map_cmH2O', 'pip_cmH2O', 'pplat_cmH2O', 'autoPeep_cmH2O', 'totalPeep_cmH2O', 'drivingPressure', 'resistivePressure']) assert.equal(s.pressures[key], null, key);
    for (const value of Object.values(s.volumes)) assert.equal(value, null);
    for (const key of ['autoPeep', 'totalPeep', 'trappedVolume', 'pip', 'pplat', 'drivingPressure', 'resistivePressure', 'minuteVentilation', 'effectiveVt', 'effectiveVtMl']) assert.equal(x.vent[key], null, key);
    assert.equal(x.vent.calculateMAP(), null); assert.equal(s.timing.inspFlow_Lpm, null);
    assert.throws(() => x.vent.generateBreathWaveforms(1));
    assert.equal(s.mechanics.compliance, 0.05); assert.equal(s.pressures.peep_cmH2O, 5);
});
test('uncontrolled mode entry/exit is rejected and no source is synthesized', () => {
    const x = make(); ticks(x, 30); x.vent.mode = 'pc-cmv';
    assert.throws(() => x.sim.tick(), /Transitions involving PC-CMVa/);
    assert.equal(x.sim.lastCompletedBreath, null); x.sim.setMode('pc-cmv');
    assert.equal(x.sim.lastCompletedBreath, null); x.sim.setMode(MODE_PC_CMVA);
    assert.equal(x.sim.lastCompletedBreath, null); assert.equal(x.sim.adaptiveState.applied_cmH2O, 10);
    assert.throws(() => x.sim.setMode('PC-CMVA'), /Unsupported/);
});
test('setup validation resets only after a valid configuration and keeps paused transport', () => {
    const x = prepared('expiration', true); x.sim.requestAdaptiveSettings({ peep_cmH2O: 11 });
    const before = x.sim.adaptiveState;
    assert.throws(() => x.sim.configureAdaptive({ maximumPressure_cmH2O: 4 }));
    assert.deepEqual(x.sim.adaptiveState, before);
    x.sim.configureAdaptive({ maximumPressure_cmH2O: 20 });
    assert.equal(x.sim.adaptiveState.config.maximumPressure_cmH2O, 20);
    clearFresh(x, { target: 500, peep: 11, paused: true });
});
test('above-PEEP bounds coexist with unchanged absolute pressure alarm', () => {
    const x = make({ C: 0.015, peep: 24 }); completions(x, 12);
    const state = x.sim.adaptiveState; assert.equal(state.applied_cmH2O, 25);
    assert.equal(x.sim.currentPressure, 49);
    const alarms = AlarmEngine.evaluateAlarms({ nowSec: x.sim.globalTime, elapsedSec: x.sim.globalTime,
        pipCmH2O: x.sim.breathSummary.pip, pawCmH2O: x.sim.currentPressure,
        measuredRR: x.sim.measuredRR, lastBreathStartSec: x.sim.lastBreathStartSec });
    assert.ok(alarms.some(a => a.id === 'HIGH_PRESSURE' && a.limit === 40));
    assert.equal(x.trace.at(-1).record.cycleAgent, 'machine');
});
test('production mechanics adaptation matches reviewed Phase A fixture bands', () => {
    const x = make(); completions(x, 10); edit(x, () => { x.lung.compliance = 0.025; }); completions(x, 16);
    const t = x.trace; between(t[0].record.measuredVT_mL, 434, 436); between(t[9].record.measuredVT_mL, 492, 494);
    between(t[10].record.measuredVT_mL, 278, 281); assert.equal(t[10].decision.pressureBefore_cmH2O, t[9].decision.pressureBefore_cmH2O);
    near(t[10].decision.nextPressure_cmH2O - t[10].decision.pressureBefore_cmH2O, 2);
    assert.ok(t.slice(10, 23).some(r => Math.abs(r.decision.error_mL) <= 10));
    t.slice(-4).forEach(r => between(r.record.measuredVT_mL, 490, 510));
    between(t.at(-1).decision.pressureBefore_cmH2O, 20.01, 20.05); traces.mechanics = t;
});
test('production prescribed-effort contribution matches reviewed fixture without changing drive', () => {
    const x = make({ patientRR: 12 }); completions(x, 10); edit(x, () => { x.vent.pMusMax = 8; }); completions(x, 16);
    const t = x.trace; between(t[10].record.measuredVT_mL, 708, 711); between(t[11].record.measuredVT_mL, 626, 629);
    near(t[10].decision.nextPressure_cmH2O - t[10].decision.pressureBefore_cmH2O, -2);
    assert.ok(t.slice(10, 17).some(r => Math.abs(r.decision.error_mL) <= 10));
    between(t.at(-1).record.measuredVT_mL, 508, 511); between(t.at(-1).decision.pressureBefore_cmH2O, 6.45, 6.49);
    for (const r of t.slice(10)) { assert.equal(r.prescribedEffort_cmH2O, 8); assert.equal(r.record.triggerAgent, 'patient'); assert.equal(r.record.cycleAgent, 'machine'); assert.equal(r.record.breathType, 'mandatory'); }
    traces.effort = t;
});
test('production maximum-limit demonstration retains unmet target and actual VT', () => {
    const x = make({ C: 0.015, config: { maximumPressure_cmH2O: 20 } }); completions(x, 18);
    between(x.trace[0].record.measuredVT_mL, 149, 151); assert.equal(x.trace[5].record.adaptive.applied_cmH2O, 20);
    for (const r of x.trace) assert.ok(r.record.adaptive.applied_cmH2O <= 20);
    const last = x.trace.at(-1); between(last.record.measuredVT_mL, 299, 301); between(last.decision.error_mL, 199, 201);
    assert.equal(last.record.measuredPIP_cmH2O, 25); assert.equal(last.decision.bound, 'upper');
    assert.equal(last.decision.nextPressure_cmH2O, 20); traces.upper = x.trace;
});
test('production minimum-bound excess volume remains visible', () => {
    const x = make({ C: 0.1, effort: 12, patientRR: 12 }); completions(x, 18);
    const last = x.trace.at(-1); between(last.record.measuredVT_mL, 788, 792);
    assert.equal(last.record.adaptive.applied_cmH2O, 5); assert.equal(last.decision.bound, 'lower');
    assert.equal(x.vent.pMusMax, 12); traces.lower = x.trace;
});
test('production saturation release immediately retreats without hidden windup', () => {
    const x = make({ C: 0.015, config: { maximumPressure_cmH2O: 20 } }); completions(x, 15);
    edit(x, () => { x.lung.compliance = 0.05; }); completions(x, 12);
    between(x.trace[15].record.measuredVT_mL, 866, 869); assert.equal(x.trace[15].decision.nextPressure_cmH2O, 18);
    between(x.trace.at(-1).record.measuredVT_mL, 505, 508); between(x.trace.at(-1).record.adaptive.applied_cmH2O, 11.66, 11.70);
    traces.release = x.trace;
});
test('production incomplete-expiration and off-rate stress expose limitations', () => {
    const x = make({ R: 40, C: 0.1, rr: 30, ie: [1, 1] }); completions(x, 30);
    const last = x.trace.at(-1); between(last.record.measuredVT_mL, 310, 313);
    assert.equal(last.record.adaptive.applied_cmH2O, 25); assert.ok(last.residualAtStart_mL > 1000);
    traces.trapping = x.trace;
    const y = make({ effort: 8, patientRR: 17, neuralTi: 0.6 }); completions(y, 35);
    const tail = y.trace.slice(-12); assert.ok(tail.every(r => r.record.triggerAgent === 'patient'));
    assert.ok(tail.at(-1).record.startedAt_s - tail.at(-2).record.startedAt_s < 4);
    assert.ok(Math.max(...tail.map(r => r.record.measuredVT_mL)) - Math.min(...tail.map(r => r.record.measuredVT_mL)) < 10);
    traces.offRate = y.trace;
});
test('broader operating-range and gain sampling records success and limitation rather than assuming convergence', () => {
    const fixtures = [];
    for (const R of [5, 10, 40]) for (const C of [0.015, 0.05, 0.1]) for (const rr of [12, 30]) fixtures.push({ R, C, rr, gain: 0.01 });
    fixtures.push({ R: 10, C: 0.025, rr: 12, gain: 0.01 });
    for (const gain of [0.005, 0.02]) for (const C of [0.025, 0.05, 0.1]) fixtures.push({ R: 10, C, rr: 12, gain });
    for (const f of fixtures) {
        const x = make({ ...f, config: { gain_cmH2O_per_mL: f.gain } }); completions(x, 25);
        const t = x.trace; const tail = t.slice(-5);
        assert.ok(t.every(r => Number.isFinite(r.record.measuredVT_mL) && r.record.adaptive.applied_cmH2O >= 5 && r.record.adaptive.applied_cmH2O <= 25));
        range.push({ ...f, breaths: 25,
            firstWithin10: t.find(r => Math.abs(r.decision.error_mL) <= 10)?.record.breathId ?? null,
            finalVT_mL: t.at(-1).record.measuredVT_mL, finalPressure_cmH2O: t.at(-1).record.adaptive.applied_cmH2O,
            finalBound: t.at(-1).decision.bound, finalError_mL: t.at(-1).decision.error_mL,
            final5Spread_mL: Math.max(...tail.map(r => r.record.measuredVT_mL)) - Math.min(...tail.map(r => r.record.measuredVT_mL)),
            finalResidual_mL: t.at(-1).residualAtStart_mL });
    }
    assert.equal(range.length, 25); assert.ok(range.some(r => r.firstWithin10 === null));
    assert.ok(range.some(r => r.firstWithin10 !== null));
});
test('canonical publication is immutable and read/summary operations never create extra decisions', () => {
    const x = make(); completions(x, 1); const record = x.sim.lastCompletedBreath;
    const state = x.sim.adaptiveState; for (let i = 0; i < 25; i++) { x.vent.summary(); void x.sim.adaptiveState; void x.sim.deliveredVentilation; }
    assert.equal(x.sim.lastCompletedBreath, record); assert.ok(Object.isFrozen(record.adaptive));
    assert.deepEqual(x.sim.adaptiveState, state); ticks(x, 100);
    assert.equal(x.trace.length, 1); assert.equal(x.sim.adaptiveState.lastConsumedBreathId, record.breathId);
    assert.equal(x.sim.settingsGeneration, 0); assert.equal(x.vent.inspiratoryPressure, 17);
});

const passed = results.filter(r => r.passed).length;
let failed = results.length - passed;
if (results.length !== EXPECTED_GROUPS) { failed++; console.error(`Integration discovery mismatch: ${results.length} != ${EXPECTED_GROUPS}`); }
const evidenceFlag = process.argv.indexOf('--evidence-dir');
if (evidenceFlag >= 0) {
    const directory = resolve(process.argv[evidenceFlag + 1]); mkdirSync(directory, { recursive: true });
    const save = (name, value) => writeFileSync(resolve(directory, name), JSON.stringify(value, null, 2) + '\n');
    save('integration-results.json', { passed, failed, commissionedGroups: EXPECTED_GROUPS, transitionCases: transitions.length, results });
    save('production-traces.json', traces); save('transition-matrix.json', transitions); save('operating-range.json', range);
    const identities = ['lung-model.js', 'ventilator.js', 'simulation.js', 'adaptive-controller.js'].map(name => ({
        path: new URL(name, runtime).href, sha256: createHash('sha256').update(readFileSync(new URL(name, runtime))).digest('hex'),
    }));
    identities.push({ path: import.meta.url, sha256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex') });
    save('integration-source-identities.json', { identities, runtime: process.version,
        claim: 'Production integrated deterministic model evidence; not clinical/device validation or browser proof.' });
}
console.log(`ADAPTIVE_INTEGRATION_TALLY ${passed} passed, ${failed} failed`);
if (failed !== 0 || passed !== EXPECTED_GROUPS) process.exitCode = 1;
