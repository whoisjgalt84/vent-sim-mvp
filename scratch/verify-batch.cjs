/**
 * Behavioural verification for this batch. Asserts what each item CLAIMS to do,
 * driving the real page — not just eyeballing pixels.
 *
 * Requires a static server on :8899 — `npm run serve` (node tools/serve.mjs).
 *   node scratch/verify-batch.cjs
 */
const { chromium } = require('playwright');

const URL = 'http://127.0.0.1:8899/index.html';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
    if (ok) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; failures.push(`${name} — ${detail}`); console.log(`  FAIL ${name} — ${detail}`); }
}

async function fresh(browser, tag) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await page.goto(`${URL}?t=${tag}`, { waitUntil: 'networkidle' });
    page._errs = errs;
    return { ctx, page };
}

async function expandRail(page) {
    await page.$$eval('.controls [data-collapsible][data-collapsed]', (els) => els.forEach((e) => e.click()));
    await page.waitForTimeout(120);
}

async function setRange(page, id, v) {
    await page.$eval(id, (el, val) => {
        el.value = String(val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    }, v);
}

async function enableEffort(page, { patientRR = 30, pmus = 6 } = {}) {
    await expandRail(page);
    await page.click('#pmus-toggle');
    await setRange(page, '#pmus-max', pmus);
    await setRange(page, '#patient-rr', patientRR);
}

// VSM-CLIN-004 extends the existing mode-change composite check, retaining its
// old predicate. All observations below are rendered DOM, with deterministic
// real-engine stepping; the hook only exposes independent source evidence.
async function readoutContract(page) {
    return page.evaluate(() => {
        const api = window.__vsim;
        api.pause();
        const errors = [], geometry = [], states = [];
        const el = id => document.getElementById(id);
        const text = id => el(id).textContent.trim();
        const require = (ok, detail) => { if (!ok) errors.push(detail); };
        const input = (id, value) => {
            el(id).value = String(value);
            el(id).dispatchEvent(new Event('input', { bubbles: true }));
        };
        const teaching = on => {
            if (document.body.classList.contains('teaching-mode') !== on) el('btn-teaching-mode').click();
        };
        const mode = value => {
            teaching(false);
            document.querySelector(`.mode-btn[data-mode="${value}"]`).click();
        };
        const effort = on => {
            teaching(false);
            if (el('pmus-toggle').classList.contains('hold-btn--active') !== on) el('pmus-toggle').click();
        };
        const requireHoldCleared = name => {
            const hold = api.state().holdMechanics;
            require(hold.reasons.includes('SETTINGS_CHANGED'), `${name}: selector not invalidated`);
            require(text('param-pplat') === '—' && text('param-dp') === '—'
                && text('hold-pplat') === '—' && text('hold-dp') === '—'
                && text('hold-crs') === '—' && text('hold-raw') === '—'
                && text('hold-status') === 'Settings changed',
                `${name}: rendered hold values did not clear synchronously`);
        };
        const take = name => {
            const s = api.state(), p = s.predicted;
            const csv = s.mode === 'PC-CSV', done = s.completed !== null;
            const expected = {
                'param-pip': done ? String(s.pipLatched) : '—',
                'param-vt': done ? String(Math.round(s.completed.measuredVT_mL)) : '—',
                'param-pplat': done && !csv && s.pplat !== null ? String(s.pplat) : '—',
                'param-dp': s.holdMechanics.drivingPressure.value === null ? '—'
                    : String(Number(s.holdMechanics.drivingPressure.value.toFixed(1))),
                'param-ve': String(csv
                    ? (done && s.measuredRRRaw > 0
                        ? Math.round(s.completed.measuredVT_mL / 1000 * s.measuredRRRaw * 10) / 10 : 0)
                    : p.volumes.minuteVentilation),
                'param-map': String(p.pressures.map_cmH2O),
                'param-total-peep': String(p.pressures.totalPeep_cmH2O),
                'param-live-trapped': String(Math.round(s.liveTrapped_mL)),
            };
            for (const [id, value] of Object.entries(expected)) {
                require(text(id) === value, `${name} ${id}: ${text(id)} != ${value}`);
            }
            const labels = {
                'param-pip': 'Measured PIP', 'param-pplat': 'Measured Pplat',
                'param-dp': 'Hold-derived driving pressure',
                'param-vt': 'Measured VT', 'param-ve': csv ? 'Delivered VE' : 'Predicted VE',
                'param-map': 'Predicted breath MAP', 'param-total-peep': 'Predicted total PEEP',
                'param-live-trapped': 'Live modeled trapped volume',
                'param-auto-peep': s.teachingMode ? 'Flow Baseline' : 'Predicted steady-state auto-PEEP',
            };
            for (const [id, label] of Object.entries(labels)) {
                const row = el(id).closest('.param-row');
                const visibleLabel = row.querySelector('.param-row__label');
                require(visibleLabel.textContent.trim() === label && visibleLabel.getClientRects().length > 0,
                    `${name} ${id}: missing visible provenance ${label}`);
                require(row.getAttribute('role') === 'group'
                    && el(row.getAttribute('aria-labelledby')) === visibleLabel,
                    `${name} ${id}: accessible group must use visible provenance`);
            }
            if (!s.teachingMode) {
                require(text('param-auto-peep') === String(p.pressures.autoPeep_cmH2O), `${name} predicted auto-PEEP`);
                require(text('rr-param-label') === 'Measured RR', `${name} measured RR label`);
                require(text('param-rr') === String(Math.round(s.measuredRRRaw)), `${name} measured RR`);
                // The existing analytical trapped-volume readout lives in the
                // Patient rail; expand that group to test its actual visibility.
                document.querySelectorAll('.controls [data-collapsible][data-collapsed]').forEach(e => e.click());
                const trap = [...document.querySelectorAll('.mechanics-chip')].at(-1);
                const trapMl = p.volumes.trappedVolume_mL;
                require(trap.innerText.replace(/\s+/g, ' ').trim() ===
                    `Predicted steady-state trapped volume ${trapMl < 0.1 ? '<1' : Math.round(trapMl)} mL`,
                    `${name} predicted trapped volume visible label/value`);
            } else {
                require(text('rr-param-label') === 'RR', `${name} Teaching RR term unchanged`);
                require(el('param-rr').querySelector('.rr-triple__num--delivered').textContent ===
                    String(Math.round(s.measuredRRRaw)), `${name} Teaching delivered RR`);
                require(!/\d/.test(text('param-auto-peep')), `${name} no hidden auto-PEEP number in live cue`);
            }
            require(s.alarmPip === s.runningPip, `${name} alarm PIP must remain live`);
            for (const badge of document.querySelectorAll('#alerts .alert-badge')) {
                const value = badge.textContent;
                require(!/AutoPEEP/.test(value) && (!/Pplat|auto-PEEP/.test(value) || value.startsWith('Predicted ')),
                    `${name} analytical header badge requires visible provenance: ${value}`);
                const b = badge.getBoundingClientRect(), header = document.querySelector('.header').getBoundingClientRect();
                if (b.left < header.left || b.right > header.right || badge.scrollWidth > badge.clientWidth + 1) {
                    geometry.push(`${name}: header ${value}`);
                }
            }
            for (const selector of ['.parameters', '.controls']) {
                const panel = document.querySelector(selector);
                if (!panel.getClientRects().length) continue;
                for (const node of panel.querySelectorAll('.param-row__label, .param-row__value, .param-row__unit, .mechanics-chip')) {
                    if (!node.getClientRects().length) continue;
                    const b = node.getBoundingClientRect(), pb = panel.getBoundingClientRect();
                    if (node.scrollWidth > node.clientWidth + 1 && node.clientWidth > 0
                        || b.right > pb.right + 0.5 || b.left < pb.left - 0.5) {
                        geometry.push(`${name}: ${node.textContent.trim()}`);
                    }
                }
            }
            states.push({ name, time: s.globalTime, completed: done, rr: s.measuredRRRaw,
                pip: text('param-pip'), vt: text('param-vt'), ve: text('param-ve'), liveTrapped: s.liveTrapped_mL });
            return s;
        };
        mode('vc-cmv'); effort(false); api.seek(0); take('VC initialization');
        mode('pc-cmv'); take('PC initialization / synchronous switch');
        mode('PC-CSV'); take('CSV selection / synchronous switch');
        api.seek(0); take('CSV reset');
        input('resistance', 40); input('compliance', 80); api.seek(15);
        const passive = take('CSV zero effort 15s');
        require(passive.completed === null && passive.breathCount === 0 && passive.measuredRRRaw === 0
            && passive.liveTrapped_mL === 0 && passive.predicted.volumes.trappedVolume_mL > 20,
            'zero-effort live state must stay independent of nonzero prediction');
        const oldMap = text('param-map'); input('ps-pressure', 20); api.redraw();
        take('CSV changed predictions'); require(text('param-map') !== oldMap, 'MAP prediction changes with settings');
        require(el('alerts').innerText.includes('Predicted steady-state auto-PEEP 4'), 'active predicted auto-PEEP header badge');
        teaching(true); api.redraw(); take('Teaching CSV no breath');
        require(el('alerts').innerText.includes('Predicted steady-state auto-PEEP 4'), 'Teaching predicted auto-PEEP header badge');
        effort(true); input('pmus-max', 0.5); input('patient-rr', 20); input('flow-trigger', 5);
        api.seek(15); const weak = take('CSV failed efforts 15s');
        require(weak.completed === null && weak.breathCount === 0 && weak.failedTriggers > 0,
            'weak-effort scenario must actually fail without delivering');
        teaching(true); api.redraw(); take('Teaching CSV failed efforts');
        teaching(false); input('resistance', 10); input('compliance', 50);
        input('pmus-max', 8); input('flow-trigger', 2); input('ps-pressure', 10); api.seek(0);
        for (let i = 0; i < 600 && api.state().breathCount === 0; i++) api.step(0.01);
        api.step(0.01);
        const running = take('CSV first inspiration');
        require(running.completed === null && running.runningPip > 0, 'first-inspiration guard');
        for (let i = 0; i < 600 && api.state().completed === null; i++) api.step(0.01);
        const first = take('CSV first completion');
        require(first.completed !== null && first.measuredRRRaw === 0 && text('param-ve') === '0', 'first-breath warm-up');
        for (let i = 0; i < 600 && api.state().breathCount < 2; i++) api.step(0.01);
        const next = take('CSV next inspiration');
        require(next.completed.completedAt_s === first.completed.completedAt_s
            && text('param-vt') === String(Math.round(first.completed.measuredVT_mL)) && next.vt_mL === 0,
            'finalized VT must survive provisional next-breath reset');
        api.step(20); const delivered = take('CSV established delivery');
        require(delivered.measuredRRRaw > 0 && Number(text('param-ve')) > 0, 'established live delivery guard');
        teaching(true); api.redraw(); take('Teaching CSV established delivery');
        teaching(false); api.seek(0); const reset = take('CSV reset after delivery');
        require(reset.completed === null && reset.measuredRRRaw === 0 && reset.liveTrapped_mL === 0, 'reset state');
        // Include nonzero live residual and a live hold value before switching,
        // so the stale-state checks cannot pass merely because inputs were zero.
        effort(false); mode('vc-cmv'); input('resistance', 40); input('compliance', 80);
        el('hold-toggle').click(); api.seek(20); const vc = take('VC established hold');
        require(vc.completed !== null && vc.pplat !== null && vc.liveTrapped_mL > 0, 'VC hold/residual guard');
        require(vc.holdMechanics.status === 'valid'
            && text('hold-status') === ''
            && text('pplat-status') === ''
            && text('hold-dp') === text('param-dp')
            && el('hold-modeled-baseline').querySelector('span').textContent === 'Modeled baseline'
            && el('dp-status').querySelector('span').textContent === 'Modeled baseline'
            && !el('hold-results').innerText.includes('Uses measured Pplat')
            && !el('hold-results').innerText.includes('Uses same-breath delivered VT')
            && vc.holdMechanics.resistance.status === 'valid',
            'valid hold-derived UI values and approved provenance copy');
        input('peep', 6); requireHoldCleared('slider change');
        input('peep', 5); api.seek(20); take('VC hold after slider change');
        document.querySelector('[data-trigger-type="pressure"]').click(); requireHoldCleared('trigger-type change');
        document.querySelector('[data-trigger-type="flow"]').click(); api.seek(20); take('VC hold after trigger change');
        el('preset').value = 'copd'; el('preset').dispatchEvent(new Event('change', { bubbles:true }));
        requireHoldCleared('preset change');
        el('preset').value = 'normal'; el('preset').dispatchEvent(new Event('change', { bubbles:true }));
        api.seek(20); take('VC hold after preset change');
        document.querySelector('#ie-group [data-ie="1,1"]').click(); requireHoldCleared('I:E change');
        document.querySelector('#ie-group [data-ie="1,2"]').click(); api.seek(20); take('VC hold after I:E change');
        teaching(true); api.redraw(); take('Teaching VC established hold');
        require(text('pplat-status') === ''
            && el('pplat-param-label').nextElementSibling.matches('[data-measurement-help="pplat"]')
            && el('pplat-param-label').nextElementSibling.getClientRects().length > 0,
            'Teaching Mode must keep concise Pplat help without a visible success sentence');
        teaching(false); mode('pc-cmv'); const clearedModeSwitch = take('VC to PC cleared hold');
        require(clearedModeSwitch.holdMechanics.reasons.includes('HOLD_RESULT_CLEARED')
            && text('hold-status') === 'Awaiting hold'
            && text('hold-pplat') === '—' && text('hold-dp') === '—'
            && text('hold-crs') === '—' && text('hold-raw') === '—',
            'mode switch must synchronously clear both main and expanded hold values');
        mode('vc-cmv'); input('hold-duration', 4); api.seek(20); const shortHold = take('VC short hold');
        require(shortHold.holdMechanics.reasons.includes('HOLD_TOO_SHORT')
            && text('hold-status') === 'Hold too short'
            && text('param-pplat') === '—' && text('param-dp') === '—',
            'short hold must show approved unavailability copy and no derived values');
        require(el('hold-pplat').title.includes('HOLD_TOO_SHORT')
            && el('hold-pplat').title.includes('INSUFFICIENT_SAMPLES')
            && el('hold-pplat').getAttribute('aria-label').includes('INSUFFICIENT_SAMPLES'),
            'all detected hold reasons must be available in title and accessible description');
        document.querySelector('#flow-pattern-group [data-pattern="ramp"]').click();
        input('hold-duration', 5); api.seek(20); const rampHold = take('VC ramp hold');
        require(rampHold.holdMechanics.pplat.status === 'valid'
            && rampHold.holdMechanics.resistance.status === 'inapplicable'
            && text('hold-raw') === '—'
            && text('hold-raw-status') === 'Unavailable for ramp VC',
            'ramp VC keeps Pplat but explains resistance applicability');
        mode('PC-CSV'); take('VC to CSV synchronous reset'); api.step(15); take('VC to no-effort CSV 15s');
        effort(true); input('pmus-max', 8); input('flow-trigger', 2); api.seek(25); take('CSV re-established');
        mode('vc-cmv'); take('CSV to VC synchronous reset');
        mode('PC-CSV'); api.seek(25); take('CSV re-established again');
        mode('pc-cmv'); take('CSV to PC synchronous reset');
        effort(false); mode('vc-cmv'); input('compliance', 10); api.seek(0); take('VC predicted Pplat before completion');
        require(api.state().completed === null && api.state().predicted.safety.pplatAbove30
            && el('alerts').innerText.includes('Predicted Pplat '), 'active predicted Pplat header badge before completion');
        return { errors, geometry, states };
    });
}

async function presentationHelpContract(page) {
    const errors = [];
    let checks = 0;
    const require = (ok, detail) => { checks++; if (!ok) errors.push(detail); };
    const firstVisible = async selector => {
        const matches = page.locator(selector);
        for (let i = 0; i < await matches.count(); i++) {
            if (await matches.nth(i).isVisible()) return matches.nth(i);
        }
        throw new Error(`No visible match for ${selector}`);
    };
    const tooltip = page.locator('#measurement-help');
    const expected = {
        pplat: 'Available after a completed hold that meets this simulator’s duration, zero-flow, pressure-stability, and effort criteria.',
        'driving-pressure': 'Uses measured Pplat and live modeled total PEEP at breath start.',
        'static-compliance': 'Uses same-breath delivered VT and live modeled total PEEP at breath start.',
        'modeled-baseline': 'Live modeled total PEEP at breath start. Calculated from set PEEP, integrated residual volume, and configured compliance; not measured by an expiratory hold.',
        'inspiratory-resistance': 'Uses same-breath PIP, measured Pplat, and end-inspiratory flow. Available only with passive constant-flow square VC inspiration and a valid completed hold.',
        duration: 'The 0.5–2 s range is this simulator’s measurement criterion.',
    };
    const expectedNames = {
        pplat: 'Measured Pplat help',
        'driving-pressure': 'Hold-derived driving pressure help',
        'static-compliance': 'Hold-derived static compliance help',
        'modeled-baseline': 'Modeled baseline help',
        'inspiratory-resistance': 'Measured inspiratory resistance help',
        duration: 'Hold duration criterion help',
    };

    if (!await page.locator('#hold-toggle').evaluate(button => button.classList.contains('hold-btn--active'))) {
        await page.click('#hold-toggle');
    }
    await setRange(page, '#hold-duration', 5);
    await page.evaluate(() => window.__vsim.seek(20));
    const standardType = await page.evaluate(() => ({
        pplat: getComputedStyle(document.getElementById('param-pplat')).fontSize,
        dp: getComputedStyle(document.getElementById('param-dp')).fontSize,
        waveformWidth: document.querySelector('.waveforms').getBoundingClientRect().width,
    }));
    require(standardType.pplat === '26px' && standardType.dp === '17px' && standardType.waveformWidth > 900,
        `standard typography/space changed: ${JSON.stringify(standardType)}`);
    require((await page.locator('#hold-status').textContent()).trim() === ''
        && (await page.locator('#pplat-status').textContent()).trim() === '',
        'valid success sentence remains visible');
    require((await page.locator('#hold-modeled-baseline > span').textContent()).trim() === 'Modeled baseline'
        && (await page.locator('#dp-status > span').textContent()).trim() === 'Modeled baseline',
        'compact modeled provenance is not independently visible');

    for (const [key, copy] of Object.entries(expected)) {
        const trigger = await firstVisible(`[data-measurement-help="${key}"]`);
        await trigger.click();
        require(await tooltip.isVisible(), `${key}: click did not open help`);
        require((await tooltip.textContent()).includes(copy), `${key}: approved help copy missing`);
        require(await trigger.getAttribute('aria-expanded') === 'true'
            && await trigger.getAttribute('aria-describedby') === 'measurement-help',
            `${key}: accessible open association missing`);
        require(await trigger.getAttribute('aria-label') === expectedNames[key],
            `${key}: meaningful accessible name missing`);
        const box = await tooltip.boundingBox();
        const viewport = page.viewportSize();
        require(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width
            && box.y + box.height <= viewport.height, `${key}: help clipped outside viewport`);
        await trigger.click();
        require(!await tooltip.isVisible(), `${key}: trigger did not close clicked help`);
    }

    const pplat = await firstVisible('[data-measurement-help="pplat"]');
    await page.evaluate(() => document.activeElement?.blur());
    await pplat.focus();
    require(await tooltip.isVisible(), 'keyboard focus did not open help');
    await page.keyboard.press('Escape');
    require(!await tooltip.isVisible() && await pplat.evaluate(node => document.activeElement === node),
        'Escape did not dismiss help and restore trigger focus');

    await page.evaluate(() => document.activeElement?.blur());
    await pplat.hover();
    await tooltip.hover();
    await page.waitForTimeout(220);
    require(await tooltip.isVisible(), 'pointer transfer onto help did not preserve it');
    await page.mouse.move(700, 500);
    await page.waitForTimeout(220);
    require(!await tooltip.isVisible(), 'unpinned hover help did not close after pointer left');

    const driving = await firstVisible('[data-measurement-help="driving-pressure"]');
    await pplat.click();
    await driving.click();
    require(await pplat.getAttribute('aria-expanded') === 'false'
        && await driving.getAttribute('aria-expanded') === 'true'
        && await page.locator('#measurement-help:visible').count() === 1,
        'more than one explanation remained open');
    const stableText = await tooltip.textContent();
    await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__vsim.redraw(); });
    require(await tooltip.isVisible() && await tooltip.textContent() === stableText,
        'open help did not remain stable through monitor refreshes');
    await setRange(page, '#peep', 6);
    require(await tooltip.isVisible() && (await tooltip.textContent()).includes('Settings changed. Awaiting a new completed hold.')
        && (await tooltip.textContent()).includes('SETTINGS_CHANGED'),
        'open help did not update when its measurement became stale');
    await driving.click();

    await pplat.click();
    await page.mouse.click(700, 500);
    require(!await tooltip.isVisible(), 'outside interaction did not dismiss clicked help');

    await setRange(page, '#peep', 5);
    await page.evaluate(() => window.__vsim.seek(20));
    const holdPplat = page.locator('#hold-results [data-measurement-help="pplat"]');
    await holdPplat.click();
    await page.click('#hold-toggle');
    require(!await tooltip.isVisible(), 'help did not close when its hold panel became hidden');

    await page.click('#hold-toggle');
    await page.evaluate(() => window.__vsim.seek(20));
    await page.click('#btn-teaching-mode');
    const teachingType = await page.evaluate(() => ({
        pplat: getComputedStyle(document.getElementById('param-pplat')).fontSize,
        dp: getComputedStyle(document.getElementById('param-dp')).fontSize,
        waveformWidth: document.querySelector('.waveforms').getBoundingClientRect().width,
    }));
    require(teachingType.pplat === '28px' && teachingType.dp === '20px' && teachingType.waveformWidth > 1100,
        `Teaching typography/space changed: ${JSON.stringify(teachingType)}`);
    const teachingBaseline = await firstVisible('#dp-status [data-measurement-help="modeled-baseline"]');
    await teachingBaseline.click();
    require(await tooltip.isVisible() && (await tooltip.textContent()).includes(expected['modeled-baseline']),
        'Teaching Mode contextual help unavailable');
    await teachingBaseline.click();
    return { errors, checks };
}

(async () => {
    const launchOptions = { args: ['--no-sandbox'] };
    if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
    const browser = await chromium.launch(launchOptions);
    try {

    // ---------------------------------------------------------------- SME-018
    console.log('\n[SME-018] cancel an active alarm silence');
    {
        const { ctx, page } = await fresh(browser, 'a18');
        await expandRail(page);
        // Force the high-pressure ALARM (not just the alert badge) to fire
        // deterministically: stiff lung + a low pressure limit.
        await setRange(page, '#compliance', await page.$eval('#compliance', (e) => e.min));
        await setRange(page, '#alarm-high-pressure', await page.$eval('#alarm-high-pressure', (e) => e.min));
        await page.waitForFunction(
            () => !document.getElementById('alarm-silence-btn').disabled,
            null, { timeout: 30000 },
        ).catch(() => {});

        const armed = await page.$eval('#alarm-silence-btn', (b) => !b.disabled);
        check('silence button enabled once an alarm is active', armed);

        await page.click('#alarm-silence-btn');
        await page.waitForTimeout(600);
        const during = await page.$eval('#alarm-silence-btn', (b) => ({
            text: b.textContent.trim(), disabled: b.disabled, title: b.title,
        }));
        check('shows a running countdown', /^Silenced \d+s$/.test(during.text), during.text);
        check('stays clickable while silenced', !during.disabled);
        check('title advertises cancel', /cancel/i.test(during.title), during.title);

        await page.click('#alarm-silence-btn');
        await page.waitForTimeout(600);
        const after = await page.$eval('#alarm-silence-btn', (b) => b.textContent.trim());
        check('second press CANCELS the silence', after === 'Silence', `got "${after}"`);

        // Re-silence, then clear the alarm condition mid-countdown.
        await page.click('#alarm-silence-btn');
        await page.waitForTimeout(400);
        await setRange(page, '#compliance', 50);
        await page.waitForTimeout(2500);
        const orphan = await page.$eval('#alarm-silence-btn', (b) => ({
            text: b.textContent.trim(), disabled: b.disabled,
        }));
        check('silence stays cancellable after the alarm clears',
            !orphan.disabled || orphan.text === 'Silence',
            `text="${orphan.text}" disabled=${orphan.disabled}`);

        check('no page errors', page._errs.length === 0, page._errs.join(' | '));
        await ctx.close();
    }

    // ---------------------------------------------------------------- SME-012
    console.log('\n[SME-012] loops available regardless of Teaching Mode');
    {
        const { ctx, page } = await fresh(browser, 'a12');
        const vis = () => page.$eval('#loop-row', (r) => !r.classList.contains('loop-row--hidden'));

        check('loops start visible', await vis());
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(400);
        check('loops SURVIVE entering Teaching Mode', await vis());
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(400);
        check('loops still visible after leaving Teaching Mode', await vis());

        // The user's explicit "off" must also be respected across the toggle.
        await page.click('#btn-loops');
        await page.waitForTimeout(200);
        check('loops off when the user turns them off', !(await vis()));
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(400);
        check('Teaching Mode does not resurrect loops the user turned off', !(await vis()));

        // And they can be turned back on while Teaching Mode is on.
        await page.click('#btn-loops');
        await page.waitForTimeout(400);
        check('loops can be re-enabled inside Teaching Mode', await vis());
        check('no page errors', page._errs.length === 0, page._errs.join(' | '));
        await ctx.close();
    }

    // ---------------------------------------------------------------- SME-013
    console.log('\n[SME-013] vent mode alongside measured values');
    {
        const { ctx, page } = await fresh(browser, 'a13');
        const modeRowVisible = () => page.$eval('#param-mode-row', (r) => r.offsetParent !== null);

        check('mode row hidden in standard mode (header already shows it)', !(await modeRowVisible()));
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(400);
        check('mode row visible in Teaching Mode', await modeRowVisible());

        const same = await page.evaluate(() => {
            const header = document.getElementById('mode-label').textContent.replace(/[⏸💪].*/u, '').trim();
            const panel = document.getElementById('param-mode').textContent.trim();
            return { header, panel };
        });
        check('panel mode matches the header', same.header.startsWith(same.panel.split(' ')[0]),
            JSON.stringify(same));

        // The left rail is hidden in Teaching Mode, so leave it to switch mode,
        // then come back — the same path a user has.
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(200);
        await page.click('.mode-btn[data-mode="PC-CSV"]');
        await page.waitForTimeout(300);
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(600);
        const csv = await page.$eval('#param-mode', (e) => e.textContent.trim());
        const provenance = await readoutContract(page);
        const presentation = await presentationHelpContract(page);
        console.log(`    VSM-CLIN-005 presentation checks: ${presentation.checks - presentation.errors.length}/${presentation.checks}`);
        console.log('    VSM-CLIN-004 states:', JSON.stringify(provenance.states));
        check('panel mode tracks a mode change and VSM-CLIN-004 readouts retain provenance/state',
            csv.startsWith('PC-CSV') && provenance.errors.length === 0 && provenance.geometry.length === 0
                && presentation.errors.length === 0,
            [csv, ...provenance.errors, ...provenance.geometry, ...presentation.errors].join(' | '));
        check('no page errors', page._errs.length === 0, page._errs.join(' | '));
        await ctx.close();
    }

    // ---------------------------------------------------------------- SME-014
    console.log('\n[SME-014] peak-pressure readout stability');
    {
        const { ctx, page } = await fresh(browser, 'a14');
        await page.waitForTimeout(6000);
        const churn = await page.evaluate(async () => {
            const seen = [];
            for (let i = 0; i < 200; i++) {
                const el = document.getElementById('param-pip');
                seen.push({ v: el.textContent, w: +el.getBoundingClientRect().width.toFixed(1) });
                await new Promise((r) => setTimeout(r, 100));
            }
            let changes = 0;
            for (let i = 1; i < seen.length; i++) if (seen[i].v !== seen[i - 1].v) changes++;
            return { changes, widths: [...new Set(seen.map((s) => s.w))], last: seen.at(-1).v };
        });
        // 14 breaths/min over 20 s ≈ 4-5 breaths, so ≤6 changes means once per breath.
        check('PIP updates about once per breath, not per frame', churn.changes <= 6,
            `${churn.changes} changes in 20 s (was ~73)`);
        check('PIP no longer resizes as it updates', churn.widths.length <= 1,
            `widths ${JSON.stringify(churn.widths)}`);
        check('PIP still shows a real value', /\d/.test(churn.last), churn.last);

        // Freshness: latching at the START of the next breath (instead of at the
        // end of inspiration) left PIP showing the PREVIOUS breath for the whole
        // expiratory phase, so a pressure excursion could raise the alarm while
        // the number still read normal. The alarm legitimately leads PIP by up to
        // the remaining inspiratory time; a whole expiratory phase of lag is the
        // regression. Measure the gap between the alarm appearing and PIP moving.
        await setRange(page, '#alarm-high-pressure', await page.$eval('#alarm-high-pressure', (e) => e.min));
        const limit = await page.$eval('#alarm-high-pressure', (e) => Number(e.value));
        const lag = await page.evaluate(async (lim) => {
            const pip = () => Number(document.getElementById('param-pip').textContent) || 0;
            const alarming = () => /pressure/i.test(document.getElementById('alarm-chip-list').textContent);
            const base = pip();
            document.getElementById('compliance').value =
                document.getElementById('compliance').min;
            document.getElementById('compliance').dispatchEvent(new Event('input', { bubbles: true }));
            let tAlarm = null, tPip = null;
            const t0 = performance.now();
            for (let i = 0; i < 300; i++) {
                if (tAlarm === null && alarming()) tAlarm = performance.now();
                if (tPip === null && pip() > Math.max(base + 3, lim)) tPip = performance.now();
                if (tAlarm !== null && tPip !== null) break;
                await new Promise((r) => setTimeout(r, 50));
            }
            return {
                alarm: tAlarm === null ? null : (tAlarm - t0) / 1000,
                pip: tPip === null ? null : (tPip - t0) / 1000,
            };
        }, limit);
        const gap = (lag.alarm !== null && lag.pip !== null) ? lag.pip - lag.alarm : null;
        check('PIP catches up with a pressure excursion within one inspiration, not a whole cycle',
            gap !== null && gap < 2.0, `alarm@${lag.alarm}s pip@${lag.pip}s gap=${gap}s`);

        check('no page errors', page._errs.length === 0, page._errs.join(' | '));
        await ctx.close();
    }

    // ------------------------------------------------- counter + SME-022
    console.log('\n[counter + SME-022] ineffective efforts');
    {
        const { ctx, page } = await fresh(browser, 'a22');
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(300);
        const before = await page.$('#rr-ineffective-count');
        check('counter absent while the patient is passive', before === null);

        // Effort controls live in the left rail, which Teaching Mode hides.
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(200);
        await enableEffort(page, { patientRR: 30, pmus: 6 });
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(16000);

        const count = await page.$eval('#rr-ineffective-count', (e) => e.textContent.trim());
        check('counter present once effort is on', count !== undefined);
        check('counter registered failed efforts in an overbreathing patient',
            Number(count) > 0, `count=${count}`);

        // Hover across the flow canvas and harvest whatever tooltips exist.
        const titles = await page.evaluate(async () => {
            const c = document.getElementById('canvas-flow');
            const r = c.getBoundingClientRect();
            const found = new Set();
            for (let x = 0; x < r.width; x += 4) {
                c.dispatchEvent(new MouseEvent('mousemove', {
                    clientX: r.left + x, clientY: r.top + r.height / 2, bubbles: true,
                }));
                if (c.title) found.add(c.title);
                await new Promise((res) => setTimeout(res, 4));
            }
            return [...found];
        });
        check('a failed-effort tooltip is reachable by hover', titles.length > 0,
            `titles=${titles.length}`);
        const joined = titles.join(' || ');
        check('tooltip explains WHY, not just THAT (SME-022)',
            /did not|not available/.test(joined), joined.slice(0, 160));
        check('tooltip names the actual flow threshold',
            /2\.0 L\/min/.test(joined) || /not available/.test(joined), joined.slice(0, 200));
        console.log('    tooltip(s):');
        titles.forEach((t) => console.log(`      - ${t}`));

        // Switch to a pressure trigger and confirm the copy follows the setting.
        // The trigger control is in the left rail, hidden in Teaching Mode.
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(200);
        await page.click('.ie-btn[data-trigger-type="pressure"]');
        await setRange(page, '#pressure-trigger', 3.5);
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(16000);
        const ptitles = await page.evaluate(async () => {
            const c = document.getElementById('canvas-flow');
            const r = c.getBoundingClientRect();
            const found = new Set();
            for (let x = 0; x < r.width; x += 4) {
                c.dispatchEvent(new MouseEvent('mousemove', {
                    clientX: r.left + x, clientY: r.top + r.height / 2, bubbles: true,
                }));
                if (c.title) found.add(c.title);
                await new Promise((res) => setTimeout(res, 4));
            }
            return [...found];
        });
        const pj = ptitles.join(' || ');
        check('tooltip follows the trigger setting (pressure)',
            ptitles.length === 0 || /cmH₂O|not available/.test(pj), pj.slice(0, 200));
        console.log('    pressure-trigger tooltip(s):');
        ptitles.forEach((t) => console.log(`      - ${t}`));

        check('no page errors', page._errs.length === 0, page._errs.join(' | '));
        await ctx.close();
    }

    // ---------------------------------------------------------------- SME-002
    console.log('\n[SME-002] effort slider units + fit');
    {
        const { ctx, page } = await fresh(browser, 'a02');
        await enableEffort(page, { patientRR: 20, pmus: 4 });
        await page.waitForTimeout(600);

        const eff = await page.evaluate(() => {
            const g = (id) => {
                const el = document.getElementById(id);
                return el ? { text: el.textContent.trim(), visible: el.offsetParent !== null } : null;
            };
            const rail = document.querySelector('.controls');
            const rb = rail.getBoundingClientRect();
            const spills = [];
            rail.querySelectorAll('*').forEach((el) => {
                const b = el.getBoundingClientRect();
                if (b.width > 0 && (b.right > rb.right + 0.5 || b.left < rb.left - 0.5)) {
                    spills.push(`${el.id || el.className}`);
                }
            });
            const cut = [...rail.querySelectorAll('*')]
                .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
                .map((el) => `${el.id || el.className}:"${el.textContent.trim().slice(0, 20)}"`);
            return { pmus: g('pmus-max-display'), nti: g('neural-ti-display'), spills, cut };
        });
        check('Effort slider now has an inline value', eff.pmus && eff.pmus.visible, JSON.stringify(eff.pmus));
        check('Effort value carries its unit', /cmH₂O/.test(eff.pmus?.text || ''), eff.pmus?.text);
        check('Effort value tracks the slider', /^4\b/.test(eff.pmus?.text || ''), eff.pmus?.text);
        check('T-neural value carries a spaced unit', /\d\.\d s$/.test(eff.nti?.text || ''), eff.nti?.text);
        check('nothing overflows the sidebar', eff.spills.length === 0, eff.spills.join(','));
        check('no control text is cut off inside its own box', eff.cut.length === 0, eff.cut.join(', '));
        check('no page errors', page._errs.length === 0, page._errs.join(' | '));
        await ctx.close();
    }

    // ------------------------------------------------ teaching panel clipping
    console.log('\n[regression] Teaching-Mode monitor column clipping');
    {
        const { ctx, page } = await fresh(browser, 'aclip');
        await enableEffort(page, { patientRR: 30, pmus: 6 });
        await page.click('#btn-teaching-mode');
        await page.waitForTimeout(9000);
        const clipped = await page.evaluate(() => {
            const panel = document.querySelector('.parameters');
            // scrollWidth > clientWidth on any inline value means its text is
            // being cut off inside its own box (the "6 cmH\u2082O" failure).
            window.__overflowing = [...panel.querySelectorAll('*')]
                .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
                .map((el) => `${el.className}:"${el.textContent.trim().slice(0, 20)}"`);
            const pb = panel.getBoundingClientRect();
            const bad = [];
            panel.querySelectorAll('.param-row__value, .rr-triple__num, .rr-triple__lbl, .rr-triple__unit, .param-mode__value')
                .forEach((el) => {
                    const b = el.getBoundingClientRect();
                    if (b.width > 0 && (b.right > pb.right - 1 || b.left < pb.left + 1)) {
                        bad.push(`${el.className}:"${el.textContent.trim()}"`);
                    }
                });
            return { bad, overflowing: window.__overflowing };
        });
        check('no readout is clipped by the 208px teaching column', clipped.bad.length === 0,
            clipped.bad.join(', '));
        check('no readout text overflows its own box', clipped.overflowing.length === 0,
            clipped.overflowing.join(', '));
        await ctx.close();
    }

    // -------------------------------------------------- asset cache-busting
    // A stale stylesheet paired with fresh markup fails SILENTLY: no console
    // error, no layout error — markup-dependent rules just don't exist, so the
    // mode row vanishes and the RR readout reverts to its old layout. This
    // actually happened. Every local asset must carry the SAME ?v=.
    console.log('\n[regression] every local asset shares one cache-bust version');
    {
        const fs = require('fs');
        const html = fs.readFileSync(`${__dirname}/../index.html`, 'utf8');
        const refs = [...html.matchAll(/<(?:link|script)[^>]*(?:href|src)="([^"]+)"/g)]
            .map((m) => m[1])
            .filter((u) => !/^https?:|^\/\//.test(u));      // local assets only
        const unversioned = refs.filter((u) => !/\?v=\d+/.test(u));
        check('no local asset is missing ?v=', unversioned.length === 0, unversioned.join(', '));
        const versions = [...new Set(refs.map((u) => (u.match(/\?v=(\d+)/) || [])[1]).filter(Boolean))];
        check('all local assets share one version', versions.length <= 1,
            `versions=${versions.join(',')} in ${refs.join(' ')}`);

        // js/main.js imports carry their own ?v= — they must agree too.
        const mainJs = fs.readFileSync(`${__dirname}/../js/main.js`, 'utf8');
        const ventJs = fs.readFileSync(`${__dirname}/../js/ventilator.js`, 'utf8');
        const imp = [...new Set([...mainJs.matchAll(/from\s+'[^']*\?v=(\d+)'/g)].map((m) => m[1]))];
        const allVersions = [...(html + mainJs + ventJs).matchAll(/\?v=(\d+)/g)].map(m => m[1]);
        check('js/main.js imports share the same version as index.html',
            imp.length === 1 && (versions.length === 0 || imp[0] === versions[0])
                && allVersions.length === 10 && allVersions.every(v => v === '12'),
            `imports=${imp.join(',')} html=${versions.join(',')} all ten=${allVersions.join(',')}`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${pass} passed, ${fail} failed`);
    if (fail) { failures.forEach((f) => console.log(`   ✗ ${f}`)); process.exitCode = 1; }
    console.log('='.repeat(60));
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(`Browser assertion harness failed: ${error.stack || error.message}`);
    process.exitCode = 1;
});
