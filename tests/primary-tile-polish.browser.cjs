const assert=require('node:assert/strict'),fs=require('fs');
const {chromium}=require('playwright');
let browser;
(async()=>{
 browser=await chromium.launch();const p=await browser.newPage();let cases=0;
 const errors=[];p.on('pageerror',e=>errors.push(String(e)));
 fs.mkdirSync('scratch/primary-tile-polish',{recursive:true});
 if(process.env.VSM_POLISH_MUTATION==='copy')await p.route('**/js/main.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:(await r.text()).replace('Changing this value can cancel','Changing the draft can cancel')});});
 if(process.env.VSM_POLISH_MUTATION==='unit')await p.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{const s=document.createElement('style');s.textContent='.setting-tile__unit { font-size: 16px !important; }';document.head.append(s);}));
 await p.goto(process.env.VSM_POLISH_URL||'http://127.0.0.1:8899/');await p.waitForFunction(()=>window.__vsim);
 for(const width of [1440,1100,800,390])for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']){
  await p.setViewportSize({width,height:900});await p.evaluate(mode=>__vsim.setupEffort({mode,pMusMax:0,patientRR:0}),mode);
  const tiles=p.locator('#primary-settings .setting-tile:visible');
  assert.equal(await tiles.locator('.setting-tile__unit').count(),await tiles.count());
  for(const unit of await tiles.locator('.setting-tile__unit').all()){assert.equal(await unit.evaluate(e=>parseFloat(getComputedStyle(e).fontSize)),12);assert.equal(await unit.evaluate(e=>getComputedStyle(e).display),'inline-block');}
  const boxes=await tiles.evaluateAll(es=>es.map(e=>({height:e.getBoundingClientRect().height,width:e.clientWidth,scroll:e.scrollWidth,parts:[...e.querySelectorAll('.control__label,.control__value,.setting-tile__applied')].map(x=>({text:x.innerText,font:parseFloat(getComputedStyle(x).fontSize),right:x.getBoundingClientRect().right,bottom:x.getBoundingClientRect().bottom})),rect:e.getBoundingClientRect().toJSON()})));
  assert.ok(Math.max(...boxes.map(b=>b.height))-Math.min(...boxes.map(b=>b.height))<1,JSON.stringify({width,mode,boxes}));
  for(const b of boxes){assert.ok(b.scroll<=b.width);for(const part of b.parts){assert.ok(part.right<=b.rect.right&&part.bottom<=b.rect.bottom,JSON.stringify({width,mode,b}));}assert.equal(b.parts[0].font,12);assert.equal(b.parts[1].font,16);}
  if(mode==='PC-CSV'){assert.equal(await p.locator('#ps-pressure-tile .control__label br').count(),1);assert.match(await p.locator('#ps-pressure-tile').getAttribute('aria-label'),/Edit Pressure Support/);}
  for(let i=0;i<await tiles.count();i++){
   await tiles.nth(i).click();assert.doesNotMatch(await p.locator('#setting-consequence').innerText(),/draft/i);assert.match(await p.locator('#setting-consequence').innerText(),mode==='pc-cmva'?/Changing this value clears.*controller/:mode==='PC-CSV'?/new value takes effect.*Confirm/:/Changing this value can cancel.*manual hold/);
   const max=await p.locator('#setting-draft').getAttribute('max');await p.locator('#setting-draft').fill(max);await p.keyboard.press('Escape');
  }
  // Confirm maxima, including both queued adaptive settings, before measuring again.
  for(let i=0;i<await tiles.count();i++) { await tiles.nth(i).click();await p.locator('#setting-draft').fill(await p.locator('#setting-draft').getAttribute('max'));await p.locator('#setting-confirm').click(); }
  const maxBoxes=await tiles.evaluateAll(es=>es.map(e=>({h:e.getBoundingClientRect().height,overflow:e.scrollWidth>e.clientWidth,parts:[...e.querySelectorAll('.control__value,.setting-tile__unit,.setting-tile__pending:not([hidden])')].map(x=>({text:x.textContent,rect:x.getBoundingClientRect().toJSON()})),rect:e.getBoundingClientRect().toJSON()})));
  assert.ok(Math.max(...maxBoxes.map(b=>b.h))-Math.min(...maxBoxes.map(b=>b.h))<1);
  for(const b of maxBoxes){assert.equal(b.overflow,false);for(const x of b.parts)assert.ok(x.rect.right<=b.rect.right&&x.rect.bottom<=b.rect.bottom,JSON.stringify({width,mode,b}));}
  if(mode==='pc-cmva')assert.equal(await p.locator('.setting-tile__pending:visible').count(),2);
  if(width===1440||width===390)await p.locator('.controls').screenshot({path:'scratch/primary-tile-polish/'+mode+'-'+width+'.png'});
  cases++;
 }
 if(cases!==16)throw Error('Expected 16 layout cases');
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PRIMARY_TILE_POLISH_TALLY '+cases+' layout cases passed');
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1;});
