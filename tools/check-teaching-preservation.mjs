/** Exact same-input comparison with a separately materialized v1.0.0 runtime. No fixture rewrites. */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
if(!process.argv[2])throw new Error('Pass the untouched reference checkout path');
const reference=pathToFileURL(resolve(process.argv[2])+'/js/');
const candidate=new URL('../js/',import.meta.url);
async function runtime(base) {
    const [{LungModel},{Ventilator},{SimulationEngine}]=await Promise.all([
        import(new URL('lung-model.js',base)),import(new URL('ventilator.js',base)),import(new URL('simulation.js',base))]);
    return options=>{const vent=new Ventilator(new LungModel({resistance:options.resistance,compliance:options.compliance}),options);
        const sim=new SimulationEngine(vent);sim.configureEffortTiming({patientRR:12,neuralTi:1},options.enabled);
        return {sim,vent};};
}
const before=await runtime(reference),after=await runtime(candidate);
let fixtures=0,ticks=0;
for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva'])for(const effort of ['off','zero','positive'])for(const mechanics of ['normal','obstructive']) {
    const options={mode,resistance:mechanics==='normal'?10:35,compliance:mechanics==='normal'?.05:.08,
        respiratoryRate:14,ieRatio:[1,2],pMusMax:effort==='positive'?8:0,enabled:effort!=='off',
        triggerType:'flow',flowTriggerLpm:2,cyclePercent:25,holdTime:0};
    const a=before(options),b=after(options);
    for(let i=0;i<3000;i++) {
        a.sim.tick();b.sim.tick();ticks++;
        assert.deepEqual(b.sim.physicsSample,a.sim.physicsSample);
        assert.deepEqual(b.sim.lastCompletedBreath,a.sim.lastCompletedBreath);
        assert.deepEqual(b.sim.breathSummary,a.sim.breathSummary);
        assert.deepEqual(b.sim.adaptiveState,a.sim.adaptiveState);
    }
    assert.deepEqual(b.sim.deliveredVentilation,a.sim.deliveredVentilation);
    assert.deepEqual(b.vent.summary(),a.vent.summary());
    assert.deepEqual(b.sim.triggerEvents,a.sim.triggerEvents);
    for(const key of ['time','pressure','flow','volume'])assert.deepEqual(b.sim.buffers[key].toArray(),a.sim.buffers[key].toArray());
    assert.deepEqual(b.sim.loopCompleted,a.sim.loopCompleted);assert.deepEqual(b.sim.loopCurrent,a.sim.loopCurrent);
    fixtures++;console.log(`PASS exact ${mode} ${effort} ${mechanics}`);
}
console.log('TEACHING_PRESERVATION_TALLY '+JSON.stringify({fixtures,ticks,passed:fixtures,failed:0}));
