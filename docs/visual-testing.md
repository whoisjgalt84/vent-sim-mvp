# Visual regression testing

Two defects shipped in the 2026-07-29 batch that were **invisible in the code
diff and obvious in a screenshot**: Teaching-Mode readouts clipped by the 208 px
monitor column (unreadable since PR #11), and a Silence button that greyed out
mid-countdown. This suite exists so that class of defect fails a test instead of
reaching an SME.

```bash
npm run test:visual              # compare current-platform snapshots (diagnostic on Windows)
npm run test:visual:docker       # compare in the pinned CI image
npm run test:visual:docker -- --update-snapshots  # generate candidates only
```

This is one of four distinct verification surfaces:

- `npm test`: 300 engine assertions (CI on Node 22 and 24).
- `npm run test:browser`: 44 real-browser behavior assertions; its server
  lifecycle is self-contained (CI in the pinned Playwright image).
- `npm run test:visual`: six screenshot comparisons plus three
  determinism/cache-busting checks (CI in the pinned Playwright image).
- `node scratch/shot.cjs`: diagnostic screenshots for human investigation; not
  an assertion gate and not a substitute for baselines.

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

Authoritative baselines are **platform-tagged Linux files** such as
`baseline-chromium-linux.png`. Generate and compare them only in
`mcr.microsoft.com/playwright:v1.62.1-noble`, whose Playwright version exactly
matches `package-lock.json` and the CI browser-verification job. Windows font
rasterisation and canvas antialiasing differ, so Windows snapshots can be useful
local diagnostics but can never substitute for the CI truth set.

The Docker wrapper is cross-platform and runs a clean `npm ci` in an isolated
container volume before Playwright:

```bash
npm run test:visual:docker -- --update-snapshots
```

That command creates **candidates**, not approved baselines. Run the visual suite
a second time in the same image, build the six-image manifest/review bundle, and
give Christian every full-resolution PNG. Only his explicit acceptance makes
the files authoritative. Then commit exactly those reviewed bytes and verify
their SHA-256 hashes against the approved manifest.

Baselines are committed. `test-results/` and `playwright-report/` are not.

### First run on a fresh clone

If an expected baseline is absent, `npm run test:visual` fails in a preflight
before Playwright starts. It never creates or accepts missing truth during a
comparison run. For initial commissioning or an intentional visual change:

```bash
npm run test:visual:docker -- --update-snapshots  # writes six Linux candidates
npm run test:visual:docker                       # second consecutive comparison
node tools/create-visual-review-bundle.mjs       # run in the pinned environment
```

The suite starts its own server via `tools/serve.mjs`; no Python or hidden
browser path is involved. CI `workflow_dispatch` can generate the same
unapproved review bundle as an artifact. Normal push and pull-request runs only
compare committed, reviewed baselines.

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

The visual suite is the regression gate. `shot.cjs` is a diagnostic aid. They
share a 1440×900 viewport and scenario recipes so the output remains visually
comparable, but only the pinned Linux baselines participate in CI comparisons.
