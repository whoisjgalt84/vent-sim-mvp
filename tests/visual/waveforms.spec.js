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

        await expect(page.locator('.waveforms')).toHaveScreenshot('baseline.png');
        expect(errors, 'no console errors').toEqual([]);
    });

    test('teaching mode — passive', async ({ page }) => {
        await h.open(page);
        await h.teachingMode(page);
        await h.seek(page, SEEK_SECONDS);

        await expect(page).toHaveScreenshot('teaching-full.png', { fullPage: true });
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

        await expect(page).toHaveScreenshot('effort-teaching-full.png', { fullPage: true });
    });

    test('weak effort in PC-CSV — sub-threshold failure morphology (SME-021)', async ({ page }) => {
        await h.open(page);
        await h.setMode(page, 'PC-CSV');
        await h.enableEffort(page, { patientRR: 20, pmus: 2 });
        await h.teachingMode(page);
        await h.seek(page, SEEK_SECONDS);

        await expect(page.locator('.waveforms')).toHaveScreenshot('weak-csv.png');
    });

    test('monitored-value panel does not clip at any type size', async ({ page }) => {
        // This is the regression that shipped unnoticed from PR #11 until a
        // screenshot caught it: SET and PATIENT lost digits inside the 208 px
        // column. Effort ON is what makes the values long enough to clip.
        await h.open(page);
        await h.enableEffort(page, { patientRR: 30, pmus: 6 });
        await h.teachingMode(page);
        await h.seek(page, SEEK_SECONDS);

        await expect(page.locator('.parameters')).toHaveScreenshot('params-teaching-effort.png');
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
