/** SME-026/027 real input verification. Run only in an isolated evidence checkout. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const results = [];
const browserOptions = { headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath:process.env.CHROMIUM_PATH } : {}) };
const state = page => page.evaluate(() => window.__vsim.state());
const step = (page, seconds) => page.evaluate(s => window.__vsim.step(s), seconds);
const input = (page, id, value) => page.locator('#'+id).evaluate((el,v) => { el.value=String(v); el.dispatchEvent(new Event('input',{bubbles:true})); },value);
async function until(page, predicate, max = 800) {
    for (let i=0;i<max;i++) { if(predicate(await state(page))) return; await step(page,0.01); }
    throw Error('bounded transition failed');
}
async function fresh(browser) {
    const ctx=await browser.newContext({viewport:{width:1440,height:900},hasTouch:true});
    const page=await ctx.newPage(); const errors=[];
    page.on('pageerror', e=>errors.push(String(e)));
    await page.goto('http://127.0.0.1:8899/index.html');
    await page.evaluate(() => { window.__vsim.pause(); window.__vsim.seek(0); document.querySelectorAll('.controls [data-collapsible][data-collapsed]').forEach(e=>e.click()); });
    return {ctx,page,errors};
}
async function press(page) {
    const button=page.locator('#hold-toggle'); await button.scrollIntoViewIfNeeded(); const box=await button.boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2); await page.mouse.down();
}
async function valid(page) { await press(page); await until(page,s=>s.manualHold.active); await step(page,0.59); await page.mouse.up(); await step(page,0.01); }
async function test(browser,name,run) {
    let x;
    try { x=await fresh(browser); await run(x.page,x.ctx); assert.deepEqual(x.errors,[]); results.push({name,passed:true}); console.log('PASS manual-hold-browser '+name); }
    catch(e){ results.push({name,passed:false}); console.error('FAIL manual-hold-browser '+name+'\n'+e.stack); }
    finally { if(x) await x.ctx.close(); }
}
(async()=>{
const browser=await chromium.launch(browserOptions);
await test(browser,'default unmeasured values and separate recurring setting',async page=>{
    for(const id of ['hold-pplat','hold-dp','hold-crs','hold-raw','param-pplat','param-dp']) assert.equal(await page.locator('#'+id).textContent(),'--');
    assert.equal(await page.locator('#hold-duration').inputValue(),'0');
    assert.equal(await page.locator('#hold-duration').evaluate(e=>e.closest('.control-group').querySelector('.control-group__title').textContent),'Ventilator Settings');
    assert.equal((await state(page)).lastValidManualHold,null);
});
await test(browser,'native mouse arms without premature cycling and displays simulated duration',async page=>{
    await press(page); assert.equal((await state(page)).manualHold.armed,true);
    assert.equal(await page.locator('#hold-display').textContent(),'Armed');
    await step(page,0.3); assert.equal((await state(page)).phase,'INSPIRATION');
    await until(page,s=>s.manualHold.active); await step(page,0.2);
    assert.equal(await page.locator('#hold-display').textContent(),'Holding 0.20 s');
    await page.mouse.up(); await step(page,0.01); assert.equal((await state(page)).lastManualHoldAttempt.mechanics.actualDuration_s,0.21);
});
await test(browser,'early release is canceled arming without attempted measurement',async page=>{
    await press(page); await page.mouse.up(); await step(page,2);
    assert.equal((await state(page)).lastManualHoldAttempt,null); assert.match(await page.locator('#hold-attempt').textContent(),/no hold attempted/);
});
await test(browser,'native mouse completion publishes frozen source and later invalid retains it',async page=>{
    await valid(page); const old=(await state(page)).lastValidManualHold;
    assert.equal(old.mechanics.actualDuration_s,0.6); assert.equal(await page.locator('#hold-status').textContent(),'Last valid hold');
    assert.match(await page.locator('#hold-source').textContent(),/vc-cmv.*breath 1.*occlusion 0.60.*PEEP 5/);
    await press(page); await until(page,s=>s.manualHold.active); await step(page,0.1); await page.mouse.up(); await step(page,0.01);
    assert.deepEqual((await state(page)).lastValidManualHold,old); assert.match(await page.locator('#hold-attempt').textContent(),/Newest hold invalid: Hold too short/);
});
await test(browser,'cap requires release and fresh press; click does not toggle recurring pause',async page=>{
    await press(page); await step(page,4); const old=(await state(page)).lastManualHoldAttempt;
    assert.equal(old.mechanics.actualDuration_s,2); assert.match(await page.locator('#hold-display').textContent(),/Timing limit/);
    await step(page,8); assert.deepEqual((await state(page)).lastManualHoldAttempt,old);
    await page.mouse.up(); await page.locator('#hold-toggle').click(); assert.equal((await state(page)).manualHold.active,false);
    assert.equal(await page.locator('#hold-duration').inputValue(),'0');
    await press(page); assert.equal((await state(page)).manualHold.armed,true); await page.mouse.up();
});
await test(browser,'Space and Enter support held state; auto-repeat cannot rearm after cap',async page=>{
    for(const key of ['Space','Enter']) {
        await page.locator('#hold-toggle').focus(); await page.keyboard.down(key);
        await until(page,s=>s.manualHold.outcome==='timing-limit');
        const old=(await state(page)).lastManualHoldAttempt; assert.equal(old.mechanics.actualDuration_s,2);
        await page.keyboard.down(key); await step(page,8); assert.deepEqual((await state(page)).lastManualHoldAttempt,old);
        await page.keyboard.up(key);
    }
});
await test(browser,'touch press/hold/release uses continuous manual state',async(page,ctx)=>{
    const button=page.locator('#hold-toggle'); await button.scrollIntoViewIfNeeded(); const b=await button.boundingBox();
    const client=await ctx.newCDPSession(page); await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+b.width/2,y:b.y+b.height/2}]});
    assert.equal((await state(page)).manualHold.armed,true); await until(page,s=>s.manualHold.active); await step(page,0.59);
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await step(page,0.01);
    assert.equal((await state(page)).lastValidManualHold.mechanics.actualDuration_s,0.6);
});
await test(browser,'release/repress between ticks preserves expiration and arms next breath',async page=>{
    await press(page); await until(page,s=>s.manualHold.active); await step(page,0.59);
    await page.mouse.up(); await press(page); await step(page,0.01);
    assert.equal((await state(page)).phase,'EXPIRATION'); assert.equal((await state(page)).manualHold.armed,true);
    await until(page,s=>s.manualHold.active); await page.mouse.up();
});
await test(browser,'takeover keeps continuous samples and release overrides only this pause',async page=>{
    await input(page,'hold-duration',15); await page.evaluate(()=>window.__vsim.seek(0));
    await until(page,s=>s.phase==='HOLD'); await step(page,0.3);
    const old=(await state(page)).globalTime; await press(page); assert.equal((await state(page)).manualHold.duration_s,0.3);
    await step(page,0.29); await page.mouse.up(); await step(page,0.01);
    assert.equal((await state(page)).lastValidManualHold.mechanics.actualDuration_s,0.6);
    assert.equal(await page.locator('#hold-duration').inputValue(),'15'); await until(page,s=>s.phase==='HOLD');
    assert.equal((await state(page)).manualHold.active,false); assert.ok((await state(page)).globalTime>old);
});
for(const reason of ['pointercancel','lostpointercapture','window-blur','hidden-tab','transport-pause','focus-lost']) await test(browser,reason+' cancels actual hold without success or restart',async page=>{
    if(reason==='focus-lost') { await page.locator('#hold-toggle').focus(); await page.keyboard.down('Space'); }
    else await press(page);
    await until(page,s=>s.manualHold.active); await step(page,0.6);
    if(reason==='window-blur') await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    else if(reason==='hidden-tab') await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    // A captured held primary pointer cannot physically click another button.
    // Dispatch the transport handler without stealing the manual input owner.
    else if(reason==='transport-pause') await page.locator('#btn-pause').evaluate(el=>el.click());
    else if(reason==='focus-lost') await page.locator('#btn-reset').focus();
    else await page.locator('#hold-toggle').dispatchEvent(reason,{pointerId:1,pointerType:'mouse'});
    let s=await state(page); assert.equal(s.phase,'EXPIRATION'); assert.equal(s.lastValidManualHold,null); assert.equal(s.lastManualHoldAttempt.completion,'canceled');
    assert.equal(s.manualHold.armed,false); assert.match(await page.locator('#hold-attempt').textContent(),/Hold canceled/);
    if(reason==='transport-pause') await page.locator('#btn-pause').click();
    if(reason==='focus-lost') await page.keyboard.up('Space'); else await page.mouse.up();
    await step(page,8); assert.equal((await state(page)).lastValidManualHold,null);
});
await test(browser,'setting and effort edit/revert between ticks invalidate attempts',async page=>{
    for(const kind of ['peep','pmus-max','neural-ti','patient-rr','pmus-toggle']) {
        await page.evaluate(()=>window.__vsim.seek(0)); await press(page); await until(page,s=>s.manualHold.active); await step(page,0.6);
        await page.evaluate(kind=>{
            const el=document.getElementById(kind);
            if(kind==='pmus-toggle'){el.click();el.click();}
            else {const old=el.value;el.value=String(Number(old)+1);el.dispatchEvent(new Event('input',{bubbles:true}));el.value=old;el.dispatchEvent(new Event('input',{bubbles:true}));}
        },kind);
        assert.equal((await state(page)).lastValidManualHold,null); assert.equal((await state(page)).manualHold.active,false);
        assert.ok((await state(page)).lastManualHoldAttempt.mechanics.reasons.includes('SETTINGS_CHANGED')); await page.mouse.up();
    }
});
await test(browser,'recurring alone publishes no manual history; ordinary settings preserve old context',async page=>{
    await input(page,'hold-duration',6); await step(page,20); assert.equal((await state(page)).lastValidManualHold,null);
    await page.evaluate(()=>window.__vsim.manualHoldFixture(0.6)); const old=(await state(page)).lastValidManualHold;
    await input(page,'peep',9); await input(page,'compliance',80); await step(page,10);
    assert.deepEqual((await state(page)).lastValidManualHold,old); assert.match(await page.locator('#hold-source').textContent(),/PEEP 5/);
});
await test(browser,'cross-mode source retained and unsupported controls explicit',async page=>{
    await valid(page); const old=(await state(page)).lastValidManualHold;
    for(const mode of ['pc-cmv','PC-CSV','pc-cmva','vc-cmv']) {
        await page.locator('.mode-btn[data-mode="'+mode+'"]').click(); assert.deepEqual((await state(page)).lastValidManualHold,old);
        assert.match(await page.locator('#pplat-status').textContent(),/vc-cmv/); assert.match(await page.locator('#hold-source').textContent(),/vc-cmv/);
        const unavailable=['PC-CSV','pc-cmva'].includes(mode); assert.equal(await page.locator('#hold-toggle').isDisabled(),unavailable);
        assert.equal(await page.locator('#hold-duration').isDisabled(),unavailable);
        if(unavailable) assert.equal(await page.locator('#hold-display').textContent(),'Unavailable');
    }
});
await test(browser,'shared Reset clears history and active state while paused settings persist',async page=>{
    await input(page,'hold-duration',7); await valid(page); await press(page); await until(page,s=>s.manualHold.active);
    await page.locator('#btn-pause').evaluate(el=>el.click()); await page.mouse.up(); await page.locator('#btn-reset').click();
    const s=await state(page); assert.equal(s.running,false); assert.equal(s.lastValidManualHold,null); assert.equal(s.lastManualHoldAttempt,null);
    assert.equal(await page.locator('#hold-duration').inputValue(),'7'); assert.equal(await page.locator('#hold-pplat').textContent(),'--');
});
await test(browser,'PC/ramp per-value unavailability and help use original source',async page=>{
    for(const mode of ['pc-cmv','vc-cmv']) {
        await page.locator('.mode-btn[data-mode="'+mode+'"]').click();
        if(mode==='vc-cmv') await page.locator('[data-pattern="ramp"]').click();
        await page.evaluate(()=>window.__vsim.manualHoldFixture(0.6));
        assert.notEqual(await page.locator('#hold-pplat').textContent(),'--'); assert.equal(await page.locator('#hold-raw').textContent(),'--');
        const source = await page.locator('#hold-source').textContent();
        if(mode==='pc-cmv') {
            assert.match(source,/Pinsp set .*pressure-dependent flow/);
            assert.ok(!source.includes('VT set') && !source.includes('flow square') && !source.includes('flow ramp'));
        } else { assert.match(source,/VT set .*flow ramp/); assert.ok(!source.includes('Pinsp set')); }
        await page.locator('#hold-results [data-measurement-help="pplat"]').click();
        assert.match(await page.locator('#measurement-help').textContent(),/Last valid manual hold/); await page.keyboard.press('Escape');
    }
});
await browser.close();
console.log('MANUAL_HOLD_BROWSER_TALLY '+JSON.stringify({groups:results.length,passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length}));
if(results.some(x=>!x.passed)) process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
