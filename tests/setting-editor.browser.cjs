const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.VSM_EDITOR_URL || 'http://127.0.0.1:8899';
const modes = ['vc-cmv','pc-cmv','PC-CSV','pc-cmva'];
const applicable = {'vc-cmv':['vt','rr','peep','fio2'],'pc-cmv':['pinsp','rr','peep','fio2'],'PC-CSV':['ps-pressure','peep','fio2'],'pc-cmva':['vt','rr','peep','fio2']};
// Independent existing control contracts, not expectations copied from runtime attributes.
const specs = {
 vt: {mode:'vc-cmv',min:200,max:800,step:10,unit:'mL',field:'tidalVolume',scale:.001},
 rr: {mode:'vc-cmv',min:6,max:35,step:1,unit:'/min',field:'respiratoryRate',scale:1},
 peep: {mode:'vc-cmv',min:0,max:24,step:1,unit:'cmH2O',field:'peep',scale:1},
 fio2: {mode:'vc-cmv',min:21,max:100,step:1,unit:'%',field:'fio2',scale:.01},
 pinsp: {mode:'pc-cmv',min:5,max:35,step:1,unit:'cmH2O',field:'inspiratoryPressure',scale:1},
 'ps-pressure': {mode:'PC-CSV',min:5,max:30,step:1,unit:'cmH2O',field:'psPressure',scale:1},
};
const state = p => p.evaluate(()=>__vsim.state());
const config = s => s.resetDiagnostics.configuration;
const stable = s => ({configuration:config(s),operatorSettings:s.operatorSettings,inputRevision:s.inputRevision,adaptive:s.adaptiveState,hold:s.manualHold,history:s.lastValidManualHold,completed:s.completed,time:s.globalTime,alarms:s.activeAlarms});
const setup = (p,mode='vc-cmv')=>p.evaluate(mode=>__vsim.setupEffort({mode,pMusMax:0,patientRR:0}),mode);
const open = (p,id='vt')=>p.locator('#'+id+'-tile').click();
const fill = (p,value)=>p.locator('#setting-draft').fill(String(value));
const confirm = p=>p.locator('#setting-confirm').click();
const cancel = p=>p.locator('#setting-cancel').click();
const tick = (p,n)=>p.evaluate(n=>__vsim.stepTicks(n),n);
const change = (p,id,value)=>p.locator('#'+id).evaluate((e,value)=>{e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));},String(value));
let passed=0,failed=0;
(async()=>{
 const browser=await chromium.launch();
 async function group(name,fn){if(process.env.VSM_EDITOR_GROUP&&!name.startsWith(process.env.VSM_EDITOR_GROUP))return;const p=await browser.newPage({viewport:{width:1440,height:900},hasTouch:true}),errors=[];p.setDefaultTimeout(5000);p.on('pageerror',e=>errors.push(String(e)));
  try{
   if(process.env.VSM_EDITOR_MUTATION)await p.route('**/js/main.js*',async route=>{
    const response=await route.fetch();let body=(await response.text()).replace(/\r\n/g,'\n');
    const patches={
     notification:["    sim.notifyMeasurementSettingsChanged();\n    updateMonitorValues(vent.summary()); updateHoldResults();\n}\nfunction refreshSettingEditor", "    updateMonitorValues(vent.summary()); updateHoldResults();\n}\nfunction refreshSettingEditor"],
     immediate:["    settingDraft.text = text;", "    settingDraft.text = text; if (settingDraft.id === 'vt' && Number(text) >= 200) vent.tidalVolume = Number(text)/1000;"],
     rrImmediate:["    settingDraft.text = text;", "    settingDraft.text = text; if (settingDraft.id === 'rr' && Number(text) >= 6) vent.respiratoryRate = Number(text);"],
     adaptiveImmediate:["    if (vent.isAdaptiveMode()) sim.requestAdaptiveSettings({ targetVT_mL: vtMl });", "    if (vent.isAdaptiveMode()) vent.tidalVolume = vtMl / 1000;"],
     unchanged:["    if (value === accepted) return; // Unchanged confirmation", "    if (false) return; // Unchanged confirmation"],
     validation:["&& Number.isInteger((value - min) / step) ? value : null;", "? value : null;"],
    };
    const patch=patches[process.env.VSM_EDITOR_MUTATION];assert.ok(patch&&body.includes(patch[0]),'mutation target exists');
    body=body.replace(patch[0],patch[1]);await route.fulfill({response,body});
   });
   await p.goto(url);await p.waitForFunction(()=>window.__vsim);await setup(p);await fn(p);assert.deepEqual(errors,[]);passed++;console.log('PASS editor '+name);}
  catch(e){failed++;console.error('FAIL editor '+name+'\n'+e.stack);}finally{await p.close();}}
 await group('open focus navigation and unchanged Confirm are inert',async p=>{
  for(const mode of modes){await setup(p,mode);for(const id of applicable[mode]){const before=stable(await state(p));await open(p,id);await p.keyboard.press('Tab');await p.keyboard.press('Shift+Tab');await p.locator('#setting-draft').dispatchEvent('input');await p.locator('#setting-range').dispatchEvent('input');assert.deepEqual(stable(await state(p)),before,mode+' '+id+' unchanged input');await confirm(p);assert.deepEqual(stable(await state(p)),before,mode+' '+id+' unchanged Confirm');assert.equal(await p.locator('#'+id+'-tile').evaluate(e=>e===document.activeElement),true);}}
 });
 await group('numeric step bounds blank invalid and revert are draft-only',async p=>{
  for(const [id,spec] of Object.entries(specs)){
   const {min,max,step,unit}=spec;await setup(p,spec.mode);await open(p,id);const initial=await p.locator('#setting-draft').inputValue();assert.equal(await p.getByLabel('New value ('+unit+')',{exact:true}).count(),1);const before=await state(p);
   for(const attr of ['min','max','step'])assert.equal(+(await p.locator('#setting-range').getAttribute(attr)),spec[attr],id+' '+attr);
   for(const value of ['','abc',min-1,max+1,min+step/2]){const prior=await state(p);await fill(p,value);assert.equal(await p.locator('#setting-confirm').isDisabled(),true,id+' invalid '+value);assert.equal(await p.locator('#setting-draft').getAttribute('aria-invalid'),'true');assert.deepEqual(config(await state(p)),config(before));assert.ok((await state(p)).inputRevision>prior.inputRevision,id+' actual edit notifies');const unchanged=stable(await state(p));await p.locator('#setting-draft').dispatchEvent('input');await p.locator('#setting-confirm').evaluate(e=>e.click());assert.deepEqual(stable(await state(p)),unchanged,'unchanged invalid input cannot notify or confirm');assert.equal(await p.locator('#setting-draft').inputValue(),String(value));}
   await fill(p,max);const atMax=stable(await state(p));await p.locator('#setting-increase').click();assert.equal(await p.locator('#setting-draft').inputValue(),String(max));assert.deepEqual(stable(await state(p)),atMax);
   await fill(p,min);const atMin=stable(await state(p));await p.locator('#setting-decrease').click();assert.equal(await p.locator('#setting-draft').inputValue(),String(min));assert.deepEqual(stable(await state(p)),atMin);await p.locator('#setting-increase').click();assert.equal(await p.locator('#setting-draft').inputValue(),String(min+step));assert.deepEqual(config(await state(p)),config(before));
   await fill(p,initial);assert.ok((await state(p)).inputRevision>before.inputRevision);const reverted=stable(await state(p));await confirm(p);assert.deepEqual(stable(await state(p)),reverted,'unchanged reverted Confirm adds no notification');
  }
 });
 await group('sliders cannot bypass Confirm and repeated keyboard edits accumulate',async p=>{
  for(const [id,spec] of Object.entries(specs)){
   await setup(p,spec.mode);const before=config(await state(p));await open(p,id);const initial=+(await p.locator('#setting-draft').inputValue()),range=p.locator('#setting-range');
   await range.focus();await p.keyboard.press('ArrowRight');await p.keyboard.press('ArrowRight');assert.equal(await p.locator('#setting-draft').inputValue(),String(initial+2*spec.step));assert.deepEqual(config(await state(p)),before);const edited=stable(await state(p));await open(p,id);assert.equal(await p.locator('#setting-draft').evaluate(e=>e===document.activeElement),true);assert.equal(await p.locator('#setting-draft').inputValue(),String(initial+2*spec.step));assert.deepEqual(stable(await state(p)),edited,'reactivation preserves draft and notifications');await cancel(p);assert.equal(+(await p.locator('#'+id).inputValue()),initial);
   await open(p,id);await range.evaluate(e=>{window.editorPointerEvents=[];e.addEventListener('input',event=>editorPointerEvents.push(event.isTrusted));});const box=await range.boundingBox();await p.mouse.move(box.x+8,box.y+box.height/2);await p.mouse.down();await p.mouse.move(box.x+box.width-8,box.y+box.height/2,{steps:15});await p.mouse.up();const events=await p.evaluate(()=>editorPointerEvents);assert.ok(events.length>=5&&events.every(Boolean),id+' trusted pointer edits');assert.deepEqual(config(await state(p)),before);await cancel(p);
   await change(p,id,initial+spec.step);assert.deepEqual(config(await state(p)),before,'compatibility input is draft-only');await confirm(p);assert.equal(config(await state(p))[spec.field],(initial+spec.step)/(1/spec.scale));
  }
 });
 await group('Confirm uses retained nonadaptive path in every supported mode',async p=>{
  for(const mode of modes)for(const id of applicable[mode]){if(mode==='pc-cmva'&&['vt','peep'].includes(id))continue;await setup(p,mode);const before=config(await state(p)),spec=specs[id];await open(p,id);const selected=+(await p.locator('#setting-draft').inputValue())+2*spec.step;await fill(p,selected);assert.deepEqual(config(await state(p)),before);await p.keyboard.press('Enter');const after=await state(p);assert.deepEqual(config(after),{...before,[spec.field]:selected*spec.scale},mode+' '+id+' callback and sibling preservation');assert.equal(await p.locator('#setting-editor').isVisible(),false);if(mode==='pc-cmva')assert.equal(after.adaptiveState.pendingSettings,null);}
 });
 await group('adaptive requests remain atomic and waiting until actual breath start',async p=>{
  for(const phaseTicks of [0,150]){await setup(p,'pc-cmva');await tick(p,phaseTicks);await open(p);await fill(p,650);assert.equal((await state(p)).adaptiveState.pendingSettings,null);await confirm(p);
  await open(p,'peep');await fill(p,9);await confirm(p);let s=await state(p);assert.equal(s.operatorSettings.targetVT_mL,500);assert.equal(s.operatorSettings.peep_cmH2O,5);assert.deepEqual(s.adaptiveState.pendingSettings,{targetVT_mL:650,peep_cmH2O:9});
  assert.equal((await p.locator('#vt-display').innerText()).trim(),'500 mL');assert.match(await p.locator('#peep-display').innerText(),/^5 cmH/);
  for(const [id,value] of [['vt',650],['peep',9]]){assert.match(await p.locator('#'+id+'-tile-pending').innerText(),new RegExp(value+'.*waiting'));assert.equal(await p.locator('#'+id+'-tile').getAttribute('aria-describedby'),id+'-tile-pending');}
  await open(p);assert.match(await p.locator('#setting-accepted').innerText(),/650.*waiting/);await fill(p,700);const paused=await state(p);await p.evaluate(()=>__vsim.redraw());assert.equal((await state(p)).globalTime,paused.globalTime);assert.equal((await state(p)).operatorSettings.targetVT_mL,500);await tick(p,502-phaseTicks);s=await state(p);assert.equal(s.operatorSettings.targetVT_mL,650);assert.equal(s.operatorSettings.peep_cmH2O,9);assert.equal(s.adaptiveState.pendingSettings,null);assert.equal(await p.locator('#setting-draft').inputValue(),'700');assert.match(await p.locator('#setting-applied').innerText(),/650/);assert.equal(await p.locator('#vt-tile-pending').isVisible(),false);assert.equal(await p.locator('#vt-tile').getAttribute('aria-describedby'),null);await cancel(p);assert.equal((await state(p)).operatorSettings.targetVT_mL,650);}
 });
 await group('adaptive invalid blank revert Cancel cannot rehabilitate feedback',async p=>{
  for(const id of applicable['pc-cmva']){await setup(p,'pc-cmva');await tick(p,110);const before=await state(p);await open(p,id);const initial=await p.locator('#setting-draft').inputValue();await fill(p,'');await fill(p,initial);const changed=await state(p);assert.ok(changed.adaptiveState.epoch>before.adaptiveState.epoch,id);assert.equal(changed.adaptiveState.pendingSettings,null);assert.deepEqual(config(changed),config(before));assert.match(await p.locator('#setting-consequence').innerText(),/Cancel cannot restore/);await p.keyboard.press('Escape');assert.equal((await state(p)).adaptiveState.epoch,changed.adaptiveState.epoch);}
 });
 await group('newest request supersedes earlier queue without reverting sibling',async p=>{
  await setup(p,'pc-cmva');for(const [id,v] of [['vt',650],['peep',9],['vt',620]]){await open(p,id);await fill(p,v);await confirm(p);}assert.deepEqual((await state(p)).adaptiveState.pendingSettings,{targetVT_mL:620,peep_cmH2O:9});
  for(const mode of modes){await setup(p,mode);const before=stable(await state(p));for(const id of Object.keys(specs).filter(id=>!applicable[mode].includes(id))){assert.equal(await p.locator('#'+id+'-tile').isVisible(),false,mode+' hides '+id);await change(p,id,specs[id].max);assert.deepEqual(stable(await state(p)),before,'inapplicable legacy route inert');assert.equal(await p.locator('#setting-editor').isVisible(),false);}}
 });
 await group('reset and mode close stale drafts and preserve accepted adaptive request',async p=>{
  for(const action of ['reset','vc-cmv','pc-cmv','PC-CSV']){await setup(p,'pc-cmva');if((await state(p)).running)await p.locator('#btn-pause').click();for(const [id,value] of [['vt',650],['peep',9]]){await open(p,id);await fill(p,value);await confirm(p);}await open(p);await fill(p,700);await p.locator(action==='reset'?'#btn-reset':'[data-mode="'+action+'"]').click();assert.equal(await p.locator('#setting-editor').isVisible(),false);const s=await state(p);assert.equal(s.operatorSettings.targetVT_mL,650);assert.equal(s.operatorSettings.peep_cmH2O,9);assert.equal(s.running,false);}
  for(const [id,spec] of Object.entries(specs)){await setup(p,spec.mode);await open(p,id);await fill(p,spec.max);await setup(p,spec.mode);const before=config(await state(p));await p.locator('#setting-confirm').evaluate(e=>e.click());assert.deepEqual(config(await state(p)),before,'stale generation cannot write '+id);assert.equal(await p.locator('#setting-editor').isVisible(),false);}
 });
 await group('other accepted edits dismiss stale drafts',async p=>{
  for(const id of ['rr','fio2','peep']){await setup(p);const before=config(await state(p));await open(p);await fill(p,600);await open(p,id);assert.deepEqual(config(await state(p)),before);assert.equal(await p.locator('#setting-draft').inputValue(),await p.locator('#'+id).inputValue());await fill(p,id==='rr'?20:id==='fio2'?60:9);await confirm(p);assert.equal((await state(p)).operatorSettings.targetVT_mL,500);}
  for(const selector of ['#ie-group .ie-btn','#trigger-type-group [data-trigger-type]','#flow-pattern-control button','#pmus-toggle','#load-mechanics-example','#btn-teaching-mode']){await setup(p);await open(p);await fill(p,600);await p.locator(selector).first().evaluate(e=>e.click());assert.equal(await p.locator('#setting-editor').isVisible(),false,selector);assert.equal((await state(p)).operatorSettings.targetVT_mL,500);if((await state(p)).teachingMode)await p.locator('#btn-teaching-mode').click();}
  await setup(p);await open(p);await fill(p,600);await change(p,'compliance',60);assert.equal(await p.locator('#setting-editor').isVisible(),false);assert.equal((await state(p)).operatorSettings.targetVT_mL,500);
 });
 await group('armed and active hold changes cancel without restoring or overwriting history',async p=>{
  for(const id of ['vt','rr','peep','fio2','pinsp'])for(const active of [false,true]){await setup(p,specs[id].mode);await p.evaluate(()=>__vsim.manualHoldFixture(.6));const saved=(await state(p)).lastValidManualHold;assert.ok(saved);
   await open(p,id);await p.locator('#hold-toggle').evaluate(e=>e.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true})));
   if(active){await p.evaluate(()=>{for(let i=0;i<800&&!__vsim.state().manualHold.active;i++)__vsim.stepTicks(1);});assert.equal((await state(p)).manualHold.active,true);}else assert.equal((await state(p)).manualHold.armed,true);
   await p.locator('#setting-draft').evaluate(e=>{e.value='';e.dispatchEvent(new Event('input',{bubbles:true}));});const changed=await state(p);assert.equal(changed.manualHold.active,false);assert.equal(changed.manualHold.armed,false);assert.deepEqual(changed.lastValidManualHold,saved);assert.match(await p.locator('#setting-consequence').innerText(),/Cancel cannot restore/);await cancel(p);assert.deepEqual((await state(p)).lastValidManualHold,saved);await p.locator('#hold-toggle').evaluate(e=>e.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true})));
  }
 });
 await group('keyboard Escape focus and narrow viewport stay usable',async p=>{
  for(const width of [1440,1100,800,390])for(const mode of modes){await p.setViewportSize({width,height:900});await setup(p,mode);const id=applicable[mode][0],tile=p.locator('#'+id+'-tile');assert.equal(await tile.getAttribute('type'),'button');assert.match(await tile.ariaSnapshot(),/button ".+"/);const waves=await p.locator('.waveform-panel').evaluateAll(es=>es.map(e=>({width:e.clientWidth,height:e.clientHeight})));assert.equal(waves.length,3);for(const w of waves)assert.ok(w.width>100&&w.height>=140);
   await tile.focus();await p.keyboard.press('Enter');assert.equal(await p.locator('#setting-draft').evaluate(e=>e===document.activeElement),true);let b=await p.locator('#setting-editor').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width+.5&&b.y>=0&&b.y+b.height<=900.5);assert.deepEqual(await p.locator('.waveform-panel').evaluateAll(es=>es.map(e=>({width:e.clientWidth,height:e.clientHeight}))),waves,'editor preserves all waveform geometry');await fill(p,specs[id].max);await p.setViewportSize({width:width===1440?390:1440,height:900});await p.evaluate(()=>new Promise(requestAnimationFrame));assert.equal(await p.locator('#setting-draft').inputValue(),String(specs[id].max));b=await p.locator('#setting-editor').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=p.viewportSize().width+.5,JSON.stringify({width,mode,resize:p.viewportSize(),box:b}));await p.keyboard.press('Escape');assert.equal(await tile.evaluate(e=>e===document.activeElement),true);assert.equal(await p.locator('#setting-editor').isVisible(),false);await p.setViewportSize({width,height:900});await p.evaluate(()=>new Promise(requestAnimationFrame));await tile.tap();assert.equal(await p.locator('#setting-editor').isVisible(),true);await p.locator('#setting-cancel').tap();assert.equal(await p.locator('#setting-editor').isVisible(),false);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  }
 });
 await group('review previews and input labels',async p=>{
  // Short windows and mobile browser chrome must not strand either action.
  for(const width of [1440,390]){await p.setViewportSize({width,height:500});await p.evaluate(()=>new Promise(requestAnimationFrame));await setup(p);await open(p);await fill(p,620);await p.locator('#setting-confirm').scrollIntoViewIfNeeded();let box=await p.locator('#setting-confirm').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=500.5);await confirm(p);assert.equal((await state(p)).operatorSettings.targetVT_mL,620);await open(p);await fill(p,700);await p.locator('#setting-cancel').scrollIntoViewIfNeeded();box=await p.locator('#setting-cancel').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=500.5);if(width===390){await p.locator('#setting-editor').evaluate(e=>{e.scrollTop=e.scrollHeight;});assert.ok(await p.locator('#setting-editor').evaluate(e=>e.scrollTop>0),'nonvacuous scrolled short editor');}await cancel(p);assert.equal((await state(p)).operatorSettings.targetVT_mL,620);await open(p,'rr');assert.equal(await p.locator('#setting-editor').evaluate(e=>e.scrollTop),0,'new setting opens with heading visible');await cancel(p);}
  await p.setViewportSize({width:1440,height:900});await p.evaluate(()=>new Promise(requestAnimationFrame));
  if(process.env.VSM_EDITOR_SHOTS)fs.mkdirSync(process.env.VSM_EDITOR_SHOTS,{recursive:true});for(const [id,spec] of Object.entries(specs)){await setup(p,spec.mode);const applied=await p.locator('#'+id+'-display').innerText();await open(p,id);assert.equal(await p.getByLabel('New value ('+spec.unit+')',{exact:true}).count(),1);await fill(p,spec.max);assert.equal(await p.locator('#'+id+'-display').innerText(),applied,'tile never shows unconfirmed '+id);if(process.env.VSM_EDITOR_SHOTS)await p.screenshot({path:process.env.VSM_EDITOR_SHOTS+'/draft-'+id+'.png',fullPage:true});await cancel(p);}
  await setup(p,'pc-cmva');await open(p);await fill(p,650);await confirm(p);await open(p);assert.match(await p.locator('#setting-applied').innerText(),/500/);if(process.env.VSM_EDITOR_SHOTS)await p.screenshot({path:process.env.VSM_EDITOR_SHOTS+'/adaptive-waiting.png',fullPage:true});await p.setViewportSize({width:390,height:900});if(process.env.VSM_EDITOR_SHOTS)await p.screenshot({path:process.env.VSM_EDITOR_SHOTS+'/narrow-waiting.png',fullPage:true});
 });
 await browser.close();console.log(`SETTING_EDITOR_BROWSER_TALLY ${passed} passed, ${failed} failed`);if(passed!==(process.env.VSM_EDITOR_GROUP?1:12)||failed)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
