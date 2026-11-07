/** Solved-sample phase history is display metadata, never a physics input. */
import assert from 'node:assert/strict';
import {LungModel} from '../js/lung-model.js';
import {Ventilator} from '../js/ventilator.js';
import {readFile} from 'node:fs/promises';
const runtime=new URL('../js/simulation.js',import.meta.url);
let source=await readFile(runtime,'utf8');
const mutation=process.env.VSM_EXPIRATION_MUTATION;
if(mutation==='transition')source=source.replace('physicsPhase === Phase.EXPIRATION ? 1 : 0','this.phase === Phase.EXPIRATION ? 1 : 0');
if(mutation==='prefill')source=source.replace('this.buffers.expiration.push(NaN)','this.buffers.expiration.push(1)');
if(mutation==='push')source=source.replace('this.buffers.expiration.push(physicsPhase === Phase.EXPIRATION ? 1 : 0);','');
source=source.replace("'./adaptive-controller.js?v=32'",JSON.stringify(new URL('../js/adaptive-controller.js?v=32',import.meta.url).href));
const {SimulationEngine}=await import(mutation?'data:text/javascript;base64,'+Buffer.from(source).toString('base64'):runtime.href);
const modes=['vc-cmv','pc-cmv','PC-CSV','pc-cmva'];
let passed=0;function test(name,fn){fn();passed++;console.log('PASS expiration display '+name);}
function make(mode='vc-cmv',pMusMax=0,extra={}){const vent=new Ventilator(new LungModel({resistance:10,compliance:.05}),{mode,pMusMax,...extra});const sim=new SimulationEngine(vent);sim.configureEffortTiming({patientRR:12,neuralTi:1},true);return sim;}
function tick(sim){sim.tick();assert.equal(sim.buffers.expiration.last,sim.physicsSample.phase==='EXPIRATION'?1:0);assert.equal(sim.buffers.time.last,sim.physicsSample.time_s);assert.equal(sim.buffers.flow.last,sim.physicsSample.netFlow_Lps*60);}
test('prefilled history is unknown in every mode',()=>{for(const mode of modes){const sim=make(mode);assert.equal(sim.buffers.expiration.length,sim.buffers.time.length);assert.ok(sim.buffers.expiration.toArray().every(Number.isNaN));}});
test('exact aligned history survives ring overwrite and display-window changes',()=>{for(const mode of modes){const sim=make(mode,2),expected=[];for(let i=0;i<6500;i++){tick(sim);expected.push(sim.physicsSample.phase==='EXPIRATION'?1:0);if(i%500===0)sim.setDisplaySeconds(i%1000?5:30);}assert.deepEqual(sim.buffers.expiration.toArray(),expected.slice(-sim.buffers.time.capacity));for(const key of ['time','flow','pressure','volume']){assert.equal(sim.buffers.expiration.head,sim.buffers[key].head);assert.equal(sim.buffers.expiration.count,sim.buffers[key].count);}}});
test('transition ticks keep solved phase including both sides of recurring/manual holds',()=>{
 const transitions=new Set();const sim=make('vc-cmv',0,{holdTime:.6});
 for(let i=0;i<2000;i++){tick(sim);if(sim.physicsSample.phase!==sim.phase)transitions.add(sim.physicsSample.phase+'>'+sim.phase);}
 for(const key of ['INSPIRATION>HOLD','HOLD>EXPIRATION','EXPIRATION>INSPIRATION'])assert.ok(transitions.has(key),key);
 const manual=make();assert.equal(manual.pressManualHold(),true);for(let i=0;i<1000&&!manual.manualHoldState.active;i++)tick(manual);assert.ok(manual.manualHoldState.active);for(let i=0;i<60;i++)tick(manual);manual.releaseManualHold();tick(manual);assert.equal(manual.physicsSample.phase,'HOLD');assert.equal(manual.phase,'EXPIRATION');assert.equal(manual.buffers.expiration.last,0);tick(manual);assert.equal(manual.buffers.expiration.last,1);
});
test('positive failed-trigger flow remains expiration at default flow and pressure thresholds',()=>{for(const [triggerType,pMusMax] of [['flow',.5],['pressure',2]]){const sim=make('PC-CSV',pMusMax,{triggerType});let positive=0;for(let i=0;i<3000;i++){tick(sim);if(sim.physicsSample.netFlow_Lps>0){positive++;assert.equal(sim.buffers.expiration.last,1);}}assert.ok(positive>300);assert.equal(sim.patientBreathCount,0);assert.equal(sim.triggerEvents.filter(e=>e.type==='failed').length,5);}});
test('reset and every mode transition clear old phase history before fresh samples',()=>{const sim=make();for(const mode of modes){for(let i=0;i<100;i++)tick(sim);sim.setMode(mode);assert.ok(sim.buffers.expiration.toArray().every(Number.isNaN));tick(sim);sim.reset({preserveManualHistory:true});assert.ok(sim.buffers.expiration.toArray().every(Number.isNaN));tick(sim);sim.reset();assert.ok(sim.buffers.expiration.toArray().every(Number.isNaN));}});
test('phase-history corruption cannot influence physics, canonical records, triggers or old buffers',()=>{for(const mode of modes)for(const effort of [0,2]){const a=make(mode,effort),b=make(mode,effort);for(let i=0;i<4000;i++){b.buffers.expiration.data.fill(i%2?NaN:99);tick(a);tick(b);assert.deepEqual(a.physicsSample,b.physicsSample);assert.deepEqual(a.lastCompletedBreath,b.lastCompletedBreath);assert.deepEqual(a.triggerEvents,b.triggerEvents);assert.deepEqual(a.deliveredVentilation,b.deliveredVentilation);}for(const key of ['time','flow','pressure','volume'])assert.deepEqual(a.buffers[key].toArray(),b.buffers[key].toArray());}});
assert.equal(passed,6);console.log('EXPIRATION_DISPLAY_TALLY 6 passed, 0 failed');
