/** Selective preservation against the pinned pre-PC-CMVa checkpoint.
 * The original 22 fixtures / 92,500 exercised ticks remain commissioned.
 * Passive paths compare exactly; accepted active boundary changes use independent
 * conformance checks rather than treating the broken old traces as a new golden.
 * Run: node tests/legacy-mode-preservation.test.mjs
 * Optional: LEGACY_PRESERVATION_OUTPUT=<JSON path>,
 * LEGACY_PRESERVATION_CURRENT_ROOT=<disposable mutation checkout>,
 * LEGACY_PRESERVATION_REFERENCE_ROOT=<exact checkpoint source copy>,
 * LEGACY_PRESERVATION_FORCE_GIT=1 (exercise the CI reference route).
 * CI must fetch the pinned ancestor (actions/checkout fetch-depth: 0).
 * No network, baseline updates, or reference regeneration from current source.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CURRENT_ROOT = path.resolve(process.env.LEGACY_PRESERVATION_CURRENT_ROOT || ROOT);
const CHECKPOINT = 'f7ebb4cc7318e86f6a1ecce44bd3fac1e645baec';
const PINS = Object.freeze({
    'js/lung-model.js': '43947774b49423c352eca4fbca3a6a632f65562a266134b22c45288a20a05115',
    'js/ventilator.js': '6fea437fc675162214b93dbf1959c39d7315ca3f304f33418baba1e19576a99f',
    'js/simulation.js': 'b8d5e6d71d374d68db84086a603b4c9ccf4504799df452bf826f3075337837c5',
    'alarms.js': 'be929ada2511667ad06efe0a13a238254aca9c8f1dafe4f1abf71610ce0c7316',
});
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const currentIdentities = () => Object.fromEntries([...Object.keys(PINS), 'js/adaptive-controller.js']
    .filter(name => fs.existsSync(path.join(CURRENT_ROOT, name))).map(name =>
    [name, sha256(fs.readFileSync(path.join(CURRENT_ROOT, name)))]));

function materializeReference() {
    const configured = process.env.LEGACY_PRESERVATION_REFERENCE_ROOT;
    const saved = path.resolve(configured || path.join(ROOT, 'scratch/shots-vsm-adapt-001-phase-b/reference'));
    const useSaved = process.env.LEGACY_PRESERVATION_FORCE_GIT !== '1' && (configured || fs.existsSync(saved));
    const bytes = {};
    for (const [name, expected] of Object.entries(PINS)) {
        try {
            bytes[name] = useSaved ? fs.readFileSync(path.join(saved, name)) : execFileSync(
                process.platform === 'win32' ? 'git.exe' : 'git',
                ['--no-optional-locks', 'show', `${CHECKPOINT}:${name}`],
                { cwd: ROOT, windowsHide: true, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) {
            throw new Error(`Pinned reference unavailable: ${CHECKPOINT}:${name}. ${useSaved ? 'Check the exact reference path.' : 'CI checkout needs fetch-depth: 0; no network fallback or current-HEAD substitution is permitted.'} ${error.message}`);
        }
        assert.equal(sha256(bytes[name]), expected, `Reference SHA-256 mismatch: ${name}`);
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vent-sim-legacy-reference-'));
    fs.mkdirSync(path.join(directory, 'js'));
    fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"module"}\n');
    for (const [name, data] of Object.entries(bytes)) fs.writeFileSync(path.join(directory, name), data);
    return { directory, source: useSaved ? saved : `git:${CHECKPOINT}`, hashes: PINS };
}

async function load(root) {
    const get = name => import(pathToFileURL(path.join(root, name)).href);
    const [{ LungModel }, { Ventilator }, { SimulationEngine }, alarms] = await Promise.all([
        get('js/lung-model.js'), get('js/ventilator.js'), get('js/simulation.js'), get('alarms.js'),
    ]);
    return { LungModel, Ventilator, SimulationEngine, alarms };
}

function make(api, fixture) {
    const lung = new api.LungModel({ resistance: 10, compliance: 0.05, ...fixture.lung });
    const vent = new api.Ventilator(lung, { mode: 'vc-cmv', respiratoryRate: 12, ieRatio: [1, 4],
        tidalVolume: 0.5, inspiratoryPressure: 15, peep: 5, ...fixture.settings });
    const sim = new api.SimulationEngine(vent);
    sim.patientRR = fixture.patientRR || 0;
    return { lung, vent, sim, alarms: api.alarms };
}

const copy = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(copy) : Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]))
    : value;
const owned = (object, keys) => Object.fromEntries(keys.map(key => [key, copy(object[key])]));

// These are the live values used by main.js getCurrentAlarmMetrics. No analytical
// fallback is needed for a live SimulationEngine; compare inputs as well as alarms.
function alarmMetrics(sim, delivery) {
    const current = sim.isCurrentDeliveredVentilation(delivery) ? delivery : null;
    return { nowSec: sim.globalTime, elapsedSec: sim.globalTime,
        lastBreathStartSec: sim.lastBreathStartSec, pipCmH2O: sim.breathSummary.pip,
        pawCmH2O: sim.currentPressure, measuredRR: sim.measuredRR,
        minuteVentilationLpm: current?.status === 'available' ? current.valueLpm : null,
        deliveredVentilation: current, simulationTick: Math.round(sim.globalTime / sim.dt),
        simulationStep_s: sim.dt, simulationGeneration: sim.simulationGeneration,
        modeGeneration: sim.modeGeneration, deliveryHistoryRevision: sim._veRevision };
}

function capture(pair, schema) {
    const { sim, vent, lung, alarms } = pair;
    if ('adaptiveState' in sim) {
        assert.equal(sim.adaptiveState, null, 'Legacy mode exposed adaptive feedback');
        assert.equal(sim._adaptive, null, 'Legacy mode retained an active controller');
        assert.equal(sim._adaptiveContext, null, 'Legacy mode retained a pressure context');
        assert.equal(vent.adaptivePressure_cmH2O, null, 'Legacy mode retained an adaptive pressure command');
    }
    const delivery = sim.deliveredVentilation;
    const metrics = alarmMetrics(sim, delivery);
    const active = alarms.evaluateAlarms(metrics);
    return { state: owned(sim, schema.sim), settings: owned(vent, schema.vent), lung: owned(lung, schema.lung),
        selectors: { hold: sim.holdMechanics, breath: sim.breathSummary, delivery,
            currentPmus: sim.currentPmus, phaseName: sim.phaseName, isPatientTriggering: sim.isPatientTriggering,
            visibleEvents: sim.getTriggerEvents(sim.globalTime - 30, sim.globalTime),
            pressureControlLevel: vent.pressureControlLevel, inspiratoryTime: vent.inspiratoryTime,
            effectiveHoldTime: vent.effectiveHoldTime, effectiveExpiratoryTime: vent.effectiveExpiratoryTime,
            pressureMode: vent.isPressureMode(), spontaneousMode: vent.isSpontaneousMode() },
        buffers: Object.fromEntries(Object.entries(sim.buffers).map(([key, b]) =>
            [key, { capacity: b.capacity, head: b.head, count: b.count, last: b.last }])),
        loops: Object.fromEntries(['loopCurrent', 'loopCompleted'].map(name => [name,
            Object.fromEntries(Object.entries(sim[name]).map(([key, a]) => [key, { length: a.length, last: a.at(-1) }]))])),
        alarmMetrics: metrics, alarms: active, alarmPriority: alarms.highestAlarmPriority(active) };
}

function firstDifference(expected, actual, at = '') {
    if (Object.is(expected, actual)) return null;
    if (!expected || !actual || typeof expected !== 'object' || typeof actual !== 'object') return { path: at, expected, actual };
    if (Array.isArray(expected) !== Array.isArray(actual)) return { path: `${at}.[container]`, expected: Array.isArray(expected) ? 'array' : 'object', actual: Array.isArray(actual) ? 'array' : 'object' };
    const left = Object.keys(expected), right = Object.keys(actual);
    if (left.length !== right.length || left.some(k => !Object.hasOwn(actual, k))) return { path: `${at}.[keys]`, expected: left, actual: right };
    for (const key of left) { const d = firstDifference(expected[key], actual[key], `${at}.${key}`); if (d) return d; }
    return null;
}
function exact(expected, actual, where) {
    const mismatch = firstDifference(expected, actual);
    if (mismatch) throw new Error(`${where}: ${JSON.stringify(mismatch, (_k, v) => typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)}`);
}
function frozenPaths(value, prefix = '', paths = []) {
    if (value && typeof value === 'object') {
        if (Object.isFrozen(value)) paths.push(prefix);
        for (const [key, v] of Object.entries(value)) frozenPaths(v, `${prefix}.${key}`, paths);
    }
    return paths;
}
// Only additive Phase B provenance is omitted from old-schema exact comparison.
// Do not recursively project onto reference keys: that would hide unrelated drift.
function legacyProjection(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(legacyProjection);
    const record = Object.hasOwn(value, 'triggerDetection') && Object.hasOwn(value, 'triggerDelivery');
    const event = value.type === 'patient' || value.type === 'failed';
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
        !(record && ['triggerDetection', 'triggerDelivery'].includes(key)) &&
        !(event && ['schemaVersion', 'detection', 'delivery', 'simulationGeneration', 'modeGeneration', 'neuralCycleId'].includes(key)))
        .map(([key, item]) => [key, key === 'signature' && typeof item === 'string'
            ? JSON.stringify(legacyProjection(JSON.parse(item))) : legacyProjection(item)]));
}
function compareFull(reference, current, where) {
    for (const key of Object.keys(reference.sim.buffers)) exact(reference.sim.buffers[key].toArray(), current.sim.buffers[key].toArray(), `${where}.buffer.${key}`);
    exact(reference.sim.loopCurrent, current.sim.loopCurrent, `${where}.loopCurrent`);
    exact(reference.sim.loopCompleted, current.sim.loopCompleted, `${where}.loopCompleted`);
    exact(reference.vent.summary(), current.vent.summary(), `${where}.analyticalSummary`);
    exact(frozenPaths(reference.sim.lastCompletedBreath), frozenPaths(current.sim.lastCompletedBreath)
        .filter(name => !name.includes('.triggerDetection') && !name.includes('.triggerDelivery')), `${where}.recordImmutability`);
}

const near = (actual, expected, tolerance, where) => assert.ok(Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance, `${where}: ${actual} != ${expected} +/- ${tolerance}`);
const passiveFixtures = new Set(['vc-square-passive', 'vc-ramp-passive', 'vc-valid-hold', 'vc-short-hold',
    'pc-passive', 'pc-valid-hold', 'pc-incomplete-expiration', 'vc-high-pressure-rate-ventilation']);

function conformanceObserver(pair, checkpointAlarms) {
    const { sim, vent } = pair;
    const compute = sim._computePhysics;
    let decision = null;
    sim._computePhysics = function (...args) {
        const pre = { volume: this.volumeAboveEq, phase: this.phase, phaseTime: this.phaseTime,
            pmus: this.currentPmus, time: this.globalTime, index: this._sampleCount,
            peep: vent.peep, R: this.lung.resistance, C: this.lung.compliance };
        compute.apply(this, args);
        const sample = this.physicsSample;
        const variable = vent.triggerType === 'pressure' ? 'pressure' : 'flow';
        const signal = variable === 'pressure' ? Math.max(0, sample.appliedPeep_cmH2O - sample.paw_cmH2O)
            : Math.max(0, sample.netFlow_Lps * 60);
        const threshold = variable === 'pressure' ? vent.pressureTriggerCmH2O : vent.flowTriggerLpm;
        decision = { pre, variable, signal, threshold, patientCount: this.patientBreathCount,
            expected: this.patientRR > 0 && vent.pMusMax > 0 && this.neuralInspActive &&
                !this.neuralCycleResolved && sample.phase === 'EXPIRATION' && sample.phaseTime_s > .10 && signal >= threshold };
    };
    let generation = null, lastRecord = null, lastEvent = null, rr = 0;
    let ledger = [], times = [];
    const peaks = new Map(), outcomes = new Set();
    let samples = 0, publications = 0, deliveries = 0;
    return {
        check(snapshot, physics, where) {
            if (generation !== sim.simulationGeneration) {
                generation = sim.simulationGeneration; lastRecord = null; lastEvent = null;
                ledger = []; times = []; rr = 0; peaks.clear(); outcomes.clear();
            }
            if (physics) {
                const s = sim.physicsSample;
                assert.ok(s && Object.isFrozen(s), `${where}: immutable coherent physics evidence missing`);
                exact(owned(s, ['phase', 'phaseTime_s', 'pmus_cmH2O', 'time_s', 'sampleIndex',
                    'appliedPeep_cmH2O', 'resistance_cmH2O_s_per_L', 'compliance_L_per_cmH2O', 'volumePre_L']),
                    { phase: decision.pre.phase, phaseTime_s: decision.pre.phaseTime, pmus_cmH2O: decision.pre.pmus,
                        time_s: decision.pre.time, sampleIndex: decision.pre.index, appliedPeep_cmH2O: decision.pre.peep,
                        resistance_cmH2O_s_per_L: decision.pre.R, compliance_L_per_cmH2O: decision.pre.C,
                        volumePre_L: decision.pre.volume }, `${where}.actual-pre-state`);
                near(s.volumePost_L, sim.volumeAboveEq, 1e-12, `${where}.actual-post-volume`);
                near(s.paw_cmH2O, sim.currentPressure, 1e-12, `${where}.actual-pressure`);
                near(s.netFlow_Lps, sim.currentFlow, 1e-12, `${where}.actual-flow`);
                const R = s.resistance_cmH2O_s_per_L, C = s.compliance_L_per_cmH2O;
                const d = s.pmus_cmH2O - s.volumePre_L / C;
                const pc = vent.isPressureMode();
                let q, paw;
                if (s.phase === 'EXPIRATION') {
                    q = d <= 0 ? d / R : d / (R + 2);
                    paw = d <= 0 ? s.appliedPeep_cmH2O : s.appliedPeep_cmH2O - 2 * q;
                } else if (s.phase === 'HOLD') {
                    q = 0; paw = s.appliedPeep_cmH2O + s.volumePre_L / C - s.pmus_cmH2O;
                } else if (pc) {
                    q = Math.max(0, (s.pressureCommand_cmH2O + d) / R);
                    paw = s.pressureCommand_cmH2O + d >= 0 ? s.appliedPeep_cmH2O + s.pressureCommand_cmH2O
                        : s.appliedPeep_cmH2O + s.volumePre_L / C - s.pmus_cmH2O;
                } else {
                    q = vent.flowPattern === 'ramp' ? 2 * vent.tidalVolume / vent.inspiratoryTime *
                        Math.max(0, 1 - s.phaseTime_s / vent.inspiratoryTime) : vent.tidalVolume / vent.inspiratoryTime;
                    paw = s.appliedPeep_cmH2O + s.volumePost_L / C + R * q - s.pmus_cmH2O;
                }
                near(s.netFlow_Lps, q, 1e-12, `${where}.flow`);
                near(s.paw_cmH2O, paw, 1e-9, `${where}.pressure`);
                const volume = s.phase === 'INSPIRATION' && !pc ? s.volumePost_L : s.volumePre_L;
                near(s.paw_cmH2O + s.pmus_cmH2O - s.appliedPeep_cmH2O - volume / C - R * s.netFlow_Lps,
                    0, 1e-9, `${where}.common-state-EOM`);
                near(s.volumePost_L - s.volumePre_L, s.netFlow_Lps * sim.dt, 1e-12, `${where}.volume-accounting`);
                assert.equal(s.volumeGuardApplied, false, `${where}: volume floor hid lost volume`);
                near(sim.buffers.pressure.last, s.paw_cmH2O, 1e-12, `${where}.pressure-buffer`);
                near(sim.buffers.flow.last, s.netFlow_Lps * 60, 1e-12, `${where}.flow-buffer`);
                assert.equal(sim.patientBreathCount - decision.patientCount, decision.expected ? 1 : 0,
                    `${where}: delivered outcome disagrees with eligible physical threshold`);
                if (s.phase === 'INSPIRATION') {
                    const key = `${generation}:${snapshot.preBreathId}`;
                    peaks.set(key, Math.max(peaks.get(key) ?? 0, s.paw_cmH2O));
                }
                samples++;
            }
            const record = sim.lastCompletedBreath;
            if (record && record !== lastRecord) {
                near(record.measuredVT_mL, (sim.volumeAboveEq - sim.volumeAtBreathStart) * 1000, 1e-9,
                    `${where}.canonical-inspired-VT`);
                near(record.measuredPIP_cmH2O, peaks.get(`${generation}:${record.breathId}`) ?? 0, 1e-9,
                    `${where}.patient-side-PIP`);
                assert.equal(sim.lastBreathPIP, record.measuredPIP_cmH2O, `${where}.PIP-latch`);
                assert.ok(Object.isFrozen(record), `${where}.canonical-record-immutable`);
                ledger.push({ tick: Math.round(record.completedAt_s / sim.dt), volumeL: record.measuredVT_mL / 1000 });
                times.push(record.completedAt_s * 1000); if (times.length > 10) times.shift();
                if (times.length < 2) rr = 0;
                else {
                    const raw = 60000 / ((times.at(-1) - times[0]) / (times.length - 1));
                    rr = rr > 0 ? rr * .7 + raw * .3 : raw;
                }
                lastRecord = record; publications++;
            }
            near(sim.measuredRR, rr, 1e-9, `${where}.completion-only-RR`);
            const now = Math.round(sim.globalTime / sim.dt);
            const recent = ledger.filter(item => item.tick > now - 3000 && item.tick <= now);
            const v = sim.deliveredVentilation;
            assert.equal(v.completedCount, recent.length, `${where}.VE-canonical-count`);
            near(v.sumVolumeL, recent.reduce((sum, item) => sum + item.volumeL, 0), 1e-12, `${where}.VE-canonical-sum`);
            if (v.status === 'available') near(v.valueLpm, v.sumVolumeL * 2, 1e-12, `${where}.VE-raw-value`);
            else assert.equal(v.valueLpm, null, `${where}.VE-unavailable-not-zero`);
            // The pinned alarm algorithm remains the oracle; corrected inputs are intentional.
            exact(checkpointAlarms.evaluateAlarms(alarmMetrics(sim, v)), snapshot.alarms, `${where}.alarm-input-coherence`);
            const event = sim.triggerEvents.at(-1);
            if (event && event !== lastEvent) {
                if (event.type === 'patient' || event.type === 'failed') {
                    const d = event.detection;
                    const key = `${event.simulationGeneration ?? d?.simulationGeneration}:${event.modeGeneration ?? d?.modeGeneration}:${event.neuralCycleId ?? d?.neuralCycleId}`;
                    assert.ok(!outcomes.has(key), `${where}: duplicate terminal neural outcome`); outcomes.add(key);
                    if (event.type === 'patient') {
                        assert.ok(d && Object.isFrozen(event) && Object.isFrozen(d) && Object.isFrozen(d.signal) && Object.isFrozen(d.threshold),
                            `${where}: immutable detection provenance missing`);
                        const expectedSignal = d.triggerVariable === 'pressure' ? Math.max(0, d.signal.appliedPeep_cmH2O - d.signal.paw_cmH2O)
                            : Math.max(0, d.signal.netFlow_Lps * 60);
                        near(d.signal.value, expectedSignal, 1e-12, `${where}.recorded-signal`);
                        assert.ok(d.signal.value >= d.threshold.value && d.phase === 'EXPIRATION' && d.phaseTime_s > .10,
                            `${where}: delivered patient event without eligible crossing`);
                        assert.equal(d.signal.location, 'airway-opening-patient-side');
                        assert.equal(d.threshold.unit, d.triggerVariable === 'pressure' ? 'cmH2O' : 'L/min');
                        near(event.time - d.time_s, sim.dt, 1e-9, `${where}.detection-before-delivery`);
                        assert.equal(d.sampleIndex, sim.physicsSample.sampleIndex, `${where}.detection-sample`);
                        assert.equal(event.delivery.appliedPeep_cmH2O, vent.peep, `${where}.delivery-PEEP`);
                        deliveries++;
                    }
                }
                lastEvent = event;
            }
        },
        receipt: () => ({ samples, publications, patientDeliveries: deliveries }),
    };
}

const edit = (tick, values) => ({ tick, name: `edit-${tick}`, apply({ lung, vent, sim }) {
    Object.assign(lung, values.lung); Object.assign(vent, values.vent);
    if (values.patientRR !== undefined) sim.patientRR = values.patientRR;
    // Existing effort controls do not notify legacy measurement generations.
    if (values.notify !== false) sim.notifyMeasurementSettingsChanged();
} });
const liveEdits = () => [
    edit(50, { lung: { resistance: 18, compliance: 0.035 } }),
    edit(90, { vent: { pMusMax: 8, neuralTi: 0.8 }, patientRR: 18, notify: false }),
    edit(400, { vent: { peep: 8, respiratoryRate: 20, ieRatio: [1, 2] } }),
    edit(750, { vent: { triggerType: 'pressure', pressureTriggerCmH2O: 1.5 } }),
    { tick: 1100, name: 'edit-revert', apply(p) { for (const peep of [12, 8]) { p.vent.peep = peep; p.sim.notifyMeasurementSettingsChanged(); } } },
    { tick: 1600, name: 'pause-edit-resume', apply(p) {
        p.sim.pause(); p.sim.advance(0.5); p.vent.pMusMax = 4; p.sim.patientRR = 24;
        p.sim.setSpeed(2); p.sim.setDisplaySeconds(20); p.sim.resume();
    } },
    edit(2000, { vent: { tidalVolume: 0.65, inspiratoryPressure: 20, psPressure: 14, cyclePercent: 40 } }),
];

const fixtures = [
    { name: 'vc-square-passive', required: ['machine', 'completed', 've-available'] },
    { name: 'vc-ramp-passive', settings: { flowPattern: 'ramp' }, required: ['completed'] },
    { name: 'vc-valid-hold', settings: { holdTime: 0.5 }, required: ['hold-valid'] },
    { name: 'vc-short-hold', settings: { holdTime: 0.4 }, required: ['hold-invalid'] },
    { name: 'pc-passive', settings: { mode: 'pc-cmv' }, required: ['completed'] },
    { name: 'pc-pressure-trigger', settings: { mode: 'pc-cmv', pMusMax: 8, triggerType: 'pressure' }, patientRR: 18, required: ['patient', 'mandatory-patient'] },
    { name: 'pc-valid-hold', settings: { mode: 'pc-cmv', holdTime: 0.5 }, required: ['hold-valid'] },
    { name: 'csv-flow-cycle', settings: { mode: 'PC-CSV', pMusMax: 8, cyclePercent: 25, holdTime: 0.75 }, patientRR: 18, required: ['flowCycle', 'spontaneous', 'hold-inapplicable'] },
    { name: 'csv-max-ti', lung: { resistance: 25 }, settings: { mode: 'PC-CSV', pMusMax: 8, respiratoryRate: 35, ieRatio: [1, 1], cyclePercent: 10 }, patientRR: 18, required: ['maxTiReached', 'mandatory-patient'] },
    { name: 'csv-threshold-failure', settings: { mode: 'PC-CSV', pMusMax: 0.5, triggerType: 'pressure', pressureTriggerCmH2O: 2 }, patientRR: 20, required: ['failed', 'APNEA', 'LOW_VE', 've-zero'] },
    { name: 'csv-delivery-ages-after-effort-stops', settings: { mode: 'PC-CSV', pMusMax: 8 }, patientRR: 18, ticks: 7000,
        events: [edit(3500, { vent: { pMusMax: 0 }, patientRR: 0, notify: false })], required: ['completed', 've-available', 've-zero', 'APNEA', 'LOW_VE'] },
    { name: 'pc-incomplete-expiration', lung: { resistance: 40, compliance: 0.1 }, settings: { mode: 'pc-cmv', respiratoryRate: 30, ieRatio: [1, 1] }, required: ['trapping'] },
    { name: 'vc-high-pressure-rate-ventilation', lung: { compliance: 0.01 }, settings: { tidalVolume: 0.8, respiratoryRate: 40, ieRatio: [1, 2] }, required: ['HIGH_PRESSURE', 'HIGH_RR', 'HIGH_VE'] },
    ...['vc-cmv', 'pc-cmv', 'PC-CSV'].map(mode => ({ name: `${mode}-live-edits`, settings: { mode, pMusMax: 4 },
        patientRR: 18, events: liveEdits(), required: ['completed', 'patient'] })),
];
for (const from of ['vc-cmv', 'pc-cmv', 'PC-CSV']) for (const to of ['vc-cmv', 'pc-cmv', 'PC-CSV']) {
    if (from === to) continue;
    fixtures.push({ name: `${from}-reset-to-${to}`, settings: { mode: from, pMusMax: 8, holdTime: 0.5 }, patientRR: 18, ticks: 5500,
        events: [{ tick: 2000, name: 'legacy-mode-reset', apply({ vent, sim }) {
            sim.pause();
            // Match the current public transition seam against the checkpoint's
            // established direct mode setting plus reset, as the legacy UI did.
            if (typeof sim.setMode === 'function') sim.setMode(to);
            else { vent.mode = to; sim.reset(); }
            assert.equal(sim.running, false); sim.resume();
        } }],
        required: ['reset', `completed-${from}`, `completed-${to}`, 've-available'] });
}

function observe(pair, snapshot, seen) {
    const s = pair.sim, record = s.lastCompletedBreath, v = snapshot.selectors.delivery;
    for (const event of s.triggerEvents) seen.add(event.type);
    if (s.simulationGeneration > 0) seen.add('reset');
    if (s.volumeAtBreathStart > 0.2) seen.add('trapping');
    if (snapshot.selectors.hold.status === 'inapplicable') seen.add('hold-inapplicable');
    if (v.status === 'available') { seen.add('ve-available'); if (v.valueLpm === 0) seen.add('ve-zero'); }
    for (const alarm of snapshot.alarms) seen.add(alarm.id);
    if (record) {
        seen.add('completed'); seen.add(`completed-${record.configuredMode}`); seen.add(record.terminationReason);
        seen.add(record.breathType);
        if (record.triggerAgent === 'patient' && record.breathType === 'mandatory') seen.add('mandatory-patient');
        if (record.holdMechanics?.status === 'valid') seen.add('hold-valid');
        if (record.holdMechanics?.status === 'invalid') seen.add('hold-invalid');
    }
}

function runFixture(fixture, before, after) {
    const reference = make(before, fixture), current = make(after, fixture);
    const ticks = fixture.ticks || 3500, seen = new Set(), currentSeen = new Set(), events = [];
    const exactPassive = passiveFixtures.has(fixture.name);
    const classification = exactPassive ? 'passive-exact' : 'active-contract-conformance';
    const observer = exactPassive ? null : conformanceObserver(current, before.alarms);
    const digests = [crypto.createHash('sha256'), crypto.createHash('sha256')];
    const schema = { sim: Object.keys(reference.sim).filter(k => !['vent', 'lung', 'buffers', 'loopCurrent', 'loopCompleted'].includes(k)),
        vent: Object.keys(reference.vent).filter(k => k !== 'lung'), lung: Object.keys(reference.lung) };
    let lastRecord = null, lastCount = reference.sim.breathCount;
    function compare(label, full = false, physics = false, preBreathId = null) {
        // Recompute the old schema in case a legacy property is created lazily.
        schema.sim = Object.keys(reference.sim).filter(k => !['vent', 'lung', 'buffers', 'loopCurrent', 'loopCompleted'].includes(k));
        const a = capture(reference, schema), b = capture(current, schema);
        if (exactPassive) exact(legacyProjection(a), legacyProjection(b), `${fixture.name}.${label}`);
        else {
            exact(a.settings, b.settings, `${fixture.name}.${label}.operator-settings`);
            exact(a.lung, b.lung, `${fixture.name}.${label}.configured-mechanics`);
            const oscillator = ['globalTime', 'sampleRate', 'dt', 'patientRR', 'neuralTimer',
                'neuralInspActive', 'triggerLockoutSeconds', 'running', 'speed', 'displaySeconds'];
            exact(owned(reference.sim, oscillator), owned(current.sim, oscillator), `${fixture.name}.${label}.unchanged-oscillator-transport`);
            observer.check({ ...b, preBreathId }, physics, `${fixture.name}.${label}`);
        }
        observe(reference, a, seen); observe(current, b, currentSeen);
        for (const [index, snapshot] of [a, b].entries()) digests[index].update(JSON.stringify({
            time: snapshot.state.globalTime, pressure: snapshot.state.currentPressure, flow: snapshot.state.currentFlow,
            volume: snapshot.state.volumeAboveEq, phase: snapshot.state.phase, breath: snapshot.state.breathCount,
            pipLatched: snapshot.state.lastBreathPIP, measuredRR: snapshot.state.measuredRR,
            ve: snapshot.selectors.delivery.valueLpm, alarms: snapshot.alarms.map(x => x.id),
        }) + '\n');
        if (full || reference.sim.lastCompletedBreath !== lastRecord || reference.sim.breathCount !== lastCount) {
            if (exactPassive) compareFull(reference, current, `${fixture.name}.${label}`);
            else {
                const summary = current.vent.summary();
                if (!current.vent.pMusActive) exact(reference.vent.summary(), summary, `${fixture.name}.${label}.passive-analytics`);
                else {
                    assert.equal(summary.predictionsAvailable, false, `${fixture.name}.${label}.active-analytics-availability`);
                    for (const key of ['pip_cmH2O', 'pplat_cmH2O', 'map_cmH2O', 'autoPeep_cmH2O',
                        'totalPeep_cmH2O', 'drivingPressure', 'resistivePressure']) {
                        assert.equal(summary.pressures[key], null, `${fixture.name}.${label}.active-${key}`);
                    }
                    assert.equal(summary.volumes.trappedVolume_mL, null, `${fixture.name}.${label}.active-trapped-prediction`);
                    if (current.vent.isPressureMode()) {
                        assert.equal(summary.volumes.tidalVolume_mL, null, `${fixture.name}.${label}.active-PC-VT-prediction`);
                        assert.equal(summary.volumes.minuteVentilation, null, `${fixture.name}.${label}.active-PC-VE-prediction`);
                    }
                }
            }
            lastRecord = reference.sim.lastCompletedBreath; lastCount = reference.sim.breathCount;
        }
    }
    compare('initial', true);
    for (let tick = 0; tick < ticks; tick++) {
        for (const event of fixture.events || []) if (event.tick === tick) {
            event.apply(reference); event.apply(current); events.push({ tick, name: event.name }); compare(`event-${tick}`, true);
        }
        const preBreathId = current.sim.breathCount;
        reference.sim.tick(); current.sim.tick(); compare(`tick-${tick + 1}`, false, true, preBreathId);
    }
    compare('final', true);
    for (const condition of fixture.required || []) assert(seen.has(condition), `${fixture.name}: required path was not exercised: ${condition}`);
    const [referenceSampleSha256, currentSampleSha256] = digests.map(x => x.digest('hex'));
    if (exactPassive) assert.equal(currentSampleSha256, referenceSampleSha256);
    return { fixture: fixture.name, passed: true, ticks, exercisedTicks: ticks,
        exactMatchedTicks: exactPassive ? ticks : 0, conformanceTicks: exactPassive ? 0 : ticks,
        classification, conformance: observer?.receipt() ?? null,
        events, required: fixture.required, observed: [...seen].filter(x => x !== null).sort(),
        currentObserved: [...currentSeen].filter(x => x !== null).sort(),
        referenceSampleSha256, currentSampleSha256, final: { mode: current.vent.mode, simulationTime: current.sim.globalTime,
            simulationGeneration: current.sim.simulationGeneration, breathCount: current.sim.breathCount } };
}

function clampOnlyIdentity(before, after) {
    const receipt = [];
    for (const mode of ['pc-cmv', 'PC-CSV']) for (const state of [
        { name: 'open', volume: .3, effort: 0 },
        { name: 'closed', volume: .9, effort: 1 },
        { name: 'reopen', volume: .9, effort: 6 },
    ]) {
        const fixture = { settings: { mode, inspiratoryPressure: 15, psPressure: 15 } };
        const reference = make(before, fixture), current = make(after, fixture);
        for (const pair of [reference, current]) {
            pair.sim.volumeAboveEq = state.volume;
            pair.sim._computeInspiration(10, .05, 5, state.effort, .01);
        }
        exact(owned(reference.sim, ['currentFlow', 'volumeAboveEq', 'peakInspFlow_Lpm', 'peakInspiratoryFlow']),
            owned(current.sim, ['currentFlow', 'volumeAboveEq', 'peakInspFlow_Lpm', 'peakInspiratoryFlow']), `${mode}.${state.name}.clamp-only-Q-V`);
        const drive = 15 + state.effort - state.volume / .05;
        near(current.sim.currentPressure, drive >= 0 ? 20 : 5 + state.volume / .05 - state.effort,
            1e-9, `${mode}.${state.name}.patient-side-Paw`);
        receipt.push({ mode, state: state.name, flowVolumeExact: true,
            referencePaw: reference.sim.currentPressure, currentPaw: current.sim.currentPressure });
    }
    return receipt;
}

let reference;
const results = [];
const report = { checkpoint: CHECKPOINT, referencePins: PINS, fixtures: results };
try {
    reference = materializeReference(); report.referenceSource = reference.source;
    report.currentSourceHashes = currentIdentities();
    const before = await load(reference.directory), after = await load(CURRENT_ROOT);
    assert.equal(fixtures.length, 22, 'Commissioned fixture inventory changed');
    assert.equal(fixtures.reduce((sum, fixture) => sum + (fixture.ticks || 3500), 0), 92500, 'Commissioned exercised tick inventory changed');
    assert.equal(passiveFixtures.size, 8, 'Selective exact fixture inventory changed');
    report.clampOnlyIdentity = clampOnlyIdentity(before, after);
    for (const fixture of fixtures) {
        try { results.push(runFixture(fixture, before, after)); console.log(`PASS legacy ${fixture.name} (${results.at(-1).ticks} exercised ticks; ${results.at(-1).classification})`); }
        catch (error) { results.push({ fixture: fixture.name, passed: false, error: error.message }); console.error(`FAIL legacy ${fixture.name}: ${error.message}`); }
    }
    exact(report.currentSourceHashes, currentIdentities(), 'Current source changed while the preservation run was executing');
} catch (error) { report.infrastructureError = error.message; console.error(error.message); }
finally {
    if (reference) {
        const resolved = fs.realpathSync(reference.directory), tempRoot = fs.realpathSync(os.tmpdir());
        assert.equal(path.dirname(resolved), tempRoot, 'Refusing cleanup outside owned temporary parent');
        assert(path.basename(resolved).startsWith('vent-sim-legacy-reference-'), 'Refusing cleanup of unrecognized temporary directory');
        fs.rmSync(resolved, { recursive: true });
    }
}
report.passed = results.filter(r => r.passed).length;
report.failed = results.filter(r => !r.passed).length + (report.infrastructureError ? 1 : 0);
report.ticks = results.reduce((sum, r) => sum + (r.ticks || 0), 0);
report.exercisedTicks = report.ticks;
report.exactMatchedTicks = results.reduce((sum, r) => sum + (r.exactMatchedTicks || 0), 0);
report.conformanceTicks = results.reduce((sum, r) => sum + (r.conformanceTicks || 0), 0);
report.classifications = { passiveExactFixtures: results.filter(r => r.classification === 'passive-exact').length,
    activeConformanceFixtures: results.filter(r => r.classification === 'active-contract-conformance').length };
if (!report.failed && report.ticks !== 92500) { report.failed++; report.infrastructureError = 'Commissioned fixture tick total changed'; }
if (!report.failed && (report.exactMatchedTicks !== 28000 || report.conformanceTicks !== 64500)) {
    report.failed++; report.infrastructureError = 'Selective exact/conformance tick inventory changed';
}
if (process.env.LEGACY_PRESERVATION_OUTPUT) {
    const destination = path.resolve(process.env.LEGACY_PRESERVATION_OUTPUT);
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n');
}
console.log(`LEGACY_PRESERVATION_TALLY ${JSON.stringify({ fixtures: results.length, passed: report.passed, failed: report.failed,
    ticks: report.ticks, exercisedTicks: report.exercisedTicks, exactMatchedTicks: report.exactMatchedTicks,
    conformanceTicks: report.conformanceTicks, ...report.classifications })}`);
if (report.failed) process.exitCode = 1;
