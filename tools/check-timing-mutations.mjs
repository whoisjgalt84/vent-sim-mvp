/** Disposable R-02 fault injection; never edits the tested source or baselines. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=fs.readFileSync(path.join(root,'js/simulation.js'),'utf8');
const cases=[
    ['accept-overlap','if (neuralTi > 60 / patientRR)', 'if (false)'],
    ['apply-immediately','this.neuralCycleId === 0 && this.neuralTimer === 0 && !this.neuralInspActive','true'],
    ['apply-at-effort-end','    _onNeuralInspirationEnd() {','    _onNeuralInspirationEnd() { this._resolveEffortTiming();'],
    ['lose-exact-equality','this.neuralInspActive && this.neuralTimer >= neuralTi','this.neuralInspActive && this.neuralTimer > neuralTi'],
    ['off-reopens-outcome',"this.neuralCycleResolved = true;\n            // An already resolved", "this.neuralCycleResolved = false;\n            // An already resolved"],
    ['off-cancels-resolved-trigger',"this.neuralCycleResolved = true;\n            // An already resolved", "this.neuralCycleResolved = true; this.cancelScheduledPatientBreath('effort-off');\n            // An already resolved"],
    ['off-clock-advances','if (this.patientRR <= 0) {\n            // Off freezes','if (this.patientRR <= 0) { this.neuralTimer += this.dt;\n            // Off freezes'],
    ['duplicate-terminal-interruption','terminal: !this.neuralCycleResolved','terminal: true'],
    ['reset-drops-selection','reset({ preserveManualHistory = false } = {}) {\n        this._resolveEffortTiming();','reset({ preserveManualHistory = false } = {}) {'],
    ['invalid-erases-queue','        const next = validateEffortTiming({ ...(this._pendingEffortTiming', '        this._pendingEffortTiming = null;\n        const next = validateEffortTiming({ ...(this._pendingEffortTiming'],
    ['delay-hold-invalidation','        this.notifyMeasurementSettingsChanged();\n        return this.effortTiming;','        return this.effortTiming;'],
];
const out=path.join(root,'evidence/timing-mutations');fs.mkdirSync(out,{recursive:true});const receipts=[];
for(const [name,before,after] of cases){
    if(source.split(before).length!==2)throw Error('Mutation site not unique: '+name);
    const directory=path.join(out,name);fs.mkdirSync(directory,{recursive:true});
    fs.cpSync(path.join(root,'js'),path.join(directory,'js'),{recursive:true});
    fs.writeFileSync(path.join(directory,'package.json'),'{"type":"module"}');
    fs.writeFileSync(path.join(directory,'js/simulation.js'),source.replace(before,after));
    const r=spawnSync(process.execPath,['tests/effort-timing.test.mjs'],{cwd:root,windowsHide:true,encoding:'utf8',
        env:{...process.env,VSM_TIMING_RUNTIME_URL:pathToFileURL(path.join(directory,'js/')).href}});
    const text=r.stdout+r.stderr;fs.writeFileSync(path.join(out,name+'.txt'),text);
    const tally=JSON.parse(text.match(/EFFORT_TIMING_TALLY (.+)/)?.[1]??'null');
    const detected=r.status===1&&tally?.groups===17&&tally.failed>0;
    receipts.push({name,detected,tally});console.log(JSON.stringify(receipts.at(-1)));
}
fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(receipts,null,2));
if(!receipts.every(r=>r.detected))process.exitCode=1;
