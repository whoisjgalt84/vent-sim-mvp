/** R-01/R-11 independent oracles. Set VSM_REVIEW_RUNTIME_URL to check baseline/mutants. */
import assert from 'node:assert/strict';
const runtime = new URL(process.env.VSM_REVIEW_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator, SUPPORTED_MODES } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const results = [];
function test(name, fn) {
    try { fn(); results.push(true); console.log('PASS ' + name); }
    catch (e) { results.push(false); console.error('FAIL ' + name + '\n' + e.stack); }
}
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function make(mode = 'vc-cmv', options = {}) {
    const lung = new LungModel({ resistance: options.R ?? 10, compliance: options.C ?? .05 });
    const vent = new Ventilator(lung, { mode, respiratoryRate: 12, ieRatio: [1, 2], ...options });
    const sim = new SimulationEngine(vent);
    sim.patientRR = options.patientRR ?? 0; sim.reset();
    return { sim, vent };
}
function trace(sim, intervals) {
    let accepted = 0;
    for (const dt of intervals) { accepted += dt * sim.speed; sim.advance(dt); }
    // This oracle sums elapsed time once, rather than duplicating per-frame rounding.
    const expected = Math.floor(accepted / sim.dt + 1e-7);
    near(sim.globalTime, expected * sim.dt, 1e-7);
    near(sim._transportCredit_s, accepted - expected * sim.dt, 1e-7);
    assert.ok(sim._transportCredit_s >= 0 && sim._transportCredit_s < sim.dt);
    return expected;
}
for (const mode of SUPPORTED_MODES) test(`R01 cadence matrix ${mode}`, () => {
    for (const hz of [60, 120, 144, 240]) for (const speed of [.5, 1, 2, 4]) {
        const { sim } = make(mode); sim.setSpeed(speed);
        const ticks = trace(sim, Array(30 * hz).fill(1 / hz));
        const direct = make(mode).sim;
        for (let i = 0; i < ticks; i++) direct.tick();
        assert.deepEqual(sim.physicsSample, direct.physicsSample);
        assert.deepEqual(sim.lastCompletedBreath, direct.lastCompletedBreath);
        assert.deepEqual(sim.buffers.pressure.toArray(), direct.buffers.pressure.toArray());
    }
});
test('R01 jitter, sub-5ms and equivalent partitions', () => {
    const intervals = Array.from({ length: 10000 }, (_, i) => [.001, .003, .007, .019][i % 4]);
    const a = make().sim, b = make().sim;
    trace(a, intervals); trace(b, Array(2500).fill(.03));
    assert.deepEqual(a.physicsSample, b.physicsSample);
});
test('R01 pause, speed credit, reset and mode reset', () => {
    const sim = make().sim;
    sim.advance(.006); sim.pause(); sim.advance(1000); near(sim._transportCredit_s, .006);
    sim.setSpeed(4); sim.resume(); sim.advance(.001); near(sim.globalTime, .01);
    sim.advance(.001); sim.setSpeed(.5); sim.advance(.012); near(sim.globalTime, .02);
    sim.pause(); sim.reset(); near(sim._transportCredit_s, 0); assert.equal(sim.running, false);
    sim.resume(); sim.advance(.006); near(sim.globalTime, 0);
    sim.setMode('pc-cmv'); near(sim._transportCredit_s, 0); near(sim.globalTime, 0);
});
test('R01 cap discards whole excess ticks, retains only fractional credit', () => {
    for (const speed of [.5, 1, 2, 4]) for (const ticks of [299, 300, 301, 10000]) {
        const sim = make().sim; sim.setSpeed(speed);
        sim.advance(.003 / speed); sim.advance((ticks * .01 + .004) / speed);
        near(sim.globalTime, Math.min(ticks, 300) * .01);
        near(sim._transportCredit_s, .007);
        sim.advance(.003 / speed); near(sim.globalTime, (Math.min(ticks, 300) + 1) * .01);
        near(sim._transportCredit_s, 0);
    }
});
// Track each sample under its breath identity before ticking; transitions occur after physics.
function observe(sim, count, verify = true) {
    const peaks = new Map(), records = [];
    let previous = sim.lastCompletedBreath;
    for (let i = 0; i < count; i++) {
        const id = sim.currentBreath?.identity.breathId;
        sim.tick();
        const sample = sim.physicsSample;
        if (sample.phase === 'INSPIRATION' && Number.isFinite(sample.paw_cmH2O)) {
            peaks.set(id, Math.max(peaks.get(id) ?? -Infinity, sample.paw_cmH2O));
        }
        if (sim.lastCompletedBreath !== previous) {
            const r = sim.lastCompletedBreath, expected = peaks.get(r.breathId) ?? null;
            if (verify) {
                assert.equal(r.measuredPIP_cmH2O, expected, `breath ${r.breathId}`);
                assert.equal(sim.lastBreathPIP, expected);
                assert.equal(sim.breathSummary.pipLatched, expected === null ? null : Math.round(expected * 10) / 10);
            }
            records.push({ record: r, expected }); previous = r;
        }
    }
    return records;
}
for (const mode of SUPPORTED_MODES) test(`R11 same-breath independent sample oracle ${mode}`, () => {
    const { sim } = make(mode, { R: 5, C: .1, respiratoryRate: 35, tidalVolume: .2,
        peep: 0, pMusMax: 12, neuralTi: 2, patientRR: 10,
        triggerType: mode === 'PC-CSV' ? 'flow' : 'pressure', flowTriggerLpm: 2, pressureTriggerCmH2O: 5 });
    const records = observe(sim, 6000);
    assert.ok(records.length > 5);
    if (mode === 'vc-cmv') {
        const b22 = records.find(x => x.record.breathId === 22);
        assert.ok(b22 && b22.expected < -.3 && b22.expected > -.4);
        assert.ok(records.find(x => x.record.breathId === 21).expected > 4);
        console.log('R11_BREATH22 ' + JSON.stringify(b22));
    }
});
test('R11 negative, zero, tiny positive and ordinary transitions; live alarm peak unchanged', () => {
    const { sim } = make();
    for (const peak of [12, -2, 0, .001, 8]) {
        sim._startNewBreath('machine'); sim.volumeAboveEq = 0;
        // Controlled pressure samples exercise the actual inspiration sampler, not a latch assignment.
        sim._computeInspiration(0, 1, peak, 0, 0);
        sim._startExpiration('timeCycle');
        assert.equal(sim.lastCompletedBreath.measuredPIP_cmH2O, peak);
        assert.equal(sim.lastBreathPIP, peak);
        assert.equal(sim.measuredPIP, Math.max(0, peak), 'legacy live alarm signal');
        assert.equal(sim.breathSummary.pip, Math.round(Math.max(0, peak) * 10) / 10, 'live alarm summary');
    }
});
test('R11 no finite sample is null, never prior peak or sentinel; reset and first breath', () => {
    const { sim } = make();
    assert.equal(sim.lastBreathPIP, null); assert.equal(sim.breathSummary.pipLatched, null);
    sim._computeInspiration(0, 1, 8, 0, 0); sim._startExpiration();
    for (const input of [undefined, NaN, Infinity, -Infinity]) {
        sim._startNewBreath('machine');
        if (input !== undefined) sim._computeInspiration(0, 1, input, 0, 0);
        sim._startExpiration();
        assert.equal(sim.lastCompletedBreath.measuredPIP_cmH2O, null);
        assert.equal(sim.lastBreathPIP, null); assert.equal(sim.breathSummary.pipLatched, null);
    }
    sim._startNewBreath('machine'); sim.volumeAboveEq = 0;
    sim._computeInspiration(0, 1, 8, 0, 0); sim._startExpiration();
    assert.equal(sim.lastBreathPIP, 8);
    sim.reset(); assert.equal(sim.lastBreathPIP, null);
});
test('R11 retains inspiration boundaries and excludes hold and expiration pressure', () => {
    for (const mode of ['vc-cmv', 'pc-cmv']) {
        const { sim } = make(mode, { holdTime: .6 });
        const records = observe(sim, 1700); assert.ok(records.length >= 3);
        assert.equal(records[0].record.holdMechanics.pplat.status, 'valid');
    }
    const sim = make().sim;
    sim._computeInspiration(0, 1, -2, 0, 0);
    sim._computeHold(1, 100, 0); sim._startExpiration();
    assert.equal(sim.lastBreathPIP, -2, 'hold pressure excluded');
    sim._computeExpiration(10, 1, 200, 0, 0); assert.equal(sim.lastBreathPIP, -2);
    const held = make('vc-cmv', { R: 5, C: .1, respiratoryRate: 35, tidalVolume: .2,
        peep: 0, pMusMax: 12, neuralTi: 2, patientRR: 10, holdTime: .2,
        triggerType: 'pressure', pressureTriggerCmH2O: 5 }).sim;
    const b22 = observe(held, 6000).find(x => x.record.breathId === 22).record;
    assert.ok(b22.measuredPIP_cmH2O < 0);
    assert.equal(b22.holdMechanics.sources.measuredPIP_cmH2O, b22.measuredPIP_cmH2O);
    assert.equal(b22.holdMechanics.pplat.status, 'invalid');
    assert.equal(b22.holdMechanics.pplat.value, null);
    assert.equal(b22.holdMechanics.resistance.status, 'invalid');
    assert.equal(b22.holdMechanics.resistance.value, null);
});
test('R11 neighboring valid effort/mechanics', () => {
    for (const effort of [4, 10]) for (const R of [5, 10]) {
        const { sim } = make('vc-cmv', { R, C: .09, pMusMax: effort, neuralTi: 2, patientRR: 10 });
        assert.ok(observe(sim, 2000).length >= 3);
    }
});
const tally = { groups: results.length, passed: results.filter(Boolean).length, failed: results.filter(x => !x).length };
console.log('REVIEW_REMEDIATION_TALLY ' + JSON.stringify(tally));
if (tally.groups !== 15 || tally.failed) process.exitCode = 1;
