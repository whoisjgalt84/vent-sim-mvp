import assert from 'node:assert/strict';
const runtime = new URL(process.env.VSM_RESET_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator, SUPPORTED_MODES, MODE_PC_CMVA, MODE_PC_CSV } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const results = [];
function test(name, run) {
    try { run(); results.push({ name, passed: true }); console.log('PASS reset-engine: ' + name); }
    catch (error) { results.push({ name, passed: false }); console.error('FAIL reset-engine: ' + name + '\n' + error.stack); }
}
function make(mode, active, running, holdTime = 0) {
    const lung = new LungModel({ resistance: 35, compliance: 0.07 });
    const vent = new Ventilator(lung, { mode, respiratoryRate: 25, ieRatio: [1, 1],
        peep: 7, fio2: 0.55, tidalVolume: 0.65, inspiratoryPressure: 23, psPressure: 18,
        cyclePercent: 40, pMusMax: active ? 8 : 0, neuralTi: 0.8, holdTime,
        triggerType: mode === MODE_PC_CSV ? 'flow' : 'pressure', pressureTriggerCmH2O: 0.5, flowTriggerLpm: 3,
        adaptiveConfig: { initialPressure_cmH2O: 12, maximumPressure_cmH2O: 30 } });
    const sim = new SimulationEngine(vent);
    sim.patientRR = active ? 30 : 0;
    sim.setSpeed(4); sim.setDisplaySeconds(20); sim.running = running; sim.reset();
    return { lung, vent, sim };
}
function settings(x) {
    const { adaptivePressure_cmH2O, lung, ...vent } = x.vent;
    return JSON.parse(JSON.stringify({ vent, R: x.lung.resistance, C: x.lung.compliance,
        patientRR: x.sim.patientRR, speed: x.sim.speed, displaySeconds: x.sim.displaySeconds,
        running: x.sim.running, Rc: x.sim.inwardSupplyResistance_cmH2O_s_per_L }));
}
function cleared(x, generation, delivery) {
    const { sim, vent } = x, csv = vent.mode === MODE_PC_CSV;
    for (const key of ['globalTime', 'phaseTime', 'machineTimer', 'neuralTimer', 'volumeAboveEq',
        'volumeAtBreathStart', 'currentFlow', 'lastBreathPIP', 'measuredVT_mL', 'measuredRR',
        'patientBreathCount']) assert.equal(sim[key], 0, key);
    for (const key of ['lastCompletedBreath', 'scheduledBreathTrigger', '_pendingTriggerDetection',
        'lastCanceledTrigger', 'physicsSample']) assert.equal(sim[key], null, key);
    assert.equal(sim.simulationGeneration, generation + 1);
    assert.equal(sim.phaseName, csv ? 'EXPIRATION' : 'INSPIRATION');
    assert.equal(sim.breathCount, csv ? 0 : 1);
    assert.deepEqual(sim.triggerEvents.map(e => e.type), csv ? [] : ['machine']);
    assert.deepEqual(sim.breathTimestamps, []);
    for (const loop of [sim.loopCurrent, sim.loopCompleted])
        assert.deepEqual(loop, { pressure: [], volume: [], flow: [] });
    for (const key of ['volume', 'flow']) assert(sim.buffers[key].toArray().every(v => v === 0), key);
    assert(sim.buffers.pressure.toArray().every(v => v === vent.peep));
    assert(sim.buffers.time.toArray().every(v => v < 0));
    assert.equal(sim.deliveredVentilation.status, 'warming');
    assert.equal(sim.deliveredVentilation.valueLpm, null);
    assert.equal(sim.deliveredVentilation.completedCount, 0);
    assert.equal(sim.isCurrentDeliveredVentilation(delivery), false);
    assert.equal(sim.holdMechanics.pplat.value, null);
    if (vent.mode === MODE_PC_CMVA) {
        const a = sim.adaptiveState;
        assert.equal(a.applied_cmH2O, a.config.initialPressure_cmH2O);
        for (const key of ['latestDecision', 'lastFeedback', 'pending', 'pendingSettings']) assert.equal(a[key], null, key);
    }
}
for (const mode of SUPPORTED_MODES) for (const active of [false, true]) for (const running of [false, true]) {
    test(`${mode}/${active ? 'active' : 'passive'}/${running ? 'running' : 'paused'}`, () => {
        const x = make(mode, active, running), { sim } = x;
        for (let i = 0; i < 3400; i++) sim.tick();
        assert.equal(sim.deliveredVentilation.status, 'available');
        if (mode !== MODE_PC_CSV || active) {
            assert(sim.lastCompletedBreath, 'rich completion fixture');
            assert(sim.volumeAboveEq > 0, 'accumulated modeled volume fixture');
        }
        const selected = settings(x);
        for (let repetition = 0; repetition < 3; repetition++) {
            const generation = sim.simulationGeneration, old = sim.deliveredVentilation;
            sim.reset(); cleared(x, generation, old); assert.deepEqual(settings(x), selected);
            if (repetition < 2) for (let i = 0; i < 31; i++) sim.tick();
        }
        sim.advance(0.1); assert.equal(sim.globalTime > 0, running, 'transport preserved');
        if (!running) assert.equal(sim.globalTime, 0);
    });
}
for (const mode of SUPPORTED_MODES) for (const phase of ['INSPIRATION', 'EXPIRATION', 'HOLD']) {
    if (phase === 'HOLD' && [MODE_PC_CSV, MODE_PC_CMVA].includes(mode)) continue;
    test(`${mode}/reset-during-${phase}`, () => {
        const x = make(mode, true, false, phase === 'HOLD' ? 0.5 : 0), { sim } = x;
        let found = false;
        for (let i = 0; i < 6000; i++) { sim.tick(); if (sim.phaseName === phase && sim.phaseTime > 0.1) { found = true; break; } }
        assert(found, 'requested phase reached');
        if (phase === 'EXPIRATION') {
            // A queued detection can exist between detection and delivery. Seed
            // that obsolete internal queue without taking a physics tick.
            sim.scheduledBreathTrigger = 'patient';
            sim._pendingTriggerDetection = Object.freeze({ detectedAt_s: sim.globalTime });
            sim.lastCanceledTrigger = Object.freeze({ reason: 'test-prior-cancellation' });
        }
        const selected = settings(x), generation = sim.simulationGeneration, old = sim.deliveredVentilation;
        sim.reset(); cleared(x, generation, old); assert.deepEqual(settings(x), selected);
    });
}
test('adaptive atomic queues, selected maximum and obsolete correction', () => {
    const x = make(MODE_PC_CMVA, false, false), { sim, vent } = x;
    for (let i = 0; i < 150; i++) sim.tick();
    assert(sim.adaptiveState.lastFeedback, 'feedback fixture');
    sim.requestAdaptiveSettings({ targetVT_mL: 750, peep_cmH2O: 11 });
    const generation = sim.simulationGeneration, old = sim.deliveredVentilation;
    sim.configureAdaptive({ ...sim.adaptiveState.config, maximumPressure_cmH2O: 20 });
    cleared(x, generation, old);
    assert.equal(vent.tidalVolume, 0.75); assert.equal(vent.peep, 11);
    assert.equal(sim.adaptiveState.config.maximumPressure_cmH2O, 20);
    assert.equal(sim.adaptiveState.applied_cmH2O, 12);
    assert.equal(sim.running, false);
});
test('reset re-arms full VE observation window and new canonical identity', () => {
    const x = make('vc-cmv', false, false), { sim } = x;
    for (let i = 0; i < 3500; i++) sim.tick();
    const prior = sim.lastCompletedBreath;
    sim.reset();
    for (let i = 0; i < 2999; i++) sim.tick();
    assert.equal(sim.deliveredVentilation.status, 'warming');
    assert(sim.lastCompletedBreath.simulationGeneration > prior.simulationGeneration);
    sim.tick(); assert.equal(sim.deliveredVentilation.status, 'available');
});
const tally = { groups: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length };
console.log('DEMONSTRATION_RESET_ENGINE_TALLY ' + JSON.stringify(tally));
if (tally.groups !== 28 || tally.failed) process.exitCode = 1;
