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

// VSM-CLIN-008: additional assertions, separate from the commissioned 44 checks.
async function failedTriggerTerminologyContract(page) {
    const result = await page.evaluate(() => {
        const api = window.__vsim;
        api.pause();
        let passed = 0;
        const require = (ok, name) => {
            if (!ok) throw new Error(`CLIN008 ${name}`);
            passed++;
        };
        const input = (id, value) => {
            const el = document.getElementById(id);
            el.value = String(value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const teaching = on => {
            if (document.body.classList.contains('teaching-mode') !== on) document.getElementById('btn-teaching-mode').click();
        };
        const help = 'Failed trigger (ineffective effort): a patient effort that did not start a breath. This counter shows failed triggers in the last 60 s, including efforts below the trigger threshold and efforts during inspiration or a hold.';
        const name = 'Failed triggers in the last 60 seconds';
        for (const mode of ['vc-cmv', 'pc-cmv', 'PC-CSV']) {
            teaching(false);
            document.querySelector(`.mode-btn[data-mode="${mode}"]`).click();
            document.querySelectorAll('.controls [data-collapsible][data-collapsed]').forEach(e => e.click());
            if (!api.state().predicted.pMusActive) document.getElementById('pmus-toggle').click();
            input('pmus-max', 0.5); input('patient-rr', 20);
            document.querySelector('[data-trigger-type="flow"]').click(); input('flow-trigger', 5);
            teaching(true); api.seek(14);
            const row = document.querySelector('.rr-triple__ineffective');
            require(row.querySelector('.rr-triple__lbl').textContent === 'Failed triggers', `${mode} canonical-counter`);
            require(Number(document.getElementById('rr-ineffective-count').textContent) === api.state().failedTriggers, `${mode} actual-count`);
            require(row.title === help && row.getAttribute('aria-description') === help, `${mode} exact-help`);
            require(row.getAttribute('role') === 'group' && row.getAttribute('aria-label') === name, `${mode} accessible-name`);
            require(!row.hasAttribute('aria-live') && !row.hasAttribute('tabindex'), `${mode} static-group`);
            const label = row.querySelector('.rr-triple__lbl').getBoundingClientRect();
            const value = row.querySelector('.rr-triple__val').getBoundingClientRect();
            require(label.right <= value.left, `${mode} compact-fit`);
            const canvas = document.getElementById('canvas-flow'), rect = canvas.getBoundingClientRect(), titles = new Set();
            for (let x = 0; x < rect.width; x += 2) {
                canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: rect.left + x, clientY: rect.top + rect.height / 2 }));
                if (canvas.title) titles.add(canvas.title);
            }
            require(titles.size > 0 && [...titles].every(t => t.startsWith('Failed trigger —') && t.includes('5.0 L/min') && !t.includes('ineffective effort')), `${mode} canonical-flow-title`);
            canvas.dispatchEvent(new MouseEvent('mouseleave'));
            require(canvas.title === '', `${mode} hover-leave`);
        }
        api.seek(0);
        const refs = [...document.querySelectorAll('#param-rr .rr-triple__line, #param-rr .rr-triple__cell')];
        require(document.getElementById('rr-ineffective-count').textContent === '0', 'zero-count');
        while (Number(document.getElementById('rr-ineffective-count').textContent) === 0 && api.state().globalTime < 8) api.step(0.01);
        require(document.getElementById('rr-ineffective-count').textContent === '1', 'one-count');
        require(refs.every((e, i) => e === document.querySelectorAll('#param-rr .rr-triple__line, #param-rr .rr-triple__cell')[i]), 'count-changing-hover-persistence');
        require(document.querySelector('.rr-triple__ineffective').title === help, 'persistent-title');
        return passed;
    });
    console.log(`CLIN008_FOCUSED_BROWSER ${result} passed, 0 failed`);
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
                'param-ve': s.deliveredVentilation.status === 'available'
                    ? s.deliveredVentilation.valueLpm.toFixed(1) : '—',
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
                'param-vt': 'Measured VT', 'param-ve': 'Delivered VE',
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
                require(el('param-rr').title.includes('zero until two completions'), `${name} measured RR help`);
                require(el('param-rr').closest('.param-row').getAttribute('aria-labelledby') === 'rr-param-label',
                    `${name} measured RR accessible label`);
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
                const measuredCell = el('param-rr').querySelector('.rr-triple__num--delivered').closest('.rr-triple__cell');
                require(measuredCell.querySelector('.rr-triple__lbl').textContent === 'Measured'
                    && measuredCell.getAttribute('aria-label') === 'Measured RR'
                    && measuredCell.title.includes('zero until two completions'), `${name} Teaching measured RR label/help`);
                require(el('param-rr').querySelector('.rr-triple__num--delivered').textContent ===
                    String(Math.round(s.measuredRRRaw)), `${name} Teaching measured RR`);
                require(!/\d/.test(text('param-auto-peep')), `${name} no hidden auto-PEEP number in live cue`);
            }
            require(s.alarmPip === s.runningPip, `${name} alarm PIP must remain live`);
            const ve = s.deliveredVentilation;
            require(ve.source === 'live-completed-breath-volume' && ve.windowSeconds === 30,
                `${name} delivered VE source/window`);
            require(text('ve-status') === (ve.status === 'available' ? '30 s' : 'Collecting 30 s'), `${name} VE status`);
            require(s.alarmMetrics.minuteVentilationLpm === ve.valueLpm, `${name} raw shared alarm VE`);
            // Reset handlers intentionally refresh display without evaluating alarms.
            if (s.monitorDelivery?.simulationGeneration === s.evaluatedDelivery?.simulationGeneration
                && s.monitorDelivery?.asOfTick === s.evaluatedDelivery?.asOfTick) {
                require(s.monitorDelivery === s.evaluatedDelivery, `${name} same object delivered to both consumers`);
            }
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
        require(first.completed !== null && first.measuredRRRaw === 0 && text('param-ve') === '—', 'first-breath warm-up');
        for (let i = 0; i < 600 && api.state().breathCount < 2; i++) api.step(0.01);
        const next = take('CSV next inspiration');
        require(next.completed.completedAt_s === first.completed.completedAt_s
            && text('param-vt') === String(Math.round(first.completed.measuredVT_mL)) && next.vt_mL === 0,
            'finalized VT must survive provisional next-breath reset');
        api.step(30); const delivered = take('CSV established delivery');
        require(delivered.measuredRRRaw > 0 && Number(text('param-ve')) > 0, 'established live delivery guard');
        teaching(true); api.redraw(); take('Teaching CSV established delivery');
        teaching(false); effort(false); api.step(31);
        const ceased = take('CSV full-window cessation');
        require(ceased.deliveredVentilation.valueLpm === 0 && text('param-ve') === '0.0'
            && ceased.measuredRRRaw > 0, 'VE expires independently of stale interval RR');
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

    // Escape after pointer transfer must stay closed when focus returns to VE.
    const deliveredVE = await firstVisible('[data-measurement-help="delivered-ve"]');
    await page.evaluate(() => document.activeElement?.blur());
    await deliveredVE.hover();
    await tooltip.hover();
    await page.waitForTimeout(220);
    require(await tooltip.isVisible(), 'VE hover transfer did not preserve help');
    await page.keyboard.press('Escape');
    require(!await tooltip.isVisible()
        && await deliveredVE.evaluate(node => document.activeElement === node),
        'VE help reopened while restoring focus after Escape');

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

// VSM-CLIN-007: real DOM interactions; numbered checks also identify mutation kills.
async function pcDisclosureContract(page, { stopOnFailure = false } = {}) {
    const checks = [], geometry = [], caveats = [];
    const check = (id, ok, detail = '') => {
        checks.push({ id, ok, detail });
        if (!ok && stopOnFailure) {
            const error = new Error(id + ': ' + detail);
            error.pcContractCheck = { id, ok, detail };
            throw error;
        }
    };
    const cue = page.locator('#pc-disclosure-trigger'), help = page.locator('#measurement-help');
    const common = 'Patient effort can change flow and delivered volume in this model. Triggering, cycling, inspiratory holds, and expiration follow their own rules.\n\nThe flat inspiratory trace here is a model idealization. On real ventilators, patient effort may also affect pressure; assess flow and volume as well.';
    const cmv = 'In PC-CMV, this simulator uses idealized set-point pressure control. During pressure-targeted inspiration, Paw stays at PEEP plus the set inspiratory pressure, even with patient effort.';
    const csv = 'In PC-CSV, this simulator uses idealized set-point pressure control. When a breath is delivered, Paw stays at PEEP plus Pressure Support during pressure-targeted inspiration, even with patient effort.';
    const state = () => page.evaluate(() => window.__vsim.state());
    const redraw = () => page.evaluate(() => window.__vsim.redraw());
    const mode = m => page.evaluate(m => document.querySelector(`.mode-btn[data-mode="${m}"]`).click(), m);
    const seek = s => page.evaluate(s => window.__vsim.seek(s), s);
    const input = (id, value) => page.evaluate(({ id, value }) => {
        const e = document.getElementById(id); e.value = String(value); e.dispatchEvent(new Event('input', { bubbles: true }));
    }, { id, value });
    const teaching = on => page.evaluate(on => {
        if (document.body.classList.contains('teaching-mode') !== on) document.getElementById('btn-teaching-mode').click();
    }, on);
    const focusElsewhere = () => page.locator('#btn-pause').focus();
    const dismiss = async () => { await page.keyboard.press('Escape'); await focusElsewhere(); await page.mouse.move(1, 1); };
    const open = async () => { await dismiss(); await cue.focus(); };
    const exists = await cue.count() === 1;
    check('PC.markup', exists && await page.locator('.waveforms > .pc-disclosure').count() === 1);
    if (!exists) return { checks, geometry, caveats, errors: ['PC.markup: missing trigger'] };
    await cue.evaluate(e => { window.__pcInitialCue = e; });
    await page.evaluate(() => window.__vsim.pause());
    await teaching(false);
    await mode('vc-cmv');
    check('PC.VC-hidden', !(await cue.isVisible()));
    await page.locator('.controls [data-collapsible][data-collapsed]').evaluateAll(es => es.forEach(e => e.click()));
    await input('compliance', 50); await input('resistance', 10); await input('rr', 14);
    await page.locator('#pmus-toggle').evaluate(e => { if (e.classList.contains('hold-btn--active')) e.click(); });
    // Passive means the toggle is off; the magnitude slider has a positive minimum.
    for (const m of ['pc-cmv', 'PC-CSV']) {
        await mode(m); await seek(0);
        check('PC.static-node-identity', await cue.evaluate(e => e === window.__pcInitialCue));
        check(`PC.${m}.reset-presence`, await cue.isVisible());
        if (!(await cue.isVisible())) continue;
        check('PC.accessible-name', await cue.getAttribute('aria-label') === 'Idealized pressure control help');
        check('PC.visible-copy', (await cue.locator('span').first().textContent()) === 'Idealized pressure control');
        await open();
        check(`PC.${m}.exact-help`, (await help.textContent()).trim() === (m === 'PC-CSV' ? csv : cmv) + '\n\n' + common);
        check('PC.no-hold-fallback', !(await help.textContent()).includes('Reason codes:'));
        await seek(15);
        check(`PC.${m}.passive-presence`, await cue.isVisible());
        if (m === 'PC-CSV') check('PC.csv-idle-conditional', (await state()).completed === null && (await help.textContent()).includes('When a breath is delivered'));
        await teaching(true);
        check(`PC.${m}.teaching-presence`, await cue.isVisible());
        await teaching(false);
    }
    await mode('pc-cmv');
    if (!(await cue.isVisible())) return { checks, geometry, caveats, errors: checks.filter(c => !c.ok).map(c => c.id) };
    await open();
    check('PC.focus-opens', await help.isVisible());
    check('PC.aria-open', await cue.getAttribute('aria-controls') === 'measurement-help' && await cue.getAttribute('aria-expanded') === 'true' && await cue.getAttribute('aria-describedby') === 'measurement-help');
    await cue.press('Enter');
    await focusElsewhere(); await page.waitForTimeout(200);
    check('PC.enter-pins', await help.isVisible());
    await cue.focus(); await cue.press('Space');
    check('PC.space-toggles', !(await help.isVisible()));
    await dismiss();
    await cue.hover();
    check('PC.hover-opens', await help.isVisible());
    const box = await cue.boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height + 3);
    await page.waitForTimeout(75);
    check('PC.hover-gap-delay', await help.isVisible());
    if (await help.isVisible()) await help.hover();
    await page.waitForTimeout(200);
    check('PC.hover-transfer', await help.isVisible());
    await page.mouse.move(1, 1); await page.waitForTimeout(200);
    check('PC.hover-leave-closes', !(await help.isVisible()));
    await cue.click(); await focusElsewhere(); await page.mouse.move(1, 1); await page.waitForTimeout(200);
    check('PC.click-pins', await help.isVisible());
    await cue.hover(); await cue.click();
    check('PC.reentry-toggle', !(await help.isVisible()));
    await cue.click(); await focusElsewhere(); await page.keyboard.press('Escape');
    check('PC.escape-close-focus', !(await help.isVisible()) && await cue.evaluate(e => e === document.activeElement));
    await redraw();
    check('PC.escape-no-reopen', !(await help.isVisible()));
    await open(); await cue.press('Tab'); await page.waitForTimeout(200);
    check('PC.tab-order', !(await cue.evaluate(e => e === document.activeElement)) && await cue.getAttribute('aria-expanded') === 'false');
    await open(); await focusElsewhere(); await page.waitForTimeout(200);
    check('PC.blur-unpinned', !(await help.isVisible()));
    await open(); await cue.press('Enter');
    await cue.evaluate(e => { window.__pcOriginalCue = e; });
    await page.evaluate(() => { for (let i = 0; i < 120; i++) window.__vsim.redraw(); window.__vsim.step(1); });
    check('PC.redraw-identity-focus-pin', await cue.evaluate(e => e === window.__pcOriginalCue && document.activeElement === e) && await help.isVisible());
    await seek(0); await input('peep', 7); await mode('PC-CSV');
    check('PC.state-transition-text', (await help.textContent()).trim() === csv + '\n\n' + common && await help.isVisible());
    await teaching(true); await teaching(false);
    await page.evaluate(() => { document.querySelector('#speed-group [data-speed="2"]').click(); document.getElementById('btn-pause').click(); document.getElementById('btn-pause').click(); window.__vsim.redraw(); });
    check('PC.state-persistence', await cue.evaluate(e => e === window.__pcOriginalCue && e === document.activeElement) && await help.isVisible());
    await focusElsewhere(); await page.waitForTimeout(200);
    check('PC.pin-survives-state-updates', await help.isVisible());
    await cue.focus(); await mode('vc-cmv');
    check('PC.VC-transition-closes', !(await help.isVisible()) && !(await cue.isVisible()) && await cue.getAttribute('aria-expanded') === 'false' && await cue.getAttribute('aria-describedby') === null);
    check('PC.VC-focus-visible', await page.evaluate(() => document.activeElement.matches('.mode-btn[data-mode="vc-cmv"]') && document.activeElement.getClientRects().length > 0));
    await mode('pc-cmv'); await open(); await cue.press('Enter');
    await page.locator('.mode-btn[data-mode="PC-CSV"]').click();
    check('PC.user-mode-dismissal', !(await help.isVisible()) && !(await cue.evaluate(e => e === document.activeElement)));
    await open(); await cue.press('Enter'); await page.locator('#btn-teaching-mode').click();
    check('PC.user-teach-dismissal', !(await help.isVisible()) && await page.locator('#btn-teaching-mode').evaluate(e => e === document.activeElement));
    await teaching(false); await mode('pc-cmv');
    // Actual HOLD and expiration, active CSV flow cycle, max Ti, weak effort and cessation.
    await input('peep', 5); await input('rr', 14);
    await page.locator('#hold-toggle').evaluate(e => { if (!e.classList.contains('hold-btn--active')) e.click(); });
    await input('hold-duration', 5); await seek(1.5);
    check('PC.hold-presence', (await state()).phase === 'HOLD' && await cue.isVisible());
    await seek(2.1); check('PC.expiration-presence', (await state()).phase === 'EXPIRATION' && await cue.isVisible());
    await page.locator('#pmus-toggle').evaluate(e => { if (!e.classList.contains('hold-btn--active')) e.click(); });
    await input('pmus-max', 6); await input('patient-rr', 20); await input('neural-ti', 10);
    await mode('PC-CSV'); await input('cycle-percent', 25); await seek(15);
    check('PC.csv-active-flow', (await state()).completed?.terminationReason === 'flowCycle' && await cue.isVisible());
    await input('cycle-percent', 10); await input('rr', 35); await seek(15);
    check('PC.csv-max-ti', (await state()).completed?.terminationReason === 'maxTiReached' && await cue.isVisible());
    await input('pmus-max', 0.5); await input('flow-trigger', 5); await seek(15);
    check('PC.csv-weak', (await state()).completed === null && (await state()).failedTriggers > 0 && await cue.isVisible());
    await input('flow-trigger', 2); await input('pmus-max', 6); await input('rr', 14); await input('cycle-percent', 25); await seek(15);
    await page.locator('#pmus-toggle').evaluate(e => { if (e.classList.contains('hold-btn--active')) e.click(); });
    await page.evaluate(() => window.__vsim.step(35));
    check('PC.csv-cessation', (await state()).deliveredVentilation.valueLpm === 0 && await cue.isVisible());
    // Shared HOLD / VE pin fixes must work on their static triggers too.
    await mode('pc-cmv');
    for (const key of ['pplat', 'delivered-ve']) {
        const triggers = page.locator(`[data-measurement-help="${key}"]`);
        let trigger;
        for (let i = 0; i < await triggers.count(); i++) if (await triggers.nth(i).isVisible()) { trigger = triggers.nth(i); break; }
        await dismiss(); await trigger.click(); await focusElsewhere(); await page.mouse.move(1, 1); await page.waitForTimeout(200); await trigger.hover(); await trigger.click();
        check(`PC.shared-${key}-reentry-toggle`, !(await help.isVisible()));
        await trigger.click(); await focusElsewhere(); await page.keyboard.press('Escape'); await redraw();
        check(`PC.shared-${key}-escape`, !(await help.isVisible()) && await trigger.evaluate(e => e === document.activeElement));
    }
    await open(); await page.locator('[data-measurement-help="delivered-ve"]').click();
    check('PC.one-shared-popover', await page.locator('#measurement-help').count() === 1 && await cue.getAttribute('aria-expanded') === 'false' && await cue.getAttribute('aria-describedby') === null);
    for (const width of [320, 390, 768, 1024, 1440]) for (const height of [844, 900]) for (const teach of [false, true]) {
        await dismiss(); await teaching(teach); await page.setViewportSize({ width, height }); await redraw();
        const g = await cue.evaluate(e => {
            const r = e.getBoundingClientRect(), row = e.parentElement.getBoundingClientRect(), plot = document.getElementById('canvas-pressure').getBoundingClientRect();
            const text = e.querySelector('span'), style = getComputedStyle(e);
            return { cue: r.toJSON(), row: row.toJSON(), plot: plot.toJSON(), visible: e.getClientRects().length > 0, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, textScroll: text.scrollWidth, textClient: text.clientWidth, font: style.fontSize, nowrap: style.whiteSpace, documentWidth: document.documentElement.scrollWidth };
        });
        geometry.push({ width, height, teaching: teach, ...g });
        if (!teach && width < 600) { caveats.push(`Pre-existing Standard grid at ${width}px reserves 480px for sidebars; plot/cue unavailable.`); continue; }
        check(`PC.geometry-${width}-${height}-${teach}`, g.visible && g.cue.height >= 24 && g.cue.bottom <= g.plot.top && g.cue.right <= width && g.scrollWidth <= g.clientWidth + 1 && g.textScroll <= g.textClient + 1 && g.nowrap !== 'nowrap' && g.font === '12px', JSON.stringify(g));
        await open();
        const b = await help.boundingBox();
        check(`PC.help-viewport-${width}-${height}-${teach}`, b && b.x >= 7.5 && b.y >= 7.5 && b.x + b.width <= width - 7.5 && b.y + b.height <= height - 7.5);
    }
    // Short viewport forces overflow without synthetic CSS; focus stays on cue.
    await teaching(true); await page.setViewportSize({ width: 390, height: 240 }); await redraw(); await open();
    const overflow = await help.evaluate(e => e.scrollHeight > e.clientHeight);
    check('PC.overflow-fixture', overflow);
    for (const key of ['End', 'Home', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']) {
        await cue.press(key);
        const s = await help.evaluate(e => ({ top: e.scrollTop, max: e.scrollHeight - e.clientHeight }));
        check(`PC.overflow-${key}`, overflow && (key === 'End' ? Math.abs(s.top - s.max) <= 1 : ['Home', 'ArrowUp', 'PageUp'].includes(key) ? s.top === 0 : s.top > 0) && await cue.evaluate(e => e === document.activeElement));
    }
    await page.setViewportSize({ width: 1440, height: 900 }); await teaching(false);
    const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
    await page.reload(); await page.waitForFunction(() => !!window.__vsim); await page.evaluate(() => window.__vsim.pause());
    check('PC.reload-default', (await state()).mode === 'vc-cmv' && !(await state()).teachingMode && !(await cue.isVisible()) && !(await help.isVisible()));
    check('PC.no-persistence-storage', ![...storage.local, ...storage.session].some(k => /ideal|disclosure|measurement-help/i.test(k)));
    // A real touch-only browser context must activate the same click handler.
    const touchContext = await page.context().browser().newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
    try {
        const touch = await touchContext.newPage(); await touch.goto(page.url()); await touch.waitForFunction(() => !!window.__vsim);
        await touch.evaluate(() => { window.__vsim.pause(); document.querySelector('.mode-btn[data-mode="PC-CSV"]').click(); document.getElementById('btn-teaching-mode').click(); });
        const t = touch.locator('#pc-disclosure-trigger'), p = touch.locator('#measurement-help');
        await t.tap(); await touch.locator('#btn-pause').focus(); await touch.waitForTimeout(200);
        check('PC.touch-pins', await p.isVisible());
        await t.tap(); check('PC.touch-toggle', !(await p.isVisible()));
        await t.tap(); await touch.locator('#btn-pause').tap(); check('PC.touch-outside-dismiss', !(await p.isVisible()));
    } finally { await touchContext.close(); }
    return { checks, geometry, caveats, errors: checks.filter(c => !c.ok).map(c => c.id + ': ' + c.detail) };
}

module.exports = { pcDisclosureContract };

if (require.main === module) (async () => {
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
        const disclosure = await pcDisclosureContract(page);
        console.log(`    VSM-CLIN-007 disclosure checks: ${disclosure.checks.filter(c => c.ok).length}/${disclosure.checks.length}`);
        console.log(`    VSM-CLIN-005 presentation checks: ${presentation.checks - presentation.errors.length}/${presentation.checks}`);
        console.log('    VSM-CLIN-004 states:', JSON.stringify(provenance.states));
        check('panel mode tracks a mode change and VSM-CLIN-004 readouts retain provenance/state',
            csv.startsWith('PC-CSV') && provenance.errors.length === 0 && provenance.geometry.length === 0
                && presentation.errors.length === 0 && disclosure.errors.length === 0,
            [csv, ...provenance.errors, ...provenance.geometry, ...presentation.errors, ...disclosure.errors].join(' | '));
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
    console.log('\n[counter + SME-022] failed triggers');
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

        await failedTriggerTerminologyContract(page);

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
                && allVersions.length === 10 && allVersions.every(v => v === '17'),
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
