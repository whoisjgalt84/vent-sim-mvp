// @ts-check
import { test, expect } from '@playwright/test';
import * as h from './helpers.js';

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

test.describe('waveform display', () => {

    test('baseline — VC-CMV, passive patient', async ({ page }) => {
        const errors = await h.open(page);
        await h.expandRail(page);
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.mode).toBe('vc-cmv');
        expect(s.teachingMode).toBe(false);
        expect(s.machineBreaths).toBeGreaterThan(0);
        expect(s.patientBreaths).toBe(0);

        await expect(page.locator('.waveforms')).toHaveScreenshot('baseline.png');
        // Same commissioned test, additional approved-scope state/screenshot.
        await h.setMode(page, 'PC-CSV');
        await h.setRange(page, '#resistance', 40);
        await h.setRange(page, '#compliance', 80);
        await h.seek(page, 15);
        expect((await h.state(page)).completed).toBeNull();
        await expect(page.locator('#param-pip')).toHaveText('—');
        await expect(page.locator('#param-vt')).toHaveText('—');
        await expect(page.locator('#param-ve')).toHaveText('0');
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
        expect(errors, 'no console errors').toEqual([]);
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
        await h.setMode(page, 'PC-CSV');
        await h.teachingMode(page);
        await h.seek(page, 15);
        expect((await h.state(page)).completed).toBeNull();
        await expect(page.locator('#param-ve')).toHaveText('0');
        await expect(page).toHaveScreenshot('csv-no-breath-teaching-full.png', { fullPage: true });
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
    });

    test('effort + teaching — the ineffective counter and amber highlight', async ({ page }) => {
        await h.open(page);
        await h.enableEffort(page, { patientRR: 30, pmus: 6 });
        await h.teachingMode(page);          // rail work first — rail is hidden after this
        await h.seek(page, SEEK_SECONDS);

        const s = await h.state(page);
        expect(s.teachingMode).toBe(true);
        expect(s.failedTriggers, 'scenario must actually fail triggers').toBeGreaterThan(0);

        await expect(page).toHaveScreenshot('effort-teaching-full.png', { fullPage: true });
        await page.click('#btn-teaching-mode');
        await h.setMode(page, 'PC-CSV');
        await h.teachingMode(page);
        await h.seek(page, 25);
        const delivered = await h.state(page);
        expect(delivered.completed).not.toBeNull();
        expect(delivered.measuredRR).toBeGreaterThan(0);
        await expect(page.getByRole('group', { name: 'Delivered VE', exact: true })).toBeVisible();
        await expect(page).toHaveScreenshot('csv-delivered-teaching-full.png', { fullPage: true });
    });

    test('weak effort in PC-CSV — sub-threshold failure morphology (SME-021)', async ({ page }) => {
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

        await expect(page.locator('.waveforms')).toHaveScreenshot('weak-csv.png');
        expect(s.completed).toBeNull();
        await expect(page.locator('#param-vt')).toHaveText('—');
        await expect(page.locator('#param-pip')).toHaveText('—');
        await page.setViewportSize({ width: 1440, height: 1100 });
        await page.evaluate(() => window.__vsim.redraw());
        await expect(page.locator('.parameters')).toHaveScreenshot('csv-failed-teaching-column.png');
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

        expect(secondState).toEqual(firstState);
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

        const paths = requested.map((u) => u.split('?')[0]);
        expect(paths, 'no module fetched twice').toHaveLength(new Set(paths).size);
    });
});
