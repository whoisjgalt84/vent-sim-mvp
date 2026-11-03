/** Owner-approved R-02 nonoverlap, queued-pair and interruption contract. */
import assert from 'node:assert/strict';
const runtime = new URL(process.env.VSM_TIMING_RUNTIME_URL ?? '../js/', import.meta.url);
const { LungModel } = await import(new URL('lung-model.js', runtime));
const { Ventilator, SUPPORTED_MODES } = await import(new URL('ventilator.js', runtime));
const { SimulationEngine } = await import(new URL('simulation.js', runtime));
const results = [];
function test(name, fn) { try { fn(); results.push(true); console.log('PASS R02 ' + name); }
    catch(e) { results.push(false); console.error('FAIL R02 ' + name + '\n' + e.stack); } }
const near = (a,b,tol=1e-9) => assert.ok(Math.abs(a-b)<=tol, `${a} != ${b}`);
function make(mode='PC-CSV', pair={patientRR:35,neuralTi:1}, effort=4) {
    const lung = new LungModel({resistance:10,compliance:.05});
    const vent = new Ventilator(lung,{mode,respiratoryRate:6,ieRatio:[1,4],pMusMax:effort,
        neuralTi:1,triggerType:'pressure',pressureTriggerCmH2O:5});
    const sim = new SimulationEngine(vent); sim.configureEffortTiming(pair,true);
    return {sim,vent};
}
function ticks(sim,n) {for(let i=0;i<n;i++)sim.tick();}
function oracle(sim,n) {
    const owed=new Set(), outcome=new Map(); let lastPmus=0,maxStep=0;
    for(let i=0;i<n;i++) {
        sim.tick(); const s=sim.physicsSample;
        if(sim.neuralInspActive && sim.vent.pMusMax>0 && s.neuralCycleId>0 &&
            (s.phase!=='EXPIRATION'||s.phaseTime_s>.10)) owed.add(s.neuralCycleId);
        maxStep=Math.max(maxStep,Math.abs(s.pmus_cmH2O-lastPmus));lastPmus=s.pmus_cmH2O;
    }
    for(const event of sim.triggerEvents) if(['patient','failed'].includes(event.type)) {
        const id=event.neuralCycleId??event.detection.neuralCycleId;
        outcome.set(id,(outcome.get(id)??0)+1);
    }
    for(const record of sim.effortInterruptions) if(record.terminal) {
        outcome.set(record.neuralCycleId,(outcome.get(record.neuralCycleId)??0)+1);
    }
    for(const id of owed) if(id<sim.neuralCycleId) assert.equal(outcome.get(id),1,`eligible completed cycle ${id}`);
    for(const [id,count] of outcome) assert.equal(count,1,`no duplicate cycle ${id}`);
    return {owed,outcome,maxStep};
}
for(const mode of SUPPORTED_MODES) test('exact 6000-tick overlap rejection and Ti1 control '+mode,()=>{
    const {sim}=make(mode); const reference=make(mode).sim;
    const before=sim.effortTiming;
    assert.throws(()=>sim.requestEffortTiming({patientRR:35,neuralTi:2}),RangeError);
    assert.deepEqual(sim.effortTiming,before);
    const r=oracle(sim,6000);ticks(reference,6000);
    assert.equal(sim.effortTiming.applied.neuralTi,1);
    assert.deepEqual(sim.buffers.pressure.toArray(),reference.buffers.pressure.toArray());
    assert.deepEqual(sim.triggerEvents,reference.triggerEvents);
    assert.equal([...r.owed].filter(id=>id<sim.neuralCycleId).length,34);
    assert.equal(r.outcome.size,34);
    assert.ok(r.maxStep<=4*Math.PI*sim.dt+1e-8);
});
for(const mode of SUPPORTED_MODES) test('equal/near-cycle ordering and waveform bound '+mode,()=>{
    const cycle=60/35;
    for(const offset of [-.01,-.001,-1e-7,0]) {
        const {sim}=make(mode,{patientRR:35,neuralTi:cycle+offset});
        const r=oracle(sim,6000);
        assert.equal(r.outcome.size,34);
        assert.ok(r.maxStep<=4*Math.PI/(cycle+offset)*sim.dt+1e-8);
    }
    const {sim}=make(mode);
    for(const offset of [1e-7,.001,.01]) assert.throws(()=>sim.requestEffortTiming({patientRR:35,neuralTi:cycle+offset}),RangeError);
    const exact=make(mode,{patientRR:30,neuralTi:2}).sim;
    exact.neuralTimer=1.99;exact.neuralCycleId=1;exact.neuralInspActive=true;
    exact.neuralEligibleSeen=true;exact.neuralCycleResolved=false;
    exact._advanceNeural();
    assert.equal(exact.triggerEvents.filter(e=>e.type==='failed'&&e.neuralCycleId===1).length,1);
    assert.equal(exact.neuralCycleId,2);assert.equal(exact.neuralTimer,0);assert.equal(exact.currentPmus,0);
});
test('invalid proposals reject atomically at all engine seams',()=>{
    const {sim,vent}=make(); const before=sim.effortTiming;
    for(const request of [null,[],{}, {unknown:1}, {patientRR:0},{patientRR:-1},{patientRR:5.9},{patientRR:35.1},
        {patientRR:42},{patientRR:NaN},{patientRR:Infinity},{neuralTi:0},{neuralTi:.3999},{neuralTi:2.0001},
        {neuralTi:NaN},{neuralTi:Infinity},{neuralTi:null},{patientRR:12,neuralTi:undefined}]) {
        assert.throws(()=>sim.requestEffortTiming(request)); assert.deepEqual(sim.effortTiming,before);
    }
    assert.throws(()=>{vent.neuralTi=2;},RangeError);assert.equal(vent.neuralTi,1);
    assert.throws(()=>{sim.patientRR=42;},RangeError);assert.equal(sim.patientRR,35);
});
test('valid pair waits for the old full cycle with uninterrupted starting half-sine',()=>{
    const {sim,vent}=make('PC-CSV',{patientRR:12,neuralTi:1}); ticks(sim,525);
    const reference=make('PC-CSV',{patientRR:12,neuralTi:1}).sim;ticks(reference,525);
    sim.requestEffortTiming({patientRR:30,neuralTi:2});
    assert.deepEqual(sim.effortTiming.pending,{patientRR:30,neuralTi:2});
    const id=sim.neuralCycleId;
    while(sim.neuralCycleId===id) {
        const oldTime=sim.neuralTimer;sim.tick(); reference.tick();
        if(sim.neuralCycleId===id) {
            assert.equal(sim.patientRR,12);assert.equal(vent.neuralTi,1);
            near(sim.currentPmus,reference.currentPmus);near(sim.currentPressure,reference.currentPressure);
        } else {assert.ok(oldTime<5+1e-9); assert.ok(sim.neuralTimer<sim.dt+1e-9);}
    }
    assert.equal(sim.patientRR,30);assert.equal(vent.neuralTi,2);assert.equal(sim.effortTiming.pending,null);
    assert.equal(sim.triggerEvents.filter(e=>e.neuralCycleId===id).length,1);
    const y=make('PC-CSV',{patientRR:12,neuralTi:1},8);
    y.vent.triggerType='flow';y.vent.flowTriggerLpm=2;
    const evaluate=y.sim._evaluatePatientTrigger;let detection=null;
    y.sim._evaluatePatientTrigger=function(){
        evaluate.call(this);
        if(!detection&&this.scheduledBreathTrigger==='patient'){
            detection=this._pendingTriggerDetection;this.setEffortEnabled(false);
        }
    };
    for(let i=0;i<700&&y.sim.patientBreathCount===0;i++)y.sim.tick();
    assert.ok(detection);assert.equal(y.sim.patientBreathCount,1);
    assert.equal(y.sim.triggerEvents.find(e=>e.type==='patient').detection,detection);
    assert.equal(y.sim.effortInterruptions.at(-1).terminal,false);
    assert.equal(y.sim.lastCanceledTrigger,null);
    assert.equal(y.sim.triggerEvents.filter(e=>e.type==='failed').length,0);
    // An edit just after a new cycle starts belongs to its next boundary.
    sim.requestEffortTiming({patientRR:12,neuralTi:.5});
    assert.equal(sim.patientRR,30);assert.equal(vent.neuralTi,2);
    sim.tick();near(sim.currentPmus,4*Math.sin(Math.PI*sim.neuralTimer/2));
});
test('single field edits use last valid selected pair; reject retains queue; revert cancels',()=>{
    const {sim}=make('PC-CSV',{patientRR:12,neuralTi:1});ticks(sim,525);
    sim.requestEffortTiming({patientRR:30,neuralTi:2});const pending=sim.effortTiming.pending;
    assert.throws(()=>sim.requestEffortTiming({patientRR:35}),RangeError);
    assert.equal(sim.effortTiming.pending,pending);
    sim.requestEffortTiming({neuralTi:1});assert.deepEqual(sim.effortTiming.pending,{patientRR:30,neuralTi:1});
    sim.requestEffortTiming({patientRR:12});assert.equal(sim.effortTiming.pending,null);
});
test('reset and mode change resolve selections atomically and retain Off/transport',()=>{
    for(const mode of SUPPORTED_MODES) for(const enabled of [false,true]) {
        const {sim,vent}=make();ticks(sim,210);sim.requestEffortTiming({patientRR:30,neuralTi:2});
        sim.setEffortEnabled(enabled);sim.pause();sim.setMode(mode);
        assert.deepEqual(sim.effortTiming.applied,{patientRR:30,neuralTi:2});
        assert.equal(sim.effortTiming.pending,null);assert.equal(sim.patientRR,enabled?30:0);
        assert.equal(vent.neuralTi,2);assert.equal(sim.neuralTimer,0);assert.equal(sim.neuralCycleId,0);
        assert.equal(sim.running,false);assert.deepEqual(sim.effortInterruptions,[]);
    }
});
test('Off interrupts unresolved eligible effort; frozen clock and terminal guard survive On',()=>{
    for(const mode of SUPPORTED_MODES) {
        const {sim}=make(mode,{patientRR:12,neuralTi:1});ticks(sim,525);
        assert.equal(sim.neuralEligibleSeen,true);assert.equal(sim.neuralCycleResolved,false);
        const clock=sim.neuralTimer,id=sim.neuralCycleId,pmus=sim.currentPmus;
        sim.requestEffortTiming({patientRR:30,neuralTi:2});
        sim.setEffortEnabled(false);const record=sim.effortInterruptions.at(-1);
        assert.equal(record.disposition,'interrupted');assert.equal(record.terminal,true);assert.ok(Object.isFrozen(record));
        assert.equal(record.neuralCycleId,id);assert.equal(sim.currentPmus,0);
        ticks(sim,50);assert.equal(sim.neuralTimer,clock);assert.equal(sim.neuralInspActive,true);
        sim.setEffortEnabled(true);near(sim.currentPmus,pmus);assert.equal(sim.neuralCycleResolved,true);
        ticks(sim,500);
        assert.equal(sim.triggerEvents.filter(e=>(e.neuralCycleId??e.detection?.neuralCycleId)===id).length,0);
        assert.equal(sim.effortInterruptions.filter(e=>e.neuralCycleId===id&&e.terminal).length,1);
        assert.ok(sim.neuralCycleId>id);
        assert.deepEqual(sim.effortTiming.applied,{patientRR:30,neuralTi:2});
    }
});
test('already resolved effort keeps immutable outcome and receives only mechanical interruption',()=>{
    const {sim}=make();ticks(sim,175);sim._setPhase('INSPIRATION');sim._computePhysics();sim._evaluatePatientTrigger();
    const old=sim.triggerEvents.at(-1),id=sim.neuralCycleId;
    assert.equal(old.type,'failed');assert.equal(sim.neuralCycleResolved,true);
    sim.setEffortEnabled(false);assert.equal(sim.effortInterruptions.at(-1).terminal,false);
    assert.equal(sim.triggerEvents.at(-1),old);sim.setEffortEnabled(true);ticks(sim,70);
    assert.equal(sim.triggerEvents.filter(e=>e.neuralCycleId===id).length,1);
});
test('zero amplitude produces no invented interruption',()=>{
    const {sim}=make('PC-CSV',{patientRR:12,neuralTi:1},0);ticks(sim,525);
    sim.setEffortEnabled(false);assert.deepEqual(sim.effortInterruptions,[]);assert.deepEqual(sim.triggerEvents,[]);
});
test('relevant valid queued edit immediately disarms manual hold without suppressing effort',()=>{
    const {sim}=make('vc-cmv',{patientRR:12,neuralTi:1});ticks(sim,525);
    assert.equal(sim.pressManualHold(),true);assert.equal(sim.manualHoldState.armed,true);
    const pmus=sim.currentPmus;
    sim.requestEffortTiming({patientRR:30,neuralTi:2});
    assert.equal(sim.manualHoldState.armed,false);near(sim.currentPmus,pmus);
});
test('invalid atomic setup leaves run, pair and history intact',()=>{
    const {sim}=make();ticks(sim,200);const time=sim.globalTime,pair=sim.effortTiming,events=sim.triggerEvents;
    assert.throws(()=>sim.configureEffortTiming({patientRR:35,neuralTi:2}),RangeError);
    assert.equal(sim.globalTime,time);assert.deepEqual(sim.effortTiming,pair);assert.equal(sim.triggerEvents,events);
});
const tally={groups:results.length,passed:results.filter(Boolean).length,failed:results.filter(x=>!x).length};
console.log('EFFORT_TIMING_TALLY '+JSON.stringify(tally));
if(tally.groups!==17||tally.failed)process.exitCode=1;
