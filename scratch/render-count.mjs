import { LungModel } from '../js/lung-model.js';
import { Ventilator } from '../js/ventilator.js';
import { SimulationEngine } from '../js/simulation.js';
const lung = LungModel.fromPreset('normal');            // R10 / C0.060
const vent = new Ventilator(lung, {
  mode:'vc-cmv', flowPattern:'square', holdTime:0, tidalVolume:0.500,
  respiratoryRate:14, ieRatio:[1,1], peep:5, fio2:0.40,
  triggerType:'flow', flowTriggerLpm:2.0, pressureTriggerCmH2O:1.0,
  pMusMax:2.5, neuralTi:1.0,
});
const sim = new SimulationEngine(vent, { sampleRate:100, displaySeconds:10 });
sim.patientRR = 25;
for (let i=0;i<6000;i++) sim.tick();
// visible window = the ring buffer span (last displaySeconds)
const t = sim.buffers.time.toArray();
const t0 = t[0], t1 = t[t.length-1];
const evs = sim.getTriggerEvents(t0, t1);
const failed = evs.filter(e=>e.type==='failed');
const failedExp = failed.filter(e=>e.phase==='EXPIRATION');   // -> amber flow highlights
const failedInsp = failed.filter(e=>e.phase!=='EXPIRATION');  // VU during inspiration: no flow deflection
const patient = evs.filter(e=>e.type==='patient');            // blue successful-trigger markers
const machine = evs.filter(e=>e.type==='machine');
console.log(`Visible window: ${(t1-t0).toFixed(1)}s  (t ${t0.toFixed(1)}..${t1.toFixed(1)})`);
console.log(`failed events in window:        ${failed.length}  (gateFailed: VU ${failed.filter(e=>e.gateFailed==='ventilator_unavailable').length} / threshold ${failed.filter(e=>e.gateFailed==='threshold').length})`);
console.log(`-> AMBER flow highlights drawn (phase==EXPIRATION): ${failedExp.length}`);
console.log(`-> NOT highlighted on flow (insp-phase VU):          ${failedInsp.length}`);
console.log(`blue successful patient-trigger markers:            ${patient.length}`);
console.log(`machine markers:                                    ${machine.length}`);
console.log(`(full 60s totals: delivered ${sim.patientBreathCount}, machine ${sim.machineBreathCount}, measuredRR ${sim.measuredRR.toFixed(1)})`);
