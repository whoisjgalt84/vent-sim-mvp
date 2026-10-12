/** Fault-check in disposable runtimes; never mutate repository source/evidence. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..',import.meta.url));
const output = process.env.VSM_HOLD_FAULT_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(),'vent-sim-manual-faults-'));
fs.mkdirSync(output,{recursive:true});
const source=fs.readFileSync(path.join(root,'js/simulation.js'),'utf8');
const replace=(before,after)=>text=>{assert.ok(text.includes(before),'fault target absent: '+before);return text.replace(before,after);};
const faults=[
    ['fabricated-initial-attempt',replace('this.lastManualHoldAttempt = null;', "this.lastManualHoldAttempt = { completion: 'released' };")],
    ['expiration-release-keeps-arming',replace('if (this._manualHold.armed) {', "if (this._manualHold.armed && this.phase !== 'EXPIRATION') {")],
    ['disable-arming',replace('pressed: true, armed: true, active: false','pressed: true, armed: false, active: false')],
    ['ignore-release',replace('this._manualHold.releasePending = true;','this._manualHold.releasePending = false;')],
    ['rapid-repress-race',replace('if (this._manualHold.active && this._manualHold.releasePending)','if (false)')],
    ['three-second-cap',replace('Math.floor(2 / this.dt + 1e-9)','Math.floor(3 / this.dt + 1e-9)')],
    ['no-expiration-reserve',replace('entryCycleTime - 0.2','entryCycleTime - 0')],
    ['restart-takeover-samples',replace('hold.manualOwned = true;','hold.manualOwned = true; hold.samples = [];')],
    ['recurring-overwrites-manual',replace('if (this.currentBreath?.holdCollector?.manualOwned)','if (this.currentBreath?.holdCollector)')],
    ['invalid-overwrites-valid',replace("if (!canceled && holdMechanics.pplat.status === 'valid')",'if (true)')],
    ['cancellation-publishes-success',text=>replace("if (!canceled && holdMechanics.pplat.status === 'valid')","if (holdMechanics.pplat.status === 'valid')")(replace("if (hold.interrupted) pplatReasons.push('HOLD_INTERRUPTED');","// injected missing interruption check")(text))],
    ['unsupported-mode-enabled',replace('return !this.vent.isSpontaneousMode() && !this.vent.isAdaptiveMode();','return true;')],
    ['reset-retains-history',replace('const history = preserveManualHistory ? this.lastValidManualHold : null;','const history = this.lastValidManualHold;')],
    ['accept-short-duration',replace('minDuration_s: 0.5','minDuration_s: 0.1')],
    ['accept-fewer-samples',replace('minSamples: 50','minSamples: 1')],
    ['accept-nonzero-flow',replace('samples.some(s => s.flow_Lps !== 0)','false')],
    ['accept-effort',replace('maxAbsPmus_cmH2O: 1e-9','maxAbsPmus_cmH2O: 100')],
    ['accept-unstable-pressure',replace('maxPressureRange_cmH2O: 0.1','maxPressureRange_cmH2O: 100')],
    ['wrong-compliance-equation',replace('complianceValid ? measuredVT_mL / drivingPressure','complianceValid ? measuredVT_mL * drivingPressure')],
    ['settings-never-cancel',text=>text.replaceAll("this.cancelManualHold('settings-changed');",'void 0;')],
];
const receipts=[];
for(const [name,mutate] of [['healthy',x=>x],...faults]) {
    const dir=path.join(output,name); fs.mkdirSync(path.join(dir,'js'),{recursive:true});
    fs.writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
    for(const file of ['lung-model.js','ventilator.js','adaptive-controller.js']) fs.copyFileSync(path.join(root,'js',file),path.join(dir,'js',file));
    fs.writeFileSync(path.join(dir,'js/simulation.js'),mutate(source));
    const run=spawnSync(process.execPath,[path.join(root,'tests/manual-hold.test.mjs')],{
        env:{...process.env,VSM_HOLD_RUNTIME_URL:pathToFileURL(path.join(dir,'js')+path.sep).href},encoding:'utf8',windowsHide:true});
    fs.writeFileSync(path.join(output,name+'.txt'),run.stdout+run.stderr);
    const match=run.stdout.match(/^MANUAL_HOLD_ENGINE_TALLY (.+)$/m); assert.ok(match,name+' missing tally');
    const tally=JSON.parse(match[1]); assert.equal(tally.groups,43);
    const detected=name==='healthy'?run.status===0&&tally.failed===0:run.status!==0&&tally.failed>0;
    const failedGroups=[...(run.stderr??'').matchAll(/^FAIL manual-hold: (.+)$/gm)].map(x=>x[1]);
    receipts.push({name,exit:run.status,tally,detected,failedGroups});
    console.log((detected?'PASS':'FAIL')+' fault-check '+name+' ('+tally.failed+' failing groups)');
}
const detectedGroups=[...new Set(receipts.flatMap(receipt=>receipt.failedGroups))].sort();
fs.writeFileSync(path.join(output,'receipt.json'),JSON.stringify({scope:'20 targeted mutations plus healthy control; group-level detection, not individual assertion coverage',detectedGroupCount:detectedGroups.length,detectedGroups,receipts},null,2));
assert.ok(receipts.every(x=>x.detected));
assert.equal(detectedGroups.length,43,'Every manual engine group must detect a targeted fault');
console.log('MANUAL_HOLD_FAULT_TALLY '+receipts.length+' detected/control passed, 0 failed');
