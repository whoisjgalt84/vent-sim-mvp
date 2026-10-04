// @ts-check
import { test, expect as baseExpect } from '@playwright/test';
import * as h from './helpers.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Optional evidence capture preserves the original matcher and its tolerances.
// Export each real repeated frame so byte/pixel differences can be accounted for.
const expect = process.env.VISUAL_REPEAT_CAPTURE ? baseExpect.extend({
    async toHaveScreenshot(receiver, name, options = {}) {
        await baseExpect(receiver).toHaveScreenshot(name, options);
        const directory = process.env.VISUAL_REPEAT_CAPTURE;
        fs.mkdirSync(directory, { recursive: true });
        await receiver.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css',
            ...options, path: path.join(directory, path.basename(test.info().snapshotPath(name))) });
        return { pass: true, message: () => 'Original screenshot comparison passed.' };
    },
}) : baseExpect;

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
    const common = "Paw is modeled at the airway opening on the patient side of the delivery valve. The pressure target is upstream of that valve; it is not a guarantee that patient-side pressure remains at the target when the valve is closed. Reverse flow is not allowed during delivered inspiration in this model.\n\nDuring expiration, inward patient demand draws flow through a finite supply resistance and can lower Paw below applied PEEP. Passive outflow uses an ideal PEEP boundary. This simplified boundary has no circuit compliance, bias flow, leak, or pressure-response delay. Its supply resistance is an educational assumption.\n\nReal ventilators can show additional pressure deformation. Read flow and volume alongside pressure. This model does not reproduce a particular commercial ventilator, measure work of breathing, or model a patient's response to changing assistance.";
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
        const cue = page.getByRole('button', { name: 'Idealized pressure delivery help', exact: true });
        await expect(cue).toBeVisible();
        await expect(cue.locator('span').first()).toHaveText('Idealized pressure delivery');
        const name = `pc-disclosure-${mode}-${active ? 'active' : 'passive'}-${teaching ? 'teaching' : 'standard'}`;
        await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
        if (!active) {
            await cue.click();
            const opening = mode === 'PC-CSV'
                ? 'In PC-CSV, a successful patient trigger starts a supported breath with an ideal inspiratory pressure target at PEEP plus Pressure Support. While inward flow is being delivered, airway pressure is held at that target. If the delivery valve closes because inward flow would reverse, flow is zero and airway pressure follows lung recoil and prescribed muscle pressure. The existing flow or maximum-time cycling rule still ends inspiration.'
                : 'In PC-CMV, this model sets an ideal inspiratory pressure target at PEEP plus the set inspiratory pressure. While inward flow is being delivered, airway pressure is held at that target. If the delivery valve closes because inward flow would reverse, flow is zero and airway pressure follows lung recoil and prescribed muscle pressure until the valve can reopen or inspiration ends.';
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
        await expect(page.locator('#measurement-help')).toContainText('Predicted VE: unavailable.');
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
        // Reset and its first settings synchronization each advance this audit
        // revision. Preserve relative historical revisions while comparing every
        // physical value and the actual pixels without tolerance.
        expect(secondState.physicsSample.inputRevision)
            .toBe(firstState.physicsSample.inputRevision + 2);
        const normalizeGeneration = (value, generation, inputRevision) => {
            if (Array.isArray(value)) return value.map(v => normalizeGeneration(v, generation, inputRevision));
            if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, v]) => {
                if (key === 'simulationGeneration') {
                    expect(v).toBe(generation);
                    return [];
                }
                if (key === 'inputRevision') {
                    expect(Number.isInteger(v)).toBe(true);
                    return [[key, v - inputRevision]];
                }
                return [[key, normalizeGeneration(v, generation, inputRevision)]];
            }));
            return value;
        };
        const comparableFirst = normalizeGeneration(firstState, firstState.completed.simulationGeneration, firstState.physicsSample.inputRevision);
        const comparableSecond = normalizeGeneration(secondState, secondState.completed.simulationGeneration, secondState.physicsSample.inputRevision);
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
        expect(versions, 'VSM effort/pressure asset release').toEqual(['20']);

        const paths = requested.map((u) => u.split('?')[0]);
        expect(paths, 'no module fetched twice').toHaveLength(new Set(paths).size);
    });
});

// VSM-ADAPT-001: new mode only. These 22 full-page candidates are separate from
// the 74 accepted legacy PNGs. Snapshot generation requires the existing pinned
// Linux candidate workflow and owner acceptance; the checks below never accept it.
async function openAdaptive(page, options = {}) {
    const errors = await h.open(page);
    await page.evaluate(value => window.__vsim.setupAdaptive(value), options);
    await h.expandRail(page);
    expect((await h.state(page)).mode).toBe('pc-cmva');
    expect((await h.state(page)).completed).toBeNull();
    return errors;
}
async function adaptiveCompletions(page, count) {
    return page.evaluate(value => window.__vsim.stepToCompleted(value), count);
}
async function adaptiveNextStart(page) {
    return page.evaluate(() => {
        const api = window.__vsim, previous = api.state().breathCount;
        for (let tick = 0; tick < 2000; tick++) {
            const state = api.stepTicks(1);
            if (state.breathCount > previous) return state;
        }
        throw new Error('Adaptive fixture did not reach a next breath');
    });
}
async function adaptiveShot(page, name) {
    await page.evaluate(() => window.__vsim.redraw());
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const output = process.env.ADAPTIVE_VISUAL_EVIDENCE
        || path.join(root, 'scratch/shots-vsm-effort-pressure-phase-b-r1/adaptive-visual-scenarios.json');
    const sources = ['index.html', 'css/style.css', 'js/main.js', 'js/simulation.js', 'js/ventilator.js',
        'js/adaptive-controller.js', 'js/lung-model.js', 'js/waveforms.js', 'alarms.js', 'alarm-audio.js',
        'tests/visual/waveforms.spec.js', 'tests/visual/helpers.js', 'playwright.config.js'];
    const sourceSha256 = Object.fromEntries(sources.map(file => [file,
        crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
    const recipes = {
        'adaptive-startup-standard.png': 'Default setupAdaptive: R10/C.05, RR12,I:E1:4,target500,PEEP5,effort0,initial10,bounds5-25; zero ticks; Standard; all rail groups expanded.',
        'adaptive-startup-teaching.png': 'Same startup fixture; toggle Teaching; no ticks.',
        'adaptive-settled-standard.png': 'Default fixture; 10 new canonical publications; Standard.',
        'adaptive-settled-teaching.png': 'Same 10-publication fixture; toggle Teaching; no ticks.',
        'adaptive-pending-target-peep-standard.png': 'Default fixture after10publications; advance to next breath start and30ticks; actual VT input650 then PEEP input9; Standard; retain old source target500 and appliedPEEP5.',
        'adaptive-pending-target-peep-teaching.png': 'Same mid-inspiration queued target650/PEEP9 fixture; toggle Teaching; no ticks.',
        'adaptive-mixed-feedback-teaching.png': 'Same queued fixture; advance1new publication; old-context inspiration rejected for adaptation but actual volume retained.',
        'adaptive-paused-context-teaching.png': 'Same rejected publication; click actual Pause; retain mixed-feedback status and show secondary paused text.',
        'adaptive-mechanics-first-change-teaching.png': 'Default fixture;10publications; actual compliance input25mL/cmH2O;1new publication; Teaching.',
        'adaptive-mechanics-settled-teaching.png': 'Same compliance-step fixture;15further publications (16after change,26total); Teaching.',
        'adaptive-effort-first-change-teaching.png': 'Default fixture with prescribed patientRR12 but amplitude0;10publications; actual Pmus input8;1new publication; Teaching.',
        'adaptive-effort-settled-teaching.png': 'Same effort-step fixture;15further publications (16after change,26total); Teaching.',
        'adaptive-next-maximum-standard.png': 'Setup C.015 and maximum20;5publications; applied18,pending20; Standard.',
        'adaptive-upper-bound-teaching.png': 'Same upper-bound fixture;10further publications (15total); applied20; Teaching.',
        'adaptive-bound-release-teaching.png': 'Same upper-bound fixture after15publications; Standard actual compliance input50;1new publication; Teaching; source pressure20,next18.',
        'adaptive-lower-bound-teaching.png': 'Fresh setup C.1,prescribed effort12,patientRR12;18publications; applied minimum5 with excess inspiredVT; Teaching.',
        'adaptive-pending-transition-help-standard.png': 'Default fixture;10publications; actual Pause; VT650 and PEEP9 inputs; focus pending target help; Standard.',
        'adaptive-reset-retained-standard.png': 'Dismiss pending help; actual Reset demonstration; retain target650/PEEP9 and paused transport; achievedVT unavailable; Standard.',
        'adaptive-achieved-help-teaching.png': 'Same retained-reset fixture;2new publications; Teaching; focus Achieved VT help.',
        'adaptive-destination-vc-retained-standard.png': 'Same fixture; dismiss help and select Standard; queue VT640/PEEP12; actual VC-CMV mode button; preserve manual pressure settings and pause.',
        'adaptive-reentry-startup-teaching.png': 'Same VC destination fixture; actual PC-CMVa button then Teaching; target640/PEEP12 retained,initialpressure10,no eligible feedback.',
        'adaptive-prescribed-effort-help-teaching.png': 'Same adaptive reentry fixture; focus Prescribed effort help; Teaching.',
    };
    expect(recipes[name], 'Every candidate requires an exact replay recipe').toBeTruthy();
    const manifest = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { schemaVersion: 1, candidates: {} };
    manifest.candidates[name] = { name, snapshotPath: test.info().snapshotPath(name),
        testTitle: test.info().title, recipe: recipes[name], viewport: page.viewportSize(),
        platform: process.platform, sourceSha256, state: await h.state(page) };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
    await expect(page).toHaveScreenshot(name, { fullPage: true });
}

test.describe('PC-CMVa adaptive visual contract', () => {
    test('adaptive startup, settled measurements, pending context and pause', async ({ page }) => {
        const errors = await openAdaptive(page);
        await expect(page.locator('#adaptive-achieved')).toHaveText('—');
        await expect(page.locator('#adaptive-pressure')).toHaveText('10');
        await expect(page.locator('#adaptive-status')).toHaveText('Awaiting completed inspiration');
        await adaptiveShot(page, 'adaptive-startup-standard.png');
        await h.teachingMode(page);
        await adaptiveShot(page, 'adaptive-startup-teaching.png');
        await h.teachingMode(page);
        let state = await adaptiveCompletions(page, 10);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(492);
        expect(state.completed.measuredVT_mL).toBeLessThan(494);
        await expect(page.locator('#adaptive-status')).toHaveText('Within target band');
        await adaptiveShot(page, 'adaptive-settled-standard.png');
        await h.teachingMode(page);
        await adaptiveShot(page, 'adaptive-settled-teaching.png');
        await h.teachingMode(page);
        await adaptiveNextStart(page);
        await page.evaluate(() => window.__vsim.stepTicks(30));
        await h.setRange(page, '#vt', 650); await h.setRange(page, '#peep', 9);
        state = await h.state(page);
        expect(state.operatorSettings.targetVT_mL).toBe(500);
        expect(state.operatorSettings.peep_cmH2O).toBe(5);
        expect(state.adaptiveState.requested).toEqual({ targetVT_mL: 650, peep_cmH2O: 9 });
        await expect(page.locator('#adaptive-source-target')).toHaveText('Source target: 500 mL');
        await expect(page.locator('#adaptive-status')).toHaveText('Awaiting feedback for new settings');
        await adaptiveShot(page, 'adaptive-pending-target-peep-standard.png');
        await h.teachingMode(page);
        await adaptiveShot(page, 'adaptive-pending-target-peep-teaching.png');
        state = await adaptiveCompletions(page, 1);
        expect(state.adaptiveState.latestDecision.eligible).toBe(false);
        expect(state.completed.adaptive.targetVT_mL).toBe(500);
        await expect(page.locator('#adaptive-status')).toHaveText('Feedback unavailable — inputs changed');
        await adaptiveShot(page, 'adaptive-mixed-feedback-teaching.png');
        await page.locator('#btn-pause').click();
        expect((await h.state(page)).running).toBe(false);
        await expect(page.locator('#adaptive-paused')).toBeVisible();
        await adaptiveShot(page, 'adaptive-paused-context-teaching.png');
        expect(errors).toEqual([]);
    });

    test('adaptive compliance and prescribed-effort demonstrations', async ({ page }) => {
        let errors = await openAdaptive(page);
        const beforeMechanics = await adaptiveCompletions(page, 10);
        await h.setRange(page, '#compliance', 25);
        let state = await adaptiveCompletions(page, 1);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(278);
        expect(state.completed.measuredVT_mL).toBeLessThan(281);
        expect(state.adaptiveState.applied_cmH2O).toBe(beforeMechanics.adaptiveState.applied_cmH2O);
        expect(state.adaptiveState.pending.pressure_cmH2O).toBe(state.adaptiveState.applied_cmH2O + 2);
        await h.teachingMode(page);
        await adaptiveShot(page, 'adaptive-mechanics-first-change-teaching.png');
        state = await adaptiveCompletions(page, 15);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(491);
        expect(state.completed.measuredVT_mL).toBeLessThan(494);
        expect(state.adaptiveState.applied_cmH2O).toBeGreaterThan(20);
        await adaptiveShot(page, 'adaptive-mechanics-settled-teaching.png');
        expect(errors).toEqual([]);

        errors = await openAdaptive(page, { patientRR: 12 });
        const beforeEffort = await adaptiveCompletions(page, 10);
        await h.setRange(page, '#pmus-max', 8);
        state = await adaptiveCompletions(page, 1);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(708);
        expect(state.completed.measuredVT_mL).toBeLessThan(711);
        expect(state.completed.triggerAgent).toBe('patient');
        expect(state.completed.breathType).toBe('mandatory');
        expect(state.adaptiveState.applied_cmH2O).toBe(beforeEffort.adaptiveState.applied_cmH2O);
        expect(state.adaptiveState.pending.pressure_cmH2O).toBe(state.adaptiveState.applied_cmH2O - 2);
        await h.teachingMode(page);
        await adaptiveShot(page, 'adaptive-effort-first-change-teaching.png');
        state = await adaptiveCompletions(page, 15);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(508);
        expect(state.completed.measuredVT_mL).toBeLessThan(511);
        expect(state.adaptiveState.applied_cmH2O).toBeGreaterThan(6.45);
        expect(state.adaptiveState.applied_cmH2O).toBeLessThan(6.49);
        await expect(page.locator('#adaptive-effort')).toContainText('Prescribed effort · Pmus max 8');
        await adaptiveShot(page, 'adaptive-effort-settled-teaching.png');
        expect(errors).toEqual([]);
    });

    test('adaptive pending maximum, both active bounds and saturation release', async ({ page }) => {
        let errors = await openAdaptive(page, { compliance: 0.015, maximumPressure_cmH2O: 20 });
        let state = await adaptiveCompletions(page, 5);
        expect(state.adaptiveState.applied_cmH2O).toBe(18);
        expect(state.adaptiveState.pending.pressure_cmH2O).toBe(20);
        await expect(page.locator('#adaptive-bound')).toHaveText('');
        await expect(page.locator('#adaptive-next-bound')).toHaveText('Next pressure: maximum');
        await expect(page.locator('#adaptive-status')).toHaveText('Adjusting next breath');
        await adaptiveShot(page, 'adaptive-next-maximum-standard.png');
        state = await adaptiveCompletions(page, 10);
        expect(state.adaptiveState.applied_cmH2O).toBe(20);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(299);
        expect(state.completed.measuredVT_mL).toBeLessThan(301);
        await h.teachingMode(page);
        await expect(page.locator('#adaptive-status')).toHaveText('Maximum pressure — VT below target');
        await adaptiveShot(page, 'adaptive-upper-bound-teaching.png');
        await h.teachingMode(page);
        await h.setRange(page, '#compliance', 50);
        state = await adaptiveCompletions(page, 1);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(866);
        expect(state.completed.measuredVT_mL).toBeLessThan(869);
        expect(state.adaptiveState.pending.pressure_cmH2O).toBe(18);
        await h.teachingMode(page);
        await expect(page.locator('#adaptive-status')).toHaveText('Adjusting next breath');
        await adaptiveShot(page, 'adaptive-bound-release-teaching.png');
        expect(errors).toEqual([]);

        errors = await openAdaptive(page, { compliance: 0.1, pMusMax: 12, patientRR: 12 });
        state = await adaptiveCompletions(page, 18);
        expect(state.adaptiveState.applied_cmH2O).toBe(5);
        expect(state.completed.measuredVT_mL).toBeGreaterThan(788);
        expect(state.completed.measuredVT_mL).toBeLessThan(792);
        await h.teachingMode(page);
        await expect(page.locator('#adaptive-status')).toHaveText('Minimum pressure — VT above target');
        await adaptiveShot(page, 'adaptive-lower-bound-teaching.png');
        expect(errors).toEqual([]);
    });

    test('adaptive transition help, retained settings and contextual help', async ({ page }) => {
        const errors = await openAdaptive(page);
        await adaptiveCompletions(page, 10);
        await page.locator('#btn-pause').click();
        await h.setRange(page, '#vt', 650); await h.setRange(page, '#peep', 9);
        await page.locator('#adaptive-requested-target-help').focus();
        await expect(page.locator('#measurement-help-text')).toHaveText('Your new VT target takes effect at the start of the next breath. The simulator will not use the breath affected by this change to calculate the next pressure adjustment.\n\nResetting or changing modes keeps your latest selected settings. After a mode change, only the settings used by that mode affect breath delivery.');
        await adaptiveShot(page, 'adaptive-pending-transition-help-standard.png');
        await page.keyboard.press('Escape');
        await page.locator('#adaptive-reset').click();
        let state = await h.state(page);
        expect(state.operatorSettings.targetVT_mL).toBe(650);
        expect(state.operatorSettings.peep_cmH2O).toBe(9);
        expect(state.running).toBe(false);
        expect(state.completed).toBeNull();
        expect(state.adaptiveState.pendingSettings).toBeNull();
        await adaptiveShot(page, 'adaptive-reset-retained-standard.png');
        await adaptiveCompletions(page, 2);
        await h.teachingMode(page);
        await page.locator('#adaptive-panel [data-measurement-help="adaptive-achieved"]').focus();
        await expect(page.locator('#measurement-help-text')).toContainText('it is not a separate exhaled-volume measurement.');
        await adaptiveShot(page, 'adaptive-achieved-help-teaching.png');
        await page.keyboard.press('Escape');
        await h.teachingMode(page);
        await h.setRange(page, '#vt', 640); await h.setRange(page, '#peep', 12);
        const manual = (await h.state(page)).operatorSettings;
        await h.setMode(page, 'vc-cmv'); state = await h.state(page);
        expect(state.operatorSettings.targetVT_mL).toBe(640); expect(state.operatorSettings.peep_cmH2O).toBe(12);
        expect(state.operatorSettings.inspiratoryPressure_cmH2O).toBe(manual.inspiratoryPressure_cmH2O);
        expect(state.adaptiveState).toBeNull(); expect(state.running).toBe(false);
        await expect(page.locator('#adaptive-panel')).toBeHidden();
        await adaptiveShot(page, 'adaptive-destination-vc-retained-standard.png');
        await h.setMode(page, 'pc-cmva'); state = await h.state(page);
        expect(state.adaptiveState.applied_cmH2O).toBe(10); expect(state.adaptiveState.appliedPeep_cmH2O).toBe(12);
        expect(state.adaptiveState.pendingSettings).toBeNull(); expect(state.completed).toBeNull();
        await h.teachingMode(page);
        await adaptiveShot(page, 'adaptive-reentry-startup-teaching.png');
        await page.locator('#adaptive-panel [data-measurement-help="adaptive-effort"]').focus();
        await expect(page.locator('#measurement-help-text')).toContainText('Effort does not respond physiologically to changing assistance.');
        await expect(page.locator('#measurement-help-text')).toContainText('This amplitude is not measured work of breathing.');
        await adaptiveShot(page, 'adaptive-prescribed-effort-help-teaching.png');
        expect(errors).toEqual([]);
    });
});

// Phase B additions are separately commissioned: no accepted PNG replacement.
async function effortShot(page, name, recipe, screenshotOptions = {}) {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const output = process.env.EFFORT_VISUAL_EVIDENCE
        || path.join(root, 'scratch/shots-vsm-effort-pressure-phase-b-r1/visual-scenarios.json');
    const manifest = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { schemaVersion: 1, candidates: {} };
    const sources = ['index.html', 'js/main.js', 'js/simulation.js', 'js/ventilator.js', 'js/waveforms.js',
        'tests/visual/waveforms.spec.js', 'tests/visual/helpers.js'];
    manifest.candidates[name] = { name, recipe, snapshotPath: test.info().snapshotPath(name),
        testTitle: test.info().title, viewport: page.viewportSize(),
        deviceScaleFactor: await page.evaluate(() => window.devicePixelRatio), platform: process.platform,
        sourceSha256: Object.fromEntries(sources.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')])),
        state: await h.state(page) };
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(manifest, null, 2) + '\n');
    await expect(page).toHaveScreenshot(name, { fullPage: true, ...screenshotOptions });
}

test.describe('effort pressure finite-boundary visual contract', () => {
    test('signed pressure and P-V geometry retain mixed trigger-variable history', async ({ page }) => {
        const errors = await h.open(page); await h.expandRail(page);
        const signed = { mode:'vc-cmv',resistance:5,compliance:.1,respiratoryRate:6,ieRatio:[1,4],
            peep_cmH2O:0,pMusMax:12,patientRR:12,neuralTi:1,triggerType:'flow' };
        await h.setupEffort(page,signed); let state = await h.stepTicks(page,1400);
        expect(state.renderers.pressure.geometry.yMin).toBeLessThan(0);
        expect(state.pvGeometry.xRange.lo).toBeLessThan(0);
        expect(state.renderers.volume.markers.filter(e=>e.type==='patient')).toEqual([]);
        await effortShot(page,'effort-signed-vc-pv.png','VC R5/C100,RR6,I:E1:4,PEEP0,Pmus12,patientRR12,neuralTi1,flow2; configure before reset,1400 exact ticks; Standard; no injected dip.');
        await page.locator('[data-measurement-help="waveform-legend"]').click();
        await expect(page.locator('#measurement-help')).toContainText('The dashed zero line is atmospheric pressure, not PEEP.');
        await expect(page.locator('#measurement-help')).toContainText('the symbol does not replace the signal');
        await effortShot(page,'effort-signed-legend-help.png','Same signed VC snapshot; open static waveform legend help; no ticks.');
        await page.keyboard.press('Escape');

        await h.setupEffort(page,{...signed,mode:'PC-CSV',compliance:.06,peep_cmH2O:5,triggerType:'pressure',pressureTriggerCmH2O:1,psPressure:10});
        state = await h.stepTicks(page,600);
        const recorded = state.triggerEvents.filter(e=>e.type==='patient');
        expect(recorded.length).toBeGreaterThan(0); expect(recorded.every(e=>e.detection.triggerVariable==='pressure')).toBe(true);
        const before = JSON.stringify(recorded);
        await page.locator('[data-trigger-type="flow"]').click(); await h.stepTicks(page,800); state=await h.state(page);
        expect(JSON.stringify(state.triggerEvents.filter(e=>e.type==='patient'&&e.time<=6))).toBe(before);
        expect(state.triggerEvents.some(e=>e.type==='patient'&&e.detection.triggerVariable==='flow')).toBe(true);
        expect(state.renderers.pressure.markers.some(e=>e.type==='patient'&&e.variable==='pressure')).toBe(true);
        expect(state.renderers.flow.markers.some(e=>e.type==='patient'&&e.variable==='flow')).toBe(true);
        expect(state.renderers.volume.markers.filter(e=>e.type==='patient')).toEqual([]);
        const frozenTime=state.globalTime; await page.locator('[data-trigger-type="pressure"]').click();
        expect((await h.state(page)).globalTime).toBe(frozenTime);
        await effortShot(page,'effort-mixed-trigger-history.png','CSV R5/C60,PEEP5,PS10,Pmus12,patientRR12,neuralTi1,RR6,I:E1:4; pressure1 for600ticks, actual UI flow switch then800ticks, paused UI pressure switch; mixed event history remains mapped by recorded variable.');

        await h.setupEffort(page,{...signed,mode:'pc-cmva',peep_cmH2O:5,triggerType:'pressure',pressureTriggerCmH2O:1});
        await h.stepTicks(page,480); await h.setRange(page,'#peep',9); state=await h.stepTicks(page,120);
        const queuedDelivery=state.triggerEvents.find(e=>e.type==='patient'&&e.detection.signal.appliedPeep_cmH2O!==e.delivery.appliedPeep_cmH2O);
        expect(queuedDelivery).toBeTruthy(); expect(queuedDelivery.detection.signal.appliedPeep_cmH2O).toBe(5); expect(queuedDelivery.delivery.appliedPeep_cmH2O).toBe(9);
        await effortShot(page,'effort-queued-peep-history.png','Adaptive R5/C100,RR6,I:E1:4,target500,bounds5-25,PEEP5,Pmus12,patientRR12,neuralTi1,pressure1;480ticks,actual PEEP request9,120ticks; detect at applied5,delivery at9.');
        expect(errors).toEqual([]);
    });

    test('closed patient-side PC pressure and active analytical unavailability', async ({ page }) => {
        const errors=await h.open(page); await h.expandRail(page);
        for(const mode of ['vc-cmv','pc-cmv','PC-CSV','pc-cmva']) {
            await h.setupEffort(page,{mode,resistance:5,compliance:.06,peep_cmH2O:5,pMusMax:12,patientRR:12,neuralTi:1,respiratoryRate:6,ieRatio:[1,4],triggerType:'pressure',pressureTriggerCmH2O:1});
            const state=await h.stepTicks(page,1400);
            expect(state.predicted.predictionsAvailable).toBe(false);
            expect(state.predicted.predictionReason).toBe('ACTIVE_EFFORT_BOUNDARY');
            expect(state.predicted.pressures.map_cmH2O).toBeNull();
            await expect(page.locator('#param-map')).toHaveText('—');
            expect(state.completed).not.toBeNull();
            await effortShot(page,`effort-active-${mode}.png`,`${mode} R5/C60,PEEP5,Pmus12,patientRR12,neuralTi1,RR6,I:E1:4,pressure1;1400ticks; Standard, active analytical predictions unavailable, measured source retained.`);
        }
        await h.setupEffort(page,{mode:'pc-cmv',resistance:5,compliance:.06,peep_cmH2O:24,pMusMax:12,patientRR:12,neuralTi:1,respiratoryRate:14,ieRatio:[1,2],inspiratoryPressure:15});
        const closed=await h.stepTicks(page,1581);
        expect(closed.physicsSample.valveState).toBe('delivery-closed'); expect(closed.physicsSample.netFlow_Lps).toBe(0);
        expect(closed.physicsSample.paw_cmH2O).toBeGreaterThan(40);
        expect(closed.physicsSample.appliedPeep_cmH2O+closed.physicsSample.pressureCommand_cmH2O).toBe(39);
        expect(closed.activeAlarms.some(a=>a.id==='HIGH_PRESSURE')).toBe(true);
        await effortShot(page,'effort-closed-valve-high-pressure.png','PC-CMV R5/C60,PEEP24,Pinsp15,RR14,I:E1:2,Pmus12,patientRR12,neuralTi1,flow2;1581ticks; natural delivery valve closure Paw>40 while upstream command39; unchanged alarm threshold.');
        await page.locator('#active-predictions-help').click();
        await expect(page.locator('#measurement-help')).toHaveText('This prediction is unavailable when patient effort is enabled. Its calculation does not account for all effects of patient effort on airway pressure and flow.\n\nUse the live waveforms and measured values to assess the simulated breath.');
        await effortShot(page,'effort-active-predictions-help.png','Same natural PC closure snapshot; open existing static active-predictions help; no ticks.');
        expect(errors).toEqual([]);
    });

    test('signed geometry and frozen history survive narrow high-DPI views', async ({ browser }) => {
        const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,baseURL:'http://127.0.0.1:8899'});
        const page=await context.newPage();
        try {
            const errors=await h.open(page);
            await h.setupEffort(page,{mode:'vc-cmv',resistance:5,compliance:.1,respiratoryRate:6,ieRatio:[1,4],peep_cmH2O:0,pMusMax:12,patientRR:12,neuralTi:1});
            await h.stepTicks(page,1400); await h.teachingMode(page);
            const state=await h.state(page); expect(state.renderers.pressure.geometry.yMin).toBeLessThan(0);
            expect(await page.locator('#canvas-pressure').evaluate(c=>c.width===Math.round(c.getBoundingClientRect().width*window.devicePixelRatio))).toBe(true);
            await effortShot(page,'effort-signed-highdpi-390.png','Signed VC recipe at1400ticks; Teaching390x844/deviceScaleFactor2; device-resolution PNG, frozen render.',{scale:'device'});
            await page.setViewportSize({width:320,height:844}); await page.evaluate(()=>window.__vsim.redraw());
            const resized=await h.state(page); expect(resized.globalTime).toBe(state.globalTime);
            expect(resized.triggerEvents).toEqual(state.triggerEvents);
            expect(resized.renderers.pressure.geometry.yMin).toBe(state.renderers.pressure.geometry.yMin);
            await effortShot(page,'effort-signed-highdpi-320.png','Same frozen Teaching signed VC sample/history; resize320x844/deviceScaleFactor2; device-resolution PNG, no ticks.',{scale:'device'});
            expect(errors).toEqual([]);
        } finally { await context.close(); }
    });
});
