/** Shared-reset browser receipts. Uses actual native buttons and trusted events.
 * RESET_BROWSER_OUTPUT saves report/screenshots outside accepted snapshots.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const APP = process.env.VENT_SIM_URL || 'http://127.0.0.1:8899/index.html';
const OUT = process.env.RESET_BROWSER_OUTPUT;
const results = [], receipts = [];
const state = page => page.evaluate(() => window.__vsim.state());
const step = (page, ticks) => page.evaluate(n => window.__vsim.stepTicks(n), ticks);
const text = (page, selector) => page.locator(selector).innerText();
async function rail(page) { await page.locator('.controls [data-collapsible][data-collapsed]').evaluateAll(els => els.forEach(el => el.click())); }
async function singleResetControl(page) {
    assert.equal(await page.locator('#adaptive-reset').count(), 0, 'legacy adaptive reset removed from DOM');
    const controls = page.getByRole('button', { name: /^Reset(?: demonstration)?$/ });
    assert.equal(await controls.count(), 1, 'exactly one visible reset control');
    assert.equal(await controls.getAttribute('id'), 'btn-reset', 'shared header reset is the sole control');
    assert.equal(await controls.isDisabled(), false, 'shared reset remains enabled');
}
async function range(page, id, value) {
    await page.locator(id).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, String(value));
}
async function setup(page, mode, active = false, holdTime = 0) {
    if ((await state(page)).teachingMode) await page.locator('#btn-teaching-mode').click();
    await page.evaluate(o => window.__vsim.setupEffort(o), { mode, pMusMax: active ? 8 : 0,
        patientRR: active ? 12 : 0, neuralTi: 0.8, resistance: 20, compliance: 0.07,
        respiratoryRate: 25, ieRatio: [1, 1], holdTime, triggerType: 'flow', flowTriggerLpm: 2 });
    await rail(page);
    await singleResetControl(page);
    await page.locator('#speed-group [data-speed="1"]').click(); // ordinary gesture arms existing audio policy
}
async function running(page, on) { if ((await state(page)).running !== on) await page.locator('#btn-pause').click(); }
function clear(s, before) {
    assert.equal(s.globalTime, 0, 'sim time reset synchronously');
    assert.equal(s.running, before.running, 'transport'); assert.equal(s.mode, before.mode, 'mode');
    const d = s.resetDiagnostics;
    for (const key of ['volumeAboveEq', 'neuralTimer', 'phaseTime']) assert.equal(d[key], 0, key);
    assert.equal(s.liveTrapped_mL, 0); assert.equal(s.completed, null); assert.equal(s.pipLatched, 0);
    assert.equal(s.measuredRRRaw, 0); assert.equal(s.failedTriggers, 0);
    assert.equal(d.scheduledBreathTrigger, null); assert.equal(d.pendingTriggerDetection, null);
    for (const loop of [d.loopCurrent, d.loopCompleted]) assert.deepEqual(loop, { pressure: [], volume: [], flow: [] });
    assert.deepEqual(d.loopDataStatus, { pv: 'unavailable', fv: 'unavailable' }, 'both loop canvases clear even while hidden');
    assert.deepEqual(s.pvGeometry.xRange, { lo: 0, hi: 10, step: 2 }, 'empty signed-pressure loop axes');
    assert.equal(s.fvGeometry, null, 'F-V canvas clears even while hidden');
    for (const renderer of Object.values(s.renderers)) assert(renderer.geometry.tMax <= 0, 'no old trace remains rendered');
    for (const key of ['volume', 'flow']) assert.deepEqual(d.traceExtent[key], { minimum: 0, maximum: 0 });
    assert(d.traceExtent.time.maximum < 0, 'prefill contains only new baseline');
    assert.deepEqual(d.traceExtent.pressure, { minimum: s.operatorSettings.peep_cmH2O, maximum: s.operatorSettings.peep_cmH2O });
    const csv = s.mode === 'PC-CSV';
    assert.equal(s.phase, csv ? 'EXPIRATION' : 'INSPIRATION'); assert.equal(s.breathCount, csv ? 0 : 1);
    assert.deepEqual(s.triggerEvents.map(e => e.type), csv ? [] : ['machine']);
    assert.equal(s.deliveredVentilation.status, 'warming'); assert.equal(s.deliveredVentilation.completedCount, 0);
    assert.equal(s.deliveredVentilation.observedSeconds, 0); assert.equal(s.deliveredVentilation.valueLpm, null);
    assert(s.deliveredVentilation.simulationGeneration > before.deliveredVentilation.simulationGeneration);
    assert.deepEqual(s.monitorDelivery, s.deliveredVentilation); assert.equal(s.holdMechanics.pplat.value, null);
    assert.deepEqual(s.activeAlarms, []); assert.equal(s.evaluatedDelivery, null);
    if (s.adaptiveState) {
        assert.equal(s.adaptiveState.applied_cmH2O, s.adaptiveState.config.initialPressure_cmH2O);
        for (const key of ['pendingSettings', 'latestDecision', 'lastFeedback', 'pending']) assert.equal(s.adaptiveState[key], null, key);
    }
}
function retained(s, before, changes = {}) {
    const after = s.resetDiagnostics, old = before.resetDiagnostics;
    assert.deepEqual(after.configuration, { ...old.configuration, ...changes }, 'all ventilator settings');
    for (const key of ['resistance', 'compliance', 'alarmLimits', 'speed', 'displaySeconds', 'loopsVisible', 'customMechanics']) assert.deepEqual(after[key], old[key], key);
    assert.equal(s.operatorSettings.patientRR, before.operatorSettings.patientRR);
    assert.equal(s.teachingMode, before.teachingMode);
    for (const key of ['enabled', 'armed', 'silencedUntilSec', 'lastSoundAtSec']) assert.equal(s.alarmAudio[key], before.alarmAudio[key], 'audio ' + key);
}
async function reset(page, selector = '#btn-reset', keyboard = false) {
    // Target handler has run when the trusted click bubbles to document. Capture
    // synchronous presentation before the next normal alarm-evaluating frame.
    await page.evaluate(() => { window.resetReceipt = null; });
    if (keyboard) { await page.locator(selector).focus(); await page.keyboard.press('Enter'); }
    else await page.locator(selector).click();
    return page.evaluate(() => window.resetReceipt);
}
async function image(page, name) { if (OUT) await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true, animations: 'disabled' }); }
const groups = ['vc-cmv', 'pc-cmv', 'PC-CSV', 'pc-cmva'].map(mode => [mode + '-phase-effort-transport-repeat', async page => {
    const rows = [];
    for (const active of [false, true]) for (const playing of [false, true]) {
        await setup(page, mode, active); await step(page, 3400);
        assert.equal((await state(page)).deliveredVentilation.status, 'available');
        if (mode !== 'PC-CSV' || active) assert((await state(page)).completed, 'nonempty prior measured output');
        await page.locator('#speed-group [data-speed="2"]').click();
        await page.locator('#window-group [data-window="20"]').click();
        await page.locator('#btn-loops').click(); await page.locator('#btn-teaching-mode').click();
        await singleResetControl(page);
        await running(page, playing); const before = await state(page);
        const effortBefore = await page.evaluate(() => ({ effortInput: document.getElementById('pmus-max').value, effortReadout: document.getElementById('pmus-max-display').textContent.trim() }));
        const s = await reset(page);
        assert(s.trusted, 'trusted native click'); clear(s.state, before); retained(s.state, before);
        assert.deepEqual(s.dom, { pip: '—', vt: '—', ve: '—', veStatus: 'Collecting 30 s', alarms: 'No alerts', unknownHidden: true, breathInfo: s.dom.breathInfo, ...effortBefore });
        assert(s.dom.breathInfo.includes('#' + (mode === 'PC-CSV' ? 0 : 1)));
        if (active) {
            assert.equal(s.dom.effortInput, String(s.state.operatorSettings.pMusMax));
            assert.equal(s.dom.effortReadout, `${s.state.operatorSettings.pMusMax} cmH₂O`);
        }
        await running(page, false);
        const paused = await state(page), again = await reset(page, '#btn-reset', true);
        clear(again.state, paused); retained(again.state, paused); assert(again.trusted, 'keyboard activation');
        await page.waitForTimeout(80); assert.equal((await state(page)).globalTime, 0, 'paused reset never resumes');
        rows.push({ active, playing, before, synchronous: s });
    }
    for (const phase of ['INSPIRATION', 'EXPIRATION', ...(['vc-cmv', 'pc-cmv'].includes(mode) ? ['HOLD'] : [])]) {
        await setup(page, mode, true);
        if (phase === 'HOLD') await page.locator('#hold-toggle').click();
        const before = await page.evaluate(phase => {
            for (let i = 0; i < 6000; i++) { const s = __vsim.stepTicks(1); if (s.phase === phase && s.resetDiagnostics.phaseTime > 0.1) return s; }
            throw Error('Requested reset phase not reached: ' + phase);
        }, phase);
        const s = await reset(page); clear(s.state, before); retained(s.state, before); rows.push({ phase, before, synchronous: s });
    }
    for (const teaching of [false, true]) {
        if ((await state(page)).teachingMode !== teaching) await page.locator('#btn-teaching-mode').click();
        await singleResetControl(page);
        await image(page, `${mode}-${teaching ? 'teaching' : 'standard'}-reset`);
    }
    // Resume the actual animation loop for both transport states. Deterministic
    // stepTicks fixtures alone cannot establish live pause/play behavior.
    await setup(page, mode, true); await page.evaluate(() => __vsim.resume());
    await running(page, true); await page.waitForFunction(() => __vsim.state().globalTime > 0.1);
    let before = await state(page), live = await reset(page); clear(live.state, before);
    await page.waitForFunction(() => __vsim.state().globalTime > 0.1); assert((await state(page)).running);
    await running(page, false); before = await state(page); live = await reset(page); clear(live.state, before);
    await page.waitForTimeout(150); assert.equal((await state(page)).globalTime, 0); assert.equal((await state(page)).running, false);
    receipts.push({ group: mode, rows, livePausedReset: live });
}]);
groups.push(['adaptive-pending-maximum-and-header-reset', async page => {
    const rows = [];
    for (const maximum of [20, 25]) for (const playing of [false, true]) for (const queue of ['target', 'peep', 'both']) {
        await setup(page, 'pc-cmva', true); await step(page, 1400);
        assert((await state(page)).adaptiveState.lastFeedback, 'obsolete feedback fixture');
        if (queue !== 'peep') await range(page, '#vt', 650);
        if (queue !== 'target') await range(page, '#peep', 9);
        await page.locator('#adaptive-maximum').selectOption(String(maximum));
        await running(page, playing);
        const before = await state(page), s = await reset(page);
        clear(s.state, before); retained(s.state, before, { tidalVolume: queue === 'peep' ? before.resetDiagnostics.configuration.tidalVolume : 0.65, peep: queue === 'target' ? before.resetDiagnostics.configuration.peep : 9 });
        assert.equal(s.state.adaptiveState.config.maximumPressure_cmH2O, maximum);
        assert.equal(await page.locator('#adaptive-maximum').inputValue(), String(maximum));
        assert.equal(await page.locator('#vt').inputValue(), queue === 'peep' ? '500' : '650');
        assert.equal(await page.locator('#peep').inputValue(), queue === 'target' ? '5' : '9');
        assert.equal(await text(page, '#adaptive-achieved'), '—'); assert.equal(await text(page, '#adaptive-next'), '—');
        rows.push({ maximum, playing, queue, before, synchronous: s });
    }
    // Zero is a valid adaptive prescription; shared reset must not run the
    // destination-mode min=0.25 synchronization involved in the deferred issue.
    await setup(page, 'pc-cmva', true); await range(page, '#pmus-max', 0);
    const before = await state(page), s = await reset(page); clear(s.state, before); retained(s.state, before);
    assert.equal(s.state.operatorSettings.pMusMax, 0); assert.equal(await page.locator('#pmus-max').inputValue(), '0');
    receipts.push({ group: 'adaptive', rows, zeroEffort: s });
}]);
groups.push(['fresh-measurements-ve-window-and-alarm-eligibility', async page => {
    await setup(page, 'vc-cmv'); await step(page, 3400); const before = await state(page);
    assert.notEqual(await text(page, '#param-vt'), '—'); assert.notEqual(await text(page, '#param-ve'), '—');
    const s = await reset(page); clear(s.state, before); retained(s.state, before);
    await step(page, 2999); assert.equal((await state(page)).deliveredVentilation.status, 'warming');
    assert.equal(await text(page, '#param-ve'), '—'); assert(!(await state(page)).activeAlarms.some(a => /ve/i.test(a.id)), 'VE remains ineligible');
    assert((await state(page)).completed.simulationGeneration > before.completed.simulationGeneration);
    await step(page, 1); assert.equal((await state(page)).deliveredVentilation.status, 'available'); assert.notEqual(await text(page, '#param-ve'), '—');
    receipts.push({ group: 'new-measurements', synchronous: s, at30: await state(page) });
}]);
groups.push(['alarm-mute-silence-and-new-run-reevaluation', async page => {
    await setup(page, 'PC-CSV'); await range(page, '#alarm-apnea', 10); await step(page, 1200);
    assert((await state(page)).activeAlarms.some(a => a.id === 'APNEA'), 'apnea fixture');
    await page.locator('#alarm-silence-btn').click();
    let before = await state(page), s = await reset(page); clear(s.state, before); retained(s.state, before);
    assert(!(await page.locator('#alarm-silence-btn').isDisabled()), 'silence cancellable after alarm clears');
    assert((await text(page, '#alarm-silence-btn')).startsWith('Silenced'));
    await image(page, 'alarm-silenced-reset');
    await step(page, 1200); assert((await state(page)).activeAlarms.some(a => a.id === 'APNEA'));
    assert.equal((await state(page)).alarmAudio.lastSoundAtSec, before.alarmAudio.lastSoundAtSec, 'no beep while silenced');
    await page.locator('#alarm-silence-btn').click(); assert.equal((await state(page)).alarmAudio.silencedUntilSec, 0, 'native cancellation');
    await page.locator('#alarm-mute-btn').click(); before = await state(page); assert.equal(before.alarmAudio.enabled, false);
    s = await reset(page); clear(s.state, before); retained(s.state, before); assert.equal(await text(page, '#alarm-mute-btn'), 'Muted');
    await step(page, 1200); assert((await state(page)).activeAlarms.some(a => a.id === 'APNEA')); assert.equal((await state(page)).alarmAudio.enabled, false);
    receipts.push({ group: 'alarm-audio', synchronous: s, reevaluated: await state(page) });
}]);
groups.push(['native-help-controls-and-header-geometry', async page => {
    await setup(page, 'pc-cmva', true);
    const trigger = page.locator('[data-measurement-help="demonstration-reset"]');
    await trigger.focus(); assert(await page.locator('#measurement-help').isVisible());
    const copy = await text(page, '#measurement-help-text');
    for (const phrase of ['currently selected settings', 'paused or running', 'not a treatment effect', '30 s', 'selected maximum']) assert(copy.includes(phrase), phrase);
    await page.keyboard.press('Escape'); assert(!(await page.locator('#measurement-help').isVisible())); assert(await trigger.evaluate(el => document.activeElement === el));
    for (const width of [1440, 1100, 800]) {
        await page.setViewportSize({ width, height: 900 });
        for (const teaching of [false, true]) {
            if ((await state(page)).teachingMode !== teaching) await page.locator('#btn-teaching-mode').click();
            const boxes = await page.locator('.header__transport > button').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { id: el.id, left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, clipped: el.scrollWidth > el.clientWidth }; }));
            assert(boxes.every(b => b.left >= 0 && b.right <= width && b.width > 0 && !b.clipped), 'all transport controls visible/unclipped');
            for (let i = 1; i < boxes.length; i++) assert(boxes[i].left >= boxes[i - 1].right, 'no transport overlap');
            const clusters = await page.locator('.header__status, .header__transport, .header__alerts').evaluateAll(els => els.map(el => {
                const nodes = [el, ...el.querySelectorAll('button, .header__mode, .header__status-chip')];
                const boxes = nodes.map(el => el.getBoundingClientRect());
                return { left: Math.min(...boxes.map(r => r.left)), right: Math.max(...boxes.map(r => r.right)), top: Math.min(...boxes.map(r => r.top)), bottom: Math.max(...boxes.map(r => r.bottom)) };
            }));
            for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
                const a = clusters[i], b = clusters[j];
                assert(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top, 'header clusters do not overlap');
            }
            assert(await page.locator('#btn-reset').isVisible()); assert(!(await page.locator('#btn-reset').isDisabled()));
            await image(page, `header-${width}-${teaching ? 'teaching' : 'standard'}`); receipts.push({ group: 'geometry', width, teaching, boxes });
        }
    }
    assert.equal(await page.locator('#btn-reset').getAttribute('type'), 'button');
}]);
(async () => {
    if (OUT) fs.mkdirSync(OUT, { recursive: true });
    assert.equal(groups.length, 8);
    const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
    try {
        const selected = process.env.RESET_BROWSER_GROUP ? groups.filter(([name]) => name === process.env.RESET_BROWSER_GROUP) : groups;
        assert(selected.length > 0, 'unknown targeted mutation group');
        for (const [name, run] of selected) {
            const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
            page.on('pageerror', error => errors.push(String(error)));
            try {
                await page.goto(APP, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__vsim);
                await page.evaluate(() => document.addEventListener('click', event => {
                    if (event.target.id !== 'btn-reset') return;
                    const content = id => document.getElementById(id).textContent.trim();
                    window.resetReceipt = { trusted: event.isTrusted, state: __vsim.state(), dom: {
                        pip: content('param-pip'), vt: content('param-vt'), ve: content('param-ve'), veStatus: content('ve-status'),
                        alarms: content('alarm-chip-list'), unknownHidden: document.getElementById('unknown-patient-trigger').hidden,
                        effortInput: document.getElementById('pmus-max').value, effortReadout: content('pmus-max-display'),
                        breathInfo: content('breath-info') } };
                }));
                await run(page); assert.deepEqual(errors, []); results.push({ name, passed: true }); console.log('PASS reset-browser: ' + name);
            } catch (error) { results.push({ name, passed: false, error: error.stack, errors }); console.error('FAIL reset-browser: ' + name + '\n' + error.stack); await image(page, 'failure-' + name).catch(() => {}); }
            finally { await page.close(); }
        }
    } finally { await browser.close(); }
    const tally = { groups: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length };
    if (OUT) fs.writeFileSync(path.join(OUT, 'reset-browser-report.json'), JSON.stringify({ tally, results, receipts }, null, 2));
    console.log('DEMONSTRATION_RESET_BROWSER_TALLY ' + JSON.stringify(tally));
    if (tally.groups !== (process.env.RESET_BROWSER_GROUP ? 1 : 8) || tally.failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
