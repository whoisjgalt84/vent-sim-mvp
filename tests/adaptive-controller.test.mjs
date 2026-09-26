import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Mutation runs can load an isolated controller; normal runs use production bytes.
const moduleUrl = process.env.VSM_ADAPTIVE_CONTROLLER_MODULE_URL
    ?? new URL('../js/adaptive-controller.js', import.meta.url).href;
const { AdaptiveController, DEFAULT_ADAPTIVE_CONFIG } = await import(moduleUrl);
const EXPECTED_GROUPS = 22;
let passed = 0;
let failed = 0;
function test(label, run) {
    try { run(); passed++; console.log(`PASS adaptive-controller: ${label}`); }
    catch (error) { failed++; console.error(`FAIL adaptive-controller: ${label}\n${error.stack}`); }
}
function near(actual, expected, tolerance = 1e-12) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} +/- ${tolerance}`);
}
function controller(config = {}) {
    const c = new AdaptiveController(config);
    c.reset({ simulationGeneration: 7, modeGeneration: 0, targetVT_mL: 500 });
    c.beginBreath({ targetVT_mL: 500 });
    return c;
}
function record(c, edits = {}) {
    const s = c.snapshot;
    const id = s.lastConsumedBreathId + 1;
    return {
        mode: 'pc-cmva', simulationGeneration: 7, modeGeneration: 0,
        settingsGeneration: 0, breathId: id, epoch: s.epoch,
        startedAt_s: id * 5, completedAt_s: id * 5 + 1,
        boundarySampleIndex: id * 500 + 100,
        valid: true, reasons: [], vt_mL: 340,
        applied_cmH2O: s.applied_cmH2O, commandVersion: s.commandVersion,
        targetVT_mL: s.targetVT_mL, appliedPeep_cmH2O: 5, ...edits,
    };
}
function consume(c, edits = {}) {
    const r = record(c, edits);
    return c.consume(r, r.completedAt_s);
}

test('approved defaults and validated setup-only configuration', () => {
    assert.deepEqual(DEFAULT_ADAPTIVE_CONFIG, {
        minimumPressure_cmH2O: 5, maximumPressure_cmH2O: 25,
        initialPressure_cmH2O: 10, gain_cmH2O_per_mL: 0.01, maxStep_cmH2O: 2, deadband_mL: 10,
    });
    assert.equal(controller({ maximumPressure_cmH2O: 20 }).snapshot.config.maximumPressure_cmH2O, 20);
    for (const bad of [null, [], { typo: 3 }, { gain_cmH2O_per_mL: 0 },
        { maxStep_cmH2O: -1 }, { deadband_mL: -1 }, { minimumPressure_cmH2O: -1 },
        { maximumPressure_cmH2O: 5 }, { initialPressure_cmH2O: 30 },
        { minimumPressure_cmH2O: 11 }, { maximumPressure_cmH2O: NaN },
        { gain_cmH2O_per_mL: Infinity }, { maxStep_cmH2O: '2' }]) {
        assert.throws(() => new AdaptiveController(bad));
    }
});
test('explicit initialization and no unavailable-to-zero conversion', () => {
    const c = new AdaptiveController();
    assert.equal(c.snapshot.initialized, false);
    assert.equal(c.snapshot.applied_cmH2O, null);
    assert.equal(c.consume(null, 0).reason, 'NOT_INITIALIZED');
    assert.throws(() => c.beginBreath({ targetVT_mL: 500 }));
    c.reset({ simulationGeneration: 7, modeGeneration: 0, targetVT_mL: 500 });
    assert.equal(c.snapshot.applied_cmH2O, 10);
    assert.equal(c.snapshot.lastFeedback, null);
    assert.equal(c.snapshot.pending, null);
    assert.equal(c.consume(null, 0).reason, 'INVALID_RECORD');
    assert.equal(c.snapshot.applied_cmH2O, 10);
});
test('independent error-law examples and symmetric capped step', () => {
    for (const [vt, expected] of [[340, 11.6], [660, 8.4], [200, 12], [800, 8], [0, 12]]) {
        const c = controller(); const d = consume(c, { vt_mL: vt });
        assert.equal(d.eligible, true); near(d.nextPressure_cmH2O, expected);
        assert.equal(c.snapshot.applied_cmH2O, 10);
    }
});
test('inclusive deadband and unrounded fractional edge', () => {
    for (const vt of [490, 500, 510, 490.0001, 509.9999]) {
        const d = consume(controller(), { vt_mL: vt });
        assert.equal(d.reason, 'DEADBAND'); assert.equal(d.nextPressure_cmH2O, 10);
    }
    near(consume(controller(), { vt_mL: 489.6 }).nextPressure_cmH2O, 10.104);
    near(consume(controller(), { vt_mL: 510.4 }).nextPressure_cmH2O, 9.896);
});
test('decision uses source-applied pressure after boundary, not initial pressure', () => {
    const c = controller(); consume(c); c.beginBreath({ targetVT_mL: 500 });
    const d = consume(c); near(d.pressureBefore_cmH2O, 11.6); near(d.nextPressure_cmH2O, 13.2);
    assert.equal(d.source.commandVersion, 1);
});
test('pending pressure only applies at beginBreath and only once', () => {
    const c = controller(); const d = consume(c);
    assert.equal(c.snapshot.applied_cmH2O, 10); near(c.snapshot.pending.pressure_cmH2O, 11.6);
    const started = c.beginBreath({ targetVT_mL: 500 });
    near(started.applied_cmH2O, 11.6); assert.equal(started.commandVersion, 1);
    assert.equal(started.pending, null); assert.deepEqual(started.commandSourceIdentity, d.source);
    const again = c.beginBreath({ targetVT_mL: 500 });
    assert.equal(again.commandVersion, 1); near(again.applied_cmH2O, 11.6);
});
test('upper saturation does not accumulate behind bound and releases immediately', () => {
    const c = controller({ maximumPressure_cmH2O: 20 });
    for (let n = 0; n < 20; n++) {
        const d = consume(c, { vt_mL: 0 });
        assert.ok(d.nextPressure_cmH2O <= 20); c.beginBreath({ targetVT_mL: 500 });
    }
    assert.equal(c.snapshot.applied_cmH2O, 20);
    const release = consume(c, { vt_mL: 660 });
    near(release.nextPressure_cmH2O, 18.4); assert.equal(release.bound, null);
});
test('lower saturation keeps excessive measured VT and releases immediately', () => {
    const c = controller();
    for (let n = 0; n < 12; n++) { consume(c, { vt_mL: 900 }); c.beginBreath({ targetVT_mL: 500 }); }
    assert.equal(c.snapshot.applied_cmH2O, 5);
    const still = consume(c, { vt_mL: 900 });
    assert.equal(still.bound, 'lower'); assert.equal(still.vt_mL, 900); assert.equal(still.error_mL, -400);
    c.beginBreath({ targetVT_mL: 500 }); near(consume(c, { vt_mL: 340 }).nextPressure_cmH2O, 6.6);
});
test('PEEP is trace context and never silently changes above-PEEP bounds', () => {
    const outcomes = [0, 5, 24].map(peep => consume(controller(), { appliedPeep_cmH2O: peep }));
    for (const d of outcomes) near(d.nextPressure_cmH2O, 11.6);
    assert.equal(outcomes[2].source.appliedPeep_cmH2O, 24);
    assert.equal(consume(controller(), { appliedPeep_cmH2O: NaN }).reason, 'INVALID_PEEP_CONTEXT');
});
test('duplicate feedback cannot issue a second decision or replace pending pressure', () => {
    const c = controller(); const r = record(c); c.consume(r, r.completedAt_s);
    const pending = c.snapshot.pending;
    assert.equal(c.consume(r, r.completedAt_s).reason, 'DUPLICATE_OR_OUT_OF_ORDER');
    assert.equal(c.snapshot.pending, pending); assert.equal(c.snapshot.commandVersion, 0);
    const conflictingReplay = { ...r, startedAt_s: 10, completedAt_s: 11, vt_mL: 900 };
    assert.equal(c.consume(conflictingReplay, 11).reason, 'DUPLICATE_OR_OUT_OF_ORDER');
    assert.equal(c.snapshot.pending, pending);
    c.beginBreath({ targetVT_mL: 500 });
    assert.equal(c.consume(r, r.completedAt_s).eligible, false);
    assert.equal(c.snapshot.pending, null);
});
test('wrong mode and generation never poison current source identity', () => {
    const c = controller();
    for (const edits of [{ mode: 'pc-cmv' }, { mode: 'PC-CMVA' },
        { simulationGeneration: 6 }, { modeGeneration: 1 }]) {
        assert.equal(consume(c, edits).eligible, false); assert.equal(c.snapshot.lastConsumedBreathId, 0);
    }
    assert.equal(consume(c).eligible, true);
});
test('publication timing and identity are required', () => {
    for (const edits of [{ breathId: 0 }, { breathId: 1.5 }, { settingsGeneration: -1 },
        { epoch: -1 }, { boundarySampleIndex: NaN }, { startedAt_s: NaN },
        { startedAt_s: -1 }, { startedAt_s: 6 }, { startedAt_s: 7 }, { completedAt_s: Infinity }]) {
        assert.equal(consume(controller(), edits).eligible, false);
    }
    const c = controller(); const r = record(c);
    assert.equal(c.consume(r, r.completedAt_s + 0.01).reason, 'STALE_OR_FUTURE_PUBLICATION');
    assert.equal(c.consume({ ...r, breathId: 2 }, r.completedAt_s - 0.01).reason, 'STALE_OR_FUTURE_PUBLICATION');
    assert.equal(c.snapshot.pending, null);
});
test('out-of-order time and breath IDs are rejected', () => {
    const c = controller(); consume(c); c.beginBreath({ targetVT_mL: 500 });
    assert.equal(consume(c, { startedAt_s: 4, completedAt_s: 5 }).reason, 'DUPLICATE_OR_OUT_OF_ORDER');
    assert.equal(c.consume(record(c, { breathId: 1 }), 16).reason, 'DUPLICATE_OR_OUT_OF_ORDER');
    assert.equal(c.snapshot.pending, null);
});
test('invalid/partial feedback is consumed and cannot be repaired by replay', () => {
    for (const edits of [{ valid: false }, { reasons: ['HOLD_EXCLUDED'] }, { reasons: null },
        { vt_mL: NaN }, { vt_mL: Infinity }, { vt_mL: -1 }, { vt_mL: undefined }]) {
        const c = controller(); const r = record(c, edits);
        assert.equal(c.consume(r, r.completedAt_s).eligible, false);
        assert.equal(c.snapshot.pending, null); assert.equal(c.snapshot.lastFeedback, null);
        const repaired = record(c, { breathId: r.breathId });
        assert.equal(c.consume(repaired, repaired.completedAt_s).reason, 'DUPLICATE_OR_OUT_OF_ORDER');
    }
});
test('applied command, version and source target cannot be substituted', () => {
    for (const edits of [{ applied_cmH2O: 11 }, { commandVersion: 1 }, { targetVT_mL: 600 }]) {
        assert.equal(consume(controller(), edits).eligible, false);
    }
    const c = controller(); consume(c); c.beginBreath({ targetVT_mL: 500 });
    assert.equal(consume(c, { commandVersion: 0, applied_cmH2O: 10 }).reason, 'COMMAND_MISMATCH');
});
test('each invalidation cancels pending and mixed epoch, including edit then revert', () => {
    const c = controller(); const r = record(c); c.consume(r, r.completedAt_s);
    c.invalidate('EFFORT_EDIT'); c.invalidate('EFFORT_REVERT');
    assert.equal(c.snapshot.epoch, 2); assert.equal(c.snapshot.pending, null);
    assert.equal(c.snapshot.applied_cmH2O, 10); assert.equal(c.snapshot.latestDecision, null);
    assert.equal(c.snapshot.feedbackCurrent, false); assert.equal(c.snapshot.lastFeedback.vt_mL, 340);
    assert.equal(consume(c, { epoch: 0 }).reason, 'STALE_EPOCH');
    assert.equal(consume(c).eligible, true);
});
test('beginBreath target selection uses same epoch and cancels superseded correction', () => {
    const c = controller(); consume(c); c.invalidate('TARGET_REQUEST');
    c.beginBreath({ targetVT_mL: 600 });
    assert.equal(c.snapshot.epoch, 1); assert.equal(c.snapshot.applied_cmH2O, 10);
    assert.equal(c.snapshot.targetVT_mL, 600); assert.equal(c.snapshot.pending, null);
    assert.equal(c.snapshot.lastFeedback.targetVT_mL, 500); assert.equal(c.snapshot.feedbackCurrent, false);
    const d = consume(c, { vt_mL: 500 }); near(d.nextPressure_cmH2O, 11);
    assert.equal(d.source.targetVT_mL, 600);
    const fallback = controller(); consume(fallback); fallback.beginBreath({ targetVT_mL: 600 });
    assert.equal(fallback.snapshot.applied_cmH2O, 10); assert.equal(fallback.snapshot.pending, null);
});
test('reset clears history, bound assessment and source while retaining passed configuration', () => {
    const c = controller(); consume(c); c.beginBreath({ targetVT_mL: 500 }); c.invalidate();
    c.reset({ simulationGeneration: 8, modeGeneration: 0, targetVT_mL: 650 });
    const s = c.snapshot;
    assert.equal(s.applied_cmH2O, 10); assert.equal(s.targetVT_mL, 650); assert.equal(s.epoch, 0);
    assert.equal(s.commandVersion, 0); assert.equal(s.commandSourceIdentity, null);
    assert.equal(s.pending, null); assert.equal(s.latestDecision, null); assert.equal(s.lastFeedback, null);
    assert.equal(s.lastConsumedBreathId, 0); assert.equal(s.lastCompletionAt_s, null);
    assert.equal(s.feedbackCurrent, false); assert.equal(consume(c).reason, 'GENERATION_MISMATCH');
    assert.equal(consume(c, { simulationGeneration: 8 }).eligible, true);
});
test('invalid reset/boundary inputs cannot partially mutate live state', () => {
    const c = controller(); consume(c); const before = c.snapshot;
    for (const target of [0, -1, NaN, Infinity, '500', undefined]) {
        assert.throws(() => c.beginBreath({ targetVT_mL: target })); assert.deepEqual(c.snapshot, before);
        assert.throws(() => c.reset({ simulationGeneration: 8, modeGeneration: 0, targetVT_mL: target }));
        assert.deepEqual(c.snapshot, before);
    }
    assert.throws(() => c.reset({ simulationGeneration: -1, modeGeneration: 0, targetVT_mL: 500 }));
    assert.deepEqual(c.snapshot, before);
});
test('snapshots, feedback and pending commands are immutable detached context', () => {
    const c = controller(); const r = record(c); const d = c.consume(r, r.completedAt_s); const s = c.snapshot;
    for (const obj of [s, s.config, s.pending, s.pending.source, s.lastFeedback, d, d.source]) assert.ok(Object.isFrozen(obj));
    assert.throws(() => { s.pending.pressure_cmH2O = 99; });
    assert.throws(() => { d.source.targetVT_mL = 900; });
    r.targetVT_mL = 900; r.vt_mL = 999;
    assert.equal(c.snapshot.lastFeedback.targetVT_mL, 500); assert.equal(c.snapshot.lastFeedback.vt_mL, 340);
});
test('no clock or undeclared physiology/model access', () => {
    const c = controller(); const raw = record(c);
    const allowed = new Set(Object.keys(raw));
    const guarded = new Proxy(raw, {
        get(target, key) { assert.ok(allowed.has(key), `Undeclared controller input: ${String(key)}`); return target[key]; },
        ownKeys() { throw new Error('Controller must not enumerate hidden input state.'); },
    });
    const d = c.consume(guarded, raw.completedAt_s); assert.equal(d.eligible, true);
    const before = c.snapshot; for (let n = 0; n < 50; n++) assert.deepEqual(c.snapshot, before);
    const source = moduleUrl.startsWith('data:text/javascript;base64,')
        ? Buffer.from(moduleUrl.split(',')[1], 'base64').toString('utf8') : readFileSync(new URL(moduleUrl), 'utf8');
    assert.doesNotMatch(source, /^\s*import\s/m);
    assert.doesNotMatch(source, /Date\.(?:now|parse)|performance\.now|setInterval\(|setTimeout\(/);
});
test('trace provenance retains exact source identity, raw VT and decision values', () => {
    const c = controller(); const r = record(c, { vt_mL: 340.123456789, settingsGeneration: 4 });
    const d = c.consume(r, r.completedAt_s);
    assert.equal(d.vt_mL, r.vt_mL); assert.equal(d.source.breathId, r.breathId);
    assert.equal(d.source.completedAt_s, r.completedAt_s); assert.equal(d.source.boundarySampleIndex, r.boundarySampleIndex);
    assert.equal(d.source.settingsGeneration, 4); assert.equal(d.source.epoch, r.epoch);
    near(d.nextPressure_cmH2O, 11.59876543211); assert.equal(d.pressureBefore_cmH2O, 10);
});

if (passed + failed !== EXPECTED_GROUPS) {
    console.error(`Adaptive controller discovery mismatch: expected ${EXPECTED_GROUPS}, found ${passed + failed}.`);
    failed++;
}
console.log(`ADAPTIVE_CONTROLLER_TALLY ${passed} passed, ${failed} failed`);
if (failed !== 0 || passed !== EXPECTED_GROUPS) process.exitCode = 1;
