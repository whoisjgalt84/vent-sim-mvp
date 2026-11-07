/** Approved hierarchy revision: real controls, native disclosure and unchanged model state. */
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const url = process.env.VSM_SLICE_URL || 'http://127.0.0.1:8899/index.html';
const modes = ['vc-cmv', 'pc-cmv', 'PC-CSV', 'pc-cmva'];
// Owner's acceptance order, independent of the application's mapping.
const expected = [
    [['vt','rr','peep','fio2'],['flow-pattern-control','ie-group','trigger-type-group']],
    [['pinsp','rr','peep','fio2'],['ie-group','trigger-type-group']],
    [['ps-pressure','peep','fio2'],['ie-group','cycle-percent','trigger-type-group']],
    [['vt','rr','peep','fio2'],['adaptive-setup','ie-group','trigger-type-group']],
];
const results = [];
const state = p => p.evaluate(() => __vsim.state());
const stable = s => ({settings:s.resetDiagnostics.configuration,physics:s.physicsSample,
    time:s.globalTime,completed:s.completed,hold:s.lastValidManualHold,age:s.manualHoldAge_s,
    timing:s.effortTiming,alarms:s.activeAlarms,limits:s.resetDiagnostics.alarmLimits,events:s.triggerEvents});
async function setup(p,mode='vc-cmv',options={}) {
    await p.evaluate(o=>__vsim.setupEffort(o),{mode,pMusMax:8,patientRR:12,...options});
}
async function teach(p,on) {
    if((await state(p)).teachingMode===on)return;
    const button=p.locator('#btn-teaching-mode');
    // The narrower Patient drawer overlays header actions. Exercise the native
    // keyboard action without closing Patient or changing its selection.
    if(p.viewportSize().width<1300&&await p.locator('#patient-panel').isVisible()) {
        await button.focus();await p.keyboard.press('Enter');
    } else await button.click();
}
async function patient(p,on) { if(await p.locator('#patient-panel').isVisible()!==on)await p.locator(on?'#btn-patient':'#patient-close').click(); }
async function group(browser,name,fn) {
    if(process.env.VSM_HIERARCHY_GROUP&&!name.startsWith(process.env.VSM_HIERARCHY_GROUP))return;
    const p=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];p.setDefaultTimeout(5000);
    p.on('pageerror',e=>errors.push(String(e)));
    try {await p.goto(url);await p.waitForFunction(()=>window.__vsim);await p.evaluate(()=>__vsim.pause());
        await fn(p);assert.deepEqual(errors,[]);results.push(true);console.log('PASS hierarchy '+name);}
    catch(e){results.push(false);console.error('FAIL hierarchy '+name+'\n'+e.stack);}
    finally{await p.close();}
}
(async()=>{
 const browser=await chromium.launch();
 try {
    await group(browser,'Patient closed default, discoverable toggle, retained choice and fresh reload',async p=>{
        for(const width of [1440,1100,800,390]) {
            await p.setViewportSize({width,height:900});await p.reload();
            await p.waitForFunction(()=>window.__vsim);await p.evaluate(()=>__vsim.pause());
            const button=p.getByRole('button',{name:'Patient',exact:true}),panel=p.locator('#patient-panel');
            assert.equal(await panel.isVisible(),false,'fresh default closed at '+width);
            assert.equal(await button.getAttribute('aria-expanded'),'false');
            assert.equal(await button.getAttribute('aria-controls'),'patient-panel');
            for(const mode of modes)for(const teaching of [false,true]) {
                await setup(p,mode);await teach(p,teaching);
                assert.equal(await panel.isVisible(),false,'mode/Teach retain closed choice');
                assert.equal(await button.isVisible(),true);
                const bounds=await button.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width,'discoverable header action');
                const before=stable(await state(p));
                await button.focus();await p.keyboard.press('Space');
                assert.equal(await panel.isVisible(),true,'one native keyboard action opens Patient');
                assert.equal(await button.getAttribute('aria-expanded'),'true');
                if(width<1300)assert.equal(await p.locator('#patient-close').evaluate(e=>e===document.activeElement),true,'drawer opening focus');
                assert.match(await panel.ariaSnapshot(),/complementary "Patient"/);
                assert.deepEqual(stable(await state(p)),before,'opening cannot change model/history/alarms');
                await p.locator('#patient-close').focus();await p.keyboard.press('Escape');
                assert.equal(await panel.isVisible(),false);
                assert.equal(await button.evaluate(e=>e===document.activeElement),true,'close restores opener focus');
                await button.click();assert.equal(await panel.isVisible(),true,'one pointer action opens Patient');
                await teach(p,!teaching);assert.equal(await panel.isVisible(),true,'Teach retains explicit open choice');
                await p.setViewportSize({width:width===1440?1100:1440,height:900});
                assert.equal(await panel.isVisible(),true,'resize does not apply startup default');
                await p.setViewportSize({width,height:900});
                assert.deepEqual(stable(await state(p)),before,'Teach/resize are presentation only');
                // Exercise Reset's action without moving focus out of the narrow
                // drawer; normal background focus still light-dismisses it.
                await p.locator('#btn-reset').evaluate(e=>e.click());
                assert.equal(await panel.isVisible(),true,'Reset does not reapply startup visibility');
                assert.equal((await state(p)).teachingMode,!teaching);
                assert.deepEqual((await state(p)).resetDiagnostics.configuration,before.settings);
                assert.equal((await state(p)).globalTime,0);
                await p.locator('#patient-close').click();assert.equal(await panel.isVisible(),false);
                await p.locator('#btn-reset').click();assert.equal(await panel.isVisible(),false,'Reset retains closed choice');
            }
            await button.click();assert.equal(await panel.isVisible(),true);
            await p.reload();await p.waitForFunction(()=>window.__vsim);await p.evaluate(()=>__vsim.pause());
            assert.equal(await panel.isVisible(),false,'reload restores initial closed default');
            assert.equal(await button.getAttribute('aria-expanded'),'false');
            assert.equal((await state(p)).teachingMode,false,'reload keeps existing Teach startup contract');
        }
    });
    await group(browser,'exact mode hierarchy, native labels, preview emphasis and stable input identity',async p=>{
        await p.evaluate(()=>{window.hierarchyNodes=[...document.querySelectorAll('.controls input,.controls select')];});
        for(let pass=0;pass<3;pass++)for(const [i,mode] of modes.entries()) {
            await p.locator(`[data-mode="${mode}"]`).click();
            const order=await p.evaluate(()=>['primary','secondary'].map(role=>[...document.querySelectorAll('#'+role+'-settings > .control')]
                .filter(e=>e.getClientRects().length).map(e=>e.dataset.settingId)));
            assert.deepEqual(order,expected[i],mode);
            assert.equal(await p.evaluate(()=>hierarchyNodes.every(e=>document.getElementById(e.id)===e)),true);
            const volumeMode=mode==='vc-cmv'||mode==='pc-cmva';
            assert.equal(await p.locator('#vt').isVisible(),volumeMode,'VT visibility '+mode);
            if(volumeMode) {
                const name=mode==='pc-cmva'?'Target VT':'Tidal Volume';
                assert.equal(await p.locator('#vt-control-label').innerText(),name,'visible VT label '+mode);
                const named=p.getByRole('slider',{name,exact:true});
                assert.equal(await named.getAttribute('id'),'vt','exact accessible VT name '+mode);
                await named.focus();assert.equal(await named.evaluate(e=>e===document.activeElement),true);
                const other=name==='Target VT'?'Tidal Volume':'Target VT';
                assert.equal(await p.getByRole('slider',{name:other,exact:true}).count(),0,'no stale VT name '+mode);
            } else {
                assert.equal(await p.getByRole('slider',{name:/^(Tidal Volume|Target VT)$/}).count(),0,'hidden VT is not exposed '+mode);
            }
            for(const id of expected[i][0]) {
                const input=p.locator('#'+id);await input.focus();assert.equal(await input.evaluate(e=>e===document.activeElement),true);
                const ax=await input.ariaSnapshot();assert.match(ax,/slider ".+"/,'named primary slider '+id);
                assert.ok((await input.getAttribute('aria-describedby')),'units/value accessible '+id);
            }
        }
        const styles=await p.evaluate(()=>{const root=getComputedStyle(document.documentElement),s=getComputedStyle(document.getElementById('primary-settings'));
            return {palette:root.getPropertyValue('--bg-primary').trim(),background:s.backgroundColor,border:s.borderTopColor,width:s.borderTopWidth};});
        assert.equal(styles.background,'rgb(25, 44, 66)');assert.equal(styles.border,'rgb(109, 174, 255)');assert.equal(styles.width,'2px');
        // Current global palette remains byte-identical in the CSS; test the rendered main background too.
        assert.equal(await p.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(11, 15, 20)');
        await setup(p);await p.locator('#vt').focus();await p.keyboard.press('ArrowRight');
        const selected=+(await p.locator('#vt').inputValue());assert.equal((await state(p)).resetDiagnostics.configuration.tidalVolume,selected/1000);
        await teach(p,true);await teach(p,false);assert.equal(+(await p.locator('#vt').inputValue()),selected);
        assert.equal(await p.locator('#hold-duration').evaluate(e=>!!e.closest('.control-group__body')?.querySelector('#hold-toggle')),true,'recurring pause remains in Maneuvers');
    });
    await group(browser,'Teach waveform focus and independent Patient across modes, sizes and repeated toggles',async p=>{
        for(const width of [1440,1100,800,390]) {
            await p.setViewportSize({width,height:900});await patient(p,false);
            for(const mode of modes) {
                await setup(p,mode);await p.evaluate(()=>__vsim.stepTicks(1400));await teach(p,false);
                const standardWidth=await p.locator('.waveforms').evaluate(e=>e.getBoundingClientRect().width);
                const before=stable(await state(p));
                for(let repeat=0;repeat<2;repeat++)for(const pat of [true,false]) {
                    await patient(p,pat);await teach(p,true);
                    assert.equal(await p.locator('.controls').isVisible(),false);
                    assert.equal(await p.locator('#patient-panel').isVisible(),pat);
                    assert.equal(await p.locator('.key-output:visible').count(),7);
                    if(width>850&&!pat)assert.ok(await p.locator('.waveforms').evaluate(e=>e.getBoundingClientRect().width)>standardWidth+200);
                    assert.deepEqual(stable(await state(p)),before);
                    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
                    // Header keyboard path must never land in the hidden settings rail.
                    await p.locator('#btn-teaching-mode').focus();
                    for(let tab=0;tab<8;tab++){await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('.controls')),false);}
                    if(width<1300&&pat) {
                        assert.equal(await p.locator('#patient-panel').isVisible(),false,'leaving the drawer by Tab retains its light-dismiss behavior');
                        await patient(p,true);
                    }
                    await teach(p,false);assert.equal(await p.locator('.controls').isVisible(),true);
                    assert.equal(await p.locator('#patient-panel').isVisible(),pat);assert.deepEqual(stable(await state(p)),before);
                }
            }
        }
    });
    await group(browser,'additional outputs start closed; native keyboard, inner collapse and help work in both views',async p=>{
        const details=p.locator('#additional-outputs'),summary=p.locator('#additional-outputs-summary');
        assert.equal(await details.evaluate(e=>e.open),false);
        assert.equal(await p.locator('#param-live-trapped').isVisible(),false);
        for(const mode of modes)for(const teaching of [false,true]) {
            await setup(p,mode);await teach(p,teaching);
            const before=stable(await state(p));
            await summary.focus();await p.keyboard.press('Space');assert.equal(await details.evaluate(e=>e.open),true);
            await p.locator('#additional-outputs [data-collapsible][data-collapsed]').evaluateAll(es => es.forEach(e => e.click()));
            assert.equal(await p.locator('#param-live-trapped').isVisible(),true);
            const title=p.locator('#additional-outputs [data-collapsible]').first();
            await title.focus();await p.keyboard.press('Enter');assert.equal(await title.getAttribute('aria-expanded'),'false');
            assert.equal(await title.evaluate(e=>e.nextElementSibling.getClientRects().length),0);
            await p.keyboard.press('Space');assert.equal(await title.getAttribute('aria-expanded'),'true');
            // Programmatic close also handles a focused descendant becoming hidden.
            await details.evaluate(e=>{e.open=false;});await p.waitForFunction(()=>document.activeElement.id==='additional-outputs-summary');
            assert.deepEqual(stable(await state(p)),before);
            const help=p.locator('.key-outputs [data-measurement-help="inspired-vt"]');
            await help.focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#measurement-help').isVisible(),true);
            await p.keyboard.press('Escape');assert.equal(await help.evaluate(e=>e===document.activeElement),true);
            await summary.click();assert.equal(await details.evaluate(e=>e.open),true);
            await teach(p,!teaching);assert.equal(await details.evaluate(e=>e.open),true,'selection retained');
            await summary.click();assert.equal(await details.evaluate(e=>e.open),false);
            assert.equal(await p.locator('.key-output:visible').count(),7);
        }
    });
    await group(browser,'settings and pending effort pair survive disclosure, Teach and Patient; genuine alarm unchanged',async p=>{
        await setup(p,'vc-cmv');await p.evaluate(()=>__vsim.stepTicks(40));await patient(p,true);
        await p.locator('#patient-rr').fill('15');await p.locator('#patient-rr').dispatchEvent('input');
        const pending=await state(p);assert.ok(pending.effortTiming.pending,'real next-cycle pair queued');
        const asset=await p.locator('script[src^="js/main.js"]').getAttribute('src');
        await p.evaluate(async version=>{const {default:a}=await import('/alarms.js?'+version);const original=a.evaluateAlarms;
            window.hierarchyAlarmCalls=0;a.evaluateAlarms=(...x)=>{hierarchyAlarmCalls++;return original(...x);};},asset.split('?')[1]);
        async function repeatVisibility(before) {
            for(let i=0;i<3;i++) {
                await teach(p,true);await patient(p,false);await p.locator('#additional-outputs-summary').click();
                await patient(p,true);await teach(p,false);await p.locator('#additional-outputs-summary').click();
                assert.deepEqual(stable(await state(p)),before);
            }
        }
        await repeatVisibility(stable(pending));
        assert.deepEqual((await state(p)).effortTiming.pending,pending.effortTiming.pending,'pending RR/Ti pair retained before any reset');
        assert.equal(await p.evaluate(()=>hierarchyAlarmCalls),0);
        await p.evaluate(()=>__vsim.manualHoldFixture(.6));const holdState=stable(await state(p));assert.ok(holdState.hold);
        const holdCalls=await p.evaluate(()=>hierarchyAlarmCalls);await repeatVisibility(holdState);
        assert.equal(await p.evaluate(()=>hierarchyAlarmCalls),holdCalls);
        await setup(p,'pc-cmv',{resistance:5,compliance:.06,peep_cmH2O:24,inspiratoryPressure:15,respiratoryRate:14,ieRatio:[1,2],pMusMax:12,patientRR:12});
        await p.evaluate(()=>__vsim.stepTicks(1581));const alarmState=stable(await state(p));
        assert.ok(alarmState.alarms.some(a=>a.id==='HIGH_PRESSURE'||a.code==='HIGH_PRESSURE'),JSON.stringify(alarmState.alarms));
        const calls=await p.evaluate(()=>hierarchyAlarmCalls);
        await teach(p,true);await p.locator('#additional-outputs-summary').click();await patient(p,false);await teach(p,false);
        assert.deepEqual(stable(await state(p)),alarmState);assert.equal(await p.evaluate(()=>hierarchyAlarmCalls),calls);
    });
 } finally {await browser.close();}
 const tally={groups:results.length,passed:results.filter(Boolean).length,failed:results.filter(x=>!x).length};
 console.log('SETTING_HIERARCHY_BROWSER_TALLY '+JSON.stringify(tally));
 if(tally.failed||tally.groups!==(process.env.VSM_HIERARCHY_GROUP?1:5))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
