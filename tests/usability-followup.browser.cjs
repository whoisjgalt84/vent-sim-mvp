/** Approved usability follow-up; browser geometry and native-control regression checks. */
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch();let passed=0;
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const mutation=process.env.VSM_USABILITY_MUTATION;
 if(mutation)await page.route('**/js/*.js*',async route=>{
   const response=await route.fetch();let body=await response.text();
   if(mutation==='collapse'&&route.request().url().includes('/main.js'))body=body.replace("title.setAttribute('data-collapsed', '');\n                title.nextElementSibling.style.display = 'none';",'');
   if(mutation==='broad'&&route.request().url().includes('/waveforms.js'))body=body.replace("this._teachingFlowHelp = teachingMode && this.kind === 'flow';","this._teachingFlowHelp = false;");
   if(mutation==='machine'&&route.request().url().includes('/waveforms.js'))body=body.replace("if (event.type !== 'patient') continue;","if (event.type !== 'patient' && event.type !== 'machine') continue;");
   if(mutation==='wrap'&&route.request().url().includes('/waveforms.js'))body=body.replace('!expiratoryRun || !penDown || px < prevPx','!expiratoryRun || !penDown');
   if(mutation==='gap'&&route.request().url().includes('/waveforms.js'))body=body.replace('penDown = false;\n                expiratoryRun = null;\n                continue;', 'penDown = false;\n                continue;').replace('!expiratoryRun || !penDown || px < prevPx','!expiratoryRun || px < prevPx');
   if(mutation==='sign'&&route.request().url().includes('/waveforms.js'))body=body.replace('alignedExpiration && expirationData[i] === 1','valueData[i] <= 0');
   if(mutation==='slice'&&route.request().url().includes('/waveforms.js'))body=body.replace('sim.buffers.expiration.toArray().slice(offset)','sim.buffers.expiration.toArray().slice(offset + 1).concat(0)');
   await route.fulfill({response,body});
 });
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 try {
 await page.goto('http://127.0.0.1:8899/index.html');await page.waitForFunction(()=>window.__vsim);
 await page.evaluate(()=>__vsim.pause());
 const titles=page.locator('#additional-outputs [data-collapsible]');assert.equal(await titles.count(),5);
 for(let i=0;i<5;i++){assert.equal(await titles.nth(i).getAttribute('aria-expanded'),'false');assert.equal(await titles.nth(i).evaluate(e=>getComputedStyle(e.nextElementSibling).display),'none');}
 await page.locator('#additional-outputs-summary').click();await titles.first().focus();await page.keyboard.press('Enter');
 for(const selector of ['#btn-teaching-mode','#btn-patient','#btn-teaching-mode','#btn-reset'])await page.locator(selector).click();
 await page.locator('[data-mode="pc-cmv"]').click();
 await page.locator('#additional-outputs-summary').click();await page.locator('#additional-outputs-summary').click();
 assert.equal(await titles.first().getAttribute('aria-expanded'),'true');
 for(let i=1;i<5;i++)assert.equal(await titles.nth(i).getAttribute('aria-expanded'),'false');
 passed++;console.log('PASS collapsed defaults and retained native keyboard selections');
 const result=await page.evaluate(async()=>{
  const {WaveformRenderer,AIR_TRAPPING_HELP,FAILED_FLOW_HELP}=await import('/js/waveforms.js?v=32');
  document.body.classList.add('teaching-mode');
  const canvas=document.createElement('canvas');canvas.style.cssText='width:1000px;height:230px';document.body.append(canvas);
  const r=new WaveformRenderer(canvas,{kind:'flow'});
  const time=Array.from({length:1000},(_,i)=>i/100),flow=time.map(t=>t%1.2<.3?20:-8);
  const expiration=time.map(t=>t%1.2<.3?0:1);
  const tail={tailWindow:{start:70,end:110},baselineReached:false};
  const fail=[{trace:'flow',tStart:3.9,tEnd:4.3,color:'#d4a23c',label:'Failed trigger',tooltip:FAILED_FLOW_HELP}];
  const render=(a=tail,b=fail)=>r.render(time,flow,[{type:'machine',time:2}],a,b,10,expiration);
  const hover=t=>{const g=r.lastGeometry,box=canvas.getBoundingClientRect();const x=g.plot.x+(t%10)/10*g.plot.w,y=g.plot.y+g.plot.h-(-8-g.yMin)/(g.yMax-g.yMin)*g.plot.h;canvas.dispatchEvent(new MouseEvent('mousemove',{clientX:box.left+x,clientY:box.top+y}));return r._highlightHelpText;};
  render();const both=hover(6.6);const stable=[];for(let i=0;i<20;i++){r.render([...time,10+i/100],[...flow,-8],[],tail,fail,10,[...expiration,1]);stable.push(r._highlightHelpText===both);}
  const patientDataKept=r.renderedTriggerMarkers.length===0;
  render(tail,[]);const air=hover(6.6);render(null,fail);const failed=hover(6.6);
  render(null,[]);const cleared=r._highlightHelpText;
  render();document.body.classList.remove('teaching-mode');render();const standard=hover(6.6);
  document.body.classList.add('teaching-mode');render();
  const g=r.lastGeometry,box=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{clientX:box.left+g.plot.x+1,clientY:box.top+g.plot.y+1}));const empty=r._highlightHelpText;
  // A sweep wrap and nonfinite gap must not become hoverable connecting strokes.
  const breaks=r._expiratoryHoverRuns.every(run=>run.every((x,i)=>i%2||i<2||x>=run[i-2]));
  flow[660]=NaN;render();const noNaN=r._expiratoryHoverRuns.every(run=>run.every(Number.isFinite));
  // Inspiratory positive limbs, erase strip and an aged-out overlay must not claim broad help.
  const at=(x,y)=>{const b=canvas.getBoundingClientRect();canvas.dispatchEvent(new MouseEvent('mousemove',{clientX:b.left+x,clientY:b.top+y}));return r._highlightHelpText;};
  render();let q=r.lastGeometry;
  const positive=at(q.plot.x+6.1/10*q.plot.w,q.plot.y+q.plot.h-(20-q.yMin)/(q.yMax-q.yMin)*q.plot.h);
  expiration[610]=1;expiration[611]=1;render();q=r.lastGeometry;
  const positiveExpiration=at(q.plot.x+6.105/10*q.plot.w,q.plot.y+q.plot.h-(20-q.yMin)/(q.yMax-q.yMin)*q.plot.h);
  expiration[610]=0;expiration[611]=0;
  const unknown=[];for(const flags of [null,[],expiration.slice(1),expiration.map(()=>NaN),expiration.map(()=>0)]) {
    r.render(time,flow,[],tail,fail,10,flags);unknown.push(hover(6.6));
  }
  render();q=r.lastGeometry;
  const erased=at(q.plot.x+.01*q.plot.w,q.plot.y+q.plot.h-(-8-q.yMin)/(q.yMax-q.yMin)*q.plot.h);
  flow[650]=0;flow[651]=0;render();q=r.lastGeometry;
  const zero=at(q.plot.x+6.505/10*q.plot.w,q.plot.y+q.plot.h-(0-q.yMin)/(q.yMax-q.yMin)*q.plot.h);
  r.render(time,flow,[],tail,fail,10,expiration.map(()=>0));q=r.lastGeometry;
  const zeroNonExpiration=at(q.plot.x+6.505/10*q.plot.w,q.plot.y+q.plot.h-(0-q.yMin)/(q.yMax-q.yMin)*q.plot.h);
  hover(6.6);r.render(time,flow,[],{tailWindow:{start:-100,end:-1},baselineReached:false},[],10,expiration);const aged=r._highlightHelpText;
  const wrappedTime=time.map(t=>t+5),wrappedFlow=time.map(()=>-8);
  r.render(wrappedTime,wrappedFlow,[],tail,[],10,time.map(()=>1));
  const wrapSplit=r._expiratoryHoverRuns.length===2 && r._expiratoryHoverRuns.every(run=>run.every((x,i)=>i%2||i<2||x>=run[i-2]));
  for(let i=600;i<=700;i++)wrappedFlow[i]=NaN;
  r.render(wrappedTime,wrappedFlow,[],tail,[],10,time.map(()=>1));q=r.lastGeometry;
  const gapSplit=r._expiratoryHoverRuns.length===3;
  const gap=at(q.plot.x+1.5/10*q.plot.w,q.plot.y+q.plot.h-(-8-q.yMin)/(q.yMax-q.yMin)*q.plot.h);
  canvas.remove();return {zeroNonExpiration,positiveExpiration,unknown,wrapSplit,gapSplit,gap,positive,erased,zero,aged,both,stable,air,failed,cleared,standard,empty,breaks,noNaN,patientDataKept,AIR_TRAPPING_HELP,FAILED_FLOW_HELP};
 });
 assert.match(result.both,/not necessarily the breath under the pointer/);assert.ok(result.both.includes(result.AIR_TRAPPING_HELP)&&result.both.includes(result.FAILED_FLOW_HELP));assert.ok(result.stable.every(Boolean));assert.match(result.zero,/Visible flow overlays/);assert.match(result.positiveExpiration,/Visible flow overlays/);assert.ok(result.positiveExpiration.includes(result.AIR_TRAPPING_HELP)&&result.positiveExpiration.includes(result.FAILED_FLOW_HELP));assert.ok(result.unknown.every(text=>text===''));
 assert.ok(result.air.includes(result.AIR_TRAPPING_HELP)&&!result.air.includes(result.FAILED_FLOW_HELP));assert.ok(result.failed.includes(result.FAILED_FLOW_HELP)&&!result.failed.includes(result.AIR_TRAPPING_HELP));
 for(const key of ['cleared','standard','empty','positive','erased','aged','gap','zeroNonExpiration'])assert.equal(result[key],'');for(const key of ['breaks','noNaN','patientDataKept','wrapSplit','gapSplit'])assert.equal(result[key],true);
 passed++;console.log('PASS high-rate negative limbs, single/both overlays, stability, clearing, gaps and machine omission');
 await page.reload();await page.waitForFunction(()=>window.__vsim);await page.evaluate(()=>{__vsim.pause();__vsim.setupEffort({mode:'vc-cmv',pMusMax:0,patientRR:0});__vsim.stepTicks(2500);});
 let state=await page.evaluate(()=>__vsim.state());assert.ok(state.triggerEvents.some(e=>e.type==='machine'));for(const renderer of Object.values(state.renderers))assert.ok(renderer.markers.every(e=>e.type==='patient'));
 assert.match(await page.locator('#waveform-legend').innerText(),/Timed machine breaths have no symbol/);
 await page.locator('#btn-teaching-mode').click();
 for(const key of ['air-trapping','failed-trigger-highlight']) {
  const button=page.locator('[data-measurement-help="'+key+'"]');assert.equal(await button.count(),1);
  await button.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#measurement-help').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await button.evaluate(e=>document.activeElement===e),true);
  await button.click();assert.equal(await page.locator('#measurement-help').isVisible(),true);await page.keyboard.press('Escape');
 }
 fs.mkdirSync('scratch/shots-usability',{recursive:true});
 await page.screenshot({path:'scratch/shots-usability/teach-collapsed.png'});
 await page.locator('#additional-outputs-summary').click();await page.screenshot({path:'scratch/shots-usability/additional-collapsed.png'});
 for(const width of [1100,1440]) {
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>__vsim.setupEffort({mode:'vc-cmv',resistance:30,compliance:.08,respiratoryRate:35,pMusMax:2,patientRR:35,flowTriggerLpm:5}));
  await page.evaluate(()=>__vsim.stepTicks(4000));
  assert.ok((await page.evaluate(()=>__vsim.state())).failedTriggers>0);
  await page.screenshot({path:'scratch/shots-usability/high-rate-'+width+'.png'});
  for(let i=0;i<5;i++)assert.equal(await titles.nth(i).getAttribute('aria-expanded'),'false');
 }
 await page.evaluate(()=>{__vsim.setupEffort({mode:'PC-CSV',resistance:10,compliance:.05,pMusMax:.5,patientRR:12,flowTriggerLpm:2});__vsim.stepTicks(4000);});
 const target=await page.evaluate(()=>{
   const c=document.getElementById('canvas-flow'),b=c.getBoundingClientRect(),g=__vsim.state().renderers.flow.geometry;
   for(let x=g.plot.x+g.plot.w/2;x<g.plot.x+g.plot.w-12;x+=4)for(let y=g.plot.y+8;y<g.plot.y+g.plot.h-(0-g.yMin)/(g.yMax-g.yMin)*g.plot.h-4;y+=4){
     c.dispatchEvent(new MouseEvent('mousemove',{clientX:b.left+x,clientY:b.top+y}));
     if(__vsim.state().renderers.flow.overlayHelpHit.startsWith('Visible flow overlays:'))return {x:b.left+x,y:b.top+y,text:__vsim.state().renderers.flow.overlayHelpHit};
   }return null;
 });assert.ok(target,'positive-flow broad hover is reachable in the real app');
 await page.mouse.move(target.x,target.y);assert.equal(await page.evaluate(()=>__vsim.state().renderers.flow.overlayHelpHit),target.text);
 await page.evaluate(()=>__vsim.stepTicks(10));assert.equal(await page.evaluate(()=>__vsim.state().renderers.flow.overlayHelpHit),target.text);
 await page.screenshot({path:'scratch/shots-usability/positive-expiration-native-hover.png'});
 assert.deepEqual(errors,[]);passed++;
 const phaseResult=await page.evaluate(async()=>{
   const [{LungModel},{Ventilator},{SimulationEngine},{WaveformDisplay}]=await Promise.all([
     import('/js/lung-model.js?v=32'),import('/js/ventilator.js?v=32'),import('/js/simulation.js?v=32'),import('/js/waveforms.js?v=32')]);
   const canvases=Object.fromEntries(['pressure','volume','flow'].map(key=>{const c=document.createElement('canvas');c.style.cssText='width:1000px;height:230px';document.body.append(c);return [key,c];}));
   const display=new WaveformDisplay(canvases),checks=[];
   for(const [triggerType,pMusMax] of [['flow',.5],['pressure',2]]){
     const sim=new SimulationEngine(new Ventilator(new LungModel({resistance:10,compliance:.05}),{mode:'PC-CSV',pMusMax,triggerType}));sim.configureEffortTiming({patientRR:12,neuralTi:1},true);
     for(let i=0;i<4000;i++)sim.tick();
     for(const window of [5,10,30]){
       sim.setDisplaySeconds(window);display.renderFromSim(sim);
       const r=display.flowRenderer,g=r.lastGeometry,box=canvases.flow.getBoundingClientRect(),t=sim.buffers.time.toArray(),f=sim.buffers.flow.toArray();
       const x=time=>g.plot.x+(((time%window)+window)%window)/window*g.plot.w;
       const index=t.findIndex((time,i)=>time>g.tMin+.2&&f[i]>0.5&&i+1<t.length&&f[i+1]>0.5&&!r._highlightHidden(x(time))&&!r._highlightHidden(x(time)-10)&&!r._highlightHidden(x(time)+10));
       if(index<0)throw new Error('No genuine positive expiration target');
       canvases.flow.dispatchEvent(new MouseEvent('mousemove',{clientX:box.left+x(t[index]),clientY:box.top+g.plot.y+g.plot.h-(f[index]-g.yMin)/(g.yMax-g.yMin)*g.plot.h}));
       checks.push({triggerType,window,text:r._highlightHelpText,passed:r._highlightHelpText.startsWith('Visible flow overlays:')&&r._highlightHelpText.includes('Failed trigger')});
     }
     sim.reset();display.renderFromSim(sim);checks.push({triggerType,text:display.flowRenderer._highlightHelpText,passed:display.flowRenderer._highlightHelpText===''});
     sim.setMode('pc-cmv');display.renderFromSim(sim);checks.push({triggerType,text:display.flowRenderer._highlightHelpText,passed:display.flowRenderer._highlightHelpText===''});
   }
   for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']){
     const sim=new SimulationEngine(new Ventilator(new LungModel({resistance:10,compliance:.05}),{mode,pMusMax:2}));sim.configureEffortTiming({patientRR:12,neuralTi:1},true);
     for(let i=0;i<4000;i++)sim.tick();
     for(const window of [5,10,30]){
       sim.setDisplaySeconds(window);display.renderFromSim(sim);const r=display.flowRenderer,g=r.lastGeometry;
       const count=Math.round(window*sim.sampleRate),t=sim.buffers.time.toArray().slice(-count),f=sim.buffers.flow.toArray().slice(-count),phase=sim.buffers.expiration.toArray().slice(-count);
       const expected=[];for(let i=0;i<t.length;i++){
         const x=g.plot.x+(((t[i]%window)+window)%window)/window*g.plot.w,y=g.plot.y+g.plot.h-(f[i]-g.yMin)/(g.yMax-g.yMin)*g.plot.h;
         if(phase[i]===1&&!r._highlightHidden(x))expected.push(x,y);
       }
       const actual=r._expiratoryHoverRuns.flat();checks.push({mode,window,passed:actual.length===expected.length&&actual.every((n,i)=>Math.abs(n-expected[i])<1e-8)});
     }
   }
   Object.values(canvases).forEach(c=>c.remove());return checks;
 });assert.equal(phaseResult.length,22);assert.ok(phaseResult.every(check=>check.passed),JSON.stringify(phaseResult));passed++;
 console.log('PASS genuine positive-expiration hover through sliced 5/10/30s history, reset and mode changes');console.log('PASS underlying timed history, legend and keyboard/click help');
 }finally{await browser.close();}
 console.log('USABILITY_BROWSER_TALLY '+passed+' passed, 0 failed');assert.equal(passed,4);
})().catch(e=>{console.error(e);process.exitCode=1;});
