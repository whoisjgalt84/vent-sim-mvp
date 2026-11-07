/** Focused approved slice checks. No snapshot updates. Existing server lifecycle belongs to supervisor. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const url=process.env.VSM_SLICE_URL||'http://127.0.0.1:8899/index.html';
const out=process.env.VSM_SLICE_EVIDENCE;
const modes=['vc-cmv','pc-cmv','PC-CSV','pc-cmva'];
const results=[];
const state=page=>page.evaluate(()=>__vsim.state());
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
async function setup(page,mode='vc-cmv',extra={}) {
    return page.evaluate(options=>__vsim.setupEffort(options),{mode,pMusMax:0,patientRR:0,...extra});
}
async function patient(page,open=true) {
    if(await page.locator('#patient-panel').isVisible()!==open) {
        await page.locator(open?'#btn-patient':'#patient-close').click();
    }
}
async function key(page,id,key) {await page.locator('#'+id).focus();await page.keyboard.press(key);}
async function teach(page,on=true) {
    if((await state(page)).teachingMode!==on)await page.locator('#btn-teaching-mode').click();
}
async function test(browser,name,fn) {
    if(process.env.VSM_SLICE_GROUP&&!name.startsWith(process.env.VSM_SLICE_GROUP))return;
    const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
    page.setDefaultTimeout(5000);
    page.on('pageerror',e=>errors.push(String(e)));
    try {await page.goto(url);await page.waitForFunction(()=>window.__vsim);await page.evaluate(()=>__vsim.pause());
        await fn(page);assert.deepEqual(errors,[]);results.push(true);console.log('PASS slice '+name);}
    catch(e){results.push(false);console.error('FAIL slice '+name+'\n'+e.stack);}
    finally{await page.close();}
}
(async()=>{
    if(out)fs.mkdirSync(out,{recursive:true});
    const browser=await chromium.launch();
    try {
        await test(browser,'desktop settings and seven output positions, all modes and both views',async page=>{
            for(const width of [1440,1100]) {
                await page.setViewportSize({width,height:900});await patient(page,false);
                for(const mode of modes)for(const teaching of [false,true]) {
                    await setup(page,mode);await teach(page,teaching);
                    const layout=await page.evaluate(()=>({
                        keys:[...document.querySelectorAll('.key-output')].map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,text:el.textContent};}),
                        waves:[...document.querySelectorAll('.waveform-panel')].map(el=>el.getBoundingClientRect().height),
                        settings:[...document.querySelectorAll('#primary-settings > .control,#secondary-settings > .control')]
                            .filter(el=>el.getClientRects().length).map(el=>{const r=el.getBoundingClientRect();return {top:r.top,bottom:r.bottom};}),
                        overflow:document.documentElement.scrollWidth>innerWidth,
                        controls:getComputedStyle(document.querySelector('.controls')).display
                    }));
                    assert.equal(layout.keys.length,7);assert.equal(layout.overflow,false);assert.equal(layout.controls==='none',teaching);
                    for(const box of layout.keys)assert.ok(box.top>=0&&box.bottom<=900&&box.width>200,JSON.stringify(box));
                    for(const box of layout.settings)assert.ok(box.top>=0&&box.bottom<=900,JSON.stringify({width,mode,box}));
                    for(const height of layout.waves)assert.ok(height>=140,`${mode} waveform ${height}`);
                    if(out)await page.screenshot({path:path.join(out,`${width}-${mode}-${teaching?'teach':'standard'}.png`)});
                }
            }
        });
        await test(browser,'all Patient/Teach combinations retain state, alarms, holds and mounted controls',async page=>{
            await page.evaluate(async()=>{
                const {default:alarms}=await import('/alarms.js?v=32');
                const evaluate=alarms.evaluateAlarms;
                window.sliceAlarmEvaluations=0;
                alarms.evaluateAlarms=(...args)=>{window.sliceAlarmEvaluations++;return evaluate(...args);};
            });
            for(const mode of modes)for(const running of [true,false]) {
                await setup(page,mode,{pMusMax:4,patientRR:12});
                if(!running)await page.locator('#btn-pause').click();
                await page.evaluate(()=>__vsim.stepTicks(600));
                const select=s=>({settings:s.resetDiagnostics.configuration,completed:s.completed,hold:s.lastValidManualHold,
                    alarm:s.activeAlarms,limits:s.resetDiagnostics.alarmLimits,timing:s.effortTiming,running:s.running,
                    time:s.globalTime,events:s.triggerEvents,physics:s.physicsSample});
                const before=select(await state(page));
                const evaluations=await page.evaluate(()=>sliceAlarmEvaluations);
                await page.evaluate(()=>{window.sliceEffortNode=document.getElementById('pmus-max');});
                for(let i=0;i<3;i++)for(const visible of [false,true])for(const teaching of [false,true]) {
                    await patient(page,visible);await teach(page,teaching);
                    assert.deepEqual(select(await state(page)),before);
                    assert.equal(await page.evaluate(()=>sliceAlarmEvaluations),evaluations,'visibility adds no alarm evaluations');
                    assert.equal(await page.evaluate(()=>sliceEffortNode===document.getElementById('pmus-max')),true);
                }
            }
            await setup(page);await page.evaluate(()=>__vsim.manualHoldFixture(.6));const saved=(await state(page)).lastValidManualHold;
            await patient(page,false);await teach(page,true);await patient(page,true);
            assert.deepEqual((await state(page)).lastValidManualHold,saved);
        });
        await test(browser,'loops initially off and independently retain explicit selection across Teach and Patient',async page=>{
            assert.equal((await state(page)).resetDiagnostics.loopsVisible,false);
            assert.equal(await page.locator('#btn-loops').getAttribute('aria-pressed'),'false');
            for(const on of [false,true,false]) {
                if((await state(page)).resetDiagnostics.loopsVisible!==on)await page.locator('#btn-loops').click();
                await teach(page,true);await patient(page,false);await teach(page,false);await patient(page,true);
                assert.equal((await state(page)).resetDiagnostics.loopsVisible,on);
                assert.equal(await page.locator('#loop-row').isVisible(),on);
            }
        });
        await test(browser,'R03 zero and positive effort across every mode pair, Off/On and native inputs',async page=>{
            for(const source of modes)for(const target of modes)for(const amplitude of [0,7.75]) {
                await setup(page,source,{pMusMax:amplitude,patientRR:12});await patient(page,true);
                await page.locator(`[data-mode="${target}"]`).click();
                const s=await state(page);assert.equal(s.operatorSettings.pMusMax,amplitude);
                assert.equal(+(await page.locator('#pmus-max').inputValue()),amplitude);
                assert.equal(await page.locator('#pmus-max').getAttribute('min'),'0');
                assert.equal(await page.locator('#pmus-max').getAttribute('step'),'0.25');
                assert.equal(await page.locator('#pmus-max').getAttribute('aria-valuetext'),`${amplitude} cmH₂O`);
                await page.locator('#pmus-toggle').click();assert.equal((await state(page)).effortTiming.enabled,false);
                assert.equal((await state(page)).operatorSettings.pMusMax,0);
                await page.locator('#pmus-toggle').click();assert.equal((await state(page)).effortTiming.enabled,true);
                assert.equal((await state(page)).operatorSettings.pMusMax,amplitude);
            }
            await key(page,'pmus-max','Home');assert.equal((await state(page)).operatorSettings.pMusMax,0);
            assert.match(await page.locator('#effort-state').innerText(),/On.*zero amplitude/);
            await teach(page,true);assert.equal(await page.locator('.rr-triple__num--patient').innerText(),'12');
            await key(page,'pmus-max','ArrowRight');assert.equal((await state(page)).operatorSettings.pMusMax,.25);
            const box=await page.locator('#pmus-max').boundingBox();assert.ok(box);
            await page.mouse.click(box.x+box.width*.75,box.y+box.height/2);
            const actual=+(await page.locator('#pmus-max').inputValue());assert.ok(actual>8&&actual<10);
            assert.equal((await state(page)).operatorSettings.pMusMax,actual);
            await key(page,'pmus-max','End');assert.equal((await state(page)).operatorSettings.pMusMax,12);
        });
        await test(browser,'Inspired VT source, MAP provenance/unavailability and stable accessible help',async page=>{
            await setup(page);await page.evaluate(()=>__vsim.stepTicks(700));let s=await state(page);
            assert.equal(await page.locator('#vt-param-label').innerText(),'Inspired VT');
            assert.equal(+(await page.locator('#param-vt').innerText()),Math.round(s.completed.measuredVT_mL));
            assert.match(await page.locator('#map-status').innerText(),/Configured-cycle/);
            assert.notEqual(await page.locator('#param-map').innerText(),'—');
            const help=page.locator('[data-measurement-help="inspired-vt"]');await help.focus();await page.keyboard.press('Enter');
            assert.match(await page.locator('#measurement-help').innerText(),/not a separate exhaled/);
            await page.keyboard.press('Escape');assert.equal(await help.evaluate(el=>document.activeElement===el),true);
            for(const [mode,amplitude,reason] of [['vc-cmv',8,/active effort/],['pc-cmva',0,/pressure adapts/],['PC-CSV',0,/configured-cycle/]]) {
                await setup(page,mode,{pMusMax:amplitude,patientRR:amplitude?12:0});
                assert.equal(await page.locator('#param-map').innerText(),'—');
                assert.match(await page.locator('#map-status').innerText(),reason);
            }
        });
        await test(browser,'R05 CSV prediction surfaces gated, configured backstop visible, genuine signals and raw alarms retained',async page=>{
            await setup(page,'PC-CSV');await patient(page,false);
            let s=await state(page);assert.equal(s.completed,null);assert.equal(s.breathCount,0);
            assert.equal(await page.locator('#csv-backstop').isVisible(),true);
            assert.match(await page.locator('#csv-backstop-source').innerText(),/RR 12\/min.*I:E 1:4/);
            assert.equal(await page.locator('#csv-backstop-value').innerText(),'1.00 s');
            assert.equal(await page.locator('#rr').isVisible(),false);
            assert.equal(await page.locator('#ie-group').isVisible(),true);
            for(const id of ['map','pr','auto-peep','total-peep','ti','te','ti-tau','te-tau','exp-completion','flow'])
                assert.equal(await page.locator('#param-'+id).textContent(),'—',id);
            assert.doesNotMatch(await page.locator('#mechanics-bar').textContent(),/Te\/|Ti\/|Predicted steady-state/);
            assert.equal(await page.locator('#alerts').textContent(),'');
            const raw=s.predicted;assert.ok(Number.isFinite(raw.pressures.map_cmH2O),'raw analytical getter preserved');
            await setup(page,'PC-CSV',{pMusMax:8,patientRR:12});await page.evaluate(()=>__vsim.stepTicks(4000));s=await state(page);
            assert.ok(s.completed);assert.equal(s.alarmPip,s.runningPip);
            assert.equal(s.evaluatedDelivery.valueLpm,s.deliveredVentilation.valueLpm);
            assert.equal(+(await page.locator('#param-vt').textContent()),Math.round(s.completed.measuredVT_mL));
            assert.notEqual(await page.locator('#param-pip').textContent(),'—');
            assert.notEqual(await page.locator('#param-flow').textContent(),'—');
        });
        await test(browser,'hold age follows physics, pause, speed/cap and retained source; invalid attempt and Reset',async page=>{
            await setup(page);let s=await page.evaluate(()=>__vsim.manualHoldFixture(.6));const saved=s.lastValidManualHold;
            assert.ok(saved);assert.match(await page.locator('#pplat-status').innerText(),/0.0 simulated s ago.*current run/);
            await page.locator('#btn-pause').click();const age=(await state(page)).manualHoldAge_s;
            await page.evaluate(()=>__vsim.advanceTransport(100));near((await state(page)).manualHoldAge_s,age);
            await page.locator('#btn-pause').click();await page.locator('[data-speed="4"]').click();
            await page.evaluate(()=>__vsim.advanceTransport(100));near((await state(page)).manualHoldAge_s,age+3);
            await page.locator('[data-mode="pc-cmv"]').click();near((await state(page)).manualHoldAge_s,age+3);
            assert.match(await page.locator('#pplat-status').innerText(),/previous run/);
            await page.evaluate(()=>__vsim.manualHoldFixture(.2,false));s=await state(page);
            assert.deepEqual(s.lastValidManualHold,saved);assert.ok(s.manualHoldAge_s>age+3);
            await page.locator('#btn-reset').click();s=await state(page);assert.equal(s.manualHoldAge_s,null);
            assert.equal(s.lastValidManualHold,null);assert.equal(await page.locator('#hold-age').textContent(),'');
        });
        await test(browser,'drawer focus, help, Escape, keyboard collapsibles and narrow reflow',async page=>{
            await page.setViewportSize({width:1100,height:900});await patient(page,false);await patient(page,true);
            assert.equal(await page.locator('#patient-close').evaluate(el=>document.activeElement===el),true);
            await page.keyboard.press('Escape');assert.equal(await page.locator('#patient-panel').isVisible(),false);
            assert.equal(await page.locator('#btn-patient').evaluate(el=>document.activeElement===el),true);
            await teach(page,true);
            assert.equal(await page.locator('#additional-outputs').evaluate(el=>el.open),false);
            await page.locator('#additional-outputs-summary').focus();await page.keyboard.press('Enter');
            assert.equal(await page.locator('#additional-outputs').evaluate(el=>el.open),true);
            const invalid=await page.locator('.parameters [data-collapsible]').evaluateAll(els=>els.filter(el=>el.tabIndex!==0||el.getAttribute('aria-disabled')==='true').length);
            assert.equal(invalid,0);await teach(page,false);
            const title=page.locator('.parameters [data-collapsible]').first();await title.focus();
            const initial=await title.getAttribute('aria-expanded');await page.keyboard.press('Space');
            assert.notEqual(await title.getAttribute('aria-expanded'),initial);
            for(const width of [800,390]) {
                await page.setViewportSize({width,height:900});
                assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
                await patient(page,true);await page.locator('#compliance').focus();await page.keyboard.press('ArrowRight');
                const input=await page.locator('#compliance').boundingBox();assert.ok(input.x>=0&&input.x+input.width<=width);
                await page.keyboard.press('Escape');assert.equal(await page.locator('#patient-panel').isVisible(),false);
            }
        });
    }finally{await browser.close();}
    const tally={groups:results.length,passed:results.filter(Boolean).length,failed:results.filter(x=>!x).length};
    console.log('TEACHING_SLICE_BROWSER_TALLY '+JSON.stringify(tally));if(tally.failed||tally.groups!==(process.env.VSM_SLICE_GROUP?1:8))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
