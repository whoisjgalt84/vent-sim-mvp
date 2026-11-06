/** Fault injection in disposable runtime copies; never changes product or accepted snapshots. */
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const out=resolve(process.argv[2]||'../evidence/mutations');await mkdir(out,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'vent-teaching-mutations-'));
const cases=[
    ['age-frozen','js/simulation.js','this._elapsedPhysicsTicks++;','/* injected missing metadata tick */',null],
    ['age-per-run','js/simulation.js','(this._elapsedPhysicsTicks - this.lastValidManualHold.completedAtPhysicsTick) * this.dt',
        'this.globalTime - this.lastValidManualHold.completedAt_s',null],
    ['age-new-attempt','js/simulation.js','if (!canceled && holdMechanics.pplat.status === \'valid\') this.lastValidManualHold = result;',
        'this.lastValidManualHold = result;',null],
    ['csv-precedence','js/simulation.js','if (cycleReady) {','if (cycleReady && !maxTiReached) {',null],
    ['R03-native-min','js/main.js',"effortSlider.min = '0';","effortSlider.min = '0.25';",'R03'],
    ['R03-restoration','js/main.js','const pmax = selectedEffortAmplitude;','const pmax = 2;','R03'],
    ['R05-prediction-leak','js/main.js','if (!vent.isSpontaneousMode()) return summary;','return summary;','R05'],
    ['loops-default','js/main.js','let loopsVisible = false;','let loopsVisible = true;','loops'],
    ['MAP-status-missing','index.html','id="map-status"','id="injected-missing-map-status"','Inspired VT'],
    ['teaching-controls-visible','css/style.css',null,'\nbody.teaching-mode .controls {display:flex!important;}\n','desktop'],
    ['R03-zero-RR-hidden','js/main.js','const effortOn = sim.effortTiming.enabled;',
        'const effortOn = sim.effortTiming.enabled && vent.pMusMax > 0;','R03'],
    ['visibility-alarm-evaluation','js/main.js','function refreshPresentation() {',
        'function refreshPresentation() { AlarmEngine.evaluateAlarms(getCurrentAlarmMetrics(vent.summary()), alarmLimits);','all Patient'],
    ['hierarchy-order','js/main.js',"primary: ['vt', 'rr', 'peep', 'fio2'], secondary: ['flow-pattern-control'",
        "primary: ['rr', 'vt', 'peep', 'fio2'], secondary: ['flow-pattern-control'",'hierarchy:exact'],
    ['hierarchy-cloned-input','js/main.js','group.appendChild(control);','group.appendChild(control.cloneNode(true));','hierarchy:exact'],
    ['primary-emphasis','css/style.css','border: 2px solid #6daeff; background: #192c42;','border: 0 solid #6daeff; background: #192c42;','hierarchy:exact'],
    ['additional-default-open','js/main.js',"extra.className = 'additional-outputs';","extra.className = 'additional-outputs'; extra.open = true;",'hierarchy:additional'],
    ['additional-lost-focus','js/main.js',"if (extra.contains(document.activeElement)) extra.querySelector('summary').focus();",
        '/* injected missing disclosure focus restoration */','hierarchy:additional'],
    ['Teach-hides-Patient','css/style.css',null,'\nbody.teaching-mode .patient-panel {display:none!important;}\n','hierarchy:Teach'],
    ['Teach-dismisses-Patient','js/main.js',"&& event.target !== document.getElementById('btn-teaching-mode')",'', 'hierarchy:Teach'],
    ['primary-separator-missing','css/style.css',null,'\n.controls .setting-primary > .control {border-top:0!important;}\n','cleanup:trigger-presentation'],
    ['secondary-box-spacing','css/style.css',null,'\n.controls .setting-secondary > .trigger-control {padding:7px!important;}\n','cleanup:trigger-presentation'],
    ['Patient-default-wide-open','js/main.js','    setOpen(false);', "    setOpen(window.matchMedia('(min-width: 1300px)').matches);",'hierarchy:Patient'],
    ['Patient-default-narrow-open','js/main.js','    setOpen(false);', "    setOpen(window.matchMedia('(max-width: 1299px)').matches);",'hierarchy:Patient'],
    ['Patient-choice-lost-on-reset','js/main.js','function resetDemonstration() {',
        "function resetDemonstration() { if (!document.getElementById('patient-panel').hidden) document.getElementById('btn-patient').click();",'hierarchy:Patient'],
];
function run(args,env) {
    return new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},windowsHide:true,stdio:['ignore','pipe','pipe']});
        let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);
        child.once('error',reject);child.once('close',code=>resolve({code,output}));
    });
}
let killed=0;
for(const [name,file,from,to,group] of cases) {
    const directory=join(temp,name);await mkdir(directory,{recursive:true});
    for(const name of ['index.html','package.json','alarms.js','alarm-audio.js','js','css','tools/serve.mjs'])
        await cp(join(root,name),join(directory,name),{recursive:true});
    const target=join(directory,file),source=await readFile(target,'utf8');
    if(from)assert.equal(source.split(from).length,2,name+' requires exact single mutation site');
    await writeFile(target,from?source.replace(from,to):source+to);
    let result;
    if(!group)result=await run(['tests/teaching-slice.test.mjs'],{VSM_SLICE_RUNTIME_URL:pathToFileURL(join(directory,'js')+sep).href});
    else if(group.startsWith('cleanup:')) {
        result=await run(['scratch/verify-ui-cleanup.cjs',directory,group.slice(8)],{});
    } else {
        const server=spawn(process.execPath,[join(directory,'tools/serve.mjs'),'8930'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
        try {
            await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('mutant server timeout')),10000);
                server.once('error',reject);server.stdout.on('data',c=>{if(String(c).includes('Serving')){clearTimeout(timer);resolve();}});});
            const hierarchy=group.startsWith('hierarchy:');
            result=await run([hierarchy?'tests/setting-hierarchy.browser.cjs':'tests/teaching-slice.browser.cjs'],{
                VSM_SLICE_URL:'http://127.0.0.1:8930/index.html',VSM_SLICE_GROUP:hierarchy?'':group,
                VSM_HIERARCHY_GROUP:hierarchy?group.slice(10):'',VSM_SLICE_EVIDENCE:''});
        }finally{server.kill();await new Promise(r=>server.once('close',r));}
    }
    await writeFile(join(out,name+'.log'),result.output);
    assert.notEqual(result.code,0,name+' unexpectedly survived');
    assert.match(result.output,/FAIL (slice|hierarchy|UI cleanup)/,name+' must fail an assertion, not merely crash startup');
    killed++;console.log('KILLED '+name);
}
console.log('TEACHING_MUTATION_TALLY '+JSON.stringify({mutants:cases.length,killed,survived:cases.length-killed,runtimeCopies:temp}));
