/** Seven bounded UI cleanup groups. Ephemeral server; never writes snapshots.
 * Usage: node scratch/verify-ui-cleanup.cjs [source-root] [group-name]
 * Runtime instrumentation stays in this test server, never in production.
 */
const strictAssert = require('node:assert/strict');
const assertionAudit = [], auditEnabled = !!process.env.UI_CLEANUP_ASSERTION_AUDIT;
let currentGroup = 'inventory';
function check(method, args) {
    let error;
    try { (method === 'ok' ? strictAssert : strictAssert[method])(...args); }
    catch (failure) { error = failure; }
    if (auditEnabled) assertionAudit.push({group:currentGroup,method,
        location:new Error().stack.split('\n')[3]?.trim(),
        message:typeof args.at(-1)==='string'?args.at(-1):null,passed:!error});
    if (error && !(auditEnabled && process.env.UI_CLEANUP_MUTATION_CONTINUE)) throw error;
}
// Optional mutation auditing records individual assertions, including checks
// after a detected presentation fault; normal verification remains fail-fast.
const assert = new Proxy((...args)=>check('ok',args), {
    get:(_,method)=>(...args)=>check(method,args),
});
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const only = process.argv[3];
const disclosure = 'Simulation examples; not disease reference values.';
const keys = ['normal','obesity','ards_moderate','fibrosis','ards_severe','asthma','copd'];
const modes = ['vc-cmv','pc-cmv','PC-CSV','pc-cmva'];
const results = [];
const state = page => page.evaluate(() => window.__vsim.state());
// Accept existing display typography without weakening numeric/unit assertions.
const text = async locator => (await locator.textContent()).replaceAll('\u2082','2');
const fresh = async page => {
    await page.goto('/index.html');
    await page.waitForFunction(() => window.__vsim);
    await page.evaluate(() => {
        window.__vsim.pause();
        document.querySelectorAll('.controls [data-collapsed]').forEach(e => e.click());
        window.__vsim.seek(14);
    });
};
const range = async (page,id,value) => {
    await page.locator('#'+id).fill(String(value));
    await page.locator('#'+id).dispatchEvent('input');
};
const snapshot = page => page.evaluate(() => {
    const a=window.__uiAudit;
    return {R:a.lung.resistance,C:a.lung.compliance,time:a.sim.globalTime,
        completed:a.sim.lastCompletedBreath,events:a.sim.triggerEvents,
        delivery:a.sim.deliveredVentilation,settings:window.__vsim.state().resetDiagnostics.configuration};
});
const stable = s => {const copy={...s};delete copy.R;delete copy.C;return copy;};
async function ax(page,selector) {
    const session=await page.context().newCDPSession(page);
    try {
        const {root}=await session.send('DOM.getDocument');
        const {nodeId}=await session.send('DOM.querySelector',{nodeId:root.nodeId,selector});
        const {nodes}=await session.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
        return nodes.find(n=>!n.ignored);
    } finally {await session.detach();}
}
const groups = [
    ['trigger-presentation',async page=>{
        assert.equal(await page.locator('#trigger-display').count(),0,'upper trigger readout removed');
        const cardStyle=selector=>page.locator(selector).evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,border:s.border,padding:s.padding,radius:s.borderRadius,opacity:s.opacity};});
        for(const selector of ['#fio2-control','.trigger-control'])assert.deepEqual(await cardStyle(selector),await cardStyle('#vt-control'),'matching existing setting card '+selector);
        const fio2AX=await ax(page,'#fio2');assert.equal(fio2AX.role.value,'slider');assert.equal(fio2AX.name.value,'FiO2');assert.equal(fio2AX.description.value,'40%');
        const gap=await page.locator('.trigger-control .control__header').evaluate(e=>{
            const label=e.querySelector('.control__label').getBoundingClientRect();
            const icon=e.querySelector('button').getBoundingClientRect();return icon.left-label.right;
        });
        assert(gap>=7.5 && gap<=8.5,'explicit 8px Trigger/icon gap');
        for(const [type,value,unit] of [['flow','2.0','L/min'],['pressure','1.0','cmH2O']]) {
            await page.click(`[data-trigger-type="${type}"]`);
            assert(await page.locator('#'+type+'-trigger-row').isVisible(),'selected slider visible');
            assert.equal(await page.locator('#'+(type==='flow'?'pressure':'flow')+'-trigger-row').isVisible(),false);
            assert.equal(await text(page.locator('#'+type+'-trigger-display')),value+' '+unit);
            assert.equal(await page.locator('.trigger-control .control__value:visible').count(),1,'one inline readout');
            const accessibility=await ax(page,'#'+type+'-trigger');
            assert.equal(accessibility.role.value,'slider');
            assert.equal(accessibility.name.value,(type==='flow'?'Flow':'Pressure')+' trigger sensitivity');
            assert(accessibility.description.value.replaceAll('\u2082','2').includes(value+' '+unit),'inline value/units accessible');
        }
    }],
    ['trigger-native-input',async page=>{
        for(const type of ['flow','pressure']) {
            await page.click(`[data-trigger-type="${type}"]`);
            const input=page.locator('#'+type+'-trigger');
            const field=type==='flow'?'flowTriggerLpm':'pressureTriggerCmH2O';
            await input.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
            assert.equal(+(await input.inputValue()),.6,'native keyboard tenth-step');
            assert.equal((await state(page)).resetDiagnostics.configuration[field],.6,'keyboard changes retained setting');
            await input.scrollIntoViewIfNeeded();const box=await input.boundingBox();
            await input.evaluate(e=>{window.__triggerInputs=[];e.addEventListener('input',event=>window.__triggerInputs.push({value:+e.value,trusted:event.isTrusted}));});
            await page.mouse.move(box.x+8,box.y+box.height/2);await page.mouse.down();
            await page.mouse.move(box.x+box.width-8,box.y+box.height/2,{steps:20});await page.mouse.up();
            const events=await page.evaluate(()=>window.__triggerInputs);
            assert(events.length>=5 && events.every(e=>e.trusted),'nonvacuous trusted native pointer input');
            assert.equal((await state(page)).resetDiagnostics.configuration[field],+(await input.inputValue()),'pointer/model agreement');
            assert.equal(await text(page.locator('#'+type+'-trigger-display')),Number(await input.inputValue()).toFixed(1)+' '+(type==='flow'?'L/min':'cmH2O'));
        }
        const fio2=page.locator('#fio2');await fio2.focus();await page.keyboard.press('ArrowRight');
        assert.equal(+(await fio2.inputValue()),41,'FiO2 native keyboard step');assert.equal((await state(page)).resetDiagnostics.configuration.fio2,.41,'FiO2 keyboard/model agreement');assert.equal(await page.locator('#fio2-display').textContent(),'41%','FiO2 keyboard units');
        await fio2.scrollIntoViewIfNeeded();const fio2Box=await fio2.boundingBox();await fio2.evaluate(e=>{window.__fio2Inputs=[];e.addEventListener('input',event=>window.__fio2Inputs.push(event.isTrusted));});
        await page.mouse.move(fio2Box.x+8,fio2Box.y+fio2Box.height/2);await page.mouse.down();await page.mouse.move(fio2Box.x+fio2Box.width-8,fio2Box.y+fio2Box.height/2,{steps:20});await page.mouse.up();
        const fio2Events=await page.evaluate(()=>window.__fio2Inputs);assert(fio2Events.length>=5 && fio2Events.every(Boolean),'FiO2 trusted native pointer input');assert.equal((await state(page)).resetDiagnostics.configuration.fio2,+(await fio2.inputValue())/100,'FiO2 pointer/model agreement');assert.equal(await page.locator('#fio2-display').textContent(),(await fio2.inputValue())+'%','FiO2 pointer units');
        const before=(await state(page)).resetDiagnostics.configuration;await page.click('#btn-reset');
        const after=(await state(page)).resetDiagnostics.configuration;
        for(const field of ['triggerType','flowTriggerLpm','pressureTriggerCmH2O']) assert.equal(after[field],before[field],'reset retains trigger '+field);
    }],
    ['mechanics-group-order',async page=>{
        const groups=await page.locator('#preset').evaluate(e=>[...e.children].map(g=>({label:g.label,keys:[...g.children].map(o=>o.value)})));
        assert.deepEqual(groups,[{label:'Reference',keys:['normal']},{label:'Compliance examples',keys:keys.slice(1,5)},{label:'Resistance examples',keys:keys.slice(5)}]);
        const {ORACLE}=await import('../tests/preset-provenance.test.mjs');
        assert.deepEqual(await page.locator('#preset option').evaluateAll(els=>els.map(e=>e.value)),keys,'all seven stable keys ordered');
        for(const key of keys) {
            const row=ORACLE.find(r=>r.key===key),before=await snapshot(page);
            await page.selectOption('#preset',key);const after=await snapshot(page);
            assert.deepEqual([after.R,after.C],[row.resistance,row.compliance],'exact independent paired mechanics '+key);
            assert.deepEqual(stable(after),stable(before),'load keeps settings/history '+key);
            assert.equal(await page.locator('#preset option:checked').textContent(),row.label,'approved label '+key);
            assert.equal(await page.locator('#mechanics-example-state').textContent(),'');
            assert.equal(await page.locator('#mechanics-example-state').isVisible(),false,'no duplicate preset label');
        }
        await page.locator('#preset').focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');
        assert.equal(await page.locator('#preset').inputValue(),'obesity','native keyboard crosses Reference group');
        const current=await snapshot(page);assert.deepEqual([current.R,current.C],[8,.040]);
    }],
    ['custom-mechanics-reset-reload',async page=>{
        await page.selectOption('#preset','copd');
        for(const id of ['resistance','compliance']) {
            await page.click('#load-mechanics-example');await range(page,id,id==='resistance'?17:41);
            assert(await page.locator('#mechanics-example-state').isVisible(),'manual '+id+' edit shows warning');
            assert.equal(await page.locator('#mechanics-example-state').textContent(),'Custom mechanics');
            assert.equal(await page.locator('#preset').inputValue(),'copd','last loaded selector retained');
        }
        await range(page,'resistance',17);
        for(const mode of modes) {
            await page.click(`.mode-btn[data-mode="${mode}"]`);await page.click('#btn-reset');
            const s=await snapshot(page);assert.deepEqual([s.R,s.C],[17,.041]);
            assert(await page.locator('#mechanics-example-state').isVisible(),'Custom mechanics survives Reset '+mode);
            assert.equal(await page.locator('#mechanics-example-state').textContent(),'Custom mechanics');
            assert.equal(await page.locator('#preset').inputValue(),'copd');
        }
        await page.locator('#load-mechanics-example').focus();await page.keyboard.press('Enter');
        assert.deepEqual([(await snapshot(page)).R,(await snapshot(page)).C],[25,.060],'same-preset keyboard reload exact pair');
        assert.equal(await page.locator('#mechanics-example-state').isVisible(),false);
        await page.evaluate(()=>window.__vsim.seek(14));
        await range(page,'resistance',17);const before=await snapshot(page);
        assert(before.time>0 && before.completed!==null,'reload starts with completed history');
        await page.click('#load-mechanics-example');
        assert.deepEqual(stable(await snapshot(page)),stable(before),'pointer reload keeps history/settings');
        assert.equal((await snapshot(page)).R,25);assert.equal(await page.locator('#mechanics-example-state').isVisible(),false);
        await range(page,'resistance',17);await range(page,'resistance',25);
        assert(await page.locator('#mechanics-example-state').isVisible(),'manual edit/revert still custom until explicit reload');
    }],
    ['mechanics-disclaimer-and-help',async page=>{
        assert.equal(await page.locator('#mechanics-example-disclosure').isVisible(),false,'disclaimer moved off rail');
        const accessibility=await ax(page,'#preset');
        assert(accessibility.description.value.includes(disclosure),'disclaimer remains in accessible selector description');
        assert(accessibility.description.value.includes('The selector retains the last loaded example.'),'historical-selection description retained');
        const help=page.locator('#mechanics-example-help'),popover=page.locator('#measurement-help');
        await page.selectOption('#preset','copd');await help.hover();assert(await popover.isVisible());
        await popover.hover();await page.waitForTimeout(220);assert(await popover.isVisible(),'hover transfer');await page.keyboard.press('Escape');
        await help.focus();await page.keyboard.press('Enter');
        assert(await popover.isVisible(),'keyboard opens help');
        assert((await page.locator('#measurement-help-text').textContent()).startsWith(disclosure+'\n\n'),'disclaimer is first help paragraph');
        assert(await page.locator('#mechanics-example-source').isVisible(),'COPD source retained');
        await page.keyboard.press('Tab');
        assert(await page.locator('#mechanics-example-source').evaluate(e=>e===document.activeElement),'source link keyboard reachable');
        await page.keyboard.press('Escape');assert.equal(await popover.isVisible(),false);
        assert(await help.evaluate(e=>e===document.activeElement),'Escape restores trigger focus');
        await page.evaluate(()=>window.__vsim.redraw());assert.equal(await popover.isVisible(),false,'refresh does not reopen');
        await help.tap();assert(await popover.isVisible());await page.locator('#btn-reset').click();assert.equal(await popover.isVisible(),false,'outside click dismisses');
        await range(page,'resistance',17);await help.click();
        assert((await page.locator('#measurement-help-text').textContent()).includes('R or C has been edited.'));
        assert.equal(await page.locator('#mechanics-example-source').isVisible(),false,'custom mechanics has no current COPD attribution');
        await page.click('#btn-teaching-mode');assert.equal(await popover.isVisible(),false,'hidden rail trigger dismisses help');
        await page.click('#btn-teaching-mode');await help.click();assert(await popover.isVisible(),'help works after returning from Teaching');
    }],
    ['effort-single-state',async page=>{
        assert.equal(await page.locator('#pmus-display').count(),0,'upper Pmus/Off row removed');
        const toggle=page.locator('#pmus-toggle');
        for(const mode of modes) {
            // Exit adaptive with nonzero effort; known zero-effort exit remains deferred.
            await page.click(`.mode-btn[data-mode="${mode}"]`);
            if((await state(page)).operatorSettings.patientRR>0)await toggle.click();
            assert.equal(await page.locator('#pmus-btn-label').textContent(),'Passive');
            assert.equal(await toggle.getAttribute('aria-pressed'),'false');
            assert.equal((await ax(page,'#pmus-toggle')).name.value,'Patient effort Passive');
            assert.equal(await page.locator('#pmus-sliders').isVisible(),false);
            await toggle.focus();await page.keyboard.press('Space');
            assert.equal(await page.locator('#pmus-btn-label').textContent(),'Active');
            assert.equal(await toggle.getAttribute('aria-pressed'),'true');
            assert.equal((await ax(page,'#pmus-toggle')).name.value,'Patient effort Active');
            assert(await page.locator('#pmus-sliders').isVisible());
            await range(page,'pmus-max',8);assert.equal((await state(page)).operatorSettings.pMusMax,8);
            assert.equal(await text(page.locator('#pmus-max-display')),'8 cmH2O');
            assert.equal((await ax(page,'#pmus-max')).name.value,'Effort');
            if(mode==='pc-cmva') {
                assert.equal(await page.locator('#pmus-max').getAttribute('min'),'0','adaptive effort permits zero');
                await range(page,'pmus-max',0);assert.equal((await state(page)).operatorSettings.pMusMax,0);
                assert.equal(await text(page.locator('#pmus-max-display')),'0 cmH2O');
                assert.equal(await page.locator('#pmus-btn-label').textContent(),'Active','configured zero amplitude preserves existing active state');
                await range(page,'pmus-max',8);
            }
            await page.click('#btn-reset');assert.equal(await page.locator('#pmus-btn-label').textContent(),'Active');
            assert.equal((await state(page)).operatorSettings.pMusMax,8,'Reset retains effort');
            await toggle.click();assert.equal((await state(page)).operatorSettings.patientRR,0);
            assert.equal((await state(page)).operatorSettings.pMusMax,0);
            await toggle.click();assert.equal((await state(page)).operatorSettings.pMusMax,8,'reactivation retains native slider amplitude');
        }
    }],
    ['narrow-layout-and-views',async page=>{
        for(const width of [1440,1000,800]) {
            await page.setViewportSize({width,height:900});await fresh(page);
            const spacing=()=>page.locator('#preset').evaluate(e=>document.getElementById('compliance').parentElement.querySelector('.control__header').getBoundingClientRect().top-e.getBoundingClientRect().bottom);
            assert((await spacing())>=8,'mechanics dropdown spacing '+width);
            await page.click('#pmus-toggle');
            await range(page,'pmus-max',11.75);await range(page,'resistance',17);
            assert.equal(await page.locator('#preset').evaluate(e=>parseFloat(getComputedStyle(e).marginBottom)),8,'custom mechanics dropdown spacing '+width);
            for(const selector of ['#fio2-control','.trigger-control','#preset','#mechanics-example-state','#pmus-sliders']) {
                await page.locator(selector).scrollIntoViewIfNeeded();
                const geometry=await page.locator(selector).evaluate(e=>{
                    const r=e.getBoundingClientRect(),rail=document.querySelector('.controls').getBoundingClientRect();
                    return {left:r.left,right:r.right,railLeft:rail.left,railRight:rail.right,overflow:e.scrollWidth>e.clientWidth+1};
                });
                assert(geometry.left>=geometry.railLeft-.5 && geometry.right<=geometry.railRight+.5,'rail containment '+width+' '+selector);
                assert.equal(geometry.overflow,false,'no clipped content '+width+' '+selector);
            }
            await page.click('[data-measurement-help="trigger-signal"]');
            assert(await page.locator('#measurement-help').isVisible());await page.keyboard.press('Escape');
            await page.click('#btn-teaching-mode');assert.equal(await page.locator('.controls').isVisible(),false);
            await page.evaluate(()=>window.__vsim.redraw());await page.click('#btn-teaching-mode');
            assert(await page.locator('#mechanics-example-state').isVisible(),'custom warning returns in Standard');
            assert.equal(await page.locator('#pmus-max').inputValue(),'11.75');
        }
    }],
];
(async()=>{
    assert.equal(groups.length,7,'bounded group inventory');
    if(only)assert(groups.some(([name])=>name===only),'unknown group');
    const server=createServer((req,res)=>{
        const url=new URL(req.url,'http://local'),file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
        if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
        try {let bytes=fs.readFileSync(file);
            if(url.pathname==='/js/main.js') bytes=Buffer.from(bytes.toString()+'\nwindow.__uiAudit={get lung(){return lung},get sim(){return sim}};');
            res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(bytes);
        } catch {res.writeHead(404);res.end();}
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
    try {
        browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
        for(const [name,run] of groups.filter(([name])=>!only||name===only)) {
            currentGroup = name;
            const auditStart = assertionAudit.length;
            const context=await browser.newContext({baseURL:'http://127.0.0.1:'+server.address().port,viewport:{width:1440,height:900},hasTouch:true});
            const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
            page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))errors.push(r.status()+' '+r.url());});
            try {await fresh(page);await run(page);assert.deepEqual(errors,[],'application/network errors');
                if (assertionAudit.slice(auditStart).some(check=>!check.passed)) throw Error('Individual assertion audit detected a fault');
                results.push({name,passed:true});console.log('PASS UI cleanup '+name);}
            catch(error){results.push({name,passed:false,error:error.message,errors});console.error('FAIL UI cleanup '+name+': '+error.stack);}
            finally{await context.close();}
        }
    } finally {await browser?.close();await new Promise(r=>server.close(r));}
    const tally={groups:results.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length};
    if (auditEnabled) console.log('UI_CLEANUP_ASSERTION_AUDIT '+JSON.stringify(assertionAudit));
    console.log('UI_CLEANUP_BROWSER_TALLY '+JSON.stringify(tally));if(tally.failed || assertionAudit.some(check=>!check.passed))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
