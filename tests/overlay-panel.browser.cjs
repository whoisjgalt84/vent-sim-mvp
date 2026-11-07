const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const channel = process.env.VSM_BROWSER_CHANNEL;
(async () => {
 const browser = await chromium.launch(channel ? { channel } : {});
 const page = await browser.newPage({viewport:{width:1440,height:900}});
 const mutation=process.env.VSM_OVERLAY_MUTATION;
 if(mutation)await page.route('**/js/main.js*',async route=>{
  const response=await route.fetch();let body=await response.text();
  const patches={
   discovery:["if (pointerMoved && text && !overlayHelpSuppressed && !measurementHelpClickPinned)","if (false)"],
   status:[".filter(k => !overlayHelpVisible.has(k))",".filter(k => false)"],
   selection:["if (text && text.textContent !== copy)","if (text)"],
   pin:["measurementHelpClickPinned = true;","measurementHelpClickPinned = false;"],
   reentry:["overlayHelpSuppressed = false; clearTimeout(measurementHelpCloseTimer);","clearTimeout(measurementHelpCloseTimer);"],
  };
  const patch=patches[mutation];assert.ok(patch && body.includes(patch[0]),'mutation target exists');
  body=body.replace(patch[0],patch[1]);await route.fulfill({response,body});
 });
 const errors=[]; page.on('pageerror',e=>errors.push(String(e)));
 let passed=0;
 const panel=page.locator('#measurement-help'), status=page.locator('#overlay-help-status'), text=page.locator('#measurement-help-text');
 const air=page.locator('[data-measurement-help="air-trapping"]'), flow=page.locator('#canvas-flow');
 const setup=async(rr=24)=>{
  await page.goto('http://127.0.0.1:8899');await page.waitForFunction(()=>window.__vsim);
  await page.evaluate(rr=>{__vsim.pause();__vsim.setupEffort({mode:'vc-cmv',resistance:30,compliance:.08,respiratoryRate:rr,pMusMax:2,patientRR:35,flowTriggerLpm:5});__vsim.stepTicks(4000);},rr);
  await page.locator('#btn-teaching-mode').click();
 };
 const labelTarget=async(p=page)=>p.evaluate(()=>{
  const c=document.getElementById('canvas-flow'),b=c.getBoundingClientRect(),labels=__vsim.state().renderers.flow.overlayLabels;
  if(!labels?.length)throw Error('No overlay label'); const r=labels[0].rect;
  return {x:b.left+r.x+r.width/2,y:b.top+r.y+r.height/2};
 });
 try {
  for(const rr of [24,35]) {
   await setup(rr);const at=await labelTarget();await page.mouse.move(at.x,at.y);
   assert.equal(await panel.isVisible(),true);assert.equal(await flow.getAttribute('title'),null);
   await page.mouse.move(0,0);await page.waitForTimeout(220);assert.equal(await panel.isHidden(),true);
   await page.mouse.move(at.x,at.y);assert.equal(await panel.isVisible(),true);
   assert.match(await text.innerText(),/not necessarily the breath under the pointer/);
   await page.locator('#overlay-help-pin').hover();await page.waitForTimeout(250);
   assert.equal(await panel.isVisible(),true);
   await page.locator('#overlay-help-pin').click();assert.equal(await page.locator('#overlay-help-pin').getAttribute('aria-pressed'),'true');await page.mouse.move(0,0);
   const before=await text.innerText();
   await page.evaluate(()=>{window.__helpTextNode=document.getElementById('measurement-help-text').firstChild;__vsim.redraw();});
   assert.equal(await page.evaluate(()=>__helpTextNode===document.getElementById('measurement-help-text').firstChild),true);
   await page.evaluate(()=>__vsim.stepTicks(2000));await page.waitForTimeout(400);
   assert.equal(await panel.isVisible(),true);assert.ok((await text.innerText()).includes(before));
   await page.keyboard.press('Escape');assert.equal(await panel.isHidden(),true);assert.equal(await flow.evaluate(e=>e===document.activeElement),true);
   await page.evaluate(()=>__vsim.redraw());assert.equal(await panel.isHidden(),true);
  }
  passed++;console.log('PASS RR24/high RR hover, panel transfer, pin, retained copy, Escape and no reopen');
  await setup();await air.focus();await page.keyboard.press('Enter');assert.equal(await panel.isVisible(),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('#overlay-help-pin').evaluate(e=>e===document.activeElement),true);
  await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.equal(await panel.isHidden(),true);assert.equal(await air.evaluate(e=>e===document.activeElement),true);
  await flow.focus();await page.keyboard.press('Space');assert.equal(await panel.getAttribute('role'),'dialog');assert.match(await text.innerText(),/Flow baseline cue/);assert.match(await text.innerText(),/Earlier trigger settings/);
  await page.keyboard.press('Escape');assert.equal(await panel.isHidden(),true);
  passed++;console.log('PASS keyboard activation, both explanations, Close and focus restoration');
  await setup();await air.click();
  for(const action of ['#btn-reset','[data-mode="pc-cmv"]','#btn-teaching-mode']) {
   await setup();await air.focus();await page.keyboard.press('Enter');if(action.includes('data-mode'))await page.locator(action).evaluate(e=>e.click());else await page.locator(action).click();assert.equal(await panel.isHidden(),true);
  }
  passed++;console.log('PASS reset, mode and Teach-off dismissal');
  await setup();await air.focus();await page.keyboard.press('Enter');
  assert.equal(await status.isHidden(),true);
  const retainedCopy=await text.innerText();assert.match(retainedCopy,/Failed trigger: this effort/);
  // A deterministic imported renderer tests the same help visibility callback with explicit cue absence.
  await page.evaluate(async()=>{
   const {WaveformRenderer}=await import('/js/waveforms.js?v=33');
   const original=WaveformRenderer.prototype._syncHighlightTooltip;
   // Capture real renderer only, then restore the prototype immediately.
   WaveformRenderer.prototype._syncHighlightTooltip=function(...args){if(this.canvas.id==='canvas-flow')window.__flowRenderer=this;return original.apply(this,args);};
   __vsim.redraw();WaveformRenderer.prototype._syncHighlightTooltip=original;
   const {FAILED_FLOW_HELP}=await import('/js/waveforms.js?v=33');
   window.__renderCueKinds=kinds=>{
    const time=Array.from({length:100},(_,i)=>i/10),flow=time.map(()=>-1);
    __flowRenderer.render(time,flow,[],kinds.includes('air')?{tailWindow:{start:10,end:30},baselineReached:false}:null,
      kinds.includes('failed')?[{trace:'flow',tStart:4,tEnd:6,color:'#d4a23c',label:'Failed trigger',tooltip:FAILED_FLOW_HELP}]:[],null,time.map(()=>1));
   };
   __renderCueKinds([]);
  });
  assert.equal(await panel.isVisible(),true);assert.equal(await status.innerText(),'Not currently visible: air trapping and Failed trigger.');assert.equal(await text.innerText(),retainedCopy);assert.match(await text.innerText(),/Flow baseline cue/);
  await page.screenshot({path:'scratch/overlay-panel-evidence/retained-explanation.png'});
  for(const [kinds,notice] of [[['air'],'Not currently visible: Failed trigger.'],[['failed'],'Not currently visible: air trapping.'],[['air','failed'],'']]) {
   await page.evaluate(kinds=>__renderCueKinds(kinds),kinds);assert.equal(await status.textContent(),notice);assert.equal(await status.isHidden(),!notice);assert.equal(await text.innerText(),retainedCopy);
  }
  const variant=await page.evaluate(async()=>{const {WaveformDisplay}=await import('/js/waveforms.js?v=33');return WaveformDisplay.prototype._failedEffortTooltip({gateFailed:'ventilator_unavailable'});});
  assert.ok(variant.startsWith('Failed trigger: this effort was resolved'));
  passed++;console.log('PASS absent/mixed/returned cues retain text, show only missing notices, and both variants use colons');
  await setup();await flow.focus();await page.keyboard.press('Enter');
  const accessible=await panel.ariaSnapshot();assert.match(accessible,/dialog "Flow overlay explanations"/);assert.match(accessible,/button "Close"/);fs.writeFileSync('scratch/overlay-panel-evidence/panel-accessibility.txt',accessible);
  await page.screenshot({path:'scratch/overlay-panel-evidence/both-cues-desktop.png'});
  for(const width of [800,480]) {
   await page.setViewportSize({width,height:700});await page.evaluate(()=>document.body.style.zoom='1.5');await page.evaluate(()=>__vsim.redraw());
   const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1&&box.y>=0&&box.y+box.height<=701,JSON.stringify(box));
   await page.locator('#overlay-help-close').scrollIntoViewIfNeeded();assert.equal(await page.locator('#overlay-help-close').isVisible(),true);
   await page.screenshot({path:'scratch/overlay-panel-evidence/narrow-'+width+'.png'});
  }
  passed++;console.log('PASS narrow and 150% zoom panel bounds and reachable controls');
  const touch=await browser.newPage({viewport:{width:1100,height:900},hasTouch:true});
  await touch.goto('http://127.0.0.1:8899');await touch.waitForFunction(()=>window.__vsim);
  await touch.evaluate(()=>{__vsim.pause();__vsim.setupEffort({mode:'PC-CSV',resistance:10,compliance:.05,pMusMax:.5,patientRR:12,flowTriggerLpm:2});__vsim.stepTicks(4000);});await touch.locator('#btn-teaching-mode').tap();
  const point=await labelTarget(touch);await touch.touchscreen.tap(point.x,point.y);
  assert.equal(await touch.locator('#measurement-help').isVisible(),true);assert.equal(await touch.locator('#overlay-help-pin').getAttribute('aria-pressed'),'true');
  await touch.locator('#overlay-help-close').tap();assert.equal(await touch.locator('#measurement-help').isHidden(),true);
  await touch.locator('[data-measurement-help="failed-trigger-highlight"]').tap();assert.equal(await touch.locator('#measurement-help').isVisible(),true);
  await touch.close();passed++;console.log('PASS fresh touch cue tap pins and closes; static touch access remains');
  assert.deepEqual(errors,[]);assert.equal(passed,6);console.log('OVERLAY_PANEL_BROWSER_TALLY '+passed+' passed, 0 failed ('+(channel||'managed chromium')+')');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
