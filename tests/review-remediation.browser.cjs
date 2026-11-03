/** Browser gates for R-01/R-11; owns only its server on an isolated port. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = 8901;
const url = `http://127.0.0.1:${port}/index.html`;
const results = [];
async function test(name, fn) {
    try { await fn(); results.push(true); console.log('PASS ' + name); }
    catch (e) { results.push(false); console.error('FAIL ' + name + '\n' + e.stack); }
}
const fakeClock = () => {
    let callback = null, nextId = 0;
    window.reviewClock = { now: 0, frame(timestamp, now = timestamp) {
        this.now = now;
        const fn = callback; callback = null;
        if (!fn) throw new Error('No animation callback');
        fn(timestamp);
    } };
    Object.defineProperty(performance, 'now', { value: () => window.reviewClock.now });
    window.requestAnimationFrame = fn => { callback = fn; return ++nextId; };
    window.cancelAnimationFrame = () => { callback = null; };
};
(async () => {
    const server = spawn(process.execPath, ['tools/serve.mjs', String(port)], { cwd: root, windowsHide: true, stdio: 'pipe' });
    let browser;
    try {
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
            server.once('error', e => { clearTimeout(timer); reject(e); });
            server.stdout.on('data', chunk => { if (String(chunk).includes(String(port))) { clearTimeout(timer); resolve(); } });
            server.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code)); });
        });
        browser = await chromium.launch({ headless: true });
        await test('R01 deterministic control settlement, older rAF timestamp, pause/resume, reset', async () => {
            const page = await browser.newPage(); await page.addInitScript(fakeClock);
            await page.goto(url); await page.waitForFunction(() => window.__vsim);
            const actual = await page.evaluate(() => {
                const c = reviewClock, api = __vsim;
                api.setupEffort({ mode: 'vc-cmv', patientRR: 0, pMusMax: 0 }); api.resume();
                c.frame(6); c.now = 8; document.querySelector('[data-speed="4"]').click();
                c.frame(7, 8); c.frame(10);
                const speed = api.state().globalTime;
                c.now = 11; document.getElementById('btn-pause').click();
                const paused = api.state().globalTime;
                c.frame(900); c.now = 1001; document.getElementById('btn-pause').click();
                c.frame(999, 1001); c.frame(1002);
                const resumed = api.state().globalTime;
                c.now = 1003; document.getElementById('btn-reset').click();
                c.frame(1002, 1003); c.frame(1004);
                const reset = api.state().globalTime;
                c.frame(1006); return { speed, paused, resumed, reset, after: api.state().globalTime };
            });
            assert.deepEqual(actual, { speed: .01, paused: .02, resumed: .02, reset: 0, after: .01 });
            await page.close();
        });
        await test('R01 frozen deterministic fixtures do not accrue wall time through real controls', async () => {
            const page = await browser.newPage(); await page.addInitScript(fakeClock);
            await page.goto(url); await page.waitForFunction(() => window.__vsim);
            const actual = await page.evaluate(() => {
                const api = __vsim, c = reviewClock;
                api.setupEffort({ mode: 'pc-cmva', patientRR: 0, pMusMax: 0 });
                api.stepTicks(150);
                const start = api.state().globalTime;
                c.now = 10000; document.getElementById('btn-pause').click();
                const paused = api.state();
                c.now = 11000; document.querySelector('[data-speed="2"]').click();
                const speedWhilePaused = api.state().globalTime;
                c.now = 20000; document.getElementById('btn-pause').click();
                c.now = 21000; document.querySelector('[data-speed="4"]').click();
                const runningButFrozen = api.state();
                // Restarting the test transport rebases wall time, retaining exact tick state.
                c.now = 30000; api.resume(); c.frame(30001); c.frame(30003);
                return { start, paused: paused.globalTime, pausedRunning: paused.running,
                    speedWhilePaused, runningButFrozen: runningButFrozen.globalTime,
                    resumedRunning: runningButFrozen.running, resumed: api.state().globalTime };
            });
            assert.deepEqual(actual, { start: 1.5, paused: 1.5, pausedRunning: false,
                speedWhilePaused: 1.5, runningButFrozen: 1.5, resumedRunning: true, resumed: 1.51 });
            await page.close();
        });
        await test('R01 real browser animation in all four modes', async () => {
            const page = await browser.newPage(); await page.goto(url); await page.waitForFunction(() => window.__vsim);
            const receipt = await page.evaluate(async () => {
                const rows = [];
                for (const mode of ['vc-cmv', 'pc-cmv', 'PC-CSV', 'pc-cmva']) {
                    __vsim.setupEffort({ mode, patientRR: 0, pMusMax: 0, resistance: 10, compliance: .05, respiratoryRate: 12 });
                    const start = performance.now(); __vsim.resume();
                    await new Promise(resolve => {
                        function frame() { if (performance.now() - start >= 500) resolve(); else requestAnimationFrame(frame); }
                        requestAnimationFrame(frame);
                    });
                    const elapsed = (performance.now() - start) / 1000;
                    __vsim.pause(); rows.push({ mode, elapsed, simulated: __vsim.state().globalTime });
                }
                return rows;
            });
            for (const row of receipt) assert.ok(Math.abs(row.simulated - row.elapsed) < .04, JSON.stringify(row));
            console.log('REAL_ANIMATION ' + JSON.stringify(receipt)); await page.close();
        });
        await test('R11 exact independent fixture displays breath 22 signed PIP and resets to unavailable', async () => {
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            await page.goto(url); await page.waitForFunction(() => window.__vsim);
            const rows = await page.evaluate(() => {
                const api = __vsim;
                api.setupEffort({ mode: 'vc-cmv', resistance: 5, compliance: .1, respiratoryRate: 35,
                    ieRatio: [1, 2], targetVT_mL: 200, peep_cmH2O: 0, pMusMax: 12,
                    neuralTi: 2, patientRR: 10, triggerType: 'pressure', pressureTriggerCmH2O: 5 });
                const rows = []; let max = -Infinity, last = null;
                for (let i = 0; i < 4100; i++) {
                    const s = api.stepTicks(1), sample = s.physicsSample;
                    if (sample.phase === 'INSPIRATION') max = Math.max(max, sample.paw_cmH2O);
                    if (s.completed && s.completed.breathId !== last) {
                        if (s.completed.breathId >= 20) rows.push({ id: s.completed.breathId, expected: max,
                            canonical: s.completed.measuredPIP_cmH2O, latch: s.pipLatched,
                            display: document.getElementById('param-pip').textContent,
                            alarm: s.alarmPip, live: s.runningPip });
                        last = s.completed.breathId; max = -Infinity;
                        if (last === 22) break;
                    }
                }
                return rows;
            });
            fs.mkdirSync(path.join(root, 'evidence'), { recursive: true });
            await page.screenshot({ path: path.join(root, 'evidence/r11-breath22.png'), fullPage: true });
            await page.locator('#param-pip').screenshot({ path: path.join(root, 'evidence/r11-pip.png') });
            assert.equal(rows.length, 3);
            for (const r of rows) {
                assert.equal(r.canonical, r.expected); assert.equal(r.latch, Math.round(r.expected * 10) / 10);
                assert.equal(Number(r.display), r.latch); assert.equal(r.alarm, r.live);
            }
            assert.ok(rows[2].expected < -.3 && rows[2].expected > -.4);
            console.log('SIGNED_BROWSER_PIP ' + JSON.stringify(rows));
            await page.locator('#btn-reset').click(); assert.equal(await page.locator('#param-pip').textContent(), '—');
            await page.close();
        });
        await test('R02 UI rejects overlap, shows applied/queued timing and applies only at boundary in all modes', async () => {
            const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
            await page.goto(url); await page.waitForFunction(() => window.__vsim);
            for (const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']) {
                const initial = await page.evaluate(mode => {
                    __vsim.setupEffort({ mode, pMusMax:4, patientRR:12, neuralTi:1, respiratoryRate:6,
                        ieRatio:[1,4], triggerType:'pressure', pressureTriggerCmH2O:5 });
                    document.querySelectorAll('.controls [data-collapsible][data-collapsed]').forEach(e=>e.click());
                    __vsim.stepTicks(525);
                    const input=(id,value)=>{const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
                    input('patient-rr',30);input('neural-ti',20);input('patient-rr',35);
                    return {state:__vsim.state(), rr:document.getElementById('patient-rr').value,
                        ti:document.getElementById('neural-ti').value,notice:document.getElementById('effort-timing-status').textContent};
                }, mode);
                assert.equal(initial.rr,'30');assert.equal(initial.ti,'20');
                assert.deepEqual(initial.state.effortTiming.applied,{patientRR:12,neuralTi:1});
                assert.deepEqual(initial.state.effortTiming.pending,{patientRR:30,neuralTi:2});
                assert.match(initial.notice,/rejected:.*exceeds.*Applied: RR 12.*Waiting: RR 30/s);
                const s=await page.evaluate(()=>__vsim.stepTicks(1));
                assert.ok(Math.abs(s.physicsSample.pmus_cmH2O-4*Math.sin(Math.PI*.26))<1e-8);
                if(mode==='vc-cmv') {
                    assert.equal(await page.locator('#neural-ti-display').textContent(),'2.0 s');
                    await page.screenshot({path:path.join(root,'evidence/r02-pending-standard.png'),fullPage:true});
                    await page.evaluate(()=>document.getElementById('btn-teaching-mode').click());
                    assert.equal(await page.locator('#effort-timing-status').isVisible(),true);
                    await page.screenshot({path:path.join(root,'evidence/r02-pending-teaching.png'),fullPage:true});
                    await page.setViewportSize({width:390,height:844});
                    assert.equal(await page.locator('#effort-timing-status').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
                    await page.screenshot({path:path.join(root,'evidence/r02-pending-narrow.png'),fullPage:true});
                    await page.setViewportSize({width:1440,height:1000});
                    await page.evaluate(()=>document.getElementById('btn-teaching-mode').click());
                }
                const applied=await page.evaluate(()=>__vsim.stepTicks(475));
                assert.deepEqual(applied.effortTiming.applied,{patientRR:30,neuralTi:2});
                assert.equal(applied.effortTiming.pending,null);
            }
            await page.close();
        });
        await test('R02 effort Off/On preserves clock and interrupted/resolved outcomes without new markers',async()=>{
            const page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>window.__vsim);
            const rows=await page.evaluate(()=>{
                const rows=[];
                for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']) {
                    __vsim.setupEffort({mode,pMusMax:4,patientRR:12,neuralTi:1,respiratoryRate:6,
                        ieRatio:[1,4],triggerType:'pressure',pressureTriggerCmH2O:5});
                    const start=__vsim.stepTicks(525);
                    document.getElementById('pmus-toggle').click();const off=__vsim.stepTicks(50);
                    document.getElementById('pmus-toggle').click();const on=__vsim.stepTicks(100);
                    rows.push({mode,clock:start.resetDiagnostics.neuralTimer,offClock:off.resetDiagnostics.neuralTimer,
                        record:off.effortInterruptions.at(-1),failed:on.failedTriggers,patient:on.patientBreaths});
                }
                // Already delivered remains a delivered outcome, with mechanical interruption only.
                __vsim.setupEffort({mode:'PC-CSV',pMusMax:8,patientRR:12,neuralTi:1,triggerType:'flow',flowTriggerLpm:2});
                let s=__vsim.state();for(let i=0;i<700&&s.patientBreaths===0;i++)s=__vsim.stepTicks(1);
                const old=JSON.stringify(s.triggerEvents);document.getElementById('pmus-toggle').click();
                const stopped=__vsim.state();document.getElementById('pmus-toggle').click();__vsim.stepTicks(50);
                return {rows,prior:old,after:JSON.stringify(__vsim.state().triggerEvents),record:stopped.effortInterruptions.at(-1)};
            });
            for(const r of rows.rows){assert.equal(r.clock,r.offClock);assert.equal(r.record.terminal,true);
                assert.equal(r.record.disposition,'interrupted');assert.equal(r.failed,0);assert.equal(r.patient,0);}
            assert.equal(rows.prior,rows.after);assert.equal(rows.record.terminal,false);
            await page.close();
        });
        await test('R02 timing edits immediately invalidate hold; paired import rejection and Reset are atomic',async()=>{
            const page=await browser.newPage();await page.goto(url);await page.waitForFunction(()=>window.__vsim);
            await page.evaluate(()=>{
                __vsim.setupEffort({mode:'vc-cmv',pMusMax:4,patientRR:12,neuralTi:1,respiratoryRate:6,ieRatio:[1,4]});
                document.querySelectorAll('.controls [data-collapsible][data-collapsed]').forEach(e=>e.click());
            });
            await page.locator('#hold-toggle').focus();await page.keyboard.down('Space');
            const r=await page.evaluate(()=>{
                let s=__vsim.state();for(let i=0;i<400&&!s.manualHold.active;i++)s=__vsim.stepTicks(1);
                if(!s.manualHold.active)throw Error('Hold fixture did not enter');
                const time=s.globalTime;const input=(id,value)=>{const e=document.getElementById(id);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
                input('patient-rr',30);input('neural-ti',20);s=__vsim.state();
                const before=JSON.stringify({time:s.globalTime,timing:s.effortTiming,events:s.triggerEvents});let rejected=false;
                try{__vsim.setupEffort({patientRR:35,neuralTi:2});}catch{rejected=true;}
                const after=__vsim.state();
                return {time,afterTime:s.globalTime,active:s.manualHold.active,attempt:s.lastManualHoldAttempt,
                    before,after:JSON.stringify({time:after.globalTime,timing:after.effortTiming,events:after.triggerEvents}),rejected};
            });
            await page.keyboard.up('Space');
            assert.equal(r.active,false);assert.equal(r.time,r.afterTime);assert.equal(r.rejected,true);assert.equal(r.before,r.after);
            assert.equal(r.attempt.mechanics.pplat.value,null);
            await page.locator('#btn-reset').click();const s=await page.evaluate(()=>__vsim.state());
            assert.deepEqual(s.effortTiming.applied,{patientRR:30,neuralTi:2});assert.equal(s.effortTiming.pending,null);
            assert.equal(s.globalTime,0);assert.deepEqual(s.effortInterruptions,[]);
            await page.close();
        });
    } finally { if (browser) await browser.close(); server.kill(); }
    const tally = { groups: results.length, passed: results.filter(Boolean).length, failed: results.filter(x => !x).length };
    console.log('REVIEW_BROWSER_TALLY ' + JSON.stringify(tally));
    if (tally.groups !== 7 || tally.failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
