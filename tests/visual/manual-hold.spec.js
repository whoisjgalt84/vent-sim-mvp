import { test, expect } from '@playwright/test';
import * as h from './helpers.js';
async function setup(page) { const errors = await h.open(page); await h.expandRail(page); await h.seek(page, 0); return errors; }
async function keyDown(page) { await page.locator('#hold-toggle').focus(); await page.keyboard.down('Space'); }
async function active(page) {
    await keyDown(page);
    await page.evaluate(() => { for(let i=0;i<300 && !window.__vsim.state().manualHold.active;i++) window.__vsim.step(0.01); });
    expect((await h.state(page)).manualHold.active).toBe(true);
}
test('manual hold arming, actual occlusion and capped completion', async ({page}) => {
    const errors=await setup(page);
    expect((await h.state(page)).lastValidManualHold).toBeNull();
    for(const id of ['hold-pplat','hold-dp','hold-crs','hold-raw']) await expect(page.locator('#'+id)).toHaveText('--');
    await expect(page).toHaveScreenshot('manual-ready-full.png',{fullPage:true});
    await keyDown(page); await expect(page.locator('#hold-display')).toHaveText('Armed');
    await expect(page.locator('#hold-toggle').locator('..').locator('..')).toHaveScreenshot('manual-armed-control.png');
    await page.evaluate(() => { for(let i=0;i<300 && !window.__vsim.state().manualHold.active;i++) window.__vsim.step(0.01); });
    await page.evaluate(()=>window.__vsim.step(0.6));
    await expect(page.locator('#hold-display')).toHaveText('Holding 0.60 s');
    await expect(page).toHaveScreenshot('manual-holding-full.png',{fullPage:true});
    await page.evaluate(()=>window.__vsim.step(2));
    expect((await h.state(page)).lastValidManualHold.mechanics.actualDuration_s).toBe(2);
    await expect(page.locator('#hold-display')).toContainText('Timing limit');
    await expect(page).toHaveScreenshot('manual-timing-limit-full.png',{fullPage:true});
    await page.keyboard.up('Space'); expect(errors).toEqual([]);
});
test('last valid history, invalid attempt and cross-mode source are distinct', async ({page}) => {
    const errors=await setup(page); await page.evaluate(()=>window.__vsim.manualHoldFixture(0.6));
    const saved=(await h.state(page)).lastValidManualHold;
    await expect(page.locator('#hold-status')).toHaveText('Last valid hold');
    await expect(page.locator('#hold-results')).toHaveScreenshot('manual-last-valid-panel.png');
    await expect(page).toHaveScreenshot('manual-last-valid-full.png',{fullPage:true});
    await page.evaluate(()=>window.__vsim.manualHoldFixture(0.2,false));
    expect((await h.state(page)).lastValidManualHold).toEqual(saved);
    await expect(page.locator('#hold-attempt')).toContainText('Newest hold invalid');
    await expect(page.locator('#hold-results')).toHaveScreenshot('manual-invalid-retained-panel.png');
    await h.setRange(page,'#peep',9); await h.setRange(page,'#compliance',80);
    await h.setMode(page,'pc-cmv'); await expect(page.locator('#hold-source')).toContainText('vc-cmv');
    await expect(page).toHaveScreenshot('manual-old-vc-in-pc-full.png',{fullPage:true});
    await h.setMode(page,'PC-CSV'); await expect(page.locator('#hold-toggle')).toBeDisabled();
    await expect(page).toHaveScreenshot('manual-old-vc-in-csv-full.png',{fullPage:true});
    await h.setMode(page,'pc-cmva'); await expect(page.locator('#hold-toggle')).toBeDisabled();
    await expect(page).toHaveScreenshot('manual-old-vc-in-adaptive-full.png',{fullPage:true});
    await page.click('#btn-teaching-mode');
    await expect(page.locator('#pplat-status')).toContainText('Last valid hold');
    await expect(page).toHaveScreenshot('manual-history-teaching-full.png',{fullPage:true});
    await page.click('#btn-reset'); expect((await h.state(page)).lastValidManualHold).toBeNull();
    await expect(page.locator('#param-pplat')).toHaveText('--');
    await page.click('#btn-teaching-mode');
    await h.setMode(page,'pc-cmv'); await page.evaluate(()=>window.__vsim.manualHoldFixture(0.6));
    await expect(page.locator('#hold-source')).toContainText('Pinsp set');
    await expect(page.locator('#hold-raw')).toHaveText('--');
    await expect(page.locator('#hold-results')).toHaveScreenshot('manual-pc-source-panel.png');
    await expect(page).toHaveScreenshot('manual-pc-source-full.png',{fullPage:true});
    expect(errors).toEqual([]);
});
test('recurring takeover, cancellation and timing-short invalid attempt', async ({page}) => {
    const errors=await setup(page); await h.setRange(page,'#hold-duration',15);
    await page.evaluate(()=>window.__vsim.step(1.8));
    expect((await h.state(page)).phase).toBe('HOLD'); expect((await h.state(page)).lastValidManualHold).toBeNull();
    const before=(await h.state(page)).globalTime; await keyDown(page);
    expect((await h.state(page)).manualHold.duration_s).toBeGreaterThan(0);
    await expect(page).toHaveScreenshot('manual-recurring-takeover-full.png',{fullPage:true});
    await page.evaluate(()=>window.__vsim.step(0.6)); await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    expect((await h.state(page)).lastValidManualHold).toBeNull();
    await expect(page.locator('#hold-attempt')).toContainText('Hold canceled');
    await expect(page.locator('#hold-results')).toHaveScreenshot('manual-canceled-panel.png');
    await page.keyboard.up('Space'); expect((await h.state(page)).globalTime).toBeGreaterThan(before);
    await page.evaluate(()=>window.__vsim.setupEffort({mode:'vc-cmv',respiratoryRate:60,ieRatio:[1,1]}));
    await active(page); await page.evaluate(()=>window.__vsim.step(2));
    expect((await h.state(page)).lastManualHoldAttempt.mechanics.status).toBe('invalid');
    await expect(page.locator('#hold-attempt')).toContainText('timing limit reached');
    await expect(page).toHaveScreenshot('manual-short-timing-limit-full.png',{fullPage:true});
    await page.keyboard.up('Space'); expect(errors).toEqual([]);
});
