# Visual regression testing

Two defects shipped in the 2026-07-29 batch that were **invisible in the code
diff and obvious in a screenshot**: Teaching-Mode readouts clipped by the 208 px
monitor column (unreadable since PR #11), and a Silence button that greyed out
mid-countdown. This suite exists so that class of defect fails a test instead of
reaching an SME.

```bash
npm run test:visual              # compare against committed baselines
npm run test:visual:update       # accept a change as the new baseline
npm run test:visual:docker       # run in the pinned image (what CI uses)
```

---

## 1. Why a determinism hook was needed first

A real-time canvas animation can never produce byte-stable screenshots. The
number of engine ticks between two rendered frames depends on frame timing,
which depends on the machine, the GPU, whether the browser is headless, even AC
vs battery. Playwright's own docs are explicit about this.

So the tests do not watch the live loop. They stop it and render one frame at an
exact **simulated** timestamp, via `window.__vsim` (installed at the bottom of
`js/main.js`):

```js
window.__vsim.pause()        // stop the rAF loop
window.__vsim.seek(14)       // reset, advance exactly 1400 ticks, render once
window.__vsim.step(2)        // advance 2 s more from here, render once
window.__vsim.redraw()       // re-render current state, no time passes
window.__vsim.state()        // compact snapshot for assertions
```

`seek()` steps the engine directly rather than through `advance()`, which
bypasses both the 300-tick frame cap and the speed multiplier — so the rendered
frame is a pure function of the seconds requested.

**Never use `page.waitForTimeout()` in a visual test.** It is what makes a suite
flaky, and it is also 100× slower: the whole suite runs in ~12 s, where the
equivalent `scratch/shot.cjs` scenarios spend ~80 s waiting in real time.

The `determinism` describe-block asserts this property directly — two identical
seeks must produce byte-identical PNGs. If that block ever fails, every other
baseline in the suite is untrustworthy and the tolerances mean nothing.

---

## 2. Baselines

Baselines are **platform-tagged** — `baseline-chromium-linux.png`. A baseline
generated on Windows will not match one generated in CI, because font
rasterisation and canvas antialiasing differ.

Because they are platform-tagged, **the simple path is to generate them on your
own machine** — Playwright will write `…-chromium-win32.png` on Windows and
`…-chromium-linux.png` in CI, and the two coexist happily:

```bash
npm run test:visual:update
```

If you later want your machine and CI to compare against the *same* bytes, use
the pinned Docker image instead. Note this script assumes a POSIX shell — on
Windows run it from Git Bash or WSL, not PowerShell:

```bash
npm run test:visual:docker -- --update-snapshots
```

Then **look at every changed PNG before committing it.** A baseline is an
assertion about what correct looks like; accepting one you haven't examined
converts the suite into a rubber stamp. `npx playwright show-report` gives
side-by-side expected/actual/diff.

Baselines are committed. `test-results/` and `playwright-report/` are not.

### First run on a fresh clone

**There are no baselines in the repo yet, so the first `npm run test:visual`
will fail** with "A snapshot doesn't exist" — that is the expected first run,
not a broken suite. Generate them, look at them, commit them:

```bash
npm run test:visual:update        # writes six PNGs
npx playwright show-report        # eyeball all six before trusting them
git add tests/visual/*-snapshots
```

Baselines were deliberately not committed by the agent that built this suite:
they were generated in a cloud sandbox against a different Chromium build, so
they would have failed on your machine for a reason that has nothing to do with
the app. A baseline should be created by someone who can look at it.

---

## 3. Tolerances, and why they are tight

```js
maxDiffPixelRatio: 0.0002,
threshold: 0.1,
```

Because baselines are generated and compared in the same image, rendering is
byte-stable and these only need to absorb antialiasing.

⚠️ **These were mutation-checked, and the first attempt failed the check.** At
`maxDiffPixelRatio: 0.002 / threshold: 0.15`, changing a waveform stroke from
1.8 px to 2.4 px passed unnoticed — a visibly different trace, green suite. At
the current values, even 1.8 → 1.9 goes red.

If you loosen these, re-run that mutation and prove the suite still fails.
**A visual suite that cannot fail is worse than no suite**, because it produces
confidence instead of information.

---

## 4. Writing a new scenario

Use `tests/visual/helpers.js`. Two traps it exists to handle (CLAUDE.md §5):

1. The effort controls live inside a **collapsed "Patient" group** — expand the
   rail first.
2. The entire left rail is `display:none` in Teaching Mode — **do all rail work
   before** turning Teaching Mode on.

```js
test('my scenario', async ({ page }) => {
    await h.open(page);                                   // load + pause
    await h.enableEffort(page, { patientRR: 30, pmus: 6 }); // rail work
    await h.teachingMode(page);                            // rail now hidden
    await h.seek(page, 14);                                // exact timestamp

    // Guard the screenshot with a behavioural assertion, so a scenario that
    // silently stops reproducing its condition fails loudly instead of
    // baselining an empty result.
    const s = await h.state(page);
    expect(s.failedTriggers).toBeGreaterThan(0);

    await expect(page.locator('.waveforms')).toHaveScreenshot('my-scenario.png');
});
```

That guard matters. Without it, a screenshot test happily locks in a baseline of
the scenario *not happening*.

---

## 5. What this suite is not

It sees pixels, not meaning. It cannot tell you a waveform is physiologically
wrong — only that it changed. Physiological correctness lives in
`npm test` (300 engine assertions) and in
[`docs/model.md`](./model.md).

It also does not replace `scratch/verify-batch.cjs`, which asserts *behaviour*
across 44 checks — tooltips, alarm state machines, element geometry. The two are
complementary: verify-batch answers "does it still work", this answers "does it
still look right".

---

## 6. Relationship to `scratch/shot.cjs`

`shot.cjs` stays. It is a diagnostic tool — full-page and cropped screenshots
you look at while working, with a rail-overflow and clipped-readout report. It
asserts nothing and is not a gate.

This suite is the gate. Same viewport (1440×900) and the same scenario recipes,
so the two remain visually comparable.
