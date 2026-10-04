/** Durable conformance of the accepted educational boundary; not clinical validity. */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import AlarmEngine from '../alarms.js';
import { patientTriggerVariable } from '../js/waveforms.js';
import * as RendererAPI from '../js/waveforms.js';
const runtime = new URL(process.env.VSM_EFFORT_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator, SUPPORTED_MODES } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const results = [], receipts = {};
const near = (actual, expected, tol = 1e-9) => assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected} +/- ${tol}`);
function test(name, fn) {
    try { fn(); results.push({ name, passed: true }); console.log('PASS effort-pressure: ' + name); }
    catch (error) { results.push({ name, passed: false, error: error.message }); console.error('FAIL effort-pressure: ' + name + '\n' + error.stack); }
}
function make({ mode = 'PC-CSV', R = 10, C = 0.06, peep = 5, effort = 8, patientRR = 12,
    neuralTi = 1, trigger = 'flow', rate = 100, rr = 14, ie = [1, 2], hold = 0, Rc = 2,
    pinsp = 10, ps = 10, cycle = 25, maximum = 25 } = {}) {
    const lung = new LungModel({ resistance: R, compliance: C });
    const vent = new Ventilator(lung, { mode, peep, pMusMax: effort, neuralTi, triggerType: trigger,
        flowTriggerLpm: 2, pressureTriggerCmH2O: 1, respiratoryRate: rr, ieRatio: ie,
        inspiratoryPressure: pinsp, psPressure: ps, cyclePercent: cycle, holdTime: hold,
        adaptiveConfig: { initialPressure_cmH2O: 10, maximumPressure_cmH2O: maximum } });
    const sim = new SimulationEngine(vent, { sampleRate: rate, inwardSupplyResistance_cmH2O_s_per_L: Rc });
    sim.patientRR = patientRR; sim.reset();
    return { sim, vent, lung };
}
function force(x, { phase = 'EXPIRATION', V = 0, pmus = 8, phaseTime = 0.2 } = {}) {
    const { sim } = x;
    sim._setPhase(phase); sim.phaseTime = phaseTime; sim.volumeAboveEq = V;
    sim.neuralInspActive = true; sim.neuralCycleResolved = false; sim.neuralCycleId = 1;
    Object.defineProperty(sim, 'currentPmus', { configurable: true, get: () => pmus });
    sim._syncMeasurementSettings(); sim._computePhysics();
    return sim.physicsSample;
}
function physical(sample, dt) {
    assert.ok(sample && Object.isFrozen(sample));
    near(sample.paw_cmH2O + sample.pmus_cmH2O,
        sample.appliedPeep_cmH2O + sample.volumeState_L / sample.compliance_L_per_cmH2O +
        sample.resistance_cmH2O_s_per_L * sample.netFlow_Lps);
    near(sample.volumePost_L - sample.volumePre_L, sample.netFlow_Lps * dt, 1e-12);
    assert.equal(sample.volumeGuardApplied, false, 'supported-domain volume guard must not discard volume');
}
function alarmMetrics(sim) {
    const d = sim.deliveredVentilation;
    return { nowSec: sim.globalTime, elapsedSec: sim.globalTime, pipCmH2O: sim.breathSummary.pip,
        pawCmH2O: sim.currentPressure, measuredRR: sim.measuredRR, lastBreathStartSec: sim.lastBreathStartSec,
        deliveredVentilation: d, minuteVentilationLpm: d.valueLpm, simulationStep_s: sim.dt,
        simulationTick: d.asOfTick, simulationGeneration: sim.simulationGeneration,
        modeGeneration: sim.modeGeneration, deliveryHistoryRevision: d.historyRevision };
}
function eventCheck(event) {
    assert.equal(event.schemaVersion, 1); assert.equal(event.type, 'patient');
    const d = event.detection, delivery = event.delivery;
    assert.ok(Object.isFrozen(event) && Object.isFrozen(d) && Object.isFrozen(d.signal) &&
        Object.isFrozen(d.configuration) && Object.isFrozen(d.threshold) && Object.isFrozen(delivery));
    assert.equal(d.signal.location, 'airway-opening-patient-side'); assert.equal(d.comparator, '>=');
    assert.equal(d.phase, 'EXPIRATION'); assert.ok(d.phaseTime_s > d.lockout_s);
    assert.ok(d.signal.value >= d.threshold.value); assert.ok(d.neuralCycleId > 0);
    assert.equal(d.signal.unit, d.threshold.unit);
    const pressure = d.triggerVariable === 'pressure';
    assert.ok(pressure || d.triggerVariable === 'flow');
    assert.equal(patientTriggerVariable(event), d.triggerVariable, 'actual producer-to-renderer schema validation');
    assert.equal(d.threshold.unit, pressure ? 'cmH2O' : 'L/min');
    assert.equal(d.signal.basis, pressure ? 'applied-peep-minus-paw' : 'positive-net-lung-flow');
    near(d.signal.value, pressure ? Math.max(0, d.signal.appliedPeep_cmH2O - d.signal.paw_cmH2O)
        : Math.max(0, d.signal.netFlow_Lps * 60));
    assert.equal(d.configuration.Rc_cmH2O_s_per_L, 2);
    assert.ok(Number.isInteger(d.configuration.inputRevision));
    assert.equal(d.configuration.configuredMode, delivery.configuredMode);
    assert.equal(d.simulationGeneration, delivery.simulationGeneration);
    assert.equal(d.modeGeneration, delivery.modeGeneration);
    assert.ok(event.time >= d.time_s); assert.ok(Number.isInteger(d.sampleIndex));
}
function steps(x, n, observe = () => {}) { for (let i = 0; i < n; i++) { x.sim.tick(); observe(x.sim); } }
function firstPatient(x) {
    let n = 0;
    while (!x.sim.triggerEvents.some(e => e.type === 'patient')) {
        assert.ok(n++ < 20000, 'bounded wait for patient delivery'); x.sim.tick();
    }
    return x.sim.triggerEvents.find(e => e.type === 'patient');
}

test('Rc defaults and validated setup reset preserve paused transport', () => {
    const x = make(); assert.equal(x.sim.inwardSupplyResistance_cmH2O_s_per_L, 2);
    x.sim.pause(); steps(x, 20); const generation = x.sim.simulationGeneration;
    x.sim.configureInwardSupplyResistance(0.5);
    assert.equal(x.sim.running, false); assert.equal(x.sim.globalTime, 0);
    assert.equal(x.sim.simulationGeneration, generation + 1); assert.equal(x.sim.inwardSupplyResistance_cmH2O_s_per_L, 0.5);
    x.sim.configureInwardSupplyResistance(5); assert.equal(x.sim.inwardSupplyResistance_cmH2O_s_per_L, 5);
});
test('unsupported Rc values fail without reset or changing the stored assumption', () => {
    const x = make(); const before = x.sim.simulationGeneration;
    for (const Rc of [0, 0.4999, 5.0001, 10, NaN, Infinity, '2', null]) assert.throws(() => x.sim.configureInwardSupplyResistance(Rc), RangeError);
    assert.equal(x.sim.simulationGeneration, before); assert.equal(x.sim.inwardSupplyResistance_cmH2O_s_per_L, 2);
    assert.throws(() => make({ Rc: 10 }), RangeError);
    assert.throws(() => { x.sim.inwardSupplyResistance_cmH2O_s_per_L = 3; }, TypeError);
});
test('expiration EOM and volume share a common pre-state at supported corners', () => {
    for (const R of [5, 10, 40]) for (const C of [0.015, 0.06, 0.1]) for (const B of [0, 5, 15, 24]) {
        const x = make({ R, C, peep: B });
        for (const V of [0, 0.03, 0.8]) for (const pmus of [0, 0.25, 8, 12]) {
            const s = force(x, { V, pmus }); physical(s, x.sim.dt);
            const demand = pmus - V / C;
            near(s.netFlow_Lps, demand / (demand > 0 ? R + 2 : R));
            near(s.paw_cmH2O, demand > 0 ? B - 2 * s.netFlow_Lps : B);
            assert.equal(s.volumeCollocation, 'pre');
        }
    }
});
test('zero demand and both adjacent supply branches are continuous', () => {
    const x = make();
    const left = force(x, { V: 0.24, pmus: 4 - 1e-7 });
    const zero = force(x, { V: 0.24, pmus: 4 });
    const right = force(x, { V: 0.24, pmus: 4 + 1e-7 });
    near(zero.netFlow_Lps, 0); assert.equal(zero.paw_cmH2O, 5);
    assert.equal(zero.valveState, 'neutral-peep');
    assert.ok(left.netFlow_Lps < 0 && right.netFlow_Lps > 0);
    near(left.paw_cmH2O, right.paw_cmH2O, 1e-7);
});
test('effort cessation restores outward PEEP without retaining an artificial dip', () => {
    const x = make(); const active = force(x, { V: 0.06, pmus: 8 });
    assert.ok(active.netFlow_Lps > 0 && active.paw_cmH2O < 5);
    const ended = force(x, { V: active.volumePost_L, pmus: 0 });
    assert.ok(ended.netFlow_Lps < 0); assert.equal(ended.paw_cmH2O, 5); physical(ended, x.sim.dt);
});
test('original inconsistent expiration pressure fails the independent EOM oracle', () => {
    const x = make(); const s = force(x, { V: 0.06, pmus: 8 });
    assert.throws(() => physical({ ...s, paw_cmH2O: 5 - 8 }, x.sim.dt));
});
test('PC open and closed valve states obey the same law in every pressure mode', () => {
    for (const mode of ['pc-cmv', 'pc-cmva', 'PC-CSV']) {
        const x = make({ mode });
        const open = force(x, { phase: 'INSPIRATION', V: 0.3, pmus: 1 });
        assert.equal(open.valveState, 'delivery-open'); near(open.netFlow_Lps, 0.6); near(open.paw_cmH2O, 15); physical(open, x.sim.dt);
        const shut = force(x, { phase: 'INSPIRATION', V: 0.72, pmus: 1 });
        assert.equal(shut.valveState, 'delivery-closed'); assert.equal(shut.netFlow_Lps, 0); near(shut.paw_cmH2O, 16); physical(shut, x.sim.dt);
    }
});
test('valve closure raises actual live PIP while the adaptive command stays latched', () => {
    const x = make({ mode: 'pc-cmva' }); const command = x.sim.adaptiveState.applied_cmH2O;
    force(x, { phase: 'INSPIRATION', V: 0.9, pmus: 0 });
    assert.equal(x.sim.measuredPIP, 20); assert.equal(x.sim.adaptiveState.applied_cmH2O, command);
    x.sim._startExpiration(); assert.equal(x.sim.lastBreathPIP, 20);
    assert.equal(x.sim.lastCompletedBreath.measuredPIP_cmH2O, 20);
});
test('PC valve reopens algebraically and neither reverses flow nor jumps volume', () => {
    const x = make({ mode: 'pc-cmv' }); force(x, { phase: 'INSPIRATION', V: 0.72, pmus: 1 });
    const s = force(x, { phase: 'INSPIRATION', V: 0.72, pmus: 3 });
    assert.equal(s.valveState, 'delivery-open'); near(s.netFlow_Lps, 0.1); near(s.volumePost_L, 0.721); physical(s, x.sim.dt);
});
test('commanded pressure behind a closed valve is rejected as patient-side pressure', () => {
    const x = make({ mode: 'pc-cmv' }); const s = force(x, { phase: 'INSPIRATION', V: 0.72, pmus: 1 });
    assert.throws(() => physical({ ...s, paw_cmH2O: 15 }, x.sim.dt));
});
test('post-step discrepancy is ordinary staggering for pre-collocated PC and expiration', () => {
    const x = make({ mode: 'pc-cmv' });
    for (const phase of ['INSPIRATION', 'EXPIRATION']) {
        const s = force(x, { phase, V: 0.12, pmus: 8 }); physical(s, x.sim.dt);
        const postResidual = s.paw_cmH2O + s.pmus_cmH2O - s.appliedPeep_cmH2O -
            s.volumePost_L / s.compliance_L_per_cmH2O - s.resistance_cmH2O_s_per_L * s.netFlow_Lps;
        near(postResidual, -s.netFlow_Lps * x.sim.dt / s.compliance_L_per_cmH2O);
        assert.ok(Math.abs(postResidual) > 1e-9);
    }
});
test('VC preserves its deliberate post-integration pressure collocation', () => {
    const x = make({ mode: 'vc-cmv' }); const s = force(x, { phase: 'INSPIRATION', V: 0.2, pmus: 8 });
    assert.equal(s.volumeCollocation, 'post'); assert.equal(s.volumeState_L, s.volumePost_L); physical(s, x.sim.dt);
    assert.throws(() => physical({ ...s, volumeState_L: s.volumePre_L }, x.sim.dt));
});
test('HOLD remains sealed and is distinct from delivery-valve closure', () => {
    const x = make({ mode: 'pc-cmv', hold: 1 }); const s = force(x, { phase: 'HOLD', V: 0.6, pmus: 3 });
    assert.equal(s.valveState, 'sealed-hold'); assert.equal(s.netFlow_Lps, 0); near(s.paw_cmH2O, 12); physical(s, x.sim.dt);
});
test('CSV zero flow after an established peak retains flow cycling', () => {
    const x = make(); x.sim._startNewBreath('patient');
    force(x, { phase: 'INSPIRATION', V: 0.9, pmus: 0, phaseTime: 0.02 });
    x.sim.peakInspiratoryFlow = 1; x.sim._checkTransitions();
    assert.equal(x.sim.lastCompletedBreath.terminationReason, 'flowCycle');
    assert.equal(x.sim.lastCompletedBreath.flowAtTermination_Lpm, 0);
});
test('CSV with no positive peak retains maximum-Ti fallback', () => {
    const x = make({ effort: 0, patientRR: 0 }); x.sim.volumeAboveEq = 0.9; x.sim._startNewBreath('patient');
    let n = 0; while (!x.sim.lastCompletedBreath) { assert.ok(n++ < 200); x.sim.tick(); }
    assert.equal(x.sim.lastCompletedBreath.terminationReason, 'maxTiReached');
    assert.equal(x.sim.lastCompletedBreath.measuredVT_mL, 0); near(x.sim.lastCompletedBreath.measuredPIP_cmH2O, 20);
});
test('immutable sample retains old physics phase through machine transitions', () => {
    const x = make({ mode: 'pc-cmv', effort: 0, patientRR: 0 });
    x.sim._setPhase('EXPIRATION'); x.sim.machineTimer = x.vent.totalCycleTime; x.sim.phaseTime = 2;
    x.sim.tick(); const s = x.sim.physicsSample;
    assert.equal(s.phase, 'EXPIRATION'); assert.equal(x.sim.phase, 'INSPIRATION');
    assert.equal(x.sim.buffers.pressure.last, s.paw_cmH2O); assert.equal(x.sim.buffers.flow.last, s.netFlow_Lps * 60);
    assert.ok(Object.isFrozen(s)); assert.throws(() => { s.phase = 'INSPIRATION'; }, TypeError);
});
test('pressure threshold uses actual sampled Paw rather than effort/recoil proxy', () => {
    const x = make({ trigger: 'pressure' }); const s = force(x, { V: 0, pmus: 4 });
    assert.ok(4 >= 1); assert.ok(5 - s.paw_cmH2O < 1);
    x.sim._evaluatePatientTrigger(); assert.equal(x.sim.scheduledBreathTrigger, null);
    assert.equal(x.sim.neuralCycleResolved, false);
});
test('pressure delivery records the first eligible physical threshold sample', () => {
    const x = make({ R: 5, effort: 12, trigger: 'pressure' });
    let previous = null, observed = null;
    const original = x.sim._evaluatePatientTrigger.bind(x.sim);
    x.sim._evaluatePatientTrigger = function () {
        const s = this.physicsSample; original();
        if (this.scheduledBreathTrigger === 'patient' && !observed) observed = { s, previous };
        previous = s;
    };
    const e = firstPatient(x); eventCheck(e);
    assert.equal(e.detection.sampleIndex, observed.s.sampleIndex);
    near(e.time - e.detection.time_s, x.sim.dt);
    assert.ok(Math.max(0, observed.previous.appliedPeep_cmH2O - observed.previous.paw_cmH2O) < 1);
    assert.equal(e.detection.triggerVariable, 'pressure');
    receipts.pressureRecipe = { inputs: { mode: 'PC-CSV', R: 5, C: 0.06, effort: 12, patientRR: 12,
        neuralTi: 1, ps: 10, peep: 5, pressureThreshold: 1, Rc: 2, reset: true }, event: e };
});
test('flow delivery records signed net lung flow and units from detection', () => {
    const x = make({ trigger: 'flow' }); const e = firstPatient(x); eventCheck(e);
    assert.equal(e.detection.triggerVariable, 'flow'); assert.equal(e.detection.signal.unit, 'L/min');
    near(e.detection.signal.value, e.detection.signal.netFlow_Lps * 60);
});
test('exact phaseTime <= .10 remains refractory, with first already-above-threshold eligibility', () => {
    const x = make();
    force(x, { phaseTime: 0.1, pmus: 8 }); x.sim._evaluatePatientTrigger(); assert.equal(x.sim.scheduledBreathTrigger, null);
    force(x, { phaseTime: 0.1000001, pmus: 8 }); x.sim._evaluatePatientTrigger(); assert.equal(x.sim.scheduledBreathTrigger, 'patient');
});
test('terminal unavailable effort remains mechanical and cannot carry over to expiration', () => {
    const x = make({ mode: 'pc-cmv' }); force(x, { phase: 'INSPIRATION', pmus: 8 });
    x.sim._evaluatePatientTrigger(); assert.equal(x.sim.neuralCycleResolved, true);
    assert.equal(x.sim.triggerEvents.at(-1).gateFailed, 'ventilator_unavailable');
    x.sim._setPhase('EXPIRATION'); x.sim.phaseTime = 0.2; x.sim._computePhysics();
    assert.ok(x.sim.currentFlow > 0); const before = x.sim.triggerEvents.length;
    x.sim._evaluatePatientTrigger(); assert.equal(x.sim.scheduledBreathTrigger, null); assert.equal(x.sim.triggerEvents.length, before);
});
test('threshold failure resolves once without a delivered marker', () => {
    const x = make({ effort: 0.25, trigger: 'pressure' }); steps(x, 1200);
    assert.equal(x.sim.patientBreathCount, 0);
    const outcomes = x.sim.triggerEvents.filter(e => e.type === 'failed');
    assert.equal(outcomes.length, 2); assert.ok(outcomes.every(e => e.gateFailed === 'threshold'));
    assert.notEqual(outcomes[0].neuralCycleId, outcomes[1].neuralCycleId);
});
test('passive input produces no phantom patient or failed events', () => {
    for (const mode of SUPPORTED_MODES) for (const trigger of ['flow', 'pressure']) {
        const x = make({ mode, trigger, effort: 0, patientRR: 12 }); steps(x, 6000);
        assert.ok(x.sim.triggerEvents.every(e => e.type === 'machine')); assert.equal(x.sim.patientBreathCount, 0);
    }
});
test('detection/edit/publication race freezes the actual historical trigger configuration', () => {
    const x = make(); force(x); x.sim._evaluatePatientTrigger(); const pending = x.sim._pendingTriggerDetection;
    x.vent.triggerType = 'pressure'; x.vent.flowTriggerLpm = 5; x.sim.notifyMeasurementSettingsChanged();
    x.sim.globalTime += x.sim.dt; x.sim._startNewBreath('patient'); const e = x.sim.triggerEvents.at(-1); eventCheck(e);
    assert.equal(e.detection, pending); assert.equal(e.detection.triggerVariable, 'flow'); assert.equal(e.detection.threshold.value, 2);
    assert.equal(x.sim._pendingTriggerDetection, null); assert.equal(x.sim.currentBreath.triggerDetection, pending);
});
test('queued adaptive PEEP is separate at detection and delivery without a volume jump', () => {
    const x = make({ mode: 'pc-cmva', trigger: 'pressure' }); x.sim.requestAdaptiveSettings({ peep_cmH2O: 12 });
    force(x, { pmus: 8 }); const volume = x.sim.volumeAboveEq; x.sim._evaluatePatientTrigger();
    x.sim.globalTime += x.sim.dt; x.sim._startNewBreath('patient'); const e = x.sim.triggerEvents.at(-1); eventCheck(e);
    assert.equal(e.detection.signal.appliedPeep_cmH2O, 5); assert.equal(e.detection.configuration.requestedPeep_cmH2O, 12);
    assert.equal(e.delivery.appliedPeep_cmH2O, 12); assert.equal(x.sim.volumeAboveEq, volume);
    assert.ok(Number.isInteger(e.delivery.adaptiveCommandVersion));
});
test('ordinary immediate PEEP changes do not relabel already detected history', () => {
    const x = make(); force(x); x.sim._evaluatePatientTrigger();
    x.vent.peep = 12; x.sim.notifyMeasurementSettingsChanged(); x.sim._startNewBreath('patient');
    const e = x.sim.triggerEvents.at(-1); assert.equal(e.detection.signal.appliedPeep_cmH2O, 5); assert.equal(e.delivery.appliedPeep_cmH2O, 12);
});
test('explicit pending cancellation is terminal without a new failure counter or marker', () => {
    const x = make(); force(x); x.sim._evaluatePatientTrigger(); const count = x.sim.triggerEvents.length;
    x.sim.cancelScheduledPatientBreath(); assert.equal(x.sim._pendingTriggerDetection, null);
    assert.equal(x.sim.scheduledBreathTrigger, null); assert.equal(x.sim.neuralCycleResolved, true);
    x.sim._evaluatePatientTrigger(); assert.equal(x.sim.scheduledBreathTrigger, null);
    assert.equal(x.sim.triggerEvents.length, count); assert.equal(x.sim.lastCanceledTrigger.reason, 'explicit-cancellation');
});
test('external schedule interruption clears pending provenance before the next tick', () => {
    const x = make(); force(x); x.sim._evaluatePatientTrigger(); x.sim.scheduledBreathTrigger = null;
    x.sim.tick(); assert.equal(x.sim._pendingTriggerDetection, null); assert.equal(x.sim.patientBreathCount, 0);
    assert.equal(x.sim.lastCanceledTrigger.reason, 'schedule-interruption');
});
test('reset clears pending snapshot, physics sample, neural identities and event history', () => {
    const x = make(); force(x); x.sim._evaluatePatientTrigger(); x.sim.reset();
    assert.equal(x.sim._pendingTriggerDetection, null); assert.equal(x.sim.scheduledBreathTrigger, null);
    assert.equal(x.sim.physicsSample, null); assert.equal(x.sim.neuralCycleId, 0); assert.equal(x.sim.triggerEvents.length, 0);
});
test('mode exit cannot publish stale pending patient metadata', () => {
    const x = make({ mode: 'pc-cmva' }); force(x); x.sim._evaluatePatientTrigger(); x.sim.setMode('PC-CSV');
    assert.equal(x.sim._pendingTriggerDetection, null); assert.equal(x.sim.scheduledBreathTrigger, null);
    assert.equal(x.sim.triggerEvents.length, 0); x.sim.tick(); assert.equal(x.sim.patientBreathCount, 0);
});
test('paused edits change input revision without advancing or relabeling retained events', () => {
    const x = make(); const e = firstPatient(x); const serialized = JSON.stringify(e), time = x.sim.globalTime;
    x.sim.pause(); const revision = x.sim.inputRevision; x.vent.triggerType = 'pressure'; x.sim.notifyMeasurementSettingsChanged();
    x.sim.advance(1); assert.equal(x.sim.globalTime, time); assert.equal(JSON.stringify(e), serialized);
    assert.ok(x.sim.inputRevision > revision); assert.equal(e.detection.triggerVariable, 'flow');
});
test('canonical completed breath carries the same frozen detection and delivery identity', () => {
    const x = make(); const e = firstPatient(x); let n = 0;
    while (!x.sim.lastCompletedBreath) { assert.ok(n++ < 300); x.sim.tick(); }
    const b = x.sim.lastCompletedBreath;
    assert.equal(b.triggerDetection, e.detection); assert.equal(b.triggerDelivery, e.delivery);
    assert.equal(b.breathId, e.delivery.breathId); assert.ok(Object.isFrozen(b.triggerDetection));
});
test('all modes/variables/rates matrix accounts for every volume increment and terminal outcome', () => {
    let ticks = 0, closures = 0, guardUses = 0;
    for (const mode of SUPPORTED_MODES) for (const trigger of ['flow', 'pressure']) for (const rate of [50, 100, 200, 400])
        for (const mechanics of [{ R: 5, C: 0.015, peep: 0, effort: 12, neuralTi: 0.4 },
            { R: 40, C: 0.1, peep: 24, effort: 0.25, neuralTi: 2 }]) {
            const x = make({ mode, trigger, rate, ...mechanics });
            steps(x, rate * 12, sim => {
                const s = sim.physicsSample; physical(s, sim.dt); ticks++;
                closures += s.valveState === 'delivery-closed'; guardUses += s.volumeGuardApplied;
                for (const e of sim.triggerEvents.filter(e => e.type === 'patient')) eventCheck(e);
                const terminal = sim.triggerEvents.filter(e => e.type === 'patient' || e.type === 'failed');
                const ids = terminal.map(e => e.type === 'patient' ? e.detection.neuralCycleId : e.neuralCycleId);
                assert.equal(new Set(ids).size, ids.length, 'duplicate terminal event for one neural effort');
            });
        }
    assert.ok(closures > 0); assert.equal(guardUses, 0); receipts.matrix = { ticks, closures, guardUses, configurations: 64 };
});
test('inward sinus forcing converges to an independent analytical solution', () => {
    const samples = [], R = 10, Rc = 2, C = 0.06, A = 8, w = Math.PI, time = 0.5;
    const a = 1 / ((R + Rc) * C);
    const expected = (A / (R + Rc)) * (a * Math.sin(w * time) - w * Math.cos(w * time) + w * Math.exp(-a * time)) / (a * a + w * w);
    for (const rate of [50, 100, 200, 400]) {
        const x = make({ rate }); x.sim.volumeAboveEq = 0;
        for (let n = 0; n < rate * time; n++) {
            x.sim._computeExpiration(R, C, 5, A * Math.sin(w * n / rate), x.sim.dt);
        }
        samples.push({ rate, volume: x.sim.volumeAboveEq, error: Math.abs(x.sim.volumeAboveEq - expected) });
    }
    for (let n = 1; n < samples.length; n++) assert.ok(samples[n].error < samples[n - 1].error);
    assert.ok(samples.at(-1).error < 0.001); receipts.inwardAnalytic = { expected, samples };
});
test('PC sinus forcing closure converges to independent continuous valve reference', () => {
    const a = 1 / (10 * 0.06), w = Math.PI;
    const V = t => 0.6 * (1 - Math.exp(-a * t)) + 0.8 * (a * Math.sin(w * t) - w * Math.cos(w * t) + w * Math.exp(-a * t)) / (a * a + w * w);
    let lo = 0.5, hi = 1;
    for (let n = 0; n < 60; n++) { const m = (lo + hi) / 2; if (10 + 8 * Math.sin(w * m) - V(m) / 0.06 > 0) lo = m; else hi = m; }
    const expected = V((lo + hi) / 2), samples = [];
    for (const rate of [100, 200, 400, 800]) {
        const x = make({ mode: 'pc-cmv', rate });
        for (let n = 0; n < rate * 1.4; n++) x.sim._computeInspiration(10, 0.06, 5, n < rate ? 8 * Math.sin(w * n / rate) : 0, x.sim.dt);
        samples.push({ rate, volume: x.sim.volumeAboveEq, error: Math.abs(x.sim.volumeAboveEq - expected) });
    }
    for (let n = 1; n < samples.length; n++) assert.ok(samples[n].error < samples[n - 1].error);
    assert.ok(samples.at(-1).error < 0.0005); receipts.valveAnalytic = { expected, samples };
});
test('adaptive raw source, gain/bounds and command publication boundaries stay protected', () => {
    const x = make({ mode: 'pc-cmva', effort: 12, neuralTi: 0.4 }); let seen, previousCommand = 10, previousCount = 1;
    steps(x, 10000, sim => {
        const a = sim.adaptiveState;
        if (a.applied_cmH2O !== previousCommand) assert.ok(sim.breathCount > previousCount, 'mid-breath command change');
        previousCommand = a.applied_cmH2O; previousCount = sim.breathCount;
        if (sim.lastCompletedBreath && sim.lastCompletedBreath !== seen) {
            seen = sim.lastCompletedBreath; const d = a.latestDecision;
            if (d?.eligible) {
                assert.equal(d.vt_mL, seen.measuredVT_mL); assert.equal(d.source.breathId, seen.breathId);
                const error = seen.adaptive.targetVT_mL - seen.measuredVT_mL;
                const delta = Math.abs(error) <= 10 ? 0 : Math.max(-2, Math.min(2, 0.01 * error));
                near(d.nextPressure_cmH2O, Math.max(5, Math.min(25, seen.adaptive.applied_cmH2O + delta)));
            }
        }
    });
    assert.equal(x.sim.adaptiveState.config.gain_cmH2O_per_mL, 0.01); assert.equal(x.sim.adaptiveState.config.maxStep_cmH2O, 2);
});
test('actual closure pressure activates unchanged high-pressure rule before PIP latch', () => {
    const natural = make({ mode: 'pc-cmv', R: 5, C: 0.015, peep: 24, pinsp: 15,
        effort: 12, neuralTi: 0.4, patientRR: 12 });
    let firstCrossing = null, previous = null;
    steps(natural, 529, sim => {
        const active = AlarmEngine.evaluateAlarms(alarmMetrics(sim));
        if (!firstCrossing && active.some(a => a.id === 'HIGH_PRESSURE')) {
            firstCrossing = { tick: Math.round(sim.globalTime / sim.dt), sample: sim.physicsSample,
                metrics: alarmMetrics(sim), latchedPIP: sim.lastBreathPIP, active: active.map(a => a.id), previous };
        }
        previous = { sample: sim.physicsSample, active: active.map(a => a.id) };
    });
    assert.equal(firstCrossing.tick, 529); assert.equal(firstCrossing.sample.valveState, 'delivery-closed');
    assert.equal(firstCrossing.sample.pressureCommand_cmH2O, 15); assert.equal(firstCrossing.latchedPIP, 39);
    assert.ok(firstCrossing.sample.paw_cmH2O > 40); assert.ok(firstCrossing.previous.sample.paw_cmH2O <= 40);
    assert.ok(!firstCrossing.previous.active.includes('HIGH_PRESSURE'));
    near(firstCrossing.sample.paw_cmH2O, 40.5111995987752);
    assert.equal(firstCrossing.sample.netFlow_Lps, 0); physical(firstCrossing.sample, natural.sim.dt);
    const x = make({ mode: 'pc-cmv', peep: 24, pinsp: 15 });
    const oldLatch = x.sim.lastBreathPIP;
    force(x, { phase: 'INSPIRATION', V: 1.08, pmus: 0 });
    near(x.sim.currentPressure, 42); assert.equal(x.sim.lastBreathPIP, oldLatch);
    const active = AlarmEngine.evaluateAlarms(alarmMetrics(x.sim)); assert.ok(active.some(a => a.id === 'HIGH_PRESSURE'));
    const originalInput = AlarmEngine.evaluateAlarms({ ...alarmMetrics(x.sim), pipCmH2O: 39, pawCmH2O: 39 });
    assert.ok(!originalInput.some(a => a.id === 'HIGH_PRESSURE'));
    x.sim._startExpiration(); near(x.sim.lastBreathPIP, 42);
    receipts.closureAlarm = { naturalRecipe: { mode: 'pc-cmv', R: 5, C: 0.015, peep: 24, pinsp: 15,
        effort: 12, neuralTi: 0.4, patientRR: 12, rr: 14, ie: [1, 2], trigger: 'flow', threshold: 2, Rc: 2 },
        firstCrossing, syntheticBoundaryFixture: { modeled: 42, upstream: 39, active: active.map(a => a.id) } };
});
test('VE first availability, stale/reset eligibility and five-second grace remain unchanged', () => {
    const x = make({ effort: 0, patientRR: 0 }); steps(x, 2999);
    assert.equal(x.sim.deliveredVentilation.status, 'warming');
    assert.ok(!AlarmEngine.evaluateAlarms(alarmMetrics(x.sim)).some(a => a.id.endsWith('_VE')));
    x.sim.tick(); const metrics = alarmMetrics(x.sim); assert.equal(metrics.deliveredVentilation.status, 'available');
    assert.ok(AlarmEngine.evaluateAlarms(metrics).some(a => a.id === 'LOW_VE'));
    assert.ok(!AlarmEngine.evaluateAlarms({ ...metrics, elapsedSec: 4.99 }).some(a => a.id.endsWith('_VE')));
    assert.ok(!AlarmEngine.evaluateAlarms({ ...metrics, nowSec: metrics.nowSec + 0.01 }).some(a => a.id.endsWith('_VE')));
    x.sim.reset(); assert.ok(!AlarmEngine.evaluateAlarms(alarmMetrics(x.sim)).some(a => a.id.endsWith('_VE')));
    receipts.firstVE = { metrics, alarms: AlarmEngine.evaluateAlarms(metrics).map(a => a.id) };
});
test('reported clean-reset Rc2 setup retains intentional flow3 versus pressure0 deliveries', () => {
    const rows = [];
    for (const trigger of ['flow', 'pressure']) {
        const x = make({ mode: 'pc-cmva', trigger, effort: 8 }); steps(x, 6000);
        rows.push({ trigger, patient: x.sim.patientBreathCount, machine: x.sim.machineBreathCount, ve: x.sim.deliveredVentilation.valueLpm });
    }
    assert.equal(rows[0].patient, 3); assert.equal(rows[1].patient, 0); receipts.reportedSetup = rows;
});
test('exact completion-indexed adaptive demonstrations preserve accepted recipe inputs', () => {
    const demos = [];
    for (const recipe of ['mechanics', 'contribution', 'limit']) {
        const x = make({ mode: 'pc-cmva', R: 10, C: recipe === 'limit' ? 0.015 : 0.05,
            effort: 0, patientRR: recipe === 'contribution' ? 12 : 0, neuralTi: 1,
            rr: 12, ie: [1, 4], maximum: recipe === 'limit' ? 20 : 25 });
        const records = []; let seen, n = 0;
        while (records.length < (recipe === 'limit' ? 18 : 26)) {
            assert.ok(n++ < 20000); x.sim.tick();
            if (x.sim.lastCompletedBreath && x.sim.lastCompletedBreath !== seen) {
                seen = x.sim.lastCompletedBreath; records.push({ record: seen, decision: x.sim.adaptiveState.latestDecision,
                    alarms: AlarmEngine.evaluateAlarms(alarmMetrics(x.sim)).map(a => a.id) });
                if (records.length === 10 && recipe !== 'limit') {
                    if (recipe === 'mechanics') x.lung.compliance = 0.025; else x.vent.pMusMax = 8;
                    x.sim.notifyMeasurementSettingsChanged();
                }
            }
        }
        const final = records.at(-1).record;
        if (recipe === 'mechanics') { near(records[10].record.measuredVT_mL, 279.494195, 0.000001); near(final.measuredVT_mL, 492.302571, 0.000001); }
        if (recipe === 'contribution') { near(records[10].record.measuredVT_mL, 709.776512, 0.000001); near(final.measuredVT_mL, 509.454004, 0.000001); }
        if (recipe === 'limit') { assert.equal(final.adaptive.applied_cmH2O, 20); near(final.measuredVT_mL, 299.697449, 0.000001); }
        demos.push({ recipe, records, ve: x.sim.deliveredVentilation, rr: x.sim.measuredRR, triggerEvents: x.sim.triggerEvents });
    }
    receipts.demos = demos;
});

// Durable-test fragment: import runRendererContractChecks and supply renderer API.
// No instance overrides of healthy renderer behavior; fake canvas records draw calls.
function runRendererContractChecks(api) {
    const { WaveformRenderer, WaveformDisplay, LoopRenderer, signedPressureRange,
        patientTriggerVariable, hasUnknownPatientTriggerProvenance } = api;
    const beforeWindow = globalThis.window, beforeDocument = globalThis.document;
    let teaching = false;
    globalThis.window = { devicePixelRatio: 1 };
    globalThis.document = { body: { classList: { contains: () => teaching } } };
    const results = [];
    const check = (name, pass) => results.push({ name, pass: !!pass });
    const eq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
    function canvas() {
        let current=[];
        const c={ widthCss:700,heightCss:220,title:'',strokes:[],texts:[],clips:0,
            addEventListener(){},getBoundingClientRect(){return{width:this.widthCss,height:this.heightCss,left:0}},getContext(){return ctx} };
        const ctx={ beginPath(){current=[]},moveTo(x,y){current.push(['M',x,y])},lineTo(x,y){current.push(['L',x,y])},
            stroke(){c.strokes.push({color:this.strokeStyle,path:current.slice(),dash:this.dash?.slice()??[]})},fill(){},arc(x,y){current.push(['arc',x,y])},closePath(){},rect(){},clip(){c.clips++},save(){},restore(){},scale(){},fillRect(){},strokeRect(){},setLineDash(value){this.dash=value},fillText(text,x,y){c.texts.push({text,x,y})},translate(){},rotate(){},createLinearGradient(){return {gradient:true,addColorStop(){}}} };
        return c;
    }
    const event = (variable,time) => {
        const pressure=variable==='pressure', unit=pressure?'cmH2O':'L/min';
        return { schemaVersion:1,type:'patient',time,
            detection:{time_s:time-.01,sampleIndex:Math.round(time*100)-1,simulationGeneration:0,modeGeneration:0,neuralCycleId:1,
                triggerVariable:variable,threshold:{value:pressure?1:2,unit},comparator:'>=',
                signal:{location:'airway-opening-patient-side',paw_cmH2O:3,netFlow_Lps:.05,appliedPeep_cmH2O:5,value:pressure?2:3,unit,basis:pressure?'applied-peep-minus-paw':'positive-net-lung-flow'},
                configuration:{configuredMode:'pc-cmv',settingsGeneration:0,inputRevision:0,Rc_cmH2O_s_per_L:2,pressureThreshold_cmH2O:1,flowThreshold_Lpm:2,requestedPeep_cmH2O:9},
                phase:'EXPIRATION',phaseTime_s:.11,lockout_s:.1,previousEligibleSignal:null},
            delivery:{simulationGeneration:0,modeGeneration:0,breathId:1,configuredMode:'pc-cmv',appliedPeep_cmH2O:9,pressureCommand_cmH2O:10,adaptiveCommandVersion:null} };
    };
    try {
        const pressure=event('pressure',1), flow=event('flow',2), unknown={type:'patient',time:3};
        check('recorded pressure metadata validated',patientTriggerVariable(pressure)==='pressure');
        check('recorded flow metadata validated',patientTriggerVariable(flow)==='flow');
        check('unknown metadata explicitly omitted',patientTriggerVariable(unknown)===null&&hasUnknownPatientTriggerProvenance([unknown]));
        check('valid history not unknown',!hasUnknownPatientTriggerProvenance([pressure,flow]));
        const defects=[
            e=>delete e.detection,
            e=>e.detection.signal.location='upstream-command',
            e=>e.detection.signal.paw_cmH2O=5,
            e=>e.detection.signal.appliedPeep_cmH2O=9,
            e=>e.detection.signal.unit='L/min',
            e=>e.detection.threshold.unit='L/min',
            e=>e.detection.configuration.inputRevision=undefined,
            e=>e.detection.neuralCycleId=undefined,
            e=>e.detection.sampleIndex=NaN,
            e=>e.delivery.modeGeneration=1,
            e=>e.detection.configuration.Rc_cmH2O_s_per_L=10,
            e=>e.detection.phaseTime_s=.1,
            e=>e.detection.configuration.pressureThreshold_cmH2O=3,
            e=>e.time=e.detection.time_s-.1,
        ];
        defects.forEach((defect,i)=>{const bad=structuredClone(pressure);defect(bad);check(`partial/incoherent metadata ${i} omitted`,patientTriggerVariable(bad)===null)});
        const events=[pressure,flow,unknown,{type:'machine',time:4},{type:'failed',time:5}, {type:'arbitrary',time:6}];
        const display=new WaveformDisplay({pressure:canvas(),volume:canvas(),flow:canvas()});
        for(const [kind,r] of [['pressure',display.pressureRenderer],['flow',display.flowRenderer],['volume',display.volumeRenderer]]) {
            r._drawTriggerMarkers(r.ctx,events,t=>t,r.plotArea);
            const expected=kind==='volume'?[4]:[kind==='pressure'?1:2,4];
            check(`${kind} exact patient/machine/failure mapping`,eq(r.renderedTriggerMarkers.map(e=>e.time),expected));
            const history=JSON.stringify(events), markers=JSON.stringify(r.renderedTriggerMarkers);
            // Live object is deliberately unrelated to recorded history; rendering may not consult it.
            r.liveTriggerType='flow';r._drawTriggerMarkers(r.ctx,events,t=>t,r.plotArea);
            check(`${kind} live settings cannot relabel`,markers===JSON.stringify(r.renderedTriggerMarkers)&&history===JSON.stringify(events));
            r._drawTriggerMarkers(r.ctx,events,t=>t,r.plotArea,()=>true);
            check(`${kind} erase band omits all symbols`,r.renderedTriggerMarkers.length===0);
        }
        for(const data of [[-3,25,5],[-.05,10,5],[-70,25,5],[5,25,5]]) {
            const c=canvas(),r=new WaveformRenderer(c,{kind:'pressure',color:'#fixture'});
            r.render([0,1,2],data);
            const g=r.lastGeometry, trace=c.strokes.find(s=>s.color==='#fixture');
            check(`pressure ${data[0]} finite samples in range`,g.yMin<=Math.min(0,...data)&&g.yMax>=Math.max(0,...data));
            check(`pressure ${data[0]} actual affine signed trace`,Math.abs(trace.path[0][2]-(g.plot.y+g.plot.h-((data[0]-g.yMin)/(g.yMax-g.yMin))*g.plot.h))<1e-9);
            if(data[0]<0)check(`pressure ${data[0]} never pins negative at floor`,trace.path[0][2]<g.plot.y+g.plot.h);
            check(`pressure ${data[0]} zero reference`,c.strokes.some(s=>eq(s.dash,[4,4])&&s.path.length===2));
            const before=JSON.stringify({data,events,range:[g.yMin,g.yMax,g.yStep]});
            globalThis.window.devicePixelRatio=2;c.widthCss=350;c.heightCss=180;c.strokes=[];
            r.render([0,1,2],data);
            check(`pressure ${data[0]} highDPI frozen resize`,c.width===700&&c.height===360&&before===JSON.stringify({data,events,range:[r.lastGeometry.yMin,r.lastGeometry.yMax,r.lastGeometry.yStep]}));
            globalThis.window.devicePixelRatio=1;
        }
        check('positive-only range preserves commissioned geometry',eq(signedPressureRange(5,25),{yMin:0,yMax:30,yStep:5}));
        check('all-invalid pressure range fallback',eq(signedPressureRange(Infinity,-Infinity),{yMin:0,yMax:10,yStep:2}));
        const invalidCanvas=canvas(),invalid=new WaveformRenderer(invalidCanvas,{kind:'pressure',color:'#invalid'});
        invalid.render([0,1,2,3,4],[1,2,NaN,-3,5]);
        const invalidTrace=invalidCanvas.strokes.find(s=>s.color==='#invalid');
        check('nonfinite scalar pen lifts rather than bridging',eq(invalidTrace.path.map(p=>p[0]),['M','L','M','L']));
        check('nonfinite scalar diagnostic state',invalid.sampleDataStatus==='partial');
        check('nonfinite never enters canvas path',invalidCanvas.strokes.every(s=>s.path.every(p=>p.slice(1).every(Number.isFinite))));
        invalid.render([0,1],[NaN,Infinity]);
        check('all-invalid scalar unavailable',invalid.sampleDataStatus==='unavailable'&&invalid.lastGeometry.yMin===0&&invalid.lastGeometry.yMax===10);
        const highlightCanvas=canvas(),highlight=new WaveformRenderer(highlightCanvas,{kind:'pressure'});
        const times=[0,1,2,3,4],values=[-3,-2,NaN,-1,0],plot=highlight.plotArea;
        const segments=[{trace:'pressure',tStart:0,tEnd:4,color:'#f0c050',tooltip:'fixture',label:'fixture'}];
        highlight._drawWaveformHighlights(highlight.ctx,segments,times,values,t=>t,v=>100-v,plot,x=>x===1);
        const highlightStroke=highlightCanvas.strokes.find(s=>s.color?.gradient);
        check('highlight signed geometry not coordinate-pinned',highlightStroke.path[0][2]===103);
        check('highlight skips erase and nonfinite points',eq(highlightStroke.path.map(p=>p[1]),[0,3,4]));
        check('highlight gap pen lifts',eq(highlightStroke.path.map(p=>p[0]),['M','M','L']));
        highlight._highlightHoverX=1;highlight._syncHighlightTooltip();
        check('erased highlight has no stale tooltip',highlightCanvas.title==='');
        highlight._drawWaveformHighlights(highlight.ctx,[{...segments[0],tStart:8,tEnd:12}],[8,9,10,11,12],[1,2,3,4,5],t=>t%10,v=>v,plot);
        check('highlight wrap splits hover regions',highlight._highlightHoverRegions.length===2);
        const tailCanvas=canvas(),tail=new WaveformRenderer(tailCanvas,{kind:'flow'});
        tail._drawTailHighlight(tail.ctx,times,values,{start:0,end:5},false,t=>t,v=>100-v,tail.plotArea,x=>x===1);
        const tailStroke=tailCanvas.strokes[0];
        check('tail highlight skips erase and nonfinite',eq(tailStroke.path.map(p=>p[1]),[0,3,4]));
        check('tail highlight gap pen lifts',eq(tailStroke.path.map(p=>p[0]),['M','M','L']));
        const loopCanvas=canvas(),loop=new LoopRenderer(loopCanvas,{xKind:'pressure',color:'#loop'});
        loop.render({x:[-3,5,25],y:[0,100,500]},{x:[-8,NaN,20],y:[0,300,400]});
        check('PV signed range covers BOTH loops and zero',loop.lastGeometry.xRange.lo<-8&&loop.lastGeometry.xRange.hi>=25);
        check('PV nonfinite partial state',loop.sampleDataStatus==='partial');
        check('PV nonfinite never enters drawn coordinates',loopCanvas.strokes.every(s=>s.path.every(p=>p.slice(1).every(Number.isFinite))));
        loop.render({x:[],y:[]},{x:[],y:[]});
        check('PV empty pressure fallback not stale geometry',loop.sampleDataStatus==='unavailable'&&loop.lastGeometry.xRange.lo===0&&loop.lastGeometry.xRange.hi===10);
        const failure=display._failedEffortTooltip({gateFailed:'threshold'},{type:'pressure',pressureCmH2O:4});
        check('failure tooltip historical neutral wording',failure.includes('Earlier trigger settings are not stored')&&!failure.includes('4.0'));
        check('unavailable failure terminal explanation',display._failedEffortTooltip({gateFailed:'ventilator_unavailable'}).includes('not reconsidered'));
        teaching=true;
        const teachCanvas=canvas(),teach=new WaveformRenderer(teachCanvas,{kind:'pressure'});
        teach.render([0,1,2],[-3,10,5]);
        check('teaching signed labels visible',teachCanvas.texts.some(t=>String(t.text).startsWith('-')));
        return {checks:results,passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length};
    } finally { globalThis.window=beforeWindow;globalThis.document=beforeDocument; }
}

test('signed renderer, highlights, frozen resize and full historical schema conform', () => {
    const renderer = runRendererContractChecks(RendererAPI);
    assert.equal(renderer.passed, 66); assert.equal(renderer.failed, 0,
        JSON.stringify(renderer.checks.filter(c => !c.pass)));
    receipts.renderer = renderer;
});

const EXPECTED_GROUPS = 41;
const tally = { groups: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length };
if (process.env.VSM_EFFORT_OUTPUT_JSON) writeFileSync(process.env.VSM_EFFORT_OUTPUT_JSON, JSON.stringify({ tally, results, receipts }, null, 2) + '\n');
console.log('EFFORT_PRESSURE_TALLY ' + JSON.stringify(tally));
if (results.length !== EXPECTED_GROUPS || tally.failed) process.exitCode = 1;
