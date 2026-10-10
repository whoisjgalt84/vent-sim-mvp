/** Five commissioned native Effort-slider browser groups. No baseline writes.
 * The normal browser supervisor owns the :8899 server. Dedicated evidence may
 * set EFFORT_SLIDER_URL, EFFORT_SLIDER_EVIDENCE, EFFORT_SLIDER_TRAJECTORY and
 * EFFORT_SLIDER_LAYOUT=original|prototype|implemented. Original/prototype must
 * point at an untouched Phase A checkpoint server; this driver never restores
 * production markup. Prototype label association is browser-only diagnostics.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const SOURCE_SHA256 = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const APP = process.env.EFFORT_SLIDER_URL || 'http://127.0.0.1:8899/index.html';
const LAYOUT = process.env.EFFORT_SLIDER_LAYOUT || 'implemented';
const OUT = process.env.EFFORT_SLIDER_EVIDENCE && path.resolve(process.env.EFFORT_SLIDER_EVIDENCE);
const TRAJECTORY = process.env.EFFORT_SLIDER_TRAJECTORY && path.resolve(process.env.EFFORT_SLIDER_TRAJECTORY);
const PROTOTYPE = '.pmus-slider-row:has(#pmus-max){display:grid;grid-template-columns:1fr auto;row-gap:10px}.pmus-slider-row #pmus-max{grid-column:1 / -1;grid-row:2;width:100%;box-sizing:border-box}.pmus-slider-row #pmus-max-display{grid-column:2;grid-row:1}';
const INLINE_DIAGNOSTIC = '.pmus-effort-control{flex-direction:row;align-items:center;gap:6px}.pmus-effort-header{display:contents}.pmus-effort-header #pmus-max-display{order:2}.pmus-effort-control>#pmus-max{width:auto;flex:1;order:1}';
const HELP = 'Peak inspiratory muscle pressure (Pmus), 0.25–12 cmH₂O';
const ADAPTIVE_HELP = "Instructor-selected peak amplitude of this model's periodic inspiratory muscle-pressure waveform. Effort does not respond physiologically to changing assistance. This amplitude is not measured work of breathing.";
const EXCLUDED = 'PC-CMVa Pmus 0 -> PC-CMV mode-exit synchronization is excluded. Mode tests explicitly set 8 before exiting adaptive; no normalization or runtime repair is performed. Other zero-effort destinations remain unconfirmed.';
const receipts = [], sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = page => page.evaluate(() => window.__vsim.state());
const format = value => `${Number(value).toFixed(2).replace(/\.?0+$/, '')} cmH₂O`;

async function snapshot(page) {
    return page.evaluate(() => {
        const el = document.querySelector('#pmus-max'), rect = node => {
            const r = node.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom };
        }, s = window.__vsim.state();
        return { value:+el.value, display:document.querySelector('#pmus-max-display').textContent,
            top:document.querySelector('#pmus-display')?.textContent ?? null, min:+el.min,max:+el.max,step:+el.step,
            time:s.globalTime,running:s.running,mode:s.mode,settings:s.operatorSettings,
            completed:s.completed,adaptive:s.adaptiveState,breathCount:s.breathCount,
            identity:el===window.effortNode,range:rect(el),row:rect(el.parentElement),
            readout:rect(document.querySelector('#pmus-max-display')) };
    });
}
function agreement(s, value) {
    assert.equal(s.value,value,'native value'); assert.equal(s.settings.pMusMax,value,'read-only configured Pmus');
    assert.equal(s.display,format(value),'inline formatting'); if (LAYOUT === 'implemented') assert.equal(s.top,null,'redundant upper readout removed');
    else assert.equal(s.top,format(value),'historical upper formatting');
    assert(s.identity,'native input node identity changed');
}
function unrelated(settings) { const copy={...settings}; delete copy.pMusMax; return copy; }
async function transport(page, running) {
    if ((await state(page)).running!==running) await page.locator('#btn-pause').click();
    assert.equal((await state(page)).running,running,'actual transport control');
}
async function keyboard(page, value, selector='#pmus-max') {
    await page.evaluate(() => { window.effortLabel='keyboard-setup'; window.effortPointer=null; });
    const el=page.locator(selector), attrs=await el.evaluate(n=>({min:+n.min,step:+n.step}));
    assert(Number.isInteger((value-attrs.min)/attrs.step),'keyboard target must be on native step');
    await el.focus(); await page.keyboard.press('Home');
    for(let i=0;i<(value-attrs.min)/attrs.step;i++) await page.keyboard.press('ArrowRight');
    assert.equal(+(await el.inputValue()),value,'keyboard setup value');
}
async function setup(page, mode='pc-cmva', value=0) {
    if ((await state(page)).teachingMode) await page.locator('#btn-teaching-mode').click();
    await page.locator(`.mode-btn[data-mode="${mode}"]`).click();
    const patient=page.locator('.controls [data-collapsible]').filter({hasText:'Patient'});
    if (await patient.getAttribute('data-collapsed')!==null) await patient.click();
    if ((await state(page)).operatorSettings.patientRR===0) await page.locator('#pmus-toggle').click();
    await keyboard(page,12,'#patient-rr'); await keyboard(page,value);
    await transport(page,false); await page.locator('#pmus-max').scrollIntoViewIfNeeded();
    const s=await snapshot(page); assert.equal(s.mode,mode); assert.equal(s.settings.patientRR,12); agreement(s,value);
    return s;
}
async function inject(page) {
    if(LAYOUT==='prototype') {
        await page.addStyleTag({content:PROTOTYPE});
        await page.evaluate(() => {
            const old=document.querySelector('#pmus-max').parentElement.querySelector('.pmus-slider-label');
            if(old.tagName!=='LABEL') { const label=document.createElement('label'); label.className=old.className; label.htmlFor='pmus-max'; label.textContent=old.textContent; old.replaceWith(label); }
        });
    }
}
async function instrument(page) {
    await page.evaluate(() => {
        window.effortNode=document.querySelector('#pmus-max'); window.effortEvents=[]; window.effortLabel='setup';
        window.effortPointer=null; window.effortDragging=false;
        for(const type of ['pointerdown','pointermove','pointerup']) document.addEventListener(type,event=>{
            if(event.target===window.effortNode) {
                window.effortPointer={type,x:event.clientX,y:event.clientY,buttons:event.buttons,trusted:event.isTrusted};
                if(type==='pointerdown') window.effortDragging=true;
                if(type==='pointerup') window.effortDragging=false;
            }
        },true);
        window.effortNode.addEventListener('input',event=>{
            const r=window.effortNode.getBoundingClientRect();
            window.effortEvents.push({label:window.effortLabel,value:+window.effortNode.value,x:r.x,y:r.y,width:r.width,height:r.height,
                trusted:event.isTrusted,dragging:window.effortDragging,pointer:window.effortPointer,
                configured:window.__vsim.state().operatorSettings.pMusMax});
        });
    });
}
function point(s,value) { return {x:s.range.x+7+(s.range.width-14)*(value-s.min)/(s.max-s.min),y:s.range.y+s.range.height/2}; }
async function drag(page,label,xs,y) {
    await page.evaluate(l=>{window.effortLabel=l;window.effortPointer=null;},label);
    await page.mouse.move(xs[0],y); await page.mouse.down();
    for(const x of xs.slice(1)) { await page.mouse.move(x,y); await sleep(12); }
    await page.mouse.up();
    return page.evaluate(l=>window.effortEvents.filter(e=>e.label===l),label);
}
function trajectory(a,b,steps=40) { return Array.from({length:steps+1},(_,i)=>a+(b-a)*i/steps); }
async function moveValue(page,label,start,end,steps=40) {
    const s=await snapshot(page),a=point(s,start),b=point(s,end);
    return drag(page,label,trajectory(a.x,b.x,steps),a.y);
}
function meaningful(events,min=1) {
    assert(events.length>=min,`nonvacuous native input coverage: expected >=${min}, got ${events.length}`);
    for(const e of events) { assert(e.trusted && e.dragging && e.pointer?.trusted && e.pointer.buttons===1,'trusted native pointer input'); assert.equal(e.configured,e.value,'native input/model agreement'); assert(Number.isInteger(e.value*4),'quarter-step values'); assert(e.value>=0&&e.value<=12,'range bounds'); }
}
function monotonic(events,sign) { meaningful(events,10); assert(events.slice(1).every((e,i)=>sign*(e.value-events[i].value)>=0),'monotonic values during monotonic horizontal motion'); }
function geometry(events,before,after) {
    for(const key of ['x','y','width','height']) {
        const bounds=[before.range[key],after.range[key],...events.map(e=>e[key])];
        assert(bounds.every(Number.isFinite),`range ${key} measurements missing`);
        assert(Math.max(...bounds)-Math.min(...bounds)<=0.5,`range ${key} changed >0.5 CSS px`);
    }
}
async function preserveLayout(page,apply) {
    const before=await snapshot(page); await apply(); const after=await snapshot(page);
    for(const key of ['value','display','top','time','running','mode','settings','completed','adaptive','breathCount','identity']) assert.deepEqual(after[key],before[key],`layout-only preservation: ${key}`);
    return {before,after};
}
async function image(page,name,selector) {
    if(!OUT)return; const target=selector?page.locator(selector):page;
    await target.screenshot({path:path.join(OUT,`${name}.png`),...(selector?{}:{fullPage:true})});
}

const groups = [
    ['native-drags-and-geometry',async page=>{
        await setup(page); const before=await snapshot(page);
        let shared=TRAJECTORY&&fs.existsSync(TRAJECTORY)?JSON.parse(fs.readFileSync(TRAJECTORY,'utf8')):trajectory(71+7,71+73-7,180);
        assert(Array.isArray(shared)&&shared.length===181&&shared.every(Number.isFinite),'shared horizontal trajectory inventory');
        if(TRAJECTORY&&!fs.existsSync(TRAJECTORY)) { fs.mkdirSync(path.dirname(TRAJECTORY),{recursive:true}); fs.writeFileSync(TRAJECTORY,JSON.stringify(shared,null,2)+'\n'); }
        const y=before.range.y+before.range.height/2;
        // The shared original x path may start within the wider implemented track.
        const right=await drag(page,'shared-right',shared,y),left=await drag(page,'shared-left',[...shared].reverse(),y);
        await keyboard(page,0); const fullBefore=await snapshot(page);
        const fullRight=await moveValue(page,'full-right',0,12,180),atMax=await snapshot(page);
        const fullLeft=await moveValue(page,'full-left',12,0,180),atMin=await snapshot(page);
        receipts.push({group:'native-drags-and-geometry',sharedPointerXs:shared,sharedRight:right,sharedLeft:left,fullRight,fullLeft,before,atMax,atMin});
        for(const [events,sign] of [[right,1],[left,-1],[fullRight,1],[fullLeft,-1]])monotonic(events,sign);
        geometry([...right,...left,...fullRight,...fullLeft],before,atMin);
        geometry([...fullRight,...fullLeft],fullBefore,atMin); agreement(atMax,12); agreement(atMin,0);
    }],
    ['precision-and-retention',async page=>{
        await setup(page); const attempts=[];
        for(const start of [0,5.5,7.75,9,11.75]) {
            await keyboard(page,start); const events=await moveValue(page,`eight-from-${start}`,start,8),release=await snapshot(page);
            await page.evaluate(()=>window.__vsim.redraw());const redraw=await snapshot(page);
            await page.waitForTimeout(180);const pausedIdle=await snapshot(page);
            await transport(page,true);await page.waitForTimeout(220);const playing=await snapshot(page);
            await transport(page,false);const repaused=await snapshot(page);
            attempts.push({start,events,release,redraw,pausedIdle,playing,repaused});
        }
        receipts.push({group:'precision-and-retention',attempts});
        for(const attempt of attempts) {
            meaningful(attempt.events); for(const key of ['release','redraw','pausedIdle','playing','repaused'])agreement(attempt[key],8);
            assert.equal(attempt.release.time,attempt.pausedIdle.time); assert(attempt.playing.time>attempt.pausedIdle.time);
            for(const key of ['redraw','pausedIdle','playing','repaused'])assert.deepEqual(unrelated(attempt[key].settings),unrelated(attempt.release.settings));
        }
        await keyboard(page,8);const s=await snapshot(page),p8=point(s,8),p9=point(s,9),p825=point(s,8.25);
        const regrab=await drag(page,'continuous-regrab-eight-nine-eight',[
            ...trajectory(p8.x,p9.x,12),...trajectory(p9.x,p8.x,12).slice(1)],p8.y);
        meaningful(regrab,8);assert(regrab.some(e=>e.value===9),'continuous re-grab reaches nine');agreement(await snapshot(page),8);
        const reversal=await drag(page,'short-reversal',[p8.x,p825.x,p8.x],p8.y); meaningful(reversal,2);agreement(await snapshot(page),8);
        await keyboard(page,0);await page.evaluate(()=>window.effortLabel='click-away-from-thumb');await page.mouse.click(p8.x,p8.y);
        const clickEvents=await page.evaluate(()=>effortEvents.filter(e=>e.label==='click-away-from-thumb'));meaningful(clickEvents);agreement(await snapshot(page),8);
        receipts.push({group:'precision-and-retention',regrab,reversal,clickEvents});await image(page,'precision-eight','#pmus-sliders');
    }],
    ['running-transport-and-preservation',async page=>{
        await setup(page,'pc-cmva',8);await transport(page,true);
        await page.waitForFunction(()=>window.__vsim.state().completed!==null,{},{timeout:8000});
        await transport(page,false);const rich=await snapshot(page);assert(rich.completed&&rich.adaptive,'nonempty completed/adaptive preservation fixture');
        let preserved,inlineDiagnostic;
        if(LAYOUT==='implemented') {
            let temporaryStyle;
            inlineDiagnostic=await preserveLayout(page,async()=>{temporaryStyle=await page.addStyleTag({content:INLINE_DIAGNOSTIC});});
            preserved=await preserveLayout(page,()=>temporaryStyle.evaluate(el=>el.remove()));
            assert(preserved.after.range.width-preserved.before.range.width>20,'actual implemented layout restoration must meaningfully widen the native track');
        } else if(LAYOUT==='prototype') {
            let temporaryStyle;
            inlineDiagnostic=await preserveLayout(page,async()=>{temporaryStyle=await page.addStyleTag({content:'.pmus-slider-row:has(#pmus-max){display:flex}.pmus-slider-row #pmus-max{width:auto;box-sizing:border-box}'});});
            preserved=await preserveLayout(page,()=>temporaryStyle.evaluate(el=>el.remove()));
            assert(preserved.after.range.width-preserved.before.range.width>20,'actual prototype layout restoration must meaningfully widen the native track');
        } else {
            let temporaryStyle;
            preserved=await preserveLayout(page,async()=>{temporaryStyle=await page.addStyleTag({content:PROTOTYPE});});
            assert(preserved.after.range.width-preserved.before.range.width>20,'original-to-prototype diagnostic must meaningfully widen the native track');
            // Original-negative input checks below require the original layout.
            inlineDiagnostic=await preserveLayout(page,()=>temporaryStyle.evaluate(el=>el.remove()));
        }
        receipts.push({group:'running-transport-and-preservation',rich,inlineDiagnostic,preserved});
        await page.waitForTimeout(200);assert.equal((await state(page)).globalTime,rich.time,'Pause stops simulated time');
        const beforeInput=await snapshot(page);const pausedDrag=await moveValue(page,'paused-state-edit',8,9,20);meaningful(pausedDrag);
        const edited=await snapshot(page);agreement(edited,9);assert.equal(edited.time,beforeInput.time);assert.deepEqual(edited.completed,beforeInput.completed);assert.deepEqual(unrelated(edited.settings),unrelated(beforeInput.settings));
        assert(edited.adaptive.epoch>beforeInput.adaptive.epoch,'deliberate Pmus invalidation advances adaptive epoch');assert.equal(edited.adaptive.contextMatches,false);
        await transport(page,true);const runningBefore=await snapshot(page);const events=await moveValue(page,'running-nine-to-eight',9,8,40);meaningful(events);const runningAfter=await snapshot(page);agreement(runningAfter,8);assert(runningAfter.time>runningBefore.time,'Play advances simulated time during actual drag');
        await keyboard(page,0);const runningSweepBefore=await snapshot(page);
        const runningRight=await moveValue(page,'running-full-right',0,12,180),runningMax=await snapshot(page);
        const runningLeft=await moveValue(page,'running-full-left',12,0,180),runningMin=await snapshot(page);
        receipts.push({group:'running-transport-and-preservation',runningSweepBefore,runningRight,runningMax,runningLeft,runningMin});
        monotonic(runningRight,1);monotonic(runningLeft,-1);geometry([...runningRight,...runningLeft],runningSweepBefore,runningMin);
        agreement(runningMax,12);agreement(runningMin,0);
        assert(runningMax.running&&runningMin.running&&runningMax.time>runningSweepBefore.time&&runningMin.time>runningMax.time,'Play advances simulated time during each full sweep');
        await keyboard(page,8);
        await transport(page,false);const stopped=await snapshot(page);await page.waitForTimeout(180);assert.equal((await state(page)).globalTime,stopped.time);
        receipts.push({group:'running-transport-and-preservation',inlineDiagnostic,preserved,pausedDrag,beforeInput,edited,events,runningBefore,runningAfter,stopped,resetHookSmoke:'Not used; actual UI transport only.'});
    }],
    ['modes-and-keyboard',async page=>{
        const modes=[];await setup(page,'pc-cmva',8);
        for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']) {
            const initial=await setup(page,mode,8),min=mode==='pc-cmva'?0:0.25;
            assert.equal(initial.min,min);assert.equal(initial.max,12);assert.equal(initial.step,0.25);
            assert.equal(await page.locator('#pmus-max').getAttribute('title'),mode==='pc-cmva'?ADAPTIVE_HELP:HELP,'retained mode-specific title');
            const values=[];for(const value of [min,5.5,7.75,8,9.25,11.75,12]) {await keyboard(page,value);const s=await snapshot(page);agreement(s,value);values.push(s);}
            await keyboard(page,8);const events=await moveValue(page,`mode-${mode}-eight-nine`,8,9,24);meaningful(events);const end=await snapshot(page);agreement(end,9);assert.equal(end.min,min);assert.equal(end.max,12);assert.equal(end.step,0.25);
            await keyboard(page,8);modes.push({mode,initial,keyboardValues:values,events,end,exitEffort:8});
        }
        receipts.push({group:'modes-and-keyboard',modes,excluded:EXCLUDED});
    }],
    ['clipping-and-accessibility',async page=>{
        await setup(page,'pc-cmva',11.75);const checks=[];
        receipts.push({group:'clipping-and-accessibility',checks});
        for(const width of [1440,1100,800]) {
            await page.setViewportSize({width,height:900});await page.locator('#pmus-max').scrollIntoViewIfNeeded();
            const check=await page.evaluate(()=>{
                const input=document.querySelector('#pmus-max'),row=input.parentElement,readout=document.querySelector('#pmus-max-display'),label=[...input.labels||[]].find(el=>el.textContent.trim()==='Effort');
                const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
                const control=id=>{const el=document.getElementById(id),style=getComputedStyle(el),parentStyle=getComputedStyle(el.parentElement);
                    return {value:el.value,rect:rect(el),parentRect:rect(el.parentElement),style:Object.fromEntries(['display','width','height','minWidth','fontSize','marginTop','marginBottom','flex'].map(key=>[key,style[key]])),parentStyle:Object.fromEntries(['display','width','height','gap','alignItems'].map(key=>[key,parentStyle[key]]))};};
                return {range:rect(input),row:rect(row),readout:rect(readout),label:label&&rect(label),labelFor:label?.htmlFor,title:input.title,
                    value:readout.textContent,readoutClipped:readout.scrollWidth>readout.clientWidth,viewport:innerWidth,
                    adjacent:{neuralTi:document.querySelector('#neural-ti').value,patientRR:document.querySelector('#patient-rr').value},
                    adjacentGeometry:{neuralTi:control('neural-ti'),patientRR:control('patient-rr')},
                    live:!!row.querySelector('[aria-live],[role="status"],[role="alert"]')};
            });
            checks.push({width,...check});assert.equal(check.value,format(11.75));assert(!check.readoutClipped,'11.75 text clipped');
            for(const [name,box] of [['track',check.range],['readout',check.readout],['label',check.label]]) {assert(box,`${name} present`);assert(box.left>=check.row.left-0.5&&box.right<=check.row.right+0.5,`${name} horizontal row containment`);assert(box.left>=0&&box.right<=check.viewport,`${name} viewport containment`);assert(box.top>=check.row.top-0.5&&box.bottom<=check.row.bottom+0.5,`${name} vertical row containment`);}
            assert.equal(check.labelFor,'pmus-max');assert.equal(check.title,ADAPTIVE_HELP);assert.equal(check.live,false);
            assert.equal(check.adjacent.patientRR,'12');await image(page,`clipping-${width}`);await image(page,`clipping-${width}-effort`,'#pmus-sliders');
            assert.equal(check.adjacent.neuralTi,'10','adjacent neural-time value retained');
        }
        const session=await page.context().newCDPSession(page);
        const {root}=await session.send('DOM.getDocument');const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector:'#pmus-max'});
        const {nodes}=await session.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});await session.detach();
        const ax=nodes.find(node=>node.role?.value==='slider');assert(ax,'platform accessibility slider node');assert.equal(ax.name?.value,'Effort','platform accessible name');assert.equal(ax.description?.value,ADAPTIVE_HELP,'retained title help in platform accessibility tree');
        await page.locator('#pmus-max').focus();assert(await page.locator('#pmus-max').evaluate(el=>document.activeElement===el));await page.keyboard.press('ArrowLeft');agreement(await snapshot(page),11.5);
        receipts.push({group:'clipping-and-accessibility',ax,limitations:'Automated Chromium platform accessibility evidence; no manual screen-reader or mobile-readiness claim.'});
    }],
];

(async()=>{
    assert(['original','prototype','implemented'].includes(LAYOUT),'unknown layout');assert.equal(groups.length,5,'commissioned five-group inventory');
    if(OUT)fs.mkdirSync(OUT,{recursive:true});
    const launch={args:['--no-sandbox']};if(process.env.CHROMIUM_PATH)launch.executablePath=process.env.CHROMIUM_PATH;
    const browser=await chromium.launch(launch),browserVersion=browser.version(),results=[];
    try {
        for(const [name,run] of groups) {
            const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1}),page=await context.newPage(),errors=[];
            page.on('pageerror',error=>errors.push(String(error)));
            page.on('response',response=>{if(response.status()>=400&&!/favicon\.ico/.test(response.url()))errors.push(`${response.status()} ${response.url()}`);});
            try {
                await page.goto(APP,{waitUntil:'networkidle'});await page.waitForFunction(()=>typeof window.__vsim?.state==='function');
                await instrument(page);await setup(page);const injection=await preserveLayout(page,()=>inject(page));receipts.push({group:name,initialLayoutInjection:injection});
                await run(page);assert.deepEqual(errors,[],'application/network errors');
                if(name==='clipping-and-accessibility') {
                    const narrow=await browser.newContext({viewport:{width:800,height:900},deviceScaleFactor:2}),p=await narrow.newPage(),narrowErrors=[];
                    p.on('pageerror',error=>narrowErrors.push(String(error)));
                    p.on('response',response=>{if(response.status()>=400&&!/favicon\.ico/.test(response.url()))narrowErrors.push(`${response.status()} ${response.url()}`);});
                    try {await p.goto(APP,{waitUntil:'networkidle'});await p.waitForFunction(()=>window.__vsim);await instrument(p);await setup(p,'pc-cmva',11.75);await inject(p);const s=await snapshot(p);agreement(s,11.75);assert(s.readout.right<=s.row.right+0.5);assert(s.range.right<=800);await image(p,'narrow-dpr2');await image(p,'narrow-dpr2-effort','#pmus-sliders');assert.deepEqual(narrowErrors,[],'narrow/DPR2 application/network errors');receipts.push({group:name,narrowDpr2:s,narrowErrors});}finally{await narrow.close();}
                }
                results.push({name,passed:true});console.log(`PASS effort slider ${name}`);
            }catch(error){results.push({name,passed:false,error:error.message,browserErrors:errors});console.error(`FAIL effort slider ${name}: ${error.stack||error}`);await image(page,`failure-${name}`).catch(()=>{});}
            finally{receipts.push({group:name,allEvents:await page.evaluate(()=>window.effortEvents||[]).catch(()=>[])});await context.close();}
        }
    }finally{await browser.close();}
    const report={layout:LAYOUT,url:APP,sourceSha256:SOURCE_SHA256,browserVersion,prototypeDiagnosticLabelAssociation:LAYOUT==='prototype',excluded:EXCLUDED,groups:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results,receipts};
    if(OUT)fs.writeFileSync(path.join(OUT,'effort-slider-report.json'),JSON.stringify(report,null,2)+'\n');
    console.log(`EFFORT_SLIDER_BROWSER_TALLY ${JSON.stringify({groups:report.groups,passed:report.passed,failed:report.failed})}`);
    if(groups.length!==5||report.groups!==5||report.failed)process.exitCode=1;
})().catch(error=>{console.error(error.stack||error);console.log('EFFORT_SLIDER_BROWSER_TALLY {"groups":5,"passed":0,"failed":5}');process.exitCode=1;});
