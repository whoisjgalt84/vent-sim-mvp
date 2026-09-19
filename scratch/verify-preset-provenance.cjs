// Standalone focused browser gate; owns an ephemeral server and closes only it.
// Test-only instrumentation is appended by this server, never shipped in main.js.
const fs = require('node:fs');
const path = require('node:path');
const {createServer} = require('node:http');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');

(async () => {
    const root = path.resolve(process.argv[2] || '.');
    const out = path.resolve(process.argv[3] || 'scratch/shots-vsm-clin-009-phase-b/focused-browser');
    const only = process.argv[4] || 'all';
    const capture = process.argv.includes('--capture');
    const {ORACLE,COPY} = await import('../tests/preset-provenance.test.mjs');
    const h = await import('../tests/visual/helpers.js');
    const checks=[], errors=[], observations=[];
    const check=(id,ok,detail)=>{checks.push({id,ok,detail:ok?undefined:detail});if(!ok)throw Error('ASSERT '+id+' '+JSON.stringify(detail));};
    const eq=(id,a,b)=>check(id,JSON.stringify(a)===JSON.stringify(b),{actual:a,expected:b});
    const want=k=>only==='all'||only===k;
    const instrumentation='\nwindow.__presetAudit={get lung(){return lung},get vent(){return vent},get sim(){return sim},get running(){return animFrame!==null},refresh:()=>renderFrame()};';
    let server,browser;
    fs.mkdirSync(out,{recursive:true});
    try {
        server=createServer((req,res)=>{
            const url=new URL(req.url,'http://local');
            const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
            if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
            try {let bytes=fs.readFileSync(file);if(url.pathname==='/js/main.js')bytes=Buffer.from(bytes.toString()+instrumentation);
                res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(bytes);
            }catch{res.writeHead(404);res.end();}
        });
        await new Promise(r=>server.listen(0,'127.0.0.1',r));
        browser=await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
        const context=await browser.newContext({baseURL:'http://127.0.0.1:'+server.address().port,viewport:{width:1440,height:900},hasTouch:true});
        const page=await context.newPage();
        page.on('pageerror',e=>errors.push(String(e)));
        const fresh=async()=>{await h.open(page);await h.expandRail(page);await h.seek(page,0);};
        const current=()=>page.evaluate(()=>{
            const a=window.__presetAudit,s=a.sim;
            return {R:a.lung.resistance,C:a.lung.compliance,tau:a.lung.timeConstant,
                controls:Object.fromEntries([...document.querySelectorAll('input,select')].map(e=>[e.id,e.value])),
                label:document.getElementById('mechanics-example-state')?.textContent,
                time:s.globalTime,completed:s.lastCompletedBreath,delivery:s.deliveredVentilation,
                events:s.triggerEvents,breaths:s.breathCount,running:a.running,
                vent:Object.fromEntries(Object.entries(a.vent).filter(([k])=>k!=='lung'))};
        });
        const shot=async name=>{
            const observation={name,...await current()};observations.push(observation);
            if(capture){
                // Pause is already deterministic; wait for scroll/focus/CSS paint
                // to settle too, as Playwright's screenshot matcher does.
                let previous=null,stable=null;
                for(let attempt=1;attempt<=8;attempt++){
                    const bytes=await page.screenshot({fullPage:true,animations:'disabled',caret:'hide'});
                    if(previous?.equals(bytes)){stable=bytes;observation.captureAttempts=attempt;break;}
                    previous=bytes;await page.waitForTimeout(100);
                }
                if(!stable)throw Error('SCREENSHOT_STABILITY '+name);
                fs.writeFileSync(path.join(out,name+'.png'),stable);
            }
        };
        await fresh();
        if(want('startup')) {
            const s=await current();eq('D11.startup-model-C',s.C,.060);eq('D11.startup-control-C',s.controls.compliance,'60');
            eq('D11.startup-display-C',await page.locator('#compliance-display').textContent(),'60 mL/cmH₂O');
            eq('D11.startup-R',s.R,10);eq('D11.startup-label',s.label,'Normal example');
            eq('D10.selector-label',await page.locator('#load-mechanics-example').textContent(),'Load example');
            eq('D10.selector-label-association',await page.locator('#preset').getAttribute('aria-labelledby'),'load-mechanics-example');
            eq('D10.disclosure',await page.locator('#mechanics-example-disclosure').textContent(),COPY.disclosure);
            eq('D10.description',await page.locator('#mechanics-example-description').textContent(),COPY.description);
            eq('D9.limits',await page.evaluate(()=>['resistance','compliance'].map(id=>{const e=document.getElementById(id);return [e.min,e.max,e.step];})),[['5','40','1'],['15','100','1']]);
            await page.locator('#mechanics-bar').scrollIntoViewIfNeeded();
            check('D11.startup-control-in-view',await page.locator('#compliance-display').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
            await shot('startup-patient-C60');
        }
        if(want('rows'))for(const row of ORACLE) {
            await page.selectOption('#preset',row.key);await page.evaluate(()=>window.__vsim.redraw());
            const s=await current();eq('row.'+row.key+'.R',s.R,row.resistance);eq('row.'+row.key+'.C',s.C,row.compliance);
            eq('row.'+row.key+'.display-C',await page.locator('#compliance-display').textContent(),Math.round(row.compliance*1000)+' mL/cmH₂O');
            eq('row.'+row.key+'.display-R',await page.locator('#resistance-display').textContent(),row.resistance+' cmH₂O·s/L');
            eq('row.'+row.key+'.option',await page.locator('#preset option:checked').textContent(),row.label);
            eq('row.'+row.key+'.identity',s.label,row.label);
            eq('row.'+row.key+'.tau',s.tau,row.resistance*row.compliance);
            eq('row.'+row.key+'.tau-description',await page.locator('#mechanics-bar .mechanics-chip').first().getAttribute('aria-description'),COPY.tau);
            await shot(row.key+'-selected');
            await page.locator('#mechanics-example-help').click();
            check('row.'+row.key+'.help-visible',await page.locator('#measurement-help').isVisible());
            eq('row.'+row.key+'.help',await page.locator('#measurement-help-text').textContent(),[row.note,COPY.common,COPY.units,COPY.tau].join('\n\n'));
            eq('row.'+row.key+'.source-visible',await page.locator('#mechanics-example-source').isVisible(),row.key==='copd');
            if(row.key==='copd')eq('COPD.source-link',await page.locator('#mechanics-example-source').getAttribute('href'),'https://doi.org/10.4187/respcare.05775');
            await shot(row.key+'-help');await page.keyboard.press('Escape');
        }
        if(want('selection'))for(const mode of ['vc-cmv','pc-cmv','PC-CSV']) {
            await fresh();await h.setMode(page,mode);await h.enableEffort(page,{patientRR:22,pmus:6});
            for(const row of ORACLE){await h.seek(page,36);const before=await current();
                await page.selectOption('#preset',row.key);const after=await current();
                const stable=s=>({time:s.time,completed:s.completed,delivery:s.delivery,events:s.events,breaths:s.breaths,running:s.running,vent:s.vent,controls:Object.fromEntries(Object.entries(s.controls).filter(([k])=>!['preset','resistance','compliance'].includes(k)))});
                eq('selection.retains-history-and-settings.'+mode+'.'+row.key,stable(after),stable(before));
                eq('selection.pair.'+mode+'.'+row.key,[after.R,after.C],[row.resistance,row.compliance]);
                await page.locator('#preset').dispatchEvent('change');eq('selection.same-pair-retains.'+mode+'.'+row.key,stable(await current()),stable(after));
            }
        }
        if(want('custom')) {
            await fresh();await page.selectOption('#preset','copd');await h.setRange(page,'#compliance',41);
            eq('D12.C-edit-label',(await current()).label,'Custom mechanics');
            await h.setRange(page,'#resistance',17);eq('D12.R-edit-label',(await current()).label,'Custom mechanics');
            eq('D12.last-example',await page.locator('#preset').inputValue(),'copd');
            await page.locator('#mechanics-example-help').click();
            eq('D12.custom-help',await page.locator('#measurement-help-text').textContent(),[COPY.custom,COPY.common,COPY.units,COPY.tau].join('\n\n'));
            eq('D12.no-current-COPD-source',await page.locator('#mechanics-example-source').isVisible(),false);
            await shot('custom-R17-C41-help');await page.keyboard.press('Escape');
            for(const mode of ['pc-cmv','PC-CSV','vc-cmv']){await h.setMode(page,mode);const s=await current();eq('D12.mode-reset-retains.'+mode,[s.R,s.C,s.label],[17,.041,'Custom mechanics']);eq('reset.canonical-cleared.'+mode,s.completed,null);}
            for(const flow of ['ramp','square']){await page.click('[data-pattern="'+flow+'"]');const s=await current();eq('D12.flow-reset-retains.'+flow,[s.R,s.C,s.label],[17,.041,'Custom mechanics']);}
            await h.seek(page,0);eq('D12.seek-reset-label',(await current()).label,'Custom mechanics');await page.locator('#mechanics-bar').scrollIntoViewIfNeeded();await shot('custom-after-resets');
            // Native selection of an already selected option fires no change.
            // The Load example button must reload it using real keyboard input.
            await page.locator('#load-mechanics-example').focus();await page.keyboard.press('Enter');
            eq('D12.keyboard-reload-last-example',[(await current()).R,(await current()).C,(await current()).label],[25,.060,'COPD example (HME)']);
            await h.setRange(page,'#compliance',41);await page.locator('#load-mechanics-example').click();
            eq('D12.pointer-reload-last-example',[(await current()).C,(await current()).label],[.060,'COPD example (HME)']);
            for(const row of ORACLE){await page.selectOption('#preset',row.key);eq('D12.reload-restores.'+row.key,(await current()).label,row.label);await h.setRange(page,'#resistance',17);}
        }
        if(want('hold')) {
            await fresh();await page.selectOption('#preset','normal');await page.click('#hold-toggle');await h.setRange(page,'#hold-duration',5);await h.seek(page,0);
            const valid=await page.evaluate(()=>{for(let n=0;n<800;n++){window.__vsim.step(.01);if(window.__presetAudit.sim.holdMechanics.pplat.status==='valid')return true;}return false;});
            check('CLIN005.valid-hold-control',valid);
            const before=await page.evaluate(()=>({generation:window.__presetAudit.sim.settingsGeneration,record:window.__presetAudit.sim.lastCompletedBreath}));
            // The away-and-back sequence is essential: a one-way change also
            // invalidates via the live fingerprint even without notification.
            await page.selectOption('#preset','ards_severe');await page.selectOption('#preset','normal');
            const after=await page.evaluate(()=>({generation:window.__presetAudit.sim.settingsGeneration,hold:window.__presetAudit.sim.holdMechanics,record:window.__presetAudit.sim.lastCompletedBreath}));
            check('CLIN005.away-back-stale-hold',after.hold.pplat.status!=='valid',after.hold);
            eq('CLIN005.two-settings-generations',after.generation,before.generation+2);eq('CLIN005.canonical-record-retained',after.record,before.record);
        }
        if(want('help')) {
            await fresh();await page.selectOption('#preset','copd');
            const trigger=page.locator('#mechanics-example-help'),popover=page.locator('#measurement-help');
            eq('D10.help-accessible-name',await trigger.getAttribute('aria-label'),'About mechanics examples');
            eq('D10.selector-association',await page.locator('#preset').getAttribute('aria-describedby'),'mechanics-example-disclosure mechanics-example-description');
            await trigger.hover();check('help.hover-open',await popover.isVisible());await popover.hover();await page.waitForTimeout(220);check('help.hover-transfer',await popover.isVisible());
            await page.keyboard.press('Escape');await trigger.focus();await trigger.press('Enter');check('help.keyboard-open',await popover.isVisible());
            eq('help.heading',await page.locator('#mechanics-example-help-heading').textContent(),'Mechanics examples');
            eq('help.dialog-role',await popover.getAttribute('role'),'dialog');
            await page.keyboard.press('Tab');await page.waitForTimeout(220);check('help.source-keyboard-reachable',await page.locator('#mechanics-example-source').evaluate(e=>e===document.activeElement)&&await popover.isVisible());
            await page.keyboard.press('Shift+Tab');eq('help.source-back-to-trigger',await trigger.evaluate(e=>e===document.activeElement),true);
            await page.keyboard.press('Tab');await page.keyboard.press('Tab');eq('help.source-forward-to-selector',await page.locator('#preset').evaluate(e=>e===document.activeElement),true);
            eq('help.forward-dismisses',await popover.isVisible(),false);await trigger.focus();await trigger.press('Enter');await page.keyboard.press('Tab');
            await page.keyboard.press('Escape');eq('help.escape-focus',await trigger.evaluate(e=>e===document.activeElement),true);eq('help.escape-stays-closed',await popover.isVisible(),false);
            await trigger.tap();check('help.touch-open',await popover.isVisible());await trigger.tap();eq('help.touch-close',await popover.isVisible(),false);
            await h.enableEffort(page);await h.teachingMode(page);await h.seek(page,14);
            await page.evaluate(()=>{window.__staticHelp=[...document.querySelectorAll('.measurement-help-trigger')];window.__staticRR=[...document.querySelectorAll('#param-rr .rr-triple__line,#param-rr .rr-triple__cell')];});
            await page.evaluate(()=>{for(let n=0;n<50;n++)window.__vsim.redraw();});
            check('CLIN005.static-help-nodes',await page.evaluate(()=>window.__staticHelp.every((e,i)=>e===document.querySelectorAll('.measurement-help-trigger')[i])));
            check('CLIN006.static-RR-nodes',await page.evaluate(()=>window.__staticRR.length>0&&window.__staticRR.every((e,i)=>e===document.querySelectorAll('#param-rr .rr-triple__line,#param-rr .rr-triple__cell')[i])));
            eq('D10.teaching-rail-hidden',await trigger.isVisible(),false);eq('D10.hidden-trigger-closes',await popover.isVisible(),false);
            await shot('teaching-preserved');await h.teachingMode(page);
            await page.setViewportSize({width:390,height:240});await trigger.scrollIntoViewIfNeeded();await trigger.click();await trigger.press('End');
            const scroll=await popover.evaluate(e=>({height:e.scrollHeight,client:e.clientHeight,top:e.scrollTop,hidden:e.hidden}));
            check('help.short-viewport-scrolls',!scroll.hidden&&scroll.height>scroll.client&&scroll.top>0,scroll);await shot('help-short-viewport-end');
            await page.keyboard.press('Escape');await page.setViewportSize({width:1440,height:900});
            const ax=await context.newCDPSession(page);fs.writeFileSync(path.join(out,'accessibility.json'),JSON.stringify(await ax.send('Accessibility.getFullAXTree'),null,2));
        }
        check('INFRA.no-page-errors',errors.length===0,errors);
    }catch(error){if(!checks.some(c=>!c.ok))checks.push({id:'INFRA.completed-run',ok:false,detail:String(error)});console.error(error.stack);process.exitCode=1;}
    finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
    const result={root,only,platform:process.platform,passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks,errors,observations};
    fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify({passed:result.passed,failed:result.failed,failedIds:checks.filter(c=>!c.ok).map(c=>c.id)}));
})().catch(error=>{console.error(error);process.exitCode=1;});
