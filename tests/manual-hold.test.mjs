import assert from 'node:assert/strict';
const runtime = new URL(process.env.VSM_HOLD_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const results = [];
function test(name, run) {
    try { run(); results.push({ name, passed: true }); console.log('PASS manual-hold: ' + name); }
    catch (error) { results.push({ name, passed: false }); console.error('FAIL manual-hold: ' + name + '\n' + error.stack); }
}
function make(settings = {}) {
    const lung = new LungModel({ resistance: 10, compliance: 0.05 });
    const vent = new Ventilator(lung, { respiratoryRate: 12, ieRatio: [1, 2], ...settings });
    const sim = new SimulationEngine(vent);
    return { lung, vent, sim };
}
function until(sim, predicate, max = 2000) {
    for (let i = 0; i < max && !predicate(); i++) sim.tick();
    assert.ok(predicate(), 'bounded transition');
}
function ticks(sim, n) { for (let i = 0; i < n; i++) sim.tick(); }
function begin(sim) { assert.equal(sim.pressManualHold(), true); until(sim, () => sim.phase === 'HOLD'); }
function release(sim, count = 60) {
    ticks(sim, count - 1); sim.releaseManualHold(); sim.tick();
    assert.equal(sim.phase, 'EXPIRATION');
    return sim.lastManualHoldAttempt;
}
function valid(sim) { begin(sim); return release(sim); }
test('initial four manual results unavailable; recurring default zero', () => {
    const { sim, vent } = make(); assert.equal(vent.holdTime, 0);
    for (const key of ['pplat','drivingPressure','compliance','resistance']) assert.equal(sim.retainedHoldMechanics[key].value, null);
    assert.equal(sim.lastManualHoldAttempt, null);
});
test('press preserves inspiration delivery and arms end-inspiration', () => {
    const { sim } = make(); ticks(sim, 20); const volume = sim.volumeAboveEq;
    assert.ok(sim.pressManualHold()); ticks(sim, 30);
    assert.equal(sim.phase, 'INSPIRATION'); assert.ok(sim.volumeAboveEq > volume);
    assert.ok(sim.manualHoldState.armed); assert.equal(sim.manualHoldState.duration_s, 0);
    until(sim, () => sim.phase === 'HOLD'); assert.ok(sim.manualHoldState.active);
});
test('release before end-inspiration cancels arming without an attempt', () => {
    const { sim } = make(); sim.pressManualHold(); sim.releaseManualHold(); ticks(sim, 200);
    assert.equal(sim.phase, 'EXPIRATION'); assert.equal(sim.lastManualHoldAttempt, null);
    assert.equal(sim.manualHoldState.outcome, 'armed-canceled');
});
test('expiration press arms only the next eligible end-inspiration', () => {
    const { sim } = make(); until(sim, () => sim.phase === 'EXPIRATION'); const breath = sim.breathCount;
    sim.pressManualHold(); ticks(sim, 20); assert.equal(sim.phase, 'EXPIRATION');
    until(sim, () => sim.phase === 'HOLD'); assert.equal(sim.breathCount, breath + 1);
});
test('expiration release prevents future arming', () => {
    const { sim } = make(); until(sim, () => sim.phase === 'EXPIRATION'); sim.pressManualHold(); sim.releaseManualHold();
    ticks(sim, 800); assert.equal(sim.lastManualHoldAttempt, null); assert.equal(sim.manualHoldState.active, false);
});
test('normal release publishes exactly 50 contiguous simulated samples', () => {
    const { sim } = make(); begin(sim); const result = release(sim, 50);
    assert.equal(result.mechanics.actualDuration_s, 0.5); assert.equal(result.mechanics.sampleCount, 50);
    assert.equal(result.mechanics.pplat.status, 'valid'); assert.equal(result.completion, 'released');
    assert.equal(result.mechanics.firstPhysicsSampleIndex, result.mechanics.entryBoundarySampleIndex + 1);
});
test('49-sample attempt invalid; no valid history fabricated', () => {
    const { sim } = make(); begin(sim); const result = release(sim, 49);
    assert.equal(result.mechanics.actualDuration_s, 0.49); assert.ok(result.mechanics.reasons.includes('HOLD_TOO_SHORT'));
    assert.ok(result.mechanics.reasons.includes('INSUFFICIENT_SAMPLES')); assert.equal(sim.lastValidManualHold, null);
});
test('cap includes exactly 200 samples and stays valid', () => {
    const { sim } = make(); begin(sim); until(sim, () => sim.phase === 'EXPIRATION');
    assert.equal(sim.lastManualHoldAttempt.mechanics.actualDuration_s, 2);
    assert.equal(sim.lastManualHoldAttempt.mechanics.sampleCount, 200);
    assert.equal(sim.lastManualHoldAttempt.mechanics.status, 'valid');
    assert.equal(sim.manualHoldState.outcome, 'timing-limit');
});
test('continued press and rapid repeated presses after cap never rearm', () => {
    const { sim } = make(); begin(sim); until(sim, () => sim.phase === 'EXPIRATION');
    const result = sim.lastManualHoldAttempt;
    for (let i = 0; i < 800; i++) { assert.equal(sim.pressManualHold(), false); sim.tick(); }
    assert.equal(sim.lastManualHoldAttempt, result); assert.equal(sim.manualHoldState.armed, false);
});
test('release and fresh press after cap allow a new maneuver', () => {
    const { sim } = make(); begin(sim); until(sim, () => sim.phase === 'EXPIRATION'); const old = sim.lastValidManualHold;
    sim.releaseManualHold(); begin(sim); release(sim); assert.notEqual(sim.lastValidManualHold.breathId, old.breathId);
});
test('rapid release/repress cannot rescind expiration; it arms the next breath', () => {
    const { sim } = make(); begin(sim); ticks(sim, 59); sim.releaseManualHold();
    assert.equal(sim.pressManualHold(), true); sim.tick(); assert.equal(sim.phase, 'EXPIRATION');
    assert.equal(sim.lastManualHoldAttempt.mechanics.actualDuration_s, 0.6);
    assert.equal(sim.manualHoldState.armed, true); until(sim, () => sim.phase === 'HOLD');
    assert.equal(sim.manualHoldState.active, true);
});
test('cycle cap rounds down and leaves at least 0.2 seconds expiration', () => {
    const { sim, vent } = make({ respiratoryRate: 35, ieRatio: [1, 1] }); begin(sim);
    until(sim, () => sim.phase === 'EXPIRATION'); const result = sim.lastManualHoldAttempt;
    assert.ok(result.mechanics.actualDuration_s < 2); assert.equal(result.mechanics.status, 'valid');
    assert.ok(vent.totalCycleTime - result.completedAt_s >= 0.2 - 1e-9);
});
test('timing cap below minimum creates invalid attempt, not valid plateau', () => {
    const { sim } = make({ respiratoryRate: 60, ieRatio: [1, 1] }); begin(sim);
    until(sim, () => sim.phase === 'EXPIRATION');
    assert.equal(sim.lastManualHoldAttempt.completion, 'timing-limit');
    assert.ok(sim.lastManualHoldAttempt.mechanics.actualDuration_s < 0.5);
    assert.equal(sim.lastValidManualHold, null);
});
test('zero available occlusion closes and completes without invented samples', () => {
    const { sim } = make({ respiratoryRate: 100, ieRatio: [5, 1] });
    sim.pressManualHold(); until(sim, () => sim.lastManualHoldAttempt !== null);
    assert.equal(sim.phase, 'EXPIRATION'); assert.equal(sim.lastManualHoldAttempt.mechanics.sampleCount, 0);
    assert.equal(sim.lastValidManualHold, null);
});
test('recurring pauses cannot populate or overwrite manual history', () => {
    const { sim, vent } = make({ holdTime: 0.6 }); ticks(sim, 1000);
    assert.equal(sim.lastValidManualHold, null); assert.equal(sim.lastManualHoldAttempt, null);
    valid(sim); const history = sim.lastValidManualHold; ticks(sim, 1200);
    assert.equal(sim.lastValidManualHold, history); assert.equal(vent.holdTime, 0.6);
});
test('manual takeover retains collector, entry boundary and continuous duration', () => {
    const { sim } = make({ holdTime: 1 }); until(sim, () => sim.phase === 'HOLD'); ticks(sim, 30);
    const collector = sim.currentBreath.holdCollector; const entry = collector.entryBoundarySampleIndex;
    sim.pressManualHold(); assert.equal(sim.currentBreath.holdCollector, collector);
    assert.equal(sim.manualHoldState.duration_s, 0.3); const result = release(sim, 30);
    assert.equal(result.mechanics.entryBoundarySampleIndex, entry); assert.equal(result.mechanics.actualDuration_s, 0.6);
});
test('takeover cap uses full scheduled plus manual continuous pause', () => {
    const { sim } = make({ holdTime: 1.8 }); until(sim, () => sim.phase === 'HOLD'); ticks(sim, 120);
    sim.pressManualHold(); until(sim, () => sim.phase === 'EXPIRATION');
    assert.equal(sim.lastManualHoldAttempt.mechanics.actualDuration_s, 2);
    assert.equal(sim.lastManualHoldAttempt.mechanics.sampleCount, 200);
});
test('manual release overrides recurring pause only for that breath', () => {
    const { sim, vent } = make({ holdTime: 1.5 }); valid(sim);
    assert.equal(sim.lastManualHoldAttempt.mechanics.actualDuration_s, 0.6); assert.equal(vent.holdTime, 1.5);
    until(sim, () => sim.phase === 'HOLD'); assert.equal(sim.manualHoldState.active, false);
    until(sim, () => sim.phase === 'EXPIRATION'); assert.ok(sim.lastCompletedBreath.holdMechanics.actualDuration_s >= 1.5);
});
for (const mode of ['pc-cmv', 'vc-cmv']) test(mode + ' valid same-breath dependencies and frozen provenance', () => {
    const { sim } = make({ mode }); const result = valid(sim); const h = result.mechanics;
    assert.equal(h.status, 'valid'); assert.equal(h.drivingPressure.value, h.pplat.value - h.baseline.value_cmH2O);
    assert.equal(h.compliance.value, h.sources.measuredVT_mL / h.drivingPressure.value);
    assert.deepEqual(h.sources.identity, h.identity); assert.deepEqual(h.baseline.identity, h.identity);
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(h.sources.identity));
    if (mode === 'pc-cmv') assert.equal(h.resistance.status, 'inapplicable');
    else assert.equal(h.resistance.value, (h.sources.measuredPIP_cmH2O - h.pplat.value) / h.sources.endInspiratoryFlow_Lps);
});
test('ramp VC retains valid plateau with unavailable resistance', () => {
    const { sim } = make({ flowPattern: 'ramp' }); const h = valid(sim).mechanics;
    assert.equal(h.pplat.status, 'valid'); assert.equal(h.resistance.value, null);
    assert.ok(h.resistance.reasons.includes('RESISTANCE_RAMP_VC'));
});
test('ordinary breaths and settings retain exact old bytes without recomputation', () => {
    const { sim, vent, lung } = make(); valid(sim); const old = sim.lastValidManualHold; const bytes = JSON.stringify(old);
    vent.peep = 10; lung.compliance = 0.08; sim.notifyMeasurementSettingsChanged(); ticks(sim, 1000);
    assert.equal(sim.lastValidManualHold, old); assert.equal(JSON.stringify(old), bytes);
    assert.equal(sim.retainedHoldMechanics, old.mechanics);
});
test('invalid later actual hold retains all prior same-breath results', () => {
    const { sim } = make(); valid(sim); const old = sim.lastValidManualHold; begin(sim); const attempt = release(sim, 20);
    assert.equal(attempt.mechanics.status, 'invalid'); assert.equal(sim.lastValidManualHold, old);
    assert.equal(sim.retainedHoldMechanics, old.mechanics);
});
for (const reason of ['pointer-cancel','lost-pointer-capture','window-blur','hidden-tab','focus-lost']) {
    test(reason + ' cancels valid-length actual hold without publishing success', () => {
        const { sim } = make(); valid(sim); const old = sim.lastValidManualHold; begin(sim); ticks(sim, 60);
        sim.cancelManualHold(reason); assert.equal(sim.phase, 'EXPIRATION');
        assert.equal(sim.lastManualHoldAttempt.completion, 'canceled');
        assert.equal(sim.lastManualHoldAttempt.cancellationReason, reason);
        assert.ok(sim.lastManualHoldAttempt.mechanics.reasons.includes('HOLD_INTERRUPTED'));
        ticks(sim, 800); assert.equal(sim.lastValidManualHold, old); assert.equal(sim.manualHoldState.armed, false);
    });
}
test('transport pause cancels/disarms, resume cannot restart', () => {
    const { sim } = make(); begin(sim); ticks(sim, 60); sim.pause(); assert.equal(sim.running, false);
    assert.equal(sim.phase, 'EXPIRATION'); assert.equal(sim.lastValidManualHold, null);
    assert.equal(sim.pressManualHold(), false); sim.resume(); ticks(sim, 1000); assert.equal(sim.manualHoldState.active, false);
    sim.pressManualHold(); sim.toggle(); assert.equal(sim.manualHoldState.armed, false);
});
test('setting edit during actual hold invalidates and releases immediately', () => {
    const { sim, vent } = make(); begin(sim); ticks(sim, 60); vent.peep = 8; sim.notifyMeasurementSettingsChanged();
    assert.equal(sim.phase, 'EXPIRATION'); assert.equal(sim.lastValidManualHold, null);
    assert.ok(sim.lastManualHoldAttempt.mechanics.reasons.includes('SETTINGS_CHANGED'));
});
test('edit/revert and effort-only edits cannot evade invalidation', () => {
    for (const kind of ['equal-event','effort','mechanics']) {
        const { sim, vent, lung } = make(); begin(sim); ticks(sim, 60);
        if (kind === 'equal-event') sim.notifyMeasurementSettingsChanged();
        if (kind === 'effort') { vent.pMusMax = 2; sim.tick(); }
        if (kind === 'mechanics') { lung.resistance = 20; sim.tick(); }
        assert.equal(sim.lastValidManualHold, null); assert.equal(sim.manualHoldState.active, false);
        assert.ok(sim.lastManualHoldAttempt.mechanics.reasons.includes('SETTINGS_CHANGED'));
    }
});
test('setting edits while armed cancel without attempted hold', () => {
    const { sim, vent } = make(); sim.pressManualHold(); vent.respiratoryRate = 20; sim.tick();
    assert.equal(sim.manualHoldState.armed, false); assert.equal(sim.lastManualHoldAttempt, null);
});
test('mode transitions cancel and explicitly retain original historical mode', () => {
    const { sim } = make(); valid(sim); const old = sim.lastValidManualHold;
    begin(sim); ticks(sim, 60); sim.setMode('pc-cmv'); assert.equal(sim.lastValidManualHold, old);
    assert.equal(old.configuredMode, 'vc-cmv'); assert.equal(sim.manualHoldState.active, false);
    for (const mode of ['PC-CSV','pc-cmva','vc-cmv']) { sim.setMode(mode); assert.equal(sim.lastValidManualHold, old); }
});
for (const mode of ['PC-CSV','pc-cmva']) test(mode + ' explicitly excludes manual and recurring hold', () => {
    const { sim, vent } = make({ mode, holdTime: 1 }); assert.equal(sim.pressManualHold(), false);
    assert.equal(sim.manualHoldState.supported, false); assert.equal(vent.effectiveHoldTime, 0);
});
test('Reset clears armed/active/valid/invalid history and retains settings/transport', () => {
    const { sim, vent } = make({ holdTime: 0.7 }); valid(sim); begin(sim); release(sim, 20); sim.pressManualHold();
    sim.pause(); sim.reset(); assert.equal(sim.lastValidManualHold, null); assert.equal(sim.lastManualHoldAttempt, null);
    assert.equal(sim.manualHoldState.pressed, false); assert.equal(sim.manualHoldState.armed, false);
    assert.equal(sim.running, false); assert.equal(vent.holdTime, 0.7);
});
test('settings-associated reset retains history; explicit Reset clears it', () => {
    const { sim } = make(); valid(sim); const old = sim.lastValidManualHold;
    sim.reset({ preserveManualHistory: true }); assert.equal(sim.lastValidManualHold, old);
    sim.reset(); assert.equal(sim.lastValidManualHold, null);
});
test('simulated speed changes neither cap nor measurement duration', () => {
    const outcomes = [0.5,1,2,4].map(speed => {
        const { sim } = make(); sim.setSpeed(speed); begin(sim);
        for (let i = 0; i < 1000 && sim.manualHoldState.active; i++) sim.advance(0.01);
        return sim.lastManualHoldAttempt.mechanics;
    });
    for (const h of outcomes) { assert.equal(h.actualDuration_s, 2); assert.equal(h.sampleCount, 200); assert.equal(h.status, 'valid'); }
});
test('Pmus remains physical and invalidates a hold instead of being suppressed', () => {
    const { sim, vent } = make({ pMusMax: 6, neuralTi: 2 }); sim.patientRR = 12; sim.reset(); ticks(sim, 500); begin(sim);
    const h = release(sim).mechanics; assert.equal(vent.pMusMax, 6); assert.equal(sim.patientRR, 12);
    assert.ok(h.reasons.includes('EFFORT_DURING_HOLD')); assert.ok(h.metrics.wholeHoldMaxAbsPmus_cmH2O > 0);
});
for (const defect of ['pressure','flow','nonfinite','membership']) test('collector rejects ' + defect + ' fault', () => {
    const { sim } = make(); begin(sim); ticks(sim, 59); const samples = sim.currentBreath.holdCollector.samples;
    const index = defect === 'pressure' ? samples.length - 1 : 0;
    const sample = samples[index]; samples[index] = { ...sample,
        ...(defect === 'pressure' ? { paw_cmH2O: sample.paw_cmH2O + 0.11 }
            : defect === 'flow' ? { flow_Lps: 0.001 } : defect === 'nonfinite' ? { paw_cmH2O: NaN }
                : { sampleIndex: sample.sampleIndex + 1 }) };
    sim.releaseManualHold(); sim.tick(); assert.equal(sim.lastValidManualHold, null);
    const reason = { pressure:'PRESSURE_UNSTABLE',flow:'NONZERO_HOLD_FLOW',nonfinite:'NONFINITE_SOURCE',membership:'HOLD_BOUNDARY_MISMATCH' }[defect];
    assert.ok(sim.lastManualHoldAttempt.mechanics.reasons.includes(reason));
});
console.log('MANUAL_HOLD_ENGINE_TALLY ' + JSON.stringify({ groups:results.length, passed:results.filter(x=>x.passed).length, failed:results.filter(x=>!x.passed).length }));
if (results.some(x=>!x.passed)) process.exitCode = 1;
