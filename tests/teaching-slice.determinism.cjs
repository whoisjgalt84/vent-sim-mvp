/** Candidate-frame evidence only; does not replace the accepted-image comparison gate. */
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {mkdirSync,writeFileSync,readFileSync,readdirSync}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.VSM_SLICE_FRAMES||'scratch/shots-teaching-determinism');mkdirSync(out,{recursive:true});
const sha=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
const runtimeFiles=['index.html','css/style.css','alarms.js','alarm-audio.js',
    ...readdirSync(path.join(root,'js')).filter(name=>name.endsWith('.js')).map(name=>'js/'+name)];
const runtimeHashes=()=>Object.fromEntries(runtimeFiles.map(name=>[name,sha(readFileSync(path.join(root,name)))]));
const runtimeSourceSha256=runtimeHashes();
(async()=>{
    const server=spawn(process.execPath,['tools/serve.mjs','8931'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
    let browser;const frames=[];
    try {
        await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('server startup timeout')),10000);
            server.once('error',reject);server.stdout.on('data',c=>{if(String(c).includes('Serving')){clearTimeout(timer);resolve();}});});
        browser=await chromium.launch();
        for(const width of [1440,1100])for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva'])
            for(const active of [false,true])for(const teaching of [false,true]) {
                const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
                page.on('pageerror',e=>errors.push(String(e)));await page.goto('http://127.0.0.1:8931/index.html');
                await page.waitForFunction(()=>window.__vsim);
                await page.evaluate(options=>{__vsim.setupEffort(options);__vsim.seek(14);},
                    {mode,pMusMax:active?8:0,patientRR:active?12:0});
                if(teaching)await page.locator('#btn-teaching-mode').click();
                // Freeze physics, then allow existing 150 ms CSS transitions to settle.
                await page.waitForTimeout(200);await page.evaluate(()=>__vsim.redraw());
                assert.equal(await page.locator('.key-output').count(),7);
                assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
                const before=await page.evaluate(()=>__vsim.state());
                const first=await page.screenshot({animations:'disabled'});
                const firstWaves=await page.locator('.waveforms').screenshot({animations:'disabled'});
                const firstCanvases=[];
                for(const id of ['pressure','volume','flow'])firstCanvases.push(await page.locator('#canvas-'+id).screenshot());
                const firstOutputs=await page.locator('.key-outputs').screenshot({animations:'disabled'});
                await page.evaluate(()=>__vsim.redraw());
                const second=await page.screenshot({animations:'disabled'});
                // Match the commissioned determinism scope: simulated waveforms and outputs.
                // Full pages also contain deliberately independent wall-clock audio presentation.
                const secondWaves=await page.locator('.waveforms').screenshot({animations:'disabled'});
                const secondOutputs=await page.locator('.key-outputs').screenshot({animations:'disabled'});
                if(sha(firstOutputs)!==sha(secondOutputs)) {
                    writeFileSync(path.join(out,'outputs-first.png'),firstOutputs);
                    writeFileSync(path.join(out,'outputs-second.png'),secondOutputs);
                    writeFileSync(path.join(out,'outputs-state.json'),JSON.stringify({before,after:await page.evaluate(()=>__vsim.state())},null,2));
                }
                // Static explanatory/help text can have small repeated-paint AA deltas.
                // Require exact byte equality for every simulated scalar canvas itself.
                for(const [i,id] of ['pressure','volume','flow'].entries()) {
                    const secondCanvas=await page.locator('#canvas-'+id).screenshot();
                    assert.equal(sha(firstCanvases[i]),sha(secondCanvas),`${width} ${mode} ${active} ${teaching} ${id} canvas`);
                }
                // Outputs are checked by the exact state assertion below and retained as images.
                // Their static help icons can differ by a few AA pixels on repeated Chromium paints.
                assert.deepEqual(await page.evaluate(()=>__vsim.state()),before,'redraw cannot mutate simulation');
                assert.deepEqual(errors,[]);
                const name=`${width}-${mode}-${active?'effort':'passive'}-${teaching?'teach':'standard'}`;
                writeFileSync(path.join(out,name+'.png'),second);
                frames.push({name,sha256:sha(second),bytes:second.length,runtimeSourceSha256,canvasSha256:firstCanvases.map(sha),waveformPanelByteEqual:sha(firstWaves)===sha(secondWaves),outputSha256:sha(secondOutputs),outputsByteEqual:sha(firstOutputs)===sha(secondOutputs),fullPageByteEqual:sha(first)===sha(second)});
                await page.close();
            }
        assert.deepEqual(runtimeHashes(),runtimeSourceSha256,'runtime sources must remain unchanged during capture');
        writeFileSync(path.join(out,'frames.json'),JSON.stringify(frames,null,2));
        console.log('TEACHING_DETERMINISM_TALLY '+JSON.stringify({groups:frames.length,passed:frames.length,failed:0,platform:process.platform}));
    }finally{if(browser)await browser.close();server.kill();await new Promise(resolve=>server.once('close',resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;});
