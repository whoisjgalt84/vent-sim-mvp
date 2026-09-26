/** Twelve commissioned PC-CMVa browser groups. Requires the normal :8899 server.
 * No baselines are written. Optional ADAPTIVE_BROWSER_OUTPUT records JSON;
 * ADAPTIVE_BROWSER_SHOTS records diagnostic screenshots in an explicit directory.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const APP = process.env.VENT_SIM_URL || 'http://127.0.0.1:8899/index.html';
const MODE = '.mode-btn[data-mode="pc-cmva"]';
const HELP = {
    mode: 'Pressure-controlled continuous mandatory ventilation with adaptive targeting. The model holds an inspiratory pressure command during each breath and adjusts the next command from completed inspired volume. This is a generic educational controller.',
    tag: 'Conventional feedback control. This controller does not learn, reason clinically, or reproduce a particular commercial ventilator.',
    target: 'Operator-selected volume target for eligible completed inspirations. A target is not a guarantee of delivered volume.',
    achieved: 'Unrounded modeled inspired volume from the last completed inspiration drives adaptation. This display rounds to whole milliliters. The record is finalized when expiration starts; it is not a separate exhaled-volume measurement.',
    pressure: 'Pressure command applied to the current or most recently started breath, above set PEEP. It is separate from measured peak airway pressure and from total PEEP. Patient contribution and mechanics can change achieved volume.',
    next: 'Command calculated from the identified completed inspiration. It applies only when the next breath starts and may be canceled by an input change.',
    bounds: 'Educational controller bounds above set PEEP. These are not alarm thresholds, clinical safety limits, or pressure above total PEEP. Configure bounds before resetting a demonstration.',
    effort: "Instructor-selected peak amplitude of this model's periodic inspiratory muscle-pressure waveform. Effort does not respond physiologically to changing assistance. This amplitude is not measured work of breathing.",
    hold: 'Inspiratory hold is excluded from this initial adaptive demonstration. Hold-derived measurements remain unavailable in this mode.',
    predictions: 'Fixed-pressure steady-state predictions are unavailable while pressure adapts between breaths.',
    idealization: 'In PC-CMVa, Paw stays at the latched set PEEP plus adaptive pressure during each pressure-targeted inspiration. The next pressure command may change between breaths. Patient effort can change flow and delivered volume. Real ventilators may also show pressure deformation; this trace is a model idealization.',
    targetPending: 'The new target applies at the next breath. The current inspiration will not be used to adjust pressure after this edit. Reset or a mode change retains your latest selected value; it does not wait for another adaptive breath. Destination modes use settings only where applicable.',
    peepPending: 'The new set PEEP applies at the next breath. The current inspiratory pressure target remains unchanged until then. Reset or a mode change retains your latest selected value; it does not wait for another adaptive breath. Destination modes use settings only where applicable.',
};
const state = page => page.evaluate(() => window.__vsim.state());
const text = (page, selector) => page.locator(selector).textContent().then(x => x.trim());
const range = (page, selector, value) => page.locator(selector).evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const step = (page, count) => page.evaluate(n => window.__vsim.stepTicks(n), count);
const complete = (page, count) => page.evaluate(n => window.__vsim.stepToCompleted(n), count);
async function rail(page) { await page.locator('.controls [data-collapsible][data-collapsed]').evaluateAll(els => els.forEach(el => el.click())); }
async function teaching(page, on) { if ((await state(page)).teachingMode !== on) await page.locator('#btn-teaching-mode').click(); }
async function running(page, on) { if ((await state(page)).running !== on) await page.locator('#btn-pause').click(); }
async function setup(page, options = {}) { await teaching(page, false); await page.evaluate(o => window.__vsim.setupAdaptive(o), options); await rail(page); }
async function nextStart(page) {
    return page.evaluate(() => {
        const api = window.__vsim, old = api.state().breathCount;
        for (let i = 0; i < 2000; i++) { const s = api.stepTicks(1); if (s.breathCount > old) return s; }
        throw Error('No next breath boundary');
    });
}
async function help(page, key, expected, selector = `#adaptive-panel [data-measurement-help="${key}"]`) {
    const trigger = page.locator(selector).first();
    await trigger.focus();
    assert(await page.locator('#measurement-help').isVisible(), `${key}: help did not open`);
    assert.equal(await text(page, '#measurement-help-text'), expected, `${key}: exact approved help`);
    assert.equal(await trigger.getAttribute('aria-describedby'), 'measurement-help');
    await page.keyboard.press('Escape');
    assert(!(await page.locator('#measurement-help').isVisible()), `${key}: Escape did not dismiss`);
    assert(await trigger.evaluate(el => document.activeElement === el), `${key}: Escape focus restoration`);
}

const groups = [
    ['mode-entry-and-unavailable-feedback', async page => {
        await page.locator(MODE).click(); await rail(page);
        const s = await state(page);
        assert.equal(s.mode, 'pc-cmva'); assert.equal(s.completed, null); assert.equal(s.adaptiveState.applied_cmH2O, 10);
        assert.equal(await text(page, '#adaptive-status'), 'Awaiting completed inspiration');
        assert.equal(await text(page, '#adaptive-achieved'), '—'); assert.equal(await text(page, '#adaptive-next'), '—');
        assert.equal(await text(page, '#adaptive-target'), '500');
        assert((await text(page, '#mode-label')).includes('Adaptive targeting'));
        assert(await page.locator('#vt').isVisible()); assert(await page.locator('#hold-toggle').isDisabled());
        assert(await page.locator('#adaptive-hold-exclusion').isVisible());
        assert.equal(s.holdMechanics.status, 'inapplicable');
        assert.equal(await page.locator('#vt').getAttribute('min'), '200'); assert.equal(await page.locator('#vt').getAttribute('max'), '800');
        assert.equal(await page.locator('#peep').getAttribute('max'), '24');
        await help(page, 'adaptive-mode', `${HELP.mode}\n\n${HELP.tag}`);
    }],
    ['queued-target-and-peep-apply-at-next-boundary', async page => {
        await setup(page); await step(page, 50); const before = await state(page);
        await range(page, '#vt', 650); await range(page, '#peep', 9);
        let s = await state(page);
        assert.equal(s.operatorSettings.targetVT_mL, 500); assert.equal(s.operatorSettings.peep_cmH2O, 5);
        assert.equal(s.adaptiveState.requested.targetVT_mL, 650); assert.equal(s.adaptiveState.requested.peep_cmH2O, 9);
        assert.equal(await text(page, '#adaptive-target'), '500'); assert.equal(await text(page, '#adaptive-applied-peep'), 'Applied PEEP: 5 cmH₂O');
        assert(await page.locator('#adaptive-target-pending').isVisible()); assert(await page.locator('#adaptive-peep-pending').isVisible());
        s = await complete(page, 1); assert.equal(s.completed.measuredPIP_cmH2O, before.adaptiveState.applied_cmH2O + 5);
        assert.equal(s.completed.adaptive.targetVT_mL, 500); assert.equal(s.adaptiveState.latestDecision.eligible, false);
        s = await nextStart(page); assert.equal(s.operatorSettings.targetVT_mL, 650); assert.equal(s.operatorSettings.peep_cmH2O, 9);
        assert.equal(s.adaptiveState.pendingSettings, null); assert.equal(s.adaptiveState.applied_cmH2O, 10);
        assert(!(await page.locator('#adaptive-requests').isVisible()));
        s = await complete(page, 1); assert.equal(s.completed.measuredPIP_cmH2O, 19); assert.equal(s.completed.adaptive.targetVT_mL, 650);
    }],
    ['paused-reset-retains-each-operator-queue', async page => {
        for (const combination of ['target', 'peep', 'both']) {
            await setup(page); await running(page, false); await step(page, 50);
            if (combination !== 'peep') await range(page, '#vt', 620);
            if (combination !== 'target') await range(page, '#peep', 8);
            await page.locator('#adaptive-reset').click(); const s = await state(page);
            assert.equal(s.running, false); assert.equal(s.completed, null); assert.equal(s.adaptiveState.pendingSettings, null);
            assert.equal(s.operatorSettings.targetVT_mL, combination === 'peep' ? 500 : 620);
            assert.equal(s.operatorSettings.peep_cmH2O, combination === 'target' ? 5 : 8);
            assert.equal(s.adaptiveState.applied_cmH2O, 10); assert.equal(s.adaptiveState.latestDecision, null);
            assert.equal(await text(page, '#adaptive-achieved'), '—'); assert(await page.locator('#adaptive-paused').isVisible());
            const first = await step(page, 1); assert.equal(first.alarmMetrics.pawCmH2O, first.operatorSettings.peep_cmH2O + 10);
        }
    }],
    ['destination-modes-and-reentry-retain-operator-settings', async page => {
        for (const destination of ['vc-cmv', 'pc-cmv', 'PC-CSV']) {
            await setup(page); await complete(page, 1); await running(page, false);
            const manual = (await state(page)).operatorSettings;
            await range(page, '#vt', 640); await range(page, '#peep', 10);
            await page.locator(`.mode-btn[data-mode="${destination}"]`).click(); let s = await state(page);
            assert.equal(s.mode, destination); assert.equal(s.running, false); assert.equal(s.completed, null); assert.equal(s.adaptiveState, null);
            assert.equal(s.operatorSettings.targetVT_mL, 640); assert.equal(s.operatorSettings.peep_cmH2O, 10);
            assert.equal(s.operatorSettings.inspiratoryPressure_cmH2O, manual.inspiratoryPressure_cmH2O);
            assert.equal(s.operatorSettings.pressureSupport_cmH2O, manual.pressureSupport_cmH2O);
            assert(!(await page.locator('#adaptive-panel').isVisible()));
            if (destination === 'vc-cmv') assert.equal(await page.locator('#vt').inputValue(), '640');
            await page.locator(MODE).click(); s = await state(page);
            assert.equal(s.adaptiveState.applied_cmH2O, 10); assert.equal(s.adaptiveState.targetVT_mL, 640);
            assert.equal(s.adaptiveState.appliedPeep_cmH2O, 10); assert.equal(s.adaptiveState.pendingSettings, null);
            assert.equal(s.adaptiveState.latestDecision, null); assert.equal(s.running, false);
        }
    }],
    ['repeated-edits-revert-and-setup-only-bounds', async page => {
        await setup(page); await complete(page, 1); const before = await state(page);
        for (const value of [600, 700, 500]) await range(page, '#vt', value);
        for (const value of [9, 12, 5]) await range(page, '#peep', value);
        let s = await state(page); assert(s.adaptiveState.epoch >= before.adaptiveState.epoch + 6);
        assert.equal(s.adaptiveState.pending, null); assert.equal(s.adaptiveState.contextMatches, false);
        await page.locator('#adaptive-maximum').selectOption('20');
        assert.equal((await state(page)).adaptiveState.config.maximumPressure_cmH2O, 25);
        await running(page, false); await page.locator('#adaptive-reset').click(); s = await state(page);
        assert.equal(s.adaptiveState.config.maximumPressure_cmH2O, 20); assert.equal(s.running, false);
        assert.equal(s.adaptiveState.targetVT_mL, 500); assert.equal(s.adaptiveState.appliedPeep_cmH2O, 5);
        assert.equal(s.adaptiveState.pendingSettings, null);
    }],
    ['source-target-pairing-and-mixed-delivery-history', async page => {
        await setup(page); await complete(page, 10); const previous = await state(page);
        assert.equal(await text(page, '#adaptive-status'), 'Within target band');
        await range(page, '#vt', 650);
        assert.equal(await text(page, '#adaptive-achieved'), String(Math.round(previous.completed.measuredVT_mL)));
        assert.equal(await text(page, '#adaptive-source-target'), 'Source target: 500 mL');
        assert.equal(await text(page, '#adaptive-status'), 'Awaiting feedback for new settings');
        await nextStart(page); assert.equal(await text(page, '#adaptive-target'), '650');
        assert.equal(await text(page, '#adaptive-source-target'), 'Source target: 500 mL');
        assert.equal(await text(page, '#adaptive-status'), 'Awaiting feedback for new settings');
        await step(page, 20); await range(page, '#compliance', 25); const count = (await state(page)).deliveredVentilation.completedCount;
        const mixed = await complete(page, 1); assert.equal(mixed.adaptiveState.latestDecision.eligible, false);
        assert(mixed.deliveredVentilation.eventIds.some(id => id.breathId === mixed.completed.breathId));
        assert(mixed.deliveredVentilation.completedCount >= count); assert.equal(await text(page, '#adaptive-status'), 'Feedback unavailable — inputs changed');
        assert.equal(await text(page, '#adaptive-achieved'), String(Math.round(mixed.completed.measuredVT_mL)));
        const fresh = await complete(page, 1); assert.equal(fresh.adaptiveState.latestDecision.eligible, true); assert.equal(fresh.completed.adaptive.targetVT_mL, 650);
    }],
    ['applied-versus-pending-bounds-and-release', async page => {
        await setup(page, { compliance: 0.015, maximumPressure_cmH2O: 20 }); await complete(page, 5);
        assert.equal((await state(page)).adaptiveState.applied_cmH2O, 18);
        assert.equal(await text(page, '#adaptive-next-bound'), 'Next pressure: maximum'); assert.equal(await text(page, '#adaptive-bound'), '');
        assert.equal(await text(page, '#adaptive-status'), 'Adjusting next breath');
        let s = await complete(page, 10); assert.equal(s.adaptiveState.applied_cmH2O, 20);
        assert.equal(await text(page, '#adaptive-status'), 'Maximum pressure — VT below target');
        assert(s.completed.measuredVT_mL > 299 && s.completed.measuredVT_mL < 301);
        await range(page, '#compliance', 50); s = await complete(page, 1);
        assert(s.completed.measuredVT_mL > 860); assert.equal(s.adaptiveState.pending.pressure_cmH2O, 18);
        assert.equal(await text(page, '#adaptive-status'), 'Adjusting next breath');
        await setup(page, { compliance: 0.1, pMusMax: 12, patientRR: 12 }); s = await complete(page, 18);
        assert.equal(s.adaptiveState.applied_cmH2O, 5); assert(s.completed.measuredVT_mL > 780);
        assert.equal(await text(page, '#adaptive-status'), 'Minimum pressure — VT above target');
    }],
    ['unsupported-predictions-are-unavailable-in-both-views', async page => {
        await setup(page); await complete(page, 8);
        for (const teach of [false, true]) {
            await teaching(page, teach); const s = await state(page), p = s.predicted;
            assert.equal(p.predictionsAvailable, false);
            for (const key of ['pip_cmH2O', 'pplat_cmH2O', 'map_cmH2O', 'autoPeep_cmH2O', 'totalPeep_cmH2O', 'drivingPressure', 'resistivePressure']) assert.equal(p.pressures[key], null, key);
            for (const value of Object.values(p.volumes)) assert.equal(value, null);
            assert.equal(p.timing.inspFlow_Lpm, null);
            for (const id of ['param-map', 'param-pr', 'param-total-peep', 'param-flow']) assert.equal(await text(page, `#${id}`), '—');
            if (!teach) {
                assert.equal(await text(page, '#param-auto-peep'), '—');
                assert.equal(await page.locator('#param-auto-peep').getAttribute('title'), HELP.predictions);
                assert.equal(await page.locator('#param-auto-peep').getAttribute('aria-description'), HELP.predictions);
            } else {
                assert(!/\d/.test(await text(page, '#param-auto-peep')), 'Teaching live flow cue must not expose a predicted number');
                assert.equal(await page.locator('#param-auto-peep').getAttribute('title'), null, 'Live flow cue cannot inherit fixed-pressure prediction help');
                assert.equal(await page.locator('#param-auto-peep').getAttribute('aria-description'), null);
            }
            assert(!/Predicted (Pplat|auto-PEEP)|driving pressure/i.test(await text(page, '#alerts')));
            // The exact VE help is legacy context plus this approved adaptive disclosure.
            const trigger = page.locator('[data-measurement-help="delivered-ve"]').first(); await trigger.focus();
            assert((await text(page, '#measurement-help-text')).includes(HELP.predictions));
            assert(!/predicted VE:\s*\d/i.test(await text(page, '#measurement-help-text'))); await page.keyboard.press('Escape');
        }
    }],
    ['approved-effort-pressure-and-transition-help', async page => {
        await setup(page, { patientRR: 12 }); await complete(page, 10); await range(page, '#pmus-max', 8);
        const s = await complete(page, 1); assert(s.completed.measuredVT_mL > 700 && s.completed.measuredVT_mL < 715);
        assert((await text(page, '#adaptive-effort')).includes('Prescribed effort')); assert((await text(page, '#adaptive-effort')).includes('Pmus max 8'));
        assert.equal(await page.locator('#pmus-max').getAttribute('title'), HELP.effort);
        for (const key of ['target', 'achieved', 'pressure', 'next', 'bounds', 'effort']) await help(page, `adaptive-${key}`, HELP[key]);
        await help(page, 'pc-idealization', HELP.idealization, '#pc-disclosure-trigger');
        await help(page, 'adaptive-hold', HELP.hold, '#adaptive-hold-exclusion [data-measurement-help]');
        await range(page, '#vt', 650); await range(page, '#peep', 9);
        await help(page, 'adaptive-target-pending', HELP.targetPending, '#adaptive-requested-target-help');
        await help(page, 'adaptive-peep-pending', HELP.peepPending, '#adaptive-requested-peep-help');
        await help(page, 'adaptive-mode', `${HELP.mode}\n\n${HELP.tag}`);
    }],
    ['static-help-hover-focus-and-escape-in-both-views', async page => {
        await setup(page); await complete(page, 5);
        for (const teach of [false, true]) {
            await teaching(page, teach); const trigger = page.locator('#adaptive-panel [data-measurement-help="adaptive-achieved"]');
            await trigger.evaluate(el => { window.__adaptiveHelpOriginal = el; });
            const old = await state(page); await trigger.hover(); assert(await page.locator('#measurement-help').isVisible());
            await page.locator('#measurement-help').hover(); await page.waitForTimeout(200); assert(await page.locator('#measurement-help').isVisible());
            await step(page, 10); assert(await trigger.evaluate(el => el === window.__adaptiveHelpOriginal));
            assert.equal((await state(page)).adaptiveState.lastConsumedBreathId, old.adaptiveState.lastConsumedBreathId);
            await trigger.focus(); await page.keyboard.press('Escape'); assert(!(await page.locator('#measurement-help').isVisible()));
            assert(await trigger.evaluate(el => document.activeElement === el));
            await page.waitForTimeout(60); assert(!(await page.locator('#measurement-help').isVisible()), 'Escape focus must not reopen');
        }
    }],
    ['full-copy-and-readout-geometry-at-supported-type-sizes', async page => {
        await setup(page, { compliance: 0.015, maximumPressure_cmH2O: 20 }); await complete(page, 15);
        for (const teach of [false, true]) {
            await teaching(page, teach);
            const bad = await page.locator('#adaptive-panel').evaluate(panel => {
                const box = panel.getBoundingClientRect();
                return [...panel.querySelectorAll('*')].filter(el => {
                    if (!el.getClientRects().length || !el.textContent.trim()) return false;
                    const b = el.getBoundingClientRect();
                    return b.left < box.left - 1 || b.right > box.right + 1 || el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;
                }).map(el => `${el.id || el.className}: ${el.textContent.trim()}`);
            });
            assert.deepEqual(bad, [], `Adaptive panel clipping in ${teach ? 'Teaching' : 'Standard'} view`);
            await page.locator('#adaptive-panel [data-measurement-help="adaptive-achieved"]').focus();
            const geometry = await page.locator('#measurement-help').evaluate(el => {
                const b = el.getBoundingClientRect(); return { visible: b.width > 0 && b.height > 0,
                    inViewport: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
                    noHorizontalClip: el.scrollWidth <= el.clientWidth + 1, text: document.getElementById('measurement-help-text').textContent };
            });
            assert(geometry.visible && geometry.inViewport && geometry.noHorizontalClip); assert.equal(geometry.text, HELP.achieved);
            if (process.env.ADAPTIVE_BROWSER_SHOTS) {
                fs.mkdirSync(process.env.ADAPTIVE_BROWSER_SHOTS, { recursive: true });
                await page.screenshot({ path: path.join(process.env.ADAPTIVE_BROWSER_SHOTS, `adaptive-${teach ? 'teaching' : 'standard'}-help.png`), fullPage: true });
            }
            await page.keyboard.press('Escape');
        }
    }],
    ['actual-transport-pause-speed-and-render-do-not-create-decisions', async page => {
        await setup(page); await complete(page, 1); await running(page, true);
        await page.evaluate(() => window.__vsim.resume());
        const before = await state(page);
        await page.waitForFunction(t => window.__vsim.state().globalTime > t + 0.05, before.globalTime);
        await page.locator('#btn-pause').click(); const stopped = await state(page); assert.equal(stopped.running, false);
        await page.waitForTimeout(160); assert.equal((await state(page)).globalTime, stopped.globalTime);
        assert(await page.locator('#adaptive-paused').isVisible());
        const decision = stopped.adaptiveState.latestDecision;
        await page.locator('.speed-btn[data-speed="4"]').click(); await page.evaluate(() => window.__vsim.redraw());
        await page.locator('#adaptive-panel [data-measurement-help="adaptive-mode"]').focus(); await page.keyboard.press('Escape');
        assert.deepEqual((await state(page)).adaptiveState.latestDecision, decision);
        await page.locator('#btn-pause').click(); await page.waitForFunction(t => window.__vsim.state().globalTime > t, stopped.globalTime);
        assert(!(await page.locator('#adaptive-paused').isVisible())); await page.evaluate(() => window.__vsim.pause());
    }],
];

(async () => {
    assert.equal(groups.length, 12, 'Commissioned adaptive browser inventory changed');
    const launch = { args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(launch), results = [];
    try {
        for (const [name, run] of groups) {
            const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(String(error)));
            page.on('response', response => { if (response.status() >= 400 && !/favicon\.ico/.test(response.url())) errors.push(`${response.status()} ${response.url()}`); });
            try {
                await page.goto(`${APP}?adaptive-check=${name}`, { waitUntil: 'networkidle' });
                await page.waitForFunction(() => typeof window.__vsim?.setupAdaptive === 'function');
                await page.evaluate(() => window.__vsim.pause());
                await run(page); assert.deepEqual(errors, [], 'Browser runtime/network errors');
                results.push({ name, passed: true }); console.log(`PASS adaptive browser ${name}`);
            } catch (error) {
                results.push({ name, passed: false, error: error.message, browserErrors: errors });
                console.error(`FAIL adaptive browser ${name}: ${error.stack || error.message}`);
                if (process.env.ADAPTIVE_BROWSER_SHOTS) {
                    fs.mkdirSync(process.env.ADAPTIVE_BROWSER_SHOTS, { recursive: true });
                    await page.screenshot({ path: path.join(process.env.ADAPTIVE_BROWSER_SHOTS, `failure-${name}.png`), fullPage: true });
                }
            } finally { await context.close(); }
        }
    } finally { await browser.close(); }
    const report = { groups: results.length, passed: results.filter(r => r.passed).length, failed: results.filter(r => !r.passed).length, results };
    if (process.env.ADAPTIVE_BROWSER_OUTPUT) { const destination = path.resolve(process.env.ADAPTIVE_BROWSER_OUTPUT); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2) + '\n'); }
    console.log(`ADAPTIVE_BROWSER_TALLY ${JSON.stringify({ groups: report.groups, passed: report.passed, failed: report.failed })}`);
    if (report.groups !== 12 || report.failed) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
