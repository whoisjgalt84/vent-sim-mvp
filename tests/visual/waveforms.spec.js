// @ts-check
import { test, expect } from '@playwright/test';
import * as h from './helpers.js';

// The Desktop Chrome device preset supplies a 1280x720 viewport at the project
// layer, which otherwise overrides the documented 1440x900 suite viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Visual regression for the waveform display.
 *
 * Every test seeks to an exact simulated timestamp before screenshotting, so
 * the frame is a pure function of the scenario — no wall-clock waits, no frame
 * timing, no flake. Runs in ~2 s total; the equivalent scratch/shot.cjs
 * scenarios take ~80 s of real waiting.
 *
 * Update baselines after an INTENTIONAL visual change:
 *   npm run test:visual:docker -- --update-snapshots
 */

// 14 s covers several full breaths at default settings and lands mid-sweep,
// so a regression in the erase bar or the pen-lift shows up.
const SEEK_SECONDS = 14;

// VSM-CLIN-007: characterize existing traces with the approved disclosure.
// These images require separate owner acceptance; they do not approve morphology.
async function pcDisclosureSnapshots(page) {
    const common = 'Patient effort can change flow and delivered volume in this model. Triggering, cycling, inspiratory holds, and expiration follow their own rules.\n\nThe flat inspiratory trace here is a model idealization. On real ventilators, patient effort may also affect pressure; assess flow and volume as well.';
    for (const mode of ['pc-cmv', 'PC-CSV']) for (const active of [false, true]) for (const teaching of [false, true]) {
        const errors = await h.open(page);
        await page.setViewportSize({ width: 1440, height: 900 });
        await h.setMode(page, mode);
        await h.expandRail(page);
        await h.setRange(page, '#compliance', 50);
        await h.setRange(page, '#resistance', 10);
        await h.setRange(page, '#rr', 14);
        if (active) await h.enableEffort(page, { patientRR: mode === 'pc-cmv' ? 14 : 20, pmus: mode === 'pc-cmv' ? 10 : 6 });
        if (teaching) await h.teachingMode(page);
        await h.seek(page, 14);
        const s = await h.state(page);
        expect(s.mode).toBe(mode);
        expect(s.teachingMode).toBe(teaching);
        if (mode === 'PC-CSV' && !active) expect(s.completed).toBeNull();
        else expect(s.completed).not.toBeNull();
        if (mode === 'PC-CSV' && active) expect(s.completed.terminationReason).toBe('flowCycle');
        const cue = page.getByRole('button', { name: 'Idealized pressure control help', exact: true });
        await expect(cue).toBeVisible();
        await expect(cue.locator('span').first()).toHaveText('Idealized pressure control');
        const name = `pc-disclosure-${mode}-${active ? 'active' : 'passive'}-${teaching ? 'teaching' : 'standard'}`;
        await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
        if (!active) {
            await cue.click();
            const opening = mode === 'PC-CSV'
                ? 'In PC-CSV, this simulator uses idealized set-point pressure control. When a breath is delivered, Paw stays at PEEP plus Pressure Support during pressure-targeted inspiration, even with patient effort.'
                : 'In PC-CMV, this simulator uses idealized set-point pressure control. During pressure-targeted inspiration, Paw stays at PEEP plus the set inspiratory pressure, even with patient effort.';
            expect((await page.locator('#measurement-help').textContent()).trim()).toBe(opening + '\n\n' + common);
            await expect(page).toHaveScreenshot(`${name}-help.png`, { fullPage: true });
        }
        if (active && teaching) {
            for (const width of [390, 320]) {
                await page.setViewportSize({ width, height: 844 });
                await page.evaluate(() => window.__vsim.redraw());
                await expect(cue).toBeVisible();
                await expect(page).toHaveScreenshot(`${name}-${width}.png`, { fullPage: true });
            }
            await page.setViewportSize({ width: 390, height: 240 });
            await cue.focus();
            await expect(page.locator('#measurement-help')).toBeVisible();
            expect(await page.locator('#measurement-help').evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
            await cue.press('End');
            await expect(page).toHaveScreenshot(`${name}-overflow-end.png`, { fullPage: true });
        }
        expect(errors).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await h.open(page);
    await h.expandRail(page); await h.setMode(page, 'pc-cmv');
    await page.click('#hold-toggle'); await h.setRange(page, '#hold-duration', 5);
    await h.seek(page, 1.5);
    expect((await h.state(page)).phase).toBe('HOLD');
    await expect(page.locator('#pc-disclosure-trigger')).toBeVisible();
    await expect(page).toHaveScreenshot('pc-disclosure-cmv-hold.png', { fullPage: true });
    await h.open(page); await h.setMode(page, 'PC-CSV'); await h.enableEffort(page, { patientRR: 20, pmus: 6 });
    await h.setRange(page, '#rr', 35); await h.setRange(page, '#cycle-percent', 10); await h.teachingMode(page); await h.seek(page, 15);
    expect((await h.state(page)).completed.terminationReason).toBe('maxTiReached');
    await expect(page.locator('#pc-disclosure-trigger')).toBeVisible();
    await expect(page).toHaveScreenshot('pc-disclosure-csv-max-ti.png', { fullPage: true });
}

async function expectAvailableDelivery(page, zero = false) {
    const s = await h.state(page);
    const delivery = s.deliveredVentilation;
    expect(delivery.status).toBe('available');
    expect(delivery.observedSeconds).toBe(30);
    expect(s.monitorDelivery).toEqual(delivery);
    expect(s.evaluatedDelivery).toEqual(delivery);
    expect(s.alarmMetrics.minuteVentilationLpm).toBe(delivery.valueLpm);
    if (zero) expect(delivery.valueLpm).toBe(0);
    else expect(delivery.valueLpm).toBeGreaterThan(0);
    await expect(page.locator('#param-ve')).toHaveText(delivery.valueLpm.toFixed(1));
    await expect(page.locator('#ve-status')).toHaveText('30 s');
    await expect(page.getByRole('group', { name: 'Measured RR', exact: true })).toBeVisible();
    if (s.teachingMode) {
        const measuredCell = page.locator('.rr-triple__num--delivered').locator('..');
        await expect(measuredCell.locator('.rr-triple__lbl')).toHaveText('Measured');
        await expect(measuredCell).toHaveAttribute('title', /Completed-breath interval rate: zero until two completions/);
    } else {
        await expect(page.locator('#rr-param-label')).toHaveText('Measured RR');
        await expect(page.locator('#param-rr')).toHaveAttribute('title', /Completed-breath interval rate: zero until two completions/);
    }
}

async function expectFailedTriggerCopy(page) {
    const counter = page.getByRole('group', { name: 'Failed triggers in the last 60 seconds', exact: true });
    await expect(counter.locator('.rr-triple__lbl')).toHaveText('Failed triggers');
    const help = 'Failed trigger (ineffective effort): a patient effort that did not start a breath. This counter shows failed triggers in the last 60 s, including efforts below the trigger threshold and efforts during inspiration or a hold.';
    await expect(counter).toHaveAttribute('title', help);
    await expect(counter).toHaveAttribute('aria-description', help);
    expect(await counter.evaluate(e => e.querySelector('.rr-triple__lbl').getBoundingClientRect().right <= e.querySelector('.rr-triple__val').getBoundingClientRect().left)).toBe(true);
}

// VSM-CLIN-009: point-of-selection presentation; retain the commissioned nine tests.
async function mechanicsExampleSnapshots(page) {
    await h.open(page); await h.expandRail(page); await h.seek(page, 0);
    await expect(page.locator('#compliance')).toHaveValue('60');
    await expect(page.locator('#compliance-display')).toHaveText('60 mL/cmH₂O');
    await page.locator('#mechanics-bar').scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot('examples-startup-C60.png', { fullPage: true });
    for (const key of ['normal', 'ards_moderate', 'ards_severe', 'copd', 'asthma', 'obesity', 'fibrosis']) {
        await page.selectOption('#preset', key); await page.evaluate(() => window.__vsim.redraw());
        await expect(page).toHaveScreenshot(`examples-${key}-selected.png`, { fullPage: true });
        await page.click('#mechanics-example-help');
        await expect(page.locator('#measurement-help')).toBeVisible();
        await expect(page).toHaveScreenshot(`examples-${key}-help.png`, { fullPage: true });
        await page.keyboard.press('Escape');
    }
    await h.setRange(page, '#compliance', 41); await h.setRange(page, '#resistance', 17);
    await expect(page.locator('#mechanics-example-state')).toHaveText('Custom mechanics');
    await page.click('#mechanics-example-help');
    await expect(page).toHaveScreenshot('examples-custom-help.png', { fullPage: true });
    await page.keyboard.press('Escape'); await h.setMode(page, 'pc-cmv'); await h.seek(page, 0);
    await expect(page.locator('#mechanics-example-state')).toHaveText('Custom mechanics');
    await page.locator('#mechanics-bar').scrollIntoViewIfNeeded();
    await expect(page).toHaveScreenshot('examples-custom-after-reset.png', { fullPage: true });
}

test.describe('waveform display', () => {

    test('baseline — VC-CMV, passive patient', async ({ page }) => {
        const errors = await h.open(page);
        expect(page.viewportSize()).toEqual({ width: 1440, height: 900 });
        await h.expandRail(page);
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.mode).toBe('vc-cmv');
        expect(s.teachingMode).toBe(false);
        expect(s.machineBreaths).toBeGreaterThan(0);
        expect(s.patientBreaths).toBe(0);

        await expect(page.locator('.waveforms')).toHaveScreenshot('baseline.png');
        await page.click('#hold-toggle');
        await h.setRange(page, '#hold-duration', 5);
        await h.seek(page, 20);
        expect((await h.state(page)).holdMechanics.status).toBe('valid');
        await expect(page.locator('#hold-status')).toHaveText('');
        await expect(page.locator('#pplat-status')).toHaveText('');
        await expect(page.locator('#hold-modeled-baseline > span')).toHaveText('Modeled baseline');
        await expect(page.locator('#dp-status > span')).toHaveText('Modeled baseline');
        await expect(page).toHaveScreenshot('hold-valid-square-standard-full.png', { fullPage: true });
        await expect(page.locator('#hold-results')).toHaveScreenshot('hold-valid-square-panel.png');
        await page.click('#hold-results [data-measurement-help="pplat"]');
        await expect(page.locator('#measurement-help')).toContainText('Available after a completed hold that meets this simulator’s duration, zero-flow, pressure-stability, and effort criteria.');
        await expect(page).toHaveScreenshot('hold-valid-pplat-help-standard-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await page.click('#hold-modeled-baseline [data-measurement-help="modeled-baseline"]');
        await expect(page.locator('#measurement-help')).toContainText('Live modeled total PEEP at breath start. Calculated from set PEEP, integrated residual volume, and configured compliance; not measured by an expiratory hold.');
        await expect(page).toHaveScreenshot('hold-valid-baseline-help-standard-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await h.setRange(page, '#hold-duration', 4);
        await h.seek(page, 20);
        expect((await h.state(page)).holdMechanics.reasons).toContain('HOLD_TOO_SHORT');
        await expect(page.locator('#hold-status')).toHaveText('Hold too short');
        await expect(page.locator('#hold-results')).toHaveScreenshot('hold-short-panel.png');
        await page.click('[data-measurement-help="duration"]');
        await expect(page.locator('#measurement-help')).toHaveText('The 0.5–2 s range is this simulator’s measurement criterion.');
        await expect(page).toHaveScreenshot('hold-short-duration-help-standard-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await page.click('#flow-pattern-group [data-pattern="ramp"]');
        await h.setRange(page, '#hold-duration', 5);
        await h.seek(page, 20);
        expect((await h.state(page)).holdMechanics.resistance.status).toBe('inapplicable');
        await expect(page.locator('#hold-raw-status')).toHaveText('Unavailable for ramp VC');
        await expect(page.locator('#hold-results')).toHaveScreenshot('hold-ramp-panel.png');
        await page.click('#hold-results [data-measurement-help="inspiratory-resistance"]');
        await expect(page.locator('#measurement-help')).toContainText('Resistance unavailable for ramp VC.');
        await expect(page).toHaveScreenshot('hold-ramp-resistance-help-standard-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await h.setMode(page, 'pc-cmv');
        await h.seek(page, 20);
        expect((await h.state(page)).holdMechanics.resistance.reasons).toContain('RESISTANCE_PRESSURE_CONTROL');
        await expect(page.locator('#hold-raw-status')).toHaveText('Unavailable for pressure control');
        await expect(page.locator('#hold-results')).toHaveScreenshot('hold-pc-panel.png');
        // Same commissioned test, additional approved-scope state/screenshot.
        await h.setMode(page, 'PC-CSV');
        await h.setRange(page, '#resistance', 40);
        await h.setRange(page, '#compliance', 80);
        await h.seek(page, 15);
        expect((await h.state(page)).completed).toBeNull();
        await expect(page.locator('#param-pip')).toHaveText('—');
        await expect(page.locator('#param-vt')).toHaveText('—');
        await expect(page.locator('#param-ve')).toHaveText('—');
        await expect(page.locator('#ve-status')).toHaveText('Collecting 30 s');
        await expect(page.getByRole('group', { name: 'Predicted breath MAP', exact: true })).toBeVisible();
        await expect(page.getByRole('group', { name: 'Live modeled trapped volume', exact: true })).toBeVisible();
        await expect(page).toHaveScreenshot('csv-no-breath-standard-full.png', { fullPage: true });
        await expect(page.locator('.mechanics-chip--prediction')).toHaveScreenshot('csv-predicted-trapping.png');
        await h.setRange(page, '#ps-pressure', 20);
        await h.seek(page, 15);
        await expect(page.locator('#alerts')).toContainText('Predicted steady-state auto-PEEP 4');
        await expect(page.locator('.header')).toHaveScreenshot('csv-predicted-header-standard.png');
        await h.teachingMode(page);
        await page.evaluate(() => window.__vsim.redraw());
        await expect(page.locator('#alerts')).toContainText('Predicted steady-state auto-PEEP 4');
        await expect(page.locator('.header')).toHaveScreenshot('csv-predicted-header-teaching.png');
        await page.click('#btn-teaching-mode');
        await h.setMode(page, 'vc-cmv');
        await h.setRange(page, '#compliance', 10);
        await h.seek(page, 0);
        await expect(page.locator('#param-pplat')).toHaveText('—');
        await expect(page.locator('#alerts')).toContainText('Predicted Pplat ');
        await expect(page.locator('.header')).toHaveScreenshot('predicted-pplat-before-breath.png');
        await h.setMode(page, 'PC-CSV');
        await h.seek(page, 30);
        await expectAvailableDelivery(page, true);
        await page.click('[data-measurement-help="delivered-ve"]');
        await expect(page.locator('#measurement-help')).toContainText('Zero is an available value; VE alarms can evaluate it.');
        await expect(page.locator('#measurement-help')).not.toContainText('Predicted VE:');
        await expect(page).toHaveScreenshot('ve-zero-help-standard-full.png', { fullPage: true });
        expect(errors, 'no console errors').toEqual([]);
        await mechanicsExampleSnapshots(page);
    });

    test('teaching mode — passive', async ({ page }) => {
        await h.open(page);
        await h.teachingMode(page);
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.mode).toBe('vc-cmv');
        expect(s.teachingMode).toBe(true);
        expect(s.patientBreaths).toBe(0);

        await expect(page).toHaveScreenshot('teaching-full.png', { fullPage: true });
        await page.click('#btn-teaching-mode');
        await h.expandRail(page);
        await page.click('#hold-toggle');
        await page.click('#btn-teaching-mode');
        await h.seek(page, 20);
        expect((await h.state(page)).holdMechanics.status).toBe('valid');
        await expect(page.locator('.parameters')).toHaveScreenshot('hold-valid-square-teaching-column.png');
        await page.click('#pplat-param-label + [data-measurement-help="pplat"]');
        await expect(page.locator('#measurement-help')).toContainText('Valid Pplat measurement.');
        await expect(page).toHaveScreenshot('hold-valid-pplat-help-teaching-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await page.click('#dp-status [data-measurement-help="modeled-baseline"]');
        await expect(page.locator('#measurement-help')).toContainText('Live modeled total PEEP at breath start.');
        await expect(page).toHaveScreenshot('hold-valid-baseline-help-teaching-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await page.click('#btn-teaching-mode');
        await h.setMode(page, 'PC-CSV');
        await h.teachingMode(page);
        await h.seek(page, 15);
        expect((await h.state(page)).completed).toBeNull();
        await expect(page.locator('#param-ve')).toHaveText('—');
        await expect(page.locator('#ve-status')).toHaveText('Collecting 30 s');
        await expect(page).toHaveScreenshot('csv-no-breath-teaching-full.png', { fullPage: true });
        await page.click('[data-measurement-help="delivered-ve"]');
        await expect(page.locator('#measurement-help')).toContainText('Collecting a full 30 s window: 15.0 of 30.0 s. VE alarms are unavailable during collection.');
        await expect(page).toHaveScreenshot('ve-warming-help-teaching-full.png', { fullPage: true });
        await h.seek(page, 30);
        await expectAvailableDelivery(page, true);
        await expect(page.locator('#measurement-help')).toContainText('Zero is an available value; VE alarms can evaluate it.');
        await expect(page).toHaveScreenshot('ve-zero-help-teaching-full.png', { fullPage: true });
    });

    test('effort — overbreathing in VC-CMV produces failed triggers', async ({ page }) => {
        await h.open(page);
        await h.enableEffort(page, { patientRR: 30, pmus: 6 });
        await h.seek(page, SEEK_SECONDS);

        // Guard the screenshot with a behavioural assertion: if the scenario
        // stops producing failed triggers, the baseline is measuring nothing.
        const s = await h.state(page);
        expect(s.failedTriggers, 'scenario must actually fail triggers').toBeGreaterThan(0);

        await expect(page.locator('.waveforms')).toHaveScreenshot('effort.png');
        await h.seek(page, 45);
        await expectAvailableDelivery(page);
        await expect(page).toHaveScreenshot('ve-established-vc-standard-full.png', { fullPage: true });
        await page.click('[data-measurement-help="delivered-ve"]');
        await expect(page.locator('#measurement-help')).toContainText('Predicted VE:');
        await expect(page.locator('#measurement-help')).toContainText('This prediction does not drive VE alarms.');
        await expect(page).toHaveScreenshot('ve-established-vc-help-standard-full.png', { fullPage: true });
    });

    test('effort + teaching — the failed-trigger counter and amber highlight', async ({ page }) => {
        await h.open(page);
        await h.enableEffort(page, { patientRR: 30, pmus: 6 });
        await h.teachingMode(page);          // rail work first — rail is hidden after this
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.teachingMode).toBe(true);
        expect(s.failedTriggers, 'scenario must actually fail triggers').toBeGreaterThan(0);
        await expectFailedTriggerCopy(page);

        await expect(page).toHaveScreenshot('effort-teaching-full.png', { fullPage: true });
        await h.seek(page, 45);
        await expectAvailableDelivery(page);
        await expect(page).toHaveScreenshot('ve-established-vc-teaching-full.png', { fullPage: true });
        await page.click('[data-measurement-help="delivered-ve"]');
        await expect(page.locator('#measurement-help')).toContainText('Predicted VE:');
        await expect(page).toHaveScreenshot('ve-established-vc-help-teaching-full.png', { fullPage: true });
        await page.keyboard.press('Escape');
        await page.click('#btn-teaching-mode');
        await h.setMode(page, 'PC-CSV');
        await h.teachingMode(page);
        await h.seek(page, 25);
        const delivered = await h.state(page);
        expect(delivered.completed).not.toBeNull();
        expect(delivered.measuredRR).toBeGreaterThan(0);
        await expect(page.getByRole('group', { name: 'Delivered VE', exact: true })).toBeVisible();
        await expect(page).toHaveScreenshot('csv-delivered-teaching-full.png', { fullPage: true });
        await h.seek(page, 45);
        await expectAvailableDelivery(page);
        await expect(page).toHaveScreenshot('ve-established-csv-teaching-full.png', { fullPage: true });
        await page.click('[data-measurement-help="delivered-ve"]');
        await expect(page.locator('#measurement-help')).not.toContainText('Predicted VE:');
        await expect(page).toHaveScreenshot('ve-established-csv-help-teaching-full.png', { fullPage: true });
    });

    test('weak effort in PC-CSV — sub-threshold failure morphology (SME-021)', async ({ page }) => {
        test.setTimeout(90_000);
        await h.open(page);
        await h.setMode(page, 'PC-CSV');
        await h.enableEffort(page, { patientRR: 20, pmus: 0.5 });
        await h.setRange(page, '#flow-trigger', 5);
        await h.teachingMode(page);
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.mode).toBe('PC-CSV');
        expect(s.teachingMode).toBe(true);
        expect(s.failedTriggers, 'weak effort must remain sub-threshold').toBeGreaterThan(0);
        await expectFailedTriggerCopy(page);

        await expect(page.locator('.waveforms')).toHaveScreenshot('weak-csv.png');
        expect(s.completed).toBeNull();
        await expect(page.locator('#param-vt')).toHaveText('—');
        await expect(page.locator('#param-pip')).toHaveText('—');
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.evaluate(() => window.__vsim.redraw());
        await expect(page.locator('.parameters')).toHaveScreenshot('csv-failed-teaching-column.png');
        await pcDisclosureSnapshots(page);
    });

    test('monitored-value panel does not clip at any type size', async ({ page }) => {
        // This is the regression that shipped unnoticed from PR #11 until a
        // screenshot caught it: SET and PATIENT lost digits inside the 208 px
        // column. Effort ON is what makes the values long enough to clip.
        await h.open(page);
        await h.enableEffort(page, { patientRR: 30, pmus: 6 });
        await h.teachingMode(page);
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.teachingMode).toBe(true);
        expect(s.failedTriggers, 'long readouts require the effort scenario').toBeGreaterThan(0);
        await expect(page.locator('.parameters')).toBeVisible();

        await expect(page.locator('.parameters')).toHaveScreenshot('params-teaching-effort.png');
        // Capture the COMPLETE scrollable monitor at both existing type sizes
        // (standard 17/26 px, Teaching 20/28 px), without shrinking any text.
        await page.setViewportSize({ width: 1440, height: 1100 });
        for (const teaching of [true, false]) {
            if (!teaching) await page.click('#btn-teaching-mode');
            await page.evaluate(() => window.__vsim.redraw());
            const clipped = await page.locator('.parameters').evaluate(panel => {
                const p = panel.getBoundingClientRect();
                return [...panel.querySelectorAll('*')].filter(el => {
                    if (!el.getClientRects().length) return false;
                    const b = el.getBoundingClientRect();
                    return el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1
                        || b.left < p.left || b.right > p.right;
                }).map(el => el.textContent.trim());
            });
            expect(clipped, 'complete visible provenance fits both supported type sizes').toEqual([]);
            await expect(page.locator('.parameters')).toHaveScreenshot(
                teaching ? 'complete-teaching-column.png' : 'complete-standard-column.png');
        }
    });
});

test.describe('determinism', () => {

    test('the same seek renders the identical frame twice', async ({ page }) => {
        // If this fails, every other baseline in this file is untrustworthy.
        await h.open(page);
        await h.expandRail(page);

        await h.seek(page, SEEK_SECONDS);
        const first = await page.locator('.waveforms').screenshot();
        const firstState = await h.state(page);

        await h.seek(page, SEEK_SECONDS);
        const second = await page.locator('.waveforms').screenshot();
        const secondState = await h.state(page);

        expect(secondState.completed.simulationGeneration)
            .toBe(firstState.completed.simulationGeneration + 1);
        // All newly exposed VE identities must belong to the current reset,
        // while every other sampled value remains deterministic.
        const normalizeGeneration = (value, generation) => {
            if (Array.isArray(value)) return value.map(v => normalizeGeneration(v, generation));
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, v]) => {
                if (key === 'simulationGeneration') {
                    expect(v).toBe(generation);
                    return [];
                }
                return [[key, normalizeGeneration(v, generation)]];
            }));
            return value;
        };
        const comparableFirst = normalizeGeneration(firstState, firstState.completed.simulationGeneration);
        const comparableSecond = normalizeGeneration(secondState, secondState.completed.simulationGeneration);
        expect(comparableSecond).toEqual(comparableFirst);
        expect(Buffer.compare(first, second), 'frames must be byte-identical').toBe(0);
    });

    test('seek is a pure function of the seconds requested', async ({ page }) => {
        await h.open(page);
        const a = await h.seek(page, 10);
        expect(a.ticks).toBe(1000);
        expect(a.globalTime).toBeCloseTo(10, 6);
    });
});

test.describe('cache-busting invariant', () => {

    test('every local js/css request carries the same ?v=', async ({ page }) => {
        // CLAUDE.md §4.7. Asserted from the NETWORK rather than by reading
        // source: a missing ?v= on a transitive import is invisible in
        // index.html but shows up here as a duplicate fetch. That is exactly
        // how js/ventilator.js's un-versioned lung-model.js import surfaced.
        const requested = h.trackLocalRequests(page);
        await h.open(page);

        const unversioned = requested.filter((u) => !u.includes('?v='));
        expect(unversioned, 'every local asset must carry ?v=').toEqual([]);

        const versions = [...new Set(requested.map((u) => u.split('?v=')[1]))];
        expect(versions, 'all local assets must share one version').toHaveLength(1);
        expect(versions, 'VSM-CLIN-009 asset release').toEqual(['17']);

        const paths = requested.map((u) => u.split('?')[0]);
        expect(paths, 'no module fetched twice').toHaveLength(new Set(paths).size);
    });
});
