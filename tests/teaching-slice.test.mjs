/** Metadata and unchanged cycling contracts for the approved teaching slice. */
import assert from 'node:assert/strict';
const runtime = new URL(process.env.VSM_SLICE_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const results=[];
function test(name, fn) { try { fn();results.push(true);console.log('PASS slice '+name); }
    catch(e) { results.push(false);console.error('FAIL slice '+name+'\n'+e.stack); } }
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const ticks=(sim,n)=>{for(let i=0;i<n;i++)sim.tick();};
function make(mode='vc-cmv', extra={}) {
    const vent=new Ventilator(new LungModel({resistance:10,compliance:.05}),
        {mode,respiratoryRate:12,ieRatio:[1,4],pMusMax:0,...extra});
    return {vent,sim:new SimulationEngine(vent)};
}
function hold(sim,duration=.6) {
    assert.equal(sim.pressManualHold(),true);
    for(let i=0;i<1500&&!sim.manualHoldState.active;i++)sim.tick();
    assert.equal(sim.manualHoldState.active,true);
    ticks(sim,Math.round(duration/sim.dt)-1); sim.releaseManualHold();sim.tick();
    return sim.lastManualHoldAttempt;
}
test('hold age starts on the actual completion tick, not breath start',()=>{
    const {sim}=make(); assert.equal(sim.manualHoldAge_s,null);
    const saved=hold(sim);assert.equal(saved.mechanics.pplat.status,'valid');
    near(sim.manualHoldAge_s,.01); ticks(sim,137);near(sim.manualHoldAge_s,1.38);
    assert.equal(sim.lastValidManualHold,saved);
});
test('paused wall time cannot age; speed and catch-up cap count executed ticks only',()=>{
    const {sim}=make();hold(sim);const start=sim.manualHoldAge_s;
    sim.pause();sim.advance(100);near(sim.manualHoldAge_s,start);
    sim.resume();sim.setSpeed(4);sim.advance(100);near(sim.manualHoldAge_s,start+3);
    sim.setSpeed(.5);sim.advance(.02);near(sim.manualHoldAge_s,start+3.01);
});
test('mode changes retain age/source across all destinations without reset-time fabrication',()=>{
    const {sim}=make();const saved=hold(sim);ticks(sim,50);let age=sim.manualHoldAge_s;
    for(const mode of ['pc-cmv','PC-CSV','pc-cmva','vc-cmv']) {
        sim.setMode(mode);near(sim.manualHoldAge_s,age);assert.equal(sim.lastValidManualHold,saved);
        assert.notEqual(saved.simulationGeneration,sim.simulationGeneration);
        ticks(sim,23);age+=.23;near(sim.manualHoldAge_s,age);
    }
});
test('flow-pattern fresh runs retain age; main Reset clears saved hold and age',()=>{
    const {sim,vent}=make();const saved=hold(sim);ticks(sim,31);const age=sim.manualHoldAge_s;
    vent.flowPattern='ramp';sim.reset({preserveManualHistory:true});
    near(sim.manualHoldAge_s,age);assert.equal(sim.lastValidManualHold,saved);
    ticks(sim,200);near(sim.manualHoldAge_s,age+2);sim.reset();
    assert.equal(sim.manualHoldAge_s,null);assert.equal(sim.lastValidManualHold,null);
});
test('invalid later hold preserves original measurement and original clock',()=>{
    const {sim}=make();const saved=hold(sim);const tick=saved.completedAtPhysicsTick;
    const attempt=hold(sim,.2);assert.notEqual(attempt.mechanics.pplat.status,'valid');
    assert.equal(sim.lastValidManualHold,saved);
    assert.equal(saved.completedAtPhysicsTick,tick);assert.ok(sim.manualHoldAge_s>.6);
    near(sim.manualHoldAge_s,(sim._elapsedPhysicsTicks-tick)*sim.dt);
});
function csv(extra={}) {
    const fixture=make('PC-CSV',{pMusMax:8,...extra});
    fixture.sim.configureEffortTiming({patientRR:12,neuralTi:1},true);
    return fixture;
}
test('PC-CSV retains configured Ti backstop and flow-cycle precedence',()=>{
    for(const cyclePercent of [10,60]) {
        const {sim,vent}=csv({respiratoryRate:35,ieRatio:[1,4],cyclePercent});
        let done=null;
        for(let i=0;i<1000&&!done;i++){sim.tick();done=sim.lastCompletedBreath;}
        assert.ok(done);const duration=done.completedAt_s-done.startedAt_s;
        assert.ok(duration<=Math.max(vent.inspiratoryTime,sim.dt*2)+.02);
        assert.equal(done.terminationReason,'maxTiReached');
    }
    // Both conditions true on the same transition: released flow-cycle precedence stays intact.
    const {sim,vent}=csv();
    for(let i=0;i<1000&&sim.phaseName!=='INSPIRATION';i++)sim.tick();
    assert.equal(sim.phaseName,'INSPIRATION');
    sim.phaseTime=vent.inspiratoryTime;sim.peakInspiratoryFlow=.5;sim.currentFlow=.01;
    sim._checkTransitions();assert.equal(sim.lastCompletedBreath.terminationReason,'flowCycle');
});
test('PC-CSV flow cycling can terminate before max Ti; passive CSV invents no breaths',()=>{
    const {sim,vent}=csv({respiratoryRate:6,ieRatio:[1,1],cyclePercent:60});
    for(let i=0;i<1000&&!sim.lastCompletedBreath;i++)sim.tick();
    const done=sim.lastCompletedBreath;assert.ok(done);assert.equal(done.terminationReason,'flowCycle');
    assert.ok(done.completedAt_s-done.startedAt_s<vent.inspiratoryTime);
    const passive=make('PC-CSV').sim;ticks(passive,6000);
    assert.equal(passive.lastCompletedBreath,null);assert.equal(passive.breathCount,0);
});
test('metadata clock has no effect on samples, breath records, or detector inputs',()=>{
    for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']) {
        const a=make(mode,{pMusMax:8}),b=make(mode,{pMusMax:8});
        for(const f of [a,b])f.sim.configureEffortTiming({patientRR:12,neuralTi:1},true);
        b.sim._elapsedPhysicsTicks=900000;
        for(let i=0;i<2000;i++) {
            a.sim.tick();b.sim.tick();
            assert.deepEqual(a.sim.physicsSample,b.sim.physicsSample);
            assert.deepEqual(a.sim.lastCompletedBreath,b.sim.lastCompletedBreath);
            assert.deepEqual(a.sim.breathSummary,b.sim.breathSummary);
        }
        assert.deepEqual(a.sim.triggerEvents,b.sim.triggerEvents);
    }
});
const tally={groups:results.length,passed:results.filter(Boolean).length,failed:results.filter(x=>!x).length};
console.log('TEACHING_SLICE_ENGINE_TALLY '+JSON.stringify(tally));if(tally.failed||tally.groups!==8)process.exitCode=1;
