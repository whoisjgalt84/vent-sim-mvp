const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const url = process.env.VSM_TRIGGER_URL || 'http://127.0.0.1:8899';
const modes = ['vc-cmv', 'pc-cmv', 'PC-CSV', 'pc-cmva'];
const specs = {
 flow: { id: 'flow-trigger', field: 'flowTriggerLpm', initial: 2, unit: 'L/min' },
 pressure: { id: 'pressure-trigger', field: 'pressureTriggerCmH2O', initial: 1, unit: 'cmH2O' },
};
const state = p => p.evaluate(() => __vsim.state());
const config = s => s.resetDiagnostics.configuration;
const stable = s => ({ config: config(s), revision: s.inputRevision, adaptive: s.adaptiveState, hold: s.manualHold, history: s.lastValidManualHold, time: s.globalTime });
const setup = (p, mode = 'vc-cmv', type = 'flow') => p.evaluate(({ mode, type }) => __vsim.setupEffort({ mode, triggerType: type, pMusMax: 0, patientRR: 0 }), { mode, type });
const open = (p, type = 'flow') => p.locator('#' + specs[type].id + '-tile').click();
const fill = (p, value) => p.locator('#setting-draft').fill(String(value));
const confirm = p => p.locator('#setting-confirm').click();
const cancel = p => p.locator('#setting-cancel').click();
let passed = 0, failed = 0;
(async () => {
 const browser = await chromium.launch();
 async function group(name, fn) {
  if (process.env.VSM_TRIGGER_GROUP && !name.startsWith(process.env.VSM_TRIGGER_GROUP)) return;
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true }), errors = [];
  p.setDefaultTimeout(5000); p.on('pageerror', e => errors.push(String(e)));
  try {
   if (process.env.VSM_TRIGGER_MUTATION) await p.route('**/js/main.js*', async route => {
    const response = await route.fetch(); let body = (await response.text()).replace(/\r\n/g, '\n');
    const patches = {
     decimal: ['&& (rounded - Math.round(min * scale)) % Math.round(step * scale) === 0 ? value : null;', '&& Number.isInteger((value - min) / step) ? value : null;'],
     immediate: ['    settingDraft.text = text;', "    settingDraft.text = text; if (settingDraft.id === 'flow-trigger' && Number(text) >= .5) vent.flowTriggerLpm = Number(text);"],
     notification: ['    sim.notifyMeasurementSettingsChanged();\n    updateMonitorValues(vent.summary()); updateHoldResults();\n}\n// Live regions', '    updateMonitorValues(vent.summary()); updateHoldResults();\n}\n// Live regions'],
    };
    const patch = patches[process.env.VSM_TRIGGER_MUTATION];
    assert.ok(patch && body.includes(patch[0]), 'mutation target exists');
    body = body.replace(patch[0], patch[1]); await route.fulfill({ response, body });
   });
   await p.goto(url); await p.waitForFunction(() => window.__vsim); await setup(p);
   await fn(p); assert.deepEqual(errors, []); passed++; console.log('PASS trigger ' + name);
  } catch (e) { failed++; console.error('FAIL trigger ' + name + '\n' + e.stack); }
  finally { await p.close(); }
 }
 await group('all 46 legal tenths confirm exactly for both trigger types', async p => {
  for (const [type, spec] of Object.entries(specs)) {
   await setup(p, 'vc-cmv', type);
   for (let n = 5; n <= 50; n++) {
    const value = n / 10, before = config(await state(p));
    await open(p, type); await fill(p, value.toFixed(1));
    assert.equal(await p.locator('#setting-confirm').isDisabled(), false, type + ' valid ' + value);
    assert.deepEqual(config(await state(p)), before, 'draft never applies');
    await confirm(p); assert.deepEqual(config(await state(p)), { ...before, [spec.field]: value });
   }
  }
 });
 await group('invalid text stays invalid without changing settings or coercion', async p => {
  for (const type of Object.keys(specs)) {
   await setup(p, 'vc-cmv', type); await open(p, type); const before = config(await state(p));
   for (const value of ['', 'abc', 'NaN', 'Infinity', '-1', '0.4', '5.1', '0.55', '1.01', '2.0001']) {
    await fill(p, value); assert.equal(await p.locator('#setting-confirm').isDisabled(), true, type + ' ' + value);
    assert.equal(await p.locator('#setting-draft').getAttribute('aria-invalid'), 'true');
    await p.locator('#setting-confirm').evaluate(e => e.click());
    assert.deepEqual(config(await state(p)), before); assert.equal(await p.locator('#setting-draft').inputValue(), value);
   }
   await cancel(p); assert.deepEqual(config(await state(p)), before);
  }
 });
 await group('decimal nudges round trip and clamp without drift', async p => {
  for (const type of Object.keys(specs)) {
   await setup(p, 'vc-cmv', type); await open(p, type); await fill(p, '0.5');
   for (let n = 6; n <= 50; n++) { await p.locator('#setting-increase').click(); assert.equal(Number(await p.locator('#setting-draft').inputValue()), n / 10); assert.equal(await p.locator('#setting-confirm').isDisabled(), false); }
   const top = stable(await state(p)); await p.locator('#setting-increase').click(); assert.equal(Number(await p.locator('#setting-draft').inputValue()), 5); assert.deepEqual(stable(await state(p)), top);
   for (let n = 49; n >= 5; n--) { await p.locator('#setting-decrease').click(); assert.equal(Number(await p.locator('#setting-draft').inputValue()), n / 10); }
   const bottom = stable(await state(p)); await p.locator('#setting-decrease').click(); assert.equal(Number(await p.locator('#setting-draft').inputValue()), .5); assert.deepEqual(stable(await state(p)), bottom);
   await p.locator('#setting-range').focus(); await p.keyboard.press('ArrowRight'); assert.equal(Number(await p.locator('#setting-draft').inputValue()), .6); await cancel(p);
  }
 });
 await group('four mode inert opening unchanged confirm and immediate threshold commit', async p => {
  for (const mode of modes) for (const [type, spec] of Object.entries(specs)) {
   await setup(p, mode, type); const before = stable(await state(p)); await open(p, type);
   await p.locator('#setting-draft').dispatchEvent('input'); assert.deepEqual(stable(await state(p)), before);
   await confirm(p); assert.deepEqual(stable(await state(p)), before);
   assert.equal(await p.locator('#' + spec.id + '-tile').evaluate(e => e === document.activeElement), true);
   await open(p, type); await fill(p, '1.7'); assert.deepEqual(config(await state(p)), before.config);
   await p.keyboard.press('Enter'); const after = await state(p);
   assert.deepEqual(config(after), { ...before.config, [spec.field]: 1.7 }); assert.equal(after.globalTime, before.time, 'paused Confirm is immediate, no simulation tick needed');
   if (mode === 'pc-cmva') assert.equal(after.adaptiveState.pendingSettings, null, 'trigger is not queued');
   await open(p, type); await fill(p, '3.6'); await cancel(p); assert.equal(config(await state(p))[spec.field], 1.7);
   await open(p, type); await fill(p, '2.3');
   await p.evaluate(() => __vsim.resume());
   const runningCommit = await p.locator('#setting-confirm').evaluate(e => {
    const before = __vsim.state(); e.click(); const after = __vsim.state();
    return { before, after };
   });
   assert.equal(runningCommit.before.running, true, 'nonvacuous running Confirm');
   assert.equal(runningCommit.after.running, true, 'Confirm preserves running transport');
   assert.equal(runningCommit.after.globalTime, runningCommit.before.globalTime, 'threshold applies in event before any simulation tick');
   assert.equal(runningCommit.after.breathCount, runningCommit.before.breathCount, 'no new breath needed');
   assert.deepEqual(config(runningCommit.after), { ...config(runningCommit.before), [spec.field]: 2.3 });
   if (mode === 'pc-cmva') assert.equal(runningCommit.after.adaptiveState.pendingSettings, null, 'running trigger confirmation has no adaptive setting queue');
   await p.evaluate(() => __vsim.pause());
  }
 });
 await group('type selection is immediate and stale drafts never apply', async p => {
  for (const mode of modes) for (const type of Object.keys(specs)) {
   await setup(p, mode, type); await open(p, type); await fill(p, '4.7');
   const other = type === 'flow' ? 'pressure' : 'flow';
   await p.locator('[data-trigger-type="' + other + '"]').click();
   assert.equal(await p.locator('#setting-editor').isVisible(), false); const s = await state(p);
   assert.equal(config(s).triggerType, other); assert.equal(config(s)[specs[type].field], specs[type].initial);
   await p.locator('#setting-confirm').evaluate(e => e.click()); assert.deepEqual(config(await state(p)), config(s));
   await open(p, other); assert.equal(Number(await p.locator('#setting-draft').inputValue()), specs[other].initial); await cancel(p);
   for (const action of ['#btn-reset', '#btn-teaching-mode', '[data-mode="' + (mode === 'vc-cmv' ? 'pc-cmv' : 'vc-cmv') + '"]']) {
    await setup(p, mode, type); if ((await state(p)).teachingMode) await p.locator('#btn-teaching-mode').click();
    await open(p, type); await fill(p, '4.7'); await p.locator(action).click();
    assert.equal(await p.locator('#setting-editor').isVisible(), false); assert.equal(config(await state(p))[specs[type].field], specs[type].initial);
   }
   if ((await state(p)).teachingMode) await p.locator('#btn-teaching-mode').click();
  }
  for (const mode of modes) {
   await setup(p, mode, 'flow');
   await open(p, 'flow'); await fill(p, '1.3'); await confirm(p);
   await p.locator('[data-trigger-type="pressure"]').click();
   await open(p, 'pressure'); await fill(p, '3.7'); await confirm(p);
   for (const type of ['flow', 'pressure', 'flow', 'pressure']) {
    await p.locator('[data-trigger-type="' + type + '"]').click();
    const c = config(await state(p));
    assert.equal(c.triggerType, type); assert.equal(c.flowTriggerLpm, 1.3); assert.equal(c.pressureTriggerCmH2O, 3.7);
    await open(p, type);
    assert.equal(Number(await p.locator('#setting-draft').inputValue()), type === 'flow' ? 1.3 : 3.7, 'distinct confirmed threshold survives repeated real switches');
    await cancel(p);
   }
  }
 });
 await group('hidden source routes are draft only and editors remain mutually exclusive', async p => {
  for (const [type, spec] of Object.entries(specs)) {
   await setup(p, 'vc-cmv', type); const before = config(await state(p));
   await p.locator('#' + spec.id).evaluate(e => { e.value = '2.7'; e.dispatchEvent(new Event('input', { bubbles: true })); });
   assert.deepEqual(config(await state(p)), before); assert.equal(await p.locator('#setting-editor').isVisible(), true); await cancel(p);
   await open(p, type); await fill(p, '3.7'); await p.locator('#vt-tile').click(); assert.deepEqual(config(await state(p)), before); assert.match(await p.locator('#setting-editor-title').innerText(), /Tidal Volume/); await cancel(p);
   await p.locator('#vt-tile').click(); await fill(p, '620'); await open(p, type); await fill(p, '2.7'); await confirm(p); assert.equal(config(await state(p)).tidalVolume, before.tidalVolume); assert.equal(config(await state(p))[spec.field], 2.7);
  }
 });
 await group('hold draft safety cancels armed active attempts but retains valid history', async p => {
  for (const mode of ['vc-cmv', 'pc-cmv']) for (const type of Object.keys(specs)) for (const active of [false, true]) {
   await setup(p, mode, type); await p.evaluate(() => __vsim.manualHoldFixture(.6)); const saved = (await state(p)).lastValidManualHold; assert.ok(saved);
   await open(p, type); await p.locator('#hold-toggle').evaluate(e => e.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
   if (active) await p.evaluate(() => { for (let i = 0; i < 800 && !__vsim.state().manualHold.active; i++) __vsim.stepTicks(1); });
   assert.equal((await state(p)).manualHold[active ? 'active' : 'armed'], true);
   await p.locator('#setting-draft').evaluate(e => { e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); });
   const after = await state(p); assert.equal(after.manualHold.active, false); assert.equal(after.manualHold.armed, false); assert.deepEqual(after.lastValidManualHold, saved);
   assert.match(await p.locator('#setting-consequence').innerText(), /Cancel cannot restore/); await cancel(p); assert.deepEqual((await state(p)).lastValidManualHold, saved);
   await p.locator('#hold-toggle').evaluate(e => e.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })));
  }
 });
 await group('adaptive invalid edit revert and Cancel preserve safety invalidation', async p => {
  for (const type of Object.keys(specs)) {
   await setup(p, 'pc-cmva', type); await p.evaluate(() => __vsim.stepTicks(110)); await open(p, type);
   const before = await state(p), initial = await p.locator('#setting-draft').inputValue();
   await fill(p, ''); await fill(p, initial); const changed = await state(p);
   assert.ok(changed.adaptiveState.epoch > before.adaptiveState.epoch); assert.deepEqual(config(changed), config(before)); assert.equal(changed.adaptiveState.pendingSettings, null);
   assert.match(await p.locator('#setting-consequence').innerText(), /does not restore the cleared feedback/); await cancel(p);
   assert.equal((await state(p)).adaptiveState.epoch, changed.adaptiveState.epoch);
  }
 });
 await group('accessible labels notices focus and narrow actions remain usable', async p => {
  for (const width of [1440, 390]) for (const mode of modes) for (const [type, spec] of Object.entries(specs)) {
   await p.setViewportSize({ width, height: 500 }); await setup(p, mode, type);
   const tile = p.locator('#' + spec.id + '-tile'); await tile.focus(); await p.keyboard.press('Enter');
   assert.equal(await p.locator('#setting-draft').evaluate(e => e === document.activeElement), true);
   assert.match(await p.locator('#setting-editor-title').innerText(), new RegExp(type, 'i'));
   assert.match(await p.locator('#setting-draft-label').innerText(), type === 'flow' ? /L\/min/ : /cmH.?O/);
   assert.equal(await p.locator('#setting-accepted').isVisible(), false, 'Trigger has no pending queue status');
   const colors = await p.evaluate(() => { const flow = getComputedStyle(document.querySelector('#trigger-type-group .ie-btn--active')), tile = getComputedStyle(document.querySelector('.trigger-setting-tile[aria-expanded="true"]')); return [flow.backgroundColor, flow.borderTopColor, tile.backgroundColor, tile.borderTopColor]; });
   assert.deepEqual(colors.slice(2), colors.slice(0, 2), 'Sensitivity matches selected trigger type fill and outline');
   const notice = await p.locator('#setting-consequence').innerText();
   assert.match(notice, mode === 'pc-cmva' ? /controller/ : mode === 'PC-CSV' ? /Confirm/ : /manual hold/);
   await p.evaluate(() => { window.triggerStatusMutations = 0; window.triggerStatusObserver = new MutationObserver(ms => triggerStatusMutations += ms.length); triggerStatusObserver.observe(document.getElementById('setting-consequence'), { childList: true, subtree: true, characterData: true }); });
   await p.evaluate(async () => { __vsim.resume(); for (let i = 0; i < 12; i++) await new Promise(requestAnimationFrame); __vsim.pause(); });
   assert.equal(await p.evaluate(() => triggerStatusMutations), 0); await p.evaluate(() => triggerStatusObserver.disconnect());
   for (const id of ['setting-confirm', 'setting-cancel']) { await p.locator('#' + id).scrollIntoViewIfNeeded(); const b = await p.locator('#' + id).boundingBox(); assert.ok(b.y >= 0 && b.y + b.height <= 500.5); }
   assert.equal(await p.locator('#setting-editor').evaluate(e => e.scrollWidth > e.clientWidth), false);
   if (process.env.VSM_TRIGGER_SHOTS) { fs.mkdirSync(process.env.VSM_TRIGGER_SHOTS, { recursive: true }); await p.screenshot({ path: process.env.VSM_TRIGGER_SHOTS + '/' + mode + '-' + type + '-' + width + '.png', fullPage: true }); }
   await p.keyboard.press('Escape'); assert.equal(await p.locator('#setting-editor').isVisible(), false); assert.equal(await tile.evaluate(e => e === document.activeElement), true);
  }
 });
 await browser.close(); console.log(`TRIGGER_EDITOR_BROWSER_TALLY ${passed} passed, ${failed} failed`);
 if (passed !== (process.env.VSM_TRIGGER_GROUP ? 1 : 9) || failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
