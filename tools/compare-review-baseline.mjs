/** Exact physics/alarm/hold preservation against a supplied unchanged checkout. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const baseline = process.argv[2];
if (!baseline) throw new Error('Pass the absolute unchanged baseline checkout directory');
const roots = [pathToFileURL(path.join(baseline, 'js/')), new URL('../js/', import.meta.url)];
const apis = await Promise.all(roots.map(async root => ({
    ...(await import(new URL('lung-model.js', root))), ...(await import(new URL('ventilator.js', root))),
    ...(await import(new URL('simulation.js', root))),
})));
function make(api, mode, effort, holdTime) {
    const lung = new api.LungModel({ resistance: 5, compliance: .1 });
    const vent = new api.Ventilator(lung, { mode, respiratoryRate: 35, ieRatio: [1, 2],
        tidalVolume: .2, peep: 0, pMusMax: effort, neuralTi: 2, holdTime,
        triggerType: mode === 'PC-CSV' ? 'flow' : 'pressure', flowTriggerLpm: 2, pressureTriggerCmH2O: 5 });
    const sim = new api.SimulationEngine(vent); sim.patientRR = effort ? 10 : 0; sim.reset(); return sim;
}
const receipts = [];
for (const mode of apis[0].SUPPORTED_MODES) for (const effort of [0, 12]) for (const hold of [0, .2, .6]) {
    const [before, after] = apis.map(api => make(api, mode, effort, hold)); let completions = 0;
    // R-02's explicit input boundary records setup notifications that the old
    // raw assignments did not. Permit only this fixed per-run revision offset;
    // all later source revisions, identities, raw signals and times must match.
    const inputRevisionOffset = after.inputRevision - before.inputRevision;
    const referenceRevision = value => {
        if (!value || typeof value !== 'object') return value;
        if (Array.isArray(value)) return value.map(referenceRevision);
        return Object.fromEntries(Object.entries(value).map(([key,item]) =>
            [key,key === 'inputRevision' ? item + inputRevisionOffset : referenceRevision(item)]));
    };
    let last = null;
    for (let tick = 0; tick < 6000; tick++) {
        before.tick(); after.tick();
        assert.deepEqual(after.physicsSample, referenceRevision(before.physicsSample), `${mode}/${effort}/${hold} physics ${tick}`);
        for (const key of ['volumeAboveEq', 'currentPressure', 'currentFlow', 'measuredPIP', 'measuredVT_mL', 'measuredRR']) {
            assert.equal(after[key], before[key], key);
        }
        assert.equal(after.breathSummary.pip, before.breathSummary.pip, 'unchanged live alarm input');
        assert.equal(after.deliveredVentilation.valueLpm, before.deliveredVentilation.valueLpm);
        if (before.lastCompletedBreath !== last) {
            const a = referenceRevision(before.lastCompletedBreath), b = after.lastCompletedBreath;
            if (a) {
                // Only the approved signed PIP and its nested source provenance differ.
                a.measuredPIP_cmH2O = b.measuredPIP_cmH2O;
                if (a.holdMechanics.sources) a.holdMechanics.sources.measuredPIP_cmH2O = b.holdMechanics.sources.measuredPIP_cmH2O;
                assert.deepEqual(b, a, 'canonical identity, hold estimators/status/reasons and other measurements');
                completions++;
            }
            last = before.lastCompletedBreath;
        }
    }
    receipts.push({ mode, effort, hold, exactPhysicsTicks: 6000, completions, inputRevisionOffset });
}
console.log(JSON.stringify({ fixtures: receipts.length, exactPhysicsTicks: receipts.length * 6000,
    liveAlarmInputsExact: true, holdResultsAndReasonsExact: true, receipts }, null, 2));
